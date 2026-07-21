#!/usr/bin/env python3
"""
Sync executed media/publication rows from the shared Google Sheet into Supabase.

This fills the operational-compliance evidence we already have. Contract goals
are intentionally left null until the client commitments are loaded.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import os
import re
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client

try:
    from scripts.sync.config import DATA_DIR, ROOT, SUPABASE_SERVICE_KEY, SUPABASE_URL
except ModuleNotFoundError:
    import sys

    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import DATA_DIR, SUPABASE_SERVICE_KEY, SUPABASE_URL


DEFAULT_SHEET_ID = "1PAcofO80aMuTNdclclqCrKS-uij0S8iI"
DEFAULT_GENERAL_GID = "905402375"
logger = logging.getLogger("sync_media_sheet")


def main() -> None:
    _setup_logging()
    args = _parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")

    aliases = _load_aliases()
    rows = _download_sheet_rows(args.sheet_id, args.gid)
    publications = _publication_payloads(rows, aliases, args.sheet_id, args.gid)

    logger.info("Parsed %d mapped publication row(s) from Sheet.", len(publications))
    if args.dry_run:
        for sample in publications[:10]:
            logger.info("[dry-run] %s", sample)
        return

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    if publications:
        _upsert_chunks(sb, "account_publications", publications, "source_sheet_id,source_row_number")
        _reconcile_stale_rows(sb, args.sheet_id, publications)
    summaries = _summary_payloads(publications, args.sheet_id, args.gid)
    if summaries:
        _upsert_chunks(sb, "account_operational_scores", summaries, "account_id,period_year,period_month")
    logger.info("Synced %d publication(s) and %d CO period summary row(s).", len(publications), len(summaries))


def _reconcile_stale_rows(sb: Any, sheet_id: str, publications: list[dict[str, Any]]) -> None:
    """Borra filas de account_publications que ya no existen en el Sheet.

    La llave es la POSICIÓN de la fila (source_row_number): si el equipo borra filas
    a la mitad del Sheet, todo se recorre y las últimas posiciones quedan huérfanas
    con contenido que ya no existe — para siempre, porque el upsert nunca borra.
    Tras cada sync eliminamos las posiciones que este run no escribió.
    """
    current = {int(p["source_row_number"]) for p in publications}
    try:
        res = (
            sb.table("account_publications")
            .select("id,source_row_number")
            .eq("source_sheet_id", sheet_id)
            .limit(10000)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("No pude leer filas existentes para reconciliar: %s", exc)
        return
    stale_ids = [row["id"] for row in (res.data or []) if int(row.get("source_row_number") or 0) not in current]
    if not stale_ids:
        return
    for start in range(0, len(stale_ids), 200):
        chunk = stale_ids[start : start + 200]
        sb.table("account_publications").delete().in_("id", chunk).execute()
    logger.info("Reconciliación: %d fila(s) huérfana(s) eliminadas (posiciones que ya no están en el Sheet).", len(stale_ids))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet-id", default=os.getenv("MEDIA_SHEET_ID", DEFAULT_SHEET_ID))
    parser.add_argument("--gid", default=os.getenv("MEDIA_SHEET_GENERAL_GID", DEFAULT_GENERAL_GID))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _download_sheet_rows(sheet_id: str, gid: str) -> list[dict[str, str]]:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    logger.info("Downloading media Sheet CSV: %s", url)
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            csv_text = response.read().decode("utf-8-sig")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not download media Sheet CSV: {exc}") from exc

    raw_rows = list(csv.reader(io.StringIO(csv_text)))
    header_index = _find_header_row(raw_rows)
    headers = _unique_headers([_clean_header(cell) for cell in raw_rows[header_index]])
    rows: list[dict[str, str]] = []
    for offset, values in enumerate(raw_rows[header_index + 1 :], start=header_index + 2):
        record = {headers[i]: _clean_cell(values[i]) if i < len(values) else "" for i in range(len(headers))}
        if not any(record.values()):
            continue
        record["_source_row_number"] = str(offset)
        rows.append(record)
    return rows


def _find_header_row(rows: list[list[str]]) -> int:
    for index, row in enumerate(rows[:20]):
        normalized = {_normalize(cell) for cell in row}
        if "medio" in normalized and "cliente" in normalized and "link" in normalized:
            return index
    raise RuntimeError("Could not find the GENERAL header row. Expected Medio, Cliente and Link columns.")


def _load_aliases() -> dict[str, dict[str, str]]:
    crosswalk = DATA_DIR / "account_crosswalk_candidates.json"
    if not crosswalk.exists():
        raise RuntimeError(f"Missing account crosswalk: {crosswalk}")

    data = json.loads(crosswalk.read_text(encoding="utf-8"))
    aliases: dict[str, dict[str, str]] = {}
    for row in data.get("rows", []):
        account_id = str(row.get("account_id") or "").strip()
        dashboard_name = str(row.get("dashboard_name") or account_id).strip()
        status = str(row.get("status") or "revisar").strip()
        if not account_id:
            continue
        for candidate in row.get("sheet_candidates") or []:
            name = str(candidate.get("sheet_client_name") or "").strip()
            if not name:
                continue
            aliases[_normalize(name)] = {
                "account_id": account_id,
                "account_name": dashboard_name,
                "status": status,
            }
    return aliases


# Correcciones manuales a filas del Sheet que traen TEXTO en vez de link. Debe coincidir
# con PUBLICATION_OVERRIDES en api/media-publications.js para que el analisis quede con la
# misma URL que muestra el dashboard (si no, no empatan y sale "sin analisis").
_PUBLICATION_OVERRIDES = [
    {
        "match": "ENTREVISTA EN MILENIO PEDRO GAMBOA",
        "url": "https://www.medialog.com.mx/mx.asp?h=653abd06a797f8de777083f55e823b22&E=YntmcXBtcHM=&X=dXlwam9mbWpu",
        "media": "Milenio",
    },
]


def _apply_override(link: str, media: str) -> tuple[str, str]:
    for o in _PUBLICATION_OVERRIDES:
        if _normalize(o["match"]) == _normalize(link):
            return o["url"], (o.get("media") or media)
    return link, media


def _publication_payloads(
    rows: list[dict[str, str]],
    aliases: dict[str, dict[str, str]],
    sheet_id: str,
    gid: str,
) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    skipped = 0
    unmapped: dict[str, int] = {}
    for row in rows:
        sheet_client = _field(row, "cliente")
        alias = aliases.get(_normalize(sheet_client))
        link, media_name = _apply_override(_field(row, "link"), _field(row, "medio"))
        if not alias or not link:
            skipped += 1
            # Visibilidad: un cliente CON link pero sin mapeo es una publicación real
            # que se está tirando. Antes solo se logueaba un contador agregado y estos
            # huecos duraron meses (Pepe Aguilar, LCH, Ceron-*).
            if link and sheet_client and not alias:
                unmapped[sheet_client] = unmapped.get(sheet_client, 0) + 1
            continue

        publication_date = _parse_date(_field(row, "fecha"))
        year = _parse_int(_field(row, "ano")) or (publication_date.year if publication_date else None)
        month = _parse_int(_field(row, "mes")) or (publication_date.month if publication_date else None)
        if not year or not month:
            skipped += 1
            continue

        payloads.append(
            {
                "account_id": alias["account_id"],
                "account_name": alias["account_name"],
                "sheet_client_name": sheet_client,
                "source_sheet_id": sheet_id,
                "source_sheet_gid": gid,
                "source_row_number": _parse_int(row.get("_source_row_number")) or 0,
                "media_name": media_name,
                "provider": _field(row, "proveedor"),
                "columnist": _field(row, "columnista"),
                "total": _parse_number(_field(row, "total")),
                "legal_name": _field(row, "razon social"),
                "publication_date": publication_date.isoformat() if publication_date else None,
                "publication_year": year,
                "publication_month": month,
                "publication_month_name": _field(row, "mes", prefer_text=True),
                "url": link,
                "service": _field(row, "servicio"),
                "cost": _parse_number(_field(row, "costo")),
                "cost_status": _field(row, "estatus costo"),
                "commission": _parse_number(_field(row, "comision $")),
                "commission_status": _field(row, "estatus comision"),
                "comments": _field(row, "comentarios"),
                "raw_row": row,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    if skipped:
        logger.info("Skipped %d row(s) without mapping, link, year or month.", skipped)
    if unmapped:
        detail = ", ".join(f"{name} ({count})" for name, count in sorted(unmapped.items(), key=lambda kv: -kv[1]))
        logger.warning(
            "PUBLICACIONES DESCARTADAS con link por cliente sin mapeo en account_crosswalk_candidates.json: %s",
            detail,
        )
    return payloads


def _summary_payloads(publications: list[dict[str, Any]], sheet_id: str, gid: str) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int, int], dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "account_name": None}
    )
    for pub in publications:
        key = (pub["account_id"], int(pub["publication_year"]), int(pub["publication_month"]))
        grouped[key]["count"] += 1
        grouped[key]["account_name"] = pub.get("account_name")

    synced_at = datetime.now(timezone.utc).isoformat()
    summaries: list[dict[str, Any]] = []
    for (account_id, year, month), data in grouped.items():
        summaries.append(
            {
                "account_id": account_id,
                "account_name": data["account_name"],
                "period_year": year,
                "period_month": month,
                "delivered_publications_count": data["count"],
                "committed_publications_count": None,
                "co_publications_score": None,
                "co_score": None,
                "status": "needs_commitment",
                "source_sheet_id": sheet_id,
                "source_sheet_gid": gid,
                "synced_at": synced_at,
            }
        )
    return summaries


def _upsert_chunks(sb: Any, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
    for start in range(0, len(rows), 250):
        chunk = rows[start : start + 250]
        sb.table(table).upsert(chunk, on_conflict=conflict).execute()


def _field(row: dict[str, str], name: str, prefer_text: bool = False) -> str:
    target = _normalize(name)
    if prefer_text and target == "mes":
        for key, value in row.items():
            if _normalize(key).startswith("mes") and not _parse_int(value):
                return value.strip()
    for key, value in row.items():
        if _normalize(key) == target:
            return value.strip()
    for key, value in row.items():
        if _normalize(key).startswith(f"{target} "):
            return value.strip()
    return ""


def _unique_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique: list[str] = []
    for header in headers:
        key = header or "columna"
        count = seen.get(key, 0) + 1
        seen[key] = count
        unique.append(key if count == 1 else f"{key} {count}")
    return unique


def _clean_header(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _clean_cell(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9$]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"-?\d+", str(value).replace(",", ""))
    return int(match.group(0)) if match else None


def _parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(value).replace(",", ""))
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_date(value: str | None) -> datetime.date | None:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


if __name__ == "__main__":
    main()
