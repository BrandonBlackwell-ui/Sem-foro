"""
delta_detector.py — Compara el snapshot nuevo del crawl con el anterior
y produce una lista de deltas estructurados.

Tipos de delta detectados:
  new_account       — carpeta de cuenta nueva que no existía antes
  status_change     — el sufijo del nombre cambió (ej. activo → concluido)
  stale_fix         — fileCount corregido (era 0, ahora es N > 0)
  file_count_change — cambió el número de archivos en un subfolder
  folder_modified   — folderModifiedTime más reciente que el snapshot anterior
  subfolder_new     — subfolder que apareció en el crawl pero no estaba antes
  subfolder_missing — subfolder que estaba antes y ahora subfolderMissing=True
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def compute_deltas(
    prev_snapshot: dict,
    new_accounts: list[dict],
) -> list[dict[str, Any]]:
    """
    Compara el snapshot anterior (accounts_status.json leído) con los
    accounts recién crawleados y devuelve lista de objetos delta.

    Args:
        prev_snapshot:  contenido completo del accounts_status.json anterior
        new_accounts:   lista de accounts devuelta por DriveCrawler

    Returns:
        Lista de deltas en el formato del schema v4.1:
        {
            "type": "stale_fix" | "file_count_change" | ...,
            "account": "01. TURBOFIN",
            "subfolder": "02.Turbofin_Entregables",   # si aplica
            "prev": {...},
            "new": {...},
            "timestamp": "<ISO>"
        }
    """
    now = _now_iso()
    deltas: list[dict] = []

    prev_by_number: dict[str, dict] = {
        a["number"]: a for a in prev_snapshot.get("accounts", [])
    }
    new_by_number: dict[str, dict] = {a["number"]: a for a in new_accounts}

    # ── Cuentas nuevas ────────────────────────────────────────────────────────
    for number, account in new_by_number.items():
        if number not in prev_by_number:
            deltas.append({
                "type": "new_account",
                "account": account["folderTitle"],
                "account_number": number,
                "new": {"derivedStatus": account.get("derivedStatus")},
                "timestamp": now,
            })
            logger.info("DELTA new_account: %s", account["folderTitle"])

    # ── Cambios en cuentas existentes ────────────────────────────────────────
    for number, new_acc in new_by_number.items():
        prev_acc = prev_by_number.get(number)
        if not prev_acc:
            continue

        folder_title = new_acc["folderTitle"]

        # Status change
        prev_status = prev_acc.get("derivedStatus")
        new_status = new_acc.get("derivedStatus")
        if prev_status != new_status:
            deltas.append({
                "type": "status_change",
                "account": folder_title,
                "account_number": number,
                "prev": {"derivedStatus": prev_status},
                "new": {"derivedStatus": new_status},
                "timestamp": now,
            })
            logger.info(
                "DELTA status_change: %s  %s → %s", folder_title, prev_status, new_status
            )

        # folder_modified
        prev_fmt = prev_acc.get("folderModifiedTime")
        new_fmt = new_acc.get("folderModifiedTime")
        if _is_newer(new_fmt, prev_fmt):
            deltas.append({
                "type": "folder_modified",
                "account": folder_title,
                "account_number": number,
                "prev": {"folderModifiedTime": prev_fmt},
                "new": {"folderModifiedTime": new_fmt},
                "timestamp": now,
            })

        # Subfolders
        prev_subs: dict = prev_acc.get("subfolderActivity", {})
        new_subs: dict = new_acc.get("subfolderActivity", {})

        for sub_name, new_sub in new_subs.items():
            # Buscar la entrada anterior por prefijo numérico (tolerancia a cambios de nombre)
            sub_prefix = _prefix_of(sub_name)
            prev_sub = _find_by_prefix(prev_subs, sub_prefix) if sub_prefix else None

            if prev_sub is None:
                # Subfolder nuevo
                deltas.append({
                    "type": "subfolder_new",
                    "account": folder_title,
                    "account_number": number,
                    "subfolder": sub_name,
                    "new": _sub_summary(new_sub),
                    "timestamp": now,
                })
                continue

            prev_fc = prev_sub.get("fileCount")
            new_fc = new_sub.get("fileCount")
            prev_missing = prev_sub.get("subfolderMissing", False)
            new_missing = new_sub.get("subfolderMissing", False)

            # subfolderMissing que desaparece
            if prev_missing and not new_missing:
                deltas.append({
                    "type": "subfolder_appeared",
                    "account": folder_title,
                    "account_number": number,
                    "subfolder": sub_name,
                    "prev": {"subfolderMissing": True},
                    "new": _sub_summary(new_sub),
                    "timestamp": now,
                })

            # stale_fix: fileCount era 0 / None, ahora es > 0
            if (prev_fc == 0 or prev_fc is None) and new_fc and new_fc > 0:
                deltas.append({
                    "type": "stale_fix",
                    "account": folder_title,
                    "account_number": number,
                    "subfolder": sub_name,
                    "prev": {"fileCount": prev_fc},
                    "new": {"fileCount": new_fc, "latestFile": new_sub.get("latestFile")},
                    "timestamp": now,
                })
                logger.info(
                    "DELTA stale_fix: %s / %s  fc %s → %d",
                    folder_title, sub_name, prev_fc, new_fc,
                )

            # file_count_change general
            elif prev_fc is not None and new_fc is not None and prev_fc != new_fc:
                deltas.append({
                    "type": "file_count_change",
                    "account": folder_title,
                    "account_number": number,
                    "subfolder": sub_name,
                    "prev": {"fileCount": prev_fc},
                    "new": {"fileCount": new_fc},
                    "timestamp": now,
                })

    logger.info("Total deltas detectados: %d", len(deltas))
    return deltas


def accounts_with_delta(deltas: list[dict]) -> set[str]:
    """
    Devuelve el conjunto de account_numbers que tienen al menos un delta.
    Útil para saber qué cuentas necesitan re-análisis por Claude.
    """
    return {d["account_number"] for d in deltas if "account_number" in d}


def has_stale_fixes(deltas: list[dict]) -> bool:
    return any(d["type"] == "stale_fix" for d in deltas)


def count_by_type(deltas: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for d in deltas:
        counts[d["type"]] = counts.get(d["type"], 0) + 1
    return counts


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internos
# ─────────────────────────────────────────────────────────────────────────────

def _prefix_of(subfolder_name: str) -> str | None:
    """Extrae el prefijo numérico. "02.Turbofin_Entregables" → "02" """
    import re
    m = re.match(r"^(\d{2})[\.\s]", subfolder_name.strip())
    return m.group(1) if m else None


def _find_by_prefix(subs: dict, prefix: str | None) -> dict | None:
    """Busca en un dict de subfolderActivity por prefijo numérico."""
    if not prefix:
        return None
    import re
    for name, sub in subs.items():
        if re.match(rf"^{re.escape(prefix)}[\.\s]", name.strip()):
            return sub
    return None


def _sub_summary(sub: dict) -> dict:
    return {
        "fileCount": sub.get("fileCount"),
        "latestFile": sub.get("latestFile"),
        "latestModified": sub.get("latestModified"),
    }


def _is_newer(new_iso: str | None, prev_iso: str | None) -> bool:
    if not new_iso or not prev_iso:
        return False
    try:
        n = datetime.fromisoformat(new_iso.replace("Z", "+00:00"))
        p = datetime.fromisoformat(prev_iso.replace("Z", "+00:00"))
        return n > p
    except ValueError:
        return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
