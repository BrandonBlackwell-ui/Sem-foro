#!/usr/bin/env python3
"""
task_sync.py — Sincroniza las tareas pendientes por cliente con Supabase.

Es el puerto a Python de dashboard/src/lib/taskExtractor.ts. En cada corrida
del sync:

  1. Lee data/accounts/*/drive_intelligence.json (análisis IA por cuenta).
  2. Extrae las tareas pendientes (urgent_actions, pending, action_plan no
     hecho, client_promises pendientes/en riesgo) con el MISMO id determinista
     que genera el dashboard (ia_<account>_<hash>), para que nunca se dupliquen.
  3. Sube a Supabase (tabla client_tasks) las tareas nuevas.
  4. Marca como 'hecho' las tareas IA que ya no aparecen en el análisis
     actual de la cuenta (la IA ya no las reporta como pendientes).

Las tareas en Supabase son las que después se reflejan en Monday.

Uso standalone:
  python scripts/sync/task_sync.py             # sincroniza
  python scripts/sync/task_sync.py --dry-run   # muestra qué haría sin escribir
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import DATA_DIR, SUPABASE_KEY, SUPABASE_URL

logger = logging.getLogger("task_sync")

# ── Mapeo número → id de cuenta (idéntico a useAccounts.ts NUMBER_TO_ID) ─────
NUMBER_TO_ID = {
    "01": "turbofin", "02": "maja", "03": "aduanas", "04": "idlayr", "05": "credix",
    "06": "rocha", "07": "apollo", "08": "uldis", "09": "azvi", "10": "jack",
    "11": "futbol", "12": "tello", "13": "cima", "14": "dalinde", "15": "armor",
    "16": "mapelly", "17": "irugami", "18": "stprm", "19": "pujol", "20": "veracruz",
    "21": "nuvoil", "22": "totalplay", "23": "luca", "24": "gicsa", "25": "andy",
    "26": "bernardo", "27": "cuernavaca", "28": "queretaro", "29": "coastoil",
    "30": "erikrubi", "31": "sasil", "32": "cojab", "33": "neza", "34": "supplypay",
    "35": "pepe", "36": "terry", "37": "leadsales", "38": "karpowership",
}


# ─────────────────────────────────────────────────────────────────────────────
# Port exacto de taskExtractor.ts (mismos ids = cero duplicados con el dashboard)
# ─────────────────────────────────────────────────────────────────────────────

def _to_int32(x: int) -> int:
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x


_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _base36(n: int) -> str:
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _BASE36[r] + out
    return out


def hash_string(s: str) -> str:
    """djb2 → base36, sobre unidades UTF-16 igual que charCodeAt en JS."""
    h = 5381
    units = s.encode("utf-16-le")
    for i in range(0, len(units), 2):
        code = units[i] | (units[i + 1] << 8)
        h = _to_int32(_to_int32(h << 5) + h + code)
    return _base36(h & 0xFFFFFFFF)


def normalize(s: str) -> str:
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not (0x0300 <= ord(ch) <= 0x036F))
    return re.sub(r"\s+", " ", s).strip()


TYPE_RULES = [
    ("crisis", ["crisis", "playbook", "riesgo reputacional", "contencion", "contingencia", "narrativa adversa"]),
    ("media_training", ["media training", "mediatraining", "voceria", "vocero", "entrenamiento", "briefing", "q&a", "q & a"]),
    ("campana", ["campana", "lanzamiento", "press junket", "junket", "activacion", "evento", "gira", "concierto", "press trip"]),
    ("reunion", ["reunion", "junta", "llamada", "call", "sesion", "touch point", "kickoff", "alineacion"]),
    ("reporte", ["reporte", "informe", "report", "entrega escrita", "documentacion", "dossier", "revision formal", "revision de desempeno"]),
    ("analisis", ["analisis", "monitoreo", "sentimiento", "social listening", "dashboard", "metricas", "metrica", "baseline", "medicion", "kpi"]),
    ("nota_clientes", ["nota a cliente", "nota al cliente", "comunicado", "boletin", "nota de prensa", "aclaracion"]),
]


def classify_work_type(text: str) -> str:
    n = normalize(text)
    for wtype, kws in TYPE_RULES:
        if any(k in n for k in kws):
            return wtype
    return "otro"


def to_title(text: str) -> str:
    t = text.strip()
    cuts = [" — ", " – ", " - ", " (", "; ", ": ", " per ", " RIESGO", " (hoy"]
    cut_at = len(t)
    for c in cuts:
        idx = t.find(c)
        if 12 < idx < cut_at:
            cut_at = idx
    t = t[:cut_at].strip()
    if len(t) > 110:
        t = t[:107].rstrip() + "…"
    return t


MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

_DATE_RE = re.compile(
    r"(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto"
    r"|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s*(?:de\s+)?(\d{4}))?"
)


def parse_due_date(text: str) -> str | None:
    m = _DATE_RE.search(normalize(text))
    if not m:
        return None
    day = int(m.group(1))
    month = MONTHS.get(m.group(2), 0)
    year = int(m.group(3)) if m.group(3) else datetime.now().year
    if not month or day < 1 or day > 31:
        return None
    if year < 2000 or year > 2100:
        year = datetime.now().year
    return f"{year}-{month:02d}-{day:02d}"


def _as_arr(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str) and v.strip():
        return [v]
    return []


def extract_tasks(account_id: str, account_name: str, summary: dict,
                  default_responsable: str | None = None) -> list[dict]:
    """Extrae las tareas pendientes del account_summary de una cuenta."""
    if not summary:
        return []

    candidates: list[dict] = []
    seen: set[str] = set()

    def push(title: str, detail: str, responsable=None, due=None):
        key = normalize(title or detail)[:80]
        if not key or key in seen:
            return
        seen.add(key)
        candidates.append({"title": title, "detail": detail,
                           "responsable": responsable, "due": due})

    # 1 · Acciones urgentes
    for a in _as_arr(summary.get("urgent_actions")):
        action = a if isinstance(a, str) else (a or {}).get("action")
        if not action:
            continue
        owner = (a or {}).get("owner") if isinstance(a, dict) else None
        due = (a or {}).get("due") if isinstance(a, dict) else None
        push(
            to_title(str(action)), str(action),
            responsable=str(owner) if owner and str(owner) != "null" else None,
            due=(parse_due_date(str(due)) if due and str(due) != "null" else None)
                or parse_due_date(str(action)),
        )

    # 2 · Pendientes
    for p in _as_arr(summary.get("pending")):
        if not p:
            continue
        push(to_title(str(p)), str(p), due=parse_due_date(str(p)))

    # 3 · Plan de acción no terminado
    for step in _as_arr(summary.get("action_plan")):
        step_obj = step if isinstance(step, dict) else {"step": str(step)}
        if str(step_obj.get("status") or "").lower() == "hecho":
            continue
        txt = str(step_obj.get("step") or step_obj.get("action") or "")
        if not txt:
            continue
        owner = step_obj.get("owner")
        due = step_obj.get("due")
        push(
            to_title(txt), txt,
            responsable=str(owner) if owner and str(owner) != "null" else None,
            due=(parse_due_date(str(due)) if due and str(due) != "null" else None)
                or parse_due_date(txt),
        )

    # 4 · Promesas al cliente pendientes / en riesgo
    for pr in _as_arr(summary.get("client_promises")):
        if not isinstance(pr, dict):
            continue
        if str(pr.get("status") or "").lower() not in ("pendiente", "en_riesgo"):
            continue
        promise = pr.get("promise")
        if not promise:
            continue
        push(to_title(str(promise)), str(promise), due=parse_due_date(str(promise)))

    # 5 · Respaldo: immediate_actions
    if not candidates:
        for a in _as_arr(summary.get("immediate_actions")):
            if not a:
                continue
            push(to_title(str(a)), str(a), due=parse_due_date(str(a)))

    tasks = []
    for c in candidates:
        detail = c["detail"]
        task_id = f"ia_{account_id}_{hash_string(normalize(detail)[:120])}"
        tasks.append({
            "id": task_id,
            "account_id": account_id,
            "account_name": account_name,
            "title": c["title"] or detail[:80],
            "detail": detail,
            "status": "por_hacer",
            "responsable": c["responsable"] or default_responsable,
            "due_date": c["due"],
            "work_type": classify_work_type(detail),
            "delivery_link": None,
            "source": "ia",
        })
    return tasks


# ─────────────────────────────────────────────────────────────────────────────
# Cliente REST de Supabase (stdlib, sin dependencias extra)
# ─────────────────────────────────────────────────────────────────────────────

def _sb_request(method: str, path: str, body=None, prefer: str | None = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def sb_get_tasks() -> list[dict]:
    return _sb_request("GET", "client_tasks?select=id,account_id,status,source") or []


def sb_get_assignments() -> dict[str, str]:
    """account_id → consultant (responsable por defecto)."""
    try:
        rows = _sb_request("GET", "account_assignments?select=account_id,consultant") or []
        return {r["account_id"]: r.get("consultant") or None for r in rows}
    except Exception:
        return {}


def sb_insert_tasks(rows: list[dict]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload = [{**r, "created_at": now, "updated_at": now} for r in rows]
    for i in range(0, len(payload), 200):
        _sb_request(
            "POST", "client_tasks", body=payload[i:i + 200],
            prefer="resolution=merge-duplicates,return=minimal",
        )


def sb_mark_done(task_id: str) -> None:
    _sb_request(
        "PATCH",
        f"client_tasks?id=eq.{urllib.parse.quote(task_id)}",
        body={"status": "hecho", "updated_at": datetime.now(timezone.utc).isoformat()},
        prefer="return=minimal",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sincronización
# ─────────────────────────────────────────────────────────────────────────────

def _load_display_names() -> dict[str, str]:
    """número → nombre legible desde accounts_status.json (igual que el dashboard)."""
    names: dict[str, str] = {}
    try:
        snapshot = json.loads((DATA_DIR / "accounts_status.json").read_text(encoding="utf-8"))
        for acc in snapshot.get("accounts", []):
            number = str(acc.get("number", "")).zfill(2)
            title = acc.get("folderTitle") or ""
            name = re.sub(r"^\d+\.\s*", "", title).split("/")[0].strip()
            if name:
                names[number] = name
    except Exception:
        pass
    return names


def collect_extracted_tasks() -> tuple[dict[str, list[dict]], set[str]]:
    """
    Devuelve (tareas extraídas por account_id, account_ids analizados).
    Solo cuenta como "analizada" una cuenta con account_summary no vacío,
    para no cerrar tareas de cuentas sin análisis en esta corrida.
    """
    accounts_dir = DATA_DIR / "accounts"
    extracted: dict[str, list[dict]] = {}
    analyzed: set[str] = set()
    if not accounts_dir.exists():
        return extracted, analyzed

    assignments = sb_get_assignments()
    display_names = _load_display_names()

    for folder in sorted(accounts_dir.iterdir()):
        di_path = folder / "drive_intelligence.json"
        if not folder.is_dir() or not di_path.exists():
            continue
        try:
            di = json.loads(di_path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("drive_intelligence.json ilegible: %s", di_path)
            continue
        number = str(di.get("number", "")).zfill(2)
        summary = di.get("account_summary") or {}
        if not summary:
            continue
        account_id = NUMBER_TO_ID.get(number, f"drive-{number}")
        account_name = display_names.get(number) or di.get("account_name") or account_id
        analyzed.add(account_id)
        tasks = extract_tasks(
            account_id, account_name, summary,
            default_responsable=assignments.get(account_id),
        )
        if tasks:
            extracted[account_id] = tasks
    return extracted, analyzed


def run_task_sync(dry_run: bool = False) -> dict:
    """
    Sincroniza tareas con Supabase. Devuelve resumen
    {created, completed, accounts}.
    """
    extracted, analyzed = collect_extracted_tasks()
    all_new = [t for tasks in extracted.values() for t in tasks]
    logger.info("Tareas extraídas del análisis IA: %d (%d cuentas)",
                len(all_new), len(extracted))

    existing = sb_get_tasks()
    existing_ids = {t["id"] for t in existing}
    current_ids = {t["id"] for t in all_new}

    # 1 · Nuevas: aún no existen en Supabase
    to_create = [t for t in all_new if t["id"] not in existing_ids]

    # 2 · Completadas: tareas IA de cuentas analizadas que ya no aparecen
    #     en el análisis actual → la IA ya no las reporta pendientes.
    to_complete = [
        t for t in existing
        if t.get("source") == "ia"
        and t.get("status") != "hecho"
        and t.get("account_id") in analyzed
        and t["id"] not in current_ids
    ]

    logger.info("Tareas nuevas por subir: %d · por marcar hechas: %d",
                len(to_create), len(to_complete))

    if dry_run:
        for t in to_create[:15]:
            logger.info("  [dry-run] NUEVA  %s · %s", t["account_name"], t["title"])
        for t in to_complete[:15]:
            logger.info("  [dry-run] HECHA  %s · %s", t.get("account_id"), t["id"])
        return {"created": 0, "completed": 0, "accounts": len(extracted)}

    if to_create:
        sb_insert_tasks(to_create)
    done = 0
    for t in to_complete:
        try:
            sb_mark_done(t["id"])
            done += 1
        except Exception as e:
            logger.warning("No se pudo marcar hecha %s: %s", t["id"], e)

    logger.info("Supabase actualizado: %d creadas, %d marcadas hechas.",
                len(to_create), done)
    return {"created": len(to_create), "completed": done, "accounts": len(extracted)}


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s")
    p = argparse.ArgumentParser(description="Sincroniza tareas por cliente con Supabase")
    p.add_argument("--dry-run", action="store_true", help="Muestra qué haría sin escribir")
    args = p.parse_args()
    try:
        result = run_task_sync(dry_run=args.dry_run)
        logger.info("Resumen: %s", result)
    except urllib.error.URLError as e:
        logger.error("Sin conexión a Supabase: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
