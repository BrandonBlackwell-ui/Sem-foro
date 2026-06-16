"""
snapshot_writer.py — Escribe accounts_status.json y accounts_status.js
en el formato del schema v4.1, compatible con el dashboard existente.

También escribe data/accounts/{number}_{name}/account_status.json
para cada cuenta individual.

Garantías:
  - window.ACCOUNTS_STATUS siempre presente en el .js
  - window.SYNC_DATA alias retrocompatible siempre presente
  - JSON válido (sin trailing commas, encoding UTF-8)
  - Backup del archivo anterior antes de sobreescribir
"""
from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from config import ACCOUNTS_STATUS_JS, ACCOUNTS_STATUS_JSON, DATA_DIR

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "4.1"


def write_snapshot(
    accounts: list[dict],
    prev_snapshot: dict,
    deltas: list[dict],
    stale_fixes_applied: int,
    sync_type: str = "delta",
    sync_started_at: str | None = None,
) -> dict:
    """
    Construye y escribe el snapshot completo.

    Args:
        accounts:             lista de accounts (resultado del crawl + fixes)
        prev_snapshot:        snapshot anterior (para preservar campos no re-crawleados)
        deltas:               lista de deltas detectados
        stale_fixes_applied:  número de stale fixes aplicados
        sync_type:            "delta" | "delta+hotfix" | "baseline"
        sync_started_at:      hora ISO de INICIO del sync. Se usa como syncedAt
                              para que la siguiente ventana delta cubra archivos
                              subidos DURANTE la corrida (que puede tardar horas).

    Returns:
        El snapshot completo (dict) que se escribió.
    """
    now_iso = sync_started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev_synced_at = prev_snapshot.get("syncedAt", "")

    # Preservar campos de accounts anteriores que no se re-crawlearon
    merged_accounts = _merge_with_previous(accounts, prev_snapshot)

    snapshot = {
        "schemaVersion": SCHEMA_VERSION,
        "syncedAt": now_iso,
        "previousSyncAt": prev_synced_at,
        "type": sync_type,
        "rootFolderId": prev_snapshot.get("rootFolderId", ""),
        "accountCount": len(merged_accounts),
        "filesProcessed": sum(
            d.get("file_count_new", 0) for d in deltas
            if d.get("type") == "new_deliverable"
        ),
        "accountsAffected": len({d.get("account_number") for d in deltas if d.get("account_number")}),
        "staleFixesApplied": stale_fixes_applied,
        "deltas": deltas,
        "accounts": merged_accounts,
        "cross_account_findings": prev_snapshot.get("cross_account_findings", []),
    }

    # Validación mínima antes de escribir
    _validate_before_write(snapshot)

    # Backup del archivo anterior
    _backup_if_exists(ACCOUNTS_STATUS_JSON)

    # Escribir JSON
    ACCOUNTS_STATUS_JSON.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Escrito: %s (%d bytes)", ACCOUNTS_STATUS_JSON, ACCOUNTS_STATUS_JSON.stat().st_size)

    # Escribir JS (para el dashboard)
    _write_js(snapshot)

    # Escribir por cuenta en data/accounts/{number}_{name}/account_status.json
    _write_per_account(merged_accounts)

    return snapshot


def _merge_with_previous(new_accounts: list[dict], prev_snapshot: dict) -> list[dict]:
    """
    Fusiona accounts nuevos con el snapshot anterior.
    Para accounts no re-crawleados, preserva todos sus campos del snapshot anterior.
    Para accounts re-crawleados, usa los datos nuevos pero preserva campos como
    pqProxy, nextAction, lastAnalyzedAt que el crawl no toca.
    """
    prev_by_number = {a["number"]: a for a in prev_snapshot.get("accounts", [])}
    new_by_number = {a["number"]: a for a in new_accounts}
    result: list[dict] = []

    # Todos los accounts del snapshot anterior
    all_numbers = sorted(
        set(prev_by_number.keys()) | set(new_by_number.keys())
    )

    for number in all_numbers:
        prev = prev_by_number.get(number, {})
        new = new_by_number.get(number)

        if new is None:
            # Cuenta no re-crawleada: preservar completamente
            result.append(prev)
        else:
            # Cuenta re-crawleada: usar datos nuevos + preservar análisis anterior
            merged = {**prev, **new}
            # Preservar campos de análisis que el crawl Python no regenera
            for preserve_key in ("pqProxy", "nextAction", "lastAnalyzedAt", "analysisConfidence"):
                if preserve_key in prev and preserve_key not in new:
                    merged[preserve_key] = prev[preserve_key]
            result.append(merged)

    return result


def _write_js(snapshot: dict) -> None:
    """
    Escribe accounts_status.js con window.ACCOUNTS_STATUS y alias window.SYNC_DATA.
    El formato debe ser exactamente el que espera el dashboard.
    """
    _backup_if_exists(ACCOUNTS_STATUS_JS)

    json_str = json.dumps(snapshot, indent=2, ensure_ascii=False)
    js_content = (
        f"/* Generated by blackwell-sync · {snapshot['syncedAt']} */\n"
        f"window.ACCOUNTS_STATUS = {json_str};\n"
        f"if (typeof window.SYNC_DATA === 'undefined') {{\n"
        f"  window.SYNC_DATA = window.ACCOUNTS_STATUS;\n"
        f"}}\n"
    )

    ACCOUNTS_STATUS_JS.write_text(js_content, encoding="utf-8")
    logger.info(
        "Escrito: %s (%d bytes)", ACCOUNTS_STATUS_JS, ACCOUNTS_STATUS_JS.stat().st_size
    )


def _account_folder_name(number: str, folder_title: str) -> str:
    """Genera el nombre de carpeta: {number}_{SLUG_NAME}"""
    name = re.sub(r"^\d+\.\s*", "", folder_title or "").split("/")[0].strip()
    slug = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")
    return f"{number}_{slug}" if slug else number


def _write_per_account(accounts: list[dict]) -> None:
    """Escribe data/accounts/{folder}/account_status.json para cada cuenta."""
    accounts_dir = DATA_DIR / "accounts"
    written = 0
    for acc in accounts:
        number = acc.get("number", "")
        title = acc.get("folderTitle", number)
        folder = accounts_dir / _account_folder_name(number, title)
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / "account_status.json"
        dest.write_text(json.dumps(acc, indent=2, ensure_ascii=False), encoding="utf-8")
        written += 1
    logger.info("account_status.json escrito por cuenta: %d carpetas", written)


def _backup_if_exists(path: Path) -> None:
    if path.exists():
        now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = path.with_suffix(f".bak.{now}")
        shutil.copy2(path, backup)
        logger.debug("Backup creado: %s", backup)


def _validate_before_write(snapshot: dict) -> None:
    """
    Validaciones mínimas antes de sobreescribir el snapshot.
    Lanza ValueError si algo crítico está mal.
    """
    if not isinstance(snapshot.get("accounts"), list):
        raise ValueError("snapshot.accounts debe ser una lista")
    if not snapshot.get("syncedAt"):
        raise ValueError("snapshot.syncedAt es requerido")
    if snapshot.get("accountCount", 0) == 0:
        raise ValueError("accountCount=0: no se escribirá un snapshot vacío")

    for acc in snapshot["accounts"]:
        subs = acc.get("subfolderActivity", {})
        for sub_name, sub in subs.items():
            if not isinstance(sub, dict):
                raise ValueError(
                    f"subfolderActivity['{sub_name}'] en {acc.get('folderTitle')} "
                    f"no es un objeto"
                )
            # fileCount debe ser int o None, nunca string
            fc = sub.get("fileCount")
            if fc is not None and not isinstance(fc, int):
                raise ValueError(
                    f"fileCount en {acc.get('folderTitle')} / {sub_name} "
                    f"debe ser int o null, no {type(fc).__name__}"
                )
