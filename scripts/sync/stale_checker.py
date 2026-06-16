"""
stale_checker.py — Identifica subfolders con datos posiblemente desactualizados
y los re-verifica directamente contra Drive.

Política de staleness (v4.1+):
  P1. Slots críticos (01.*): siempre en cada sync, sin importar nada más.
  P2. Root tocado: toda cuenta cuyo folderModifiedTime cambió en el delta.
  P3. Stale > N días: last_verified_at ausente o anterior a STALE_MAX_AGE_DAYS.
  P4. Sospechoso: source=carried_forward + fileCount=0.
  P5. Onboarding nuevo: cuenta con < ONBOARDING_FULL_RECRAWL_DAYS de vida
      y fileCount=0 por más de ONBOARDING_SUSPECT_FC0_DAYS.

Límite de eficiencia: máximo STALE_MAX_REVERIFY_PER_RUN subfolders por corrida.
Prioridad: P1 → P2 → P3 → P4 → P5.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Any

from config import (
    ONBOARDING_FULL_RECRAWL_DAYS,
    ONBOARDING_SUSPECT_FC0_DAYS,
    STALE_MAX_AGE_DAYS,
    STALE_MAX_REVERIFY_PER_RUN,
)

logger = logging.getLogger(__name__)


class StaleChecker:
    """
    Evalúa qué subfolders necesitan re-verificación y los re-crawlea.
    """

    def __init__(self, crawler):
        """
        Args:
            crawler: instancia de DriveCrawler (de drive_crawler.py)
        """
        self._crawler = crawler

    def find_stale_candidates(
        self,
        accounts: list[dict],
        touched_folder_ids: set[str] | None = None,
    ) -> list[dict]:
        """
        Analiza todos los subfolders de todos los accounts y devuelve
        los candidatos a re-verificación, ordenados por prioridad.

        Args:
            accounts:           lista de accounts del snapshot actual
            touched_folder_ids: folderIds que tuvieron actividad en el delta

        Returns:
            Lista de candidatos: [{account, subfolder_name, subfolder_id,
                                   priority, reasons, entry}, ...]
        """
        now = datetime.now(timezone.utc)
        candidates: list[dict] = []

        for acc in accounts:
            folder_id = acc.get("folderId", "")
            folder_title = acc.get("folderTitle", "?")
            number = acc.get("number", "?")
            derived_status = acc.get("derivedStatus", "active")
            is_touched = touched_folder_ids and folder_id in touched_folder_ids

            # Calcular edad de la cuenta (aproximación desde el número y registros)
            account_age_days = _estimate_account_age(acc, now)

            for sub_name, entry in (acc.get("subfolderActivity") or {}).items():
                if not isinstance(entry, dict):
                    continue

                reasons, priority = _evaluate_staleness(
                    sub_name=sub_name,
                    entry=entry,
                    now=now,
                    is_touched=is_touched,
                    account_age_days=account_age_days,
                    derived_status=derived_status,
                )

                if priority > 0:
                    candidates.append({
                        "account": folder_title,
                        "account_number": number,
                        "subfolder_name": sub_name,
                        "subfolder_id": entry.get("subfolderId"),
                        "priority": priority,
                        "reasons": reasons,
                        "prev_file_count": entry.get("fileCount"),
                        "prev_last_verified_at": entry.get("last_verified_at"),
                        "entry": entry,
                    })

        # Ordenar por prioridad descendente, luego por account_number
        candidates.sort(key=lambda c: (-c["priority"], c["account_number"]))

        logger.info(
            "Subfolders candidatos a re-verificación: %d (límite: %d)",
            len(candidates), STALE_MAX_REVERIFY_PER_RUN,
        )
        return candidates

    def reverify(
        self,
        candidates: list[dict],
        now_iso: str | None = None,
    ) -> list[dict]:
        """
        Re-crawlea los N candidatos de mayor prioridad (hasta STALE_MAX_REVERIFY_PER_RUN).

        Devuelve lista de resultados:
        [{
            "account": str,
            "subfolder_name": str,
            "subfolder_id": str,
            "prev_file_count": int | None,
            "new_data": dict,         ← nuevo entry de subfolderActivity
            "changed": bool,
            "fix_type": "stale_fix" | "no_change" | "permissions_error"
        }]
        """
        if now_iso is None:
            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        to_verify = candidates[:STALE_MAX_REVERIFY_PER_RUN]
        results: list[dict] = []

        for c in to_verify:
            sub_id = c.get("subfolder_id")
            if not sub_id:
                logger.warning(
                    "Sin subfolderId para %s / %s — saltando",
                    c["account"], c["subfolder_name"],
                )
                continue

            logger.info(
                "Re-verificando: %s / %s (prioridad %d, razones: %s)",
                c["account"], c["subfolder_name"],
                c["priority"], ", ".join(c["reasons"]),
            )

            try:
                new_data = self._crawler.crawl_subfolder(sub_id, c["subfolder_name"])
            except Exception as e:
                logger.error(
                    "Error al re-verificar %s / %s: %s",
                    c["account"], c["subfolder_name"], e,
                )
                results.append({
                    **c,
                    "new_data": None,
                    "changed": False,
                    "fix_type": "permissions_error",
                    "error": str(e),
                })
                continue

            prev_fc = c["prev_file_count"]
            new_fc = new_data.get("fileCount")
            changed = (prev_fc != new_fc) or (prev_fc == 0 and new_fc and new_fc > 0)
            fix_type = "stale_fix" if changed else "no_change"

            if changed:
                logger.info(
                    "  STALE FIX: fileCount %s → %s  (%s)",
                    prev_fc, new_fc, c["subfolder_name"],
                )

            results.append({
                **c,
                "new_data": new_data,
                "changed": changed,
                "fix_type": fix_type,
            })

        skipped = len(candidates) - len(to_verify)
        if skipped > 0:
            logger.warning(
                "Límite STALE_MAX_REVERIFY_PER_RUN=%d alcanzado. "
                "%d subfolders quedaron sin re-verificar.",
                STALE_MAX_REVERIFY_PER_RUN, skipped,
            )

        return results

    def apply_fixes(
        self,
        accounts: list[dict],
        reverify_results: list[dict],
    ) -> tuple[list[dict], int]:
        """
        Aplica los resultados de reverify al snapshot de accounts (en memoria).

        Devuelve:
            (accounts_updated, num_fixes_applied)
        """
        fixes = 0
        result_by_key: dict[tuple, dict] = {
            (r["account_number"], r["subfolder_name"]): r
            for r in reverify_results
            if r.get("new_data") is not None
        }

        for acc in accounts:
            number = acc.get("number")
            subs = acc.get("subfolderActivity", {})

            for sub_name in list(subs.keys()):
                key = (number, sub_name)
                res = result_by_key.get(key)
                if res and res["new_data"]:
                    subs[sub_name] = res["new_data"]
                    if res["changed"]:
                        fixes += 1

        return accounts, fixes


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internos
# ─────────────────────────────────────────────────────────────────────────────

def _evaluate_staleness(
    sub_name: str,
    entry: dict,
    now: datetime,
    is_touched: bool,
    account_age_days: int | None,
    derived_status: str,
) -> tuple[list[str], int]:
    """
    Evalúa si un subfolder es candidato a re-verificación.

    Returns:
        (reasons: list[str], priority: int)
        priority 0 = no necesita re-verificación
    """
    reasons: list[str] = []
    priority = 0

    lva = entry.get("last_verified_at")
    lva_dt = _parse_iso(lva)
    fc = entry.get("fileCount")
    src = entry.get("source", "") or ""

    # P1: slot crítico 01.* — siempre
    if re.match(r"^01[\.\s]", sub_name.strip()):
        reasons.append("slot_critico_01")
        priority = max(priority, 100)

    # P2: root tocado en el delta
    if is_touched:
        reasons.append("root_touched")
        priority = max(priority, 80)

    # P3: stale por edad
    if lva is None or lva == "never":
        reasons.append("last_verified_at_ausente")
        priority = max(priority, 60)
    elif lva_dt:
        age_days = (now - lva_dt).days
        if age_days > STALE_MAX_AGE_DAYS:
            reasons.append(f"last_verified_at_age>{STALE_MAX_AGE_DAYS}d")
            priority = max(priority, 50)

    # P4: carried_forward con fileCount=0
    if "carried_forward" in src and (fc == 0 or fc is None):
        reasons.append("carried_forward_fc0")
        priority = max(priority, 70)

    # P5: onboarding nuevo con fileCount=0 por más de N días
    if (
        derived_status in ("onboarding", "active_new")
        and (fc == 0 or fc is None)
        and account_age_days is not None
        and account_age_days <= ONBOARDING_FULL_RECRAWL_DAYS
    ):
        # Calcular cuántos días lleva con fileCount=0 (aproximación por last_verified_at)
        days_fc0 = (now - lva_dt).days if lva_dt else 999
        if days_fc0 >= ONBOARDING_SUSPECT_FC0_DAYS:
            reasons.append(f"onboarding_fc0_age>{ONBOARDING_SUSPECT_FC0_DAYS}d")
            priority = max(priority, 65)

    return reasons, priority


def _estimate_account_age(acc: dict, now: datetime) -> int | None:
    """Estima la edad de la cuenta en días usando folderModifiedTime como proxy."""
    fmt = acc.get("folderModifiedTime")
    if not fmt:
        return None
    dt = _parse_iso(fmt)
    if not dt:
        return None
    return (now - dt).days


def _parse_iso(s: str | None) -> datetime | None:
    if not s or s == "never":
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
