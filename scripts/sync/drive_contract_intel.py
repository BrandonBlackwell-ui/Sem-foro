#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Escáner documental de contratos por cliente. Abre la carpeta "01" (Contrato/OC)
de cada carpeta de cliente en Drive, lee el/los contrato(s) y extrae con LLM los
campos que alimentan el CO y el gate del score global:
  - tiene_contrato_firmado, tipo_acuerdo, vigencia_inicio/fin, periodicidad_pago
  - meta_entregables  (publicaciones/notas comprometidas por mes → insumo del CO)
  - objetivos, servicios, resumen, faltantes, notas

Escribe en la tabla Supabase `drive_account_intel` (misma que lee el dashboard).
Complementa a drive_roster_sync.py (ese solo lee nombres de carpeta → roster).

Auth: service account (GOOGLE_SERVICE_ACCOUNT_JSON) con acceso de lectura a
DRIVE_ROOT_FOLDER_ID. LLM vía OpenRouter (OPENROUTER_API_KEY / OPENROUTER_MODEL).

Uso:
    python scripts/sync/drive_contract_intel.py                 # todas las cuentas
    python scripts/sync/drive_contract_intel.py --accounts 5,8,17
    python scripts/sync/drive_contract_intel.py --only-missing  # solo sin contrato firmado
    python scripts/sync/drive_contract_intel.py --dry-run
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.sync.config import (
        SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON,
        DRIVE_ROOT_FOLDER_ID, OPENROUTER_API_KEY, OPENROUTER_MODEL,
    )
except ModuleNotFoundError:
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import (
        SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON,
        DRIVE_ROOT_FOLDER_ID, OPENROUTER_API_KEY, OPENROUTER_MODEL,
    )

log = logging.getLogger("drive_contract_intel")

MAX_DOC_CHARS = 18000          # texto máximo enviado al LLM por cuenta
MAX_DOCS_PER_ACCOUNT = 3       # cuántos documentos de la carpeta 01 leer
MAX_DOWNLOAD_BYTES = 8_000_000 # no descargar archivos gigantes

CONTRACT_FOLDER_RX = re.compile(r"(^\s*0?1[\s.\-_)]|contrat|_oc\b|\bodc\b|contract)", re.I)
CONTRACT_DOC_RX = re.compile(r"(contrat|_oc\b|\bodc\b|propuesta|convenio|acuerdo|anexo|contract)", re.I)

GDOC = "application/vnd.google-apps.document"
GSHEET = "application/vnd.google-apps.spreadsheet"
GSLIDE = "application/vnd.google-apps.presentation"
PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def parse_number(folder_title: str) -> str | None:
    m = re.match(r"^\s*(\d+)", folder_title)
    return str(int(m.group(1))).zfill(2) if m else None


def clean_name(folder_title: str) -> str:
    no_num = re.sub(r"^\s*\d+\.\s*", "", folder_title)
    return no_num.split("/")[0].split("(")[0].strip()


# --- Google Drive ------------------------------------------------------------

def build_drive_service():
    if not GOOGLE_SERVICE_ACCOUNT_JSON.strip():
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON is required (service-account key JSON).")
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    info = json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
    # drive.readonly (no metadata-only) para poder EXPORTAR/DESCARGAR el contenido.
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_children(service, parent_id: str, only_folders: bool = False) -> list[dict]:
    items: list[dict] = []
    page_token = None
    q = f"'{parent_id}' in parents and trashed = false"
    if only_folders:
        q += " and mimeType = 'application/vnd.google-apps.folder'"
    while True:
        resp = service.files().list(
            q=q,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
            pageSize=1000, orderBy="name",
            supportsAllDrives=True, includeItemsFromAllDrives=True,
            corpora="allDrives", pageToken=page_token,
        ).execute()
        items.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return items


def read_doc_text(service, f: dict) -> str:
    """Devuelve texto plano de un Google Doc / PDF / DOCX. '' si no se puede."""
    mime = f.get("mimeType", "")
    fid = f["id"]
    try:
        size = int(f.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    if size and size > MAX_DOWNLOAD_BYTES:
        return ""
    try:
        if mime == GDOC:
            data = service.files().export(fileId=fid, mimeType="text/plain").execute()
            return data.decode("utf-8", "ignore") if isinstance(data, bytes) else str(data)
        if mime == PDF:
            raw = service.files().get_media(fileId=fid, supportsAllDrives=True).execute()
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(raw))
                return "\n".join((p.extract_text() or "") for p in reader.pages[:40])
            except Exception as exc:  # noqa: BLE001
                log.warning("PDF sin texto extraíble (%s): %s", f.get("name"), exc)
                return ""
        if mime == DOCX:
            raw = service.files().get_media(fileId=fid, supportsAllDrives=True).execute()
            try:
                import docx  # python-docx
                d = docx.Document(io.BytesIO(raw))
                return "\n".join(p.text for p in d.paragraphs)
            except Exception as exc:  # noqa: BLE001
                log.warning("DOCX sin texto (%s): %s", f.get("name"), exc)
                return ""
    except Exception as exc:  # noqa: BLE001
        log.warning("No pude leer %s: %s", f.get("name"), exc)
    return ""


def find_contract_folder(service, account_folder_id: str) -> dict | None:
    subs = list_children(service, account_folder_id, only_folders=True)
    # prioridad: nombre que empiece con "01"; luego cualquiera que mencione contrato
    for s in subs:
        if re.match(r"^\s*0?1[\s.\-_)]", s.get("name", "")):
            return s
    for s in subs:
        if CONTRACT_FOLDER_RX.search(s.get("name", "")):
            return s
    return None


# --- LLM ---------------------------------------------------------------------

EXTRACTION_SYSTEM = (
    "Eres un analista de contratos de una agencia de comunicación. Extrae SOLO lo que "
    "aparezca explícitamente en el texto del contrato/propuesta. Si un dato no está, "
    "usa null (o lista vacía). No inventes. Responde ÚNICAMENTE con un objeto JSON."
)
EXTRACTION_INSTRUCTIONS = (
    "Del siguiente texto de contrato(s), extrae este JSON EXACTO:\n"
    "{\n"
    '  "tiene_contrato_firmado": boolean,  // true si es un contrato/OC/convenio (no una simple propuesta sin firmar)\n'
    '  "tipo_acuerdo": "contrato|ODC|propuesta|convenio_intercambio|anexo|null",\n'
    '  "vigencia_inicio": "YYYY-MM-DD exacto, o null (nunca texto)",\n'
    '  "vigencia_fin": "YYYY-MM-DD exacto, o null (nunca texto)",\n'
    '  "periodicidad_pago": "texto o null",\n'
    '  "meta_mensual_num": <ENTERO o null>,  // publicaciones/notas/colocaciones/impactos comprometidos POR MES, como NÚMERO. Convierte semanal→×4, trimestral→÷3, cuatrimestral→÷4, o "N en M semanas"→ redondea a N/(M/4.33). Si viene en letra ("cuatro"→4) o entre paréntesis ("(4)"→4), usa el dígito. Si es rango, usa el mínimo garantizado. Si el servicio es solo monitoreo/reportes sin número fijo de notas, null.\n'
    '  "meta_entregables": "descripción breve y literal de los entregables comprometidos.",\n'
    '  "objetivos": ["..."],\n'
    '  "servicios": ["..."],\n'
    '  "resumen": "1-2 frases",\n'
    '  "faltantes": ["huecos documentales o datos que no venían"],\n'
    '  "notas": "observaciones relevantes o null"\n'
    "}\n"
)


def llm_extract(text: str) -> dict:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is required.")
    payload = {
        "model": OPENROUTER_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {"role": "user", "content": EXTRACTION_INSTRUCTIONS + "\n\n=== TEXTO ===\n" + text[:MAX_DOC_CHARS]},
        ],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "https://github.com/BrandonBlackwell-ui/Sem-foro"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Blackwell Semaforo"),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    content = body["choices"][0]["message"]["content"]
    # el modelo a veces envuelve en ```json ... ```
    content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.I | re.M).strip()
    return json.loads(content)


def valid_date(v) -> str | None:
    if not v or not isinstance(v, str):
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", v.strip())
    return v.strip() if m else None


def as_list(v) -> list:
    if isinstance(v, list):
        return v
    if v in (None, "", "null"):
        return []
    return [v]


# --- main --------------------------------------------------------------------

def process_account(service, folder: dict) -> dict | None:
    title = (folder.get("name") or "").strip()
    number = parse_number(title)
    if not number:
        return None
    client = clean_name(title)
    log.info("→ [%s] %s", number, client)

    subs = list_children(service, folder["id"], only_folders=True)
    subfolders = [s.get("name") for s in subs]
    contract_folder = find_contract_folder(service, folder["id"])

    # Recolectar candidatos de varias fuentes (dedup por id):
    #  1) todo lo que haya en la carpeta "01"/Contrato,
    #  2) documentos con nombre de contrato en la raíz de la cuenta y en CADA
    #     subcarpeta (por si el contrato no está en "01" o tiene otro acomodo).
    cand: dict[str, dict] = {}
    if contract_folder:
        for f in list_children(service, contract_folder["id"]):
            if f.get("mimeType") != "application/vnd.google-apps.folder":
                cand[f["id"]] = f
    for parent in [folder, *subs]:
        for f in list_children(service, parent["id"]):
            if f.get("mimeType") in (GDOC, PDF, DOCX) and CONTRACT_DOC_RX.search(f.get("name", "")):
                cand.setdefault(f["id"], f)

    files = list(cand.values())
    # priorizar los que parecen contrato y los de la carpeta "01"; leer hasta N
    files.sort(key=lambda f: (0 if CONTRACT_DOC_RX.search(f.get("name", "")) else 1,
                              f.get("name", "")))
    readable = [f for f in files if f.get("mimeType") in (GDOC, PDF, DOCX)]

    analyzed, texts = [], []
    for f in readable[:MAX_DOCS_PER_ACCOUNT]:
        t = read_doc_text(service, f)
        if t and t.strip():
            texts.append(f"# {f.get('name')}\n{t}")
            analyzed.append({"name": f.get("name"), "kind": f.get("mimeType"), "modified": f.get("modifiedTime")})

    now = datetime.now(timezone.utc).isoformat()
    base = {
        "account_number": number,
        "client_name": client,
        "folder_title": title,
        "docs_total": len(files),
        "subfolders": subfolders,
        "contract_docs": [{"name": f.get("name"), "id": f.get("id")} for f in files if CONTRACT_DOC_RX.search(f.get("name", ""))],
        "analyzed_docs": analyzed,
        # columnas NOT NULL default '[]' — deben ir en TODAS las filas (el upsert
        # batch manda null si una fila las omite y otra no).
        "objetivos": [],
        "servicios": [],
        "contratos_previos": [],
        "faltantes": [],
        "model": OPENROUTER_MODEL,
        "synced_at": now,
    }

    if not texts:
        base.update({
            "tiene_contrato_firmado": False,
            "meta_entregables": "",
            "resumen": None,
            "faltantes": ["No se encontró contrato legible en la carpeta 01"],
            "notas": "Sin documento de contrato legible (Google Doc/PDF/DOCX) en la carpeta 01.",
        })
        return base

    try:
        llm = llm_extract("\n\n".join(texts))
    except Exception as exc:  # noqa: BLE001
        log.warning("LLM falló para %s: %s", number, exc)
        base.update({"notas": f"Extracción LLM falló: {exc}", "faltantes": ["Extracción LLM pendiente"]})
        return base

    # Meta: preferir el número mensual limpio del LLM. Se guarda en formato
    # canónico "N publicaciones/mes" para que el dashboard lo parsee sin ambigüedad
    # (nada de "semanas"/paréntesis/letras cerca del número). El detalle textual
    # se preserva en notas.
    meta_num = llm.get("meta_mensual_num")
    try:
        meta_num = int(round(float(meta_num))) if meta_num not in (None, "", "null") else None
    except (TypeError, ValueError):
        meta_num = None
    desc = (llm.get("meta_entregables") or "").strip()
    notas = llm.get("notas") or None
    if meta_num and meta_num > 0:
        meta_field = f"{meta_num} publicaciones/mes"
        if desc:
            notas = (f"Meta (detalle): {desc}" + (f" · {notas}" if notas else ""))
    else:
        meta_field = desc

    base.update({
        "resumen": llm.get("resumen"),
        "tiene_contrato_firmado": bool(llm.get("tiene_contrato_firmado")),
        "tipo_acuerdo": llm.get("tipo_acuerdo") or None,
        "vigencia_inicio": valid_date(llm.get("vigencia_inicio")),
        "vigencia_fin": valid_date(llm.get("vigencia_fin")),
        "periodicidad_pago": llm.get("periodicidad_pago") or None,
        "objetivos": as_list(llm.get("objetivos")),
        "servicios": as_list(llm.get("servicios")),
        "meta_entregables": meta_field,
        "faltantes": as_list(llm.get("faltantes")),
        "notas": notas,
        "intel": llm,
    })
    return base


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    ap = argparse.ArgumentParser(description="Escanea contratos del Drive y llena drive_account_intel.")
    ap.add_argument("--accounts", help="Lista de números a procesar, ej. '5,8,17'. Por defecto: todas.")
    ap.add_argument("--only-missing", action="store_true", help="Solo cuentas sin contrato firmado en la tabla.")
    ap.add_argument("--dry-run", action="store_true", help="No escribe en Supabase; imprime el resultado.")
    args = ap.parse_args()

    service = build_drive_service()
    log.info("Crawling Drive root %s ...", DRIVE_ROOT_FOLDER_ID)
    account_folders = list_children(service, DRIVE_ROOT_FOLDER_ID, only_folders=True)

    wanted: set[str] | None = None
    if args.accounts:
        wanted = {str(int(x)).zfill(2) for x in re.split(r"[,\s]+", args.accounts.strip()) if x}

    sb = None
    if not args.dry_run or args.only_missing:
        if not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_SERVICE_KEY is required.")
        from supabase import create_client
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if args.only_missing and sb is not None:
        existing = sb.table("drive_account_intel").select("account_number,tiene_contrato_firmado").execute().data or []
        have = {r["account_number"] for r in existing if r.get("tiene_contrato_firmado") is True}
        wanted = ({parse_number(f.get("name", "")) for f in account_folders} - have) - {None}
        log.info("only-missing → %d cuentas sin contrato firmado", len(wanted))

    rows: list[dict] = []
    for folder in account_folders:
        number = parse_number(folder.get("name", ""))
        if not number or (wanted is not None and number not in wanted):
            continue
        try:
            row = process_account(service, folder)
        except Exception as exc:  # noqa: BLE001
            log.warning("Error procesando %s: %s", folder.get("name"), exc)
            continue
        if row:
            rows.append(row)

    print("\n" + "=" * 70)
    print(f"  CONTRATOS ESCANEADOS — {len(rows)} cuentas")
    print("=" * 70)
    for r in rows:
        flag = "✔ firmado" if r.get("tiene_contrato_firmado") else "· sin firma"
        vig = f"{r.get('vigencia_inicio') or '?'}..{r.get('vigencia_fin') or '?'}"
        print(f"  {r['account_number']} {r['client_name'][:22]:22} {flag:11} {vig:24} meta: {(r.get('meta_entregables') or '')[:50]}")
    print("=" * 70 + "\n")

    if args.dry_run:
        log.info("Dry-run — nada escrito.")
        return
    if not rows:
        log.warning("Sin filas — nada que escribir.")
        return

    sb.table("drive_account_intel").upsert(rows, on_conflict="account_number").execute()
    log.info("Upserted %d filas en drive_account_intel.", len(rows))


if __name__ == "__main__":
    main()
