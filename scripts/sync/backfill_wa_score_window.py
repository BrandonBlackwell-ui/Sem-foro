#!/usr/bin/env python3
"""
Backfill del score WA al modelo de NIVEL DIARIO (misma regla que
wa_daily_analyzer):

  new_score(fila)   = clamp(base de la cuenta + delta de la fila acotado a [-30, +15])
  previous_score(d) = score vigente hasta ayer (promedio de niveles de la ventana)
  current_score     = promedio de los niveles diarios de los últimos 30 días

El modelo acumulado anterior saturaba a toda cuenta activa en 100 (deltas de
+10..+45 por día de actividad normal) y el histórico salía plano.

Idempotente: correrlo dos veces produce el mismo resultado.
Uso:  py -3 scripts/sync/backfill_wa_score_window.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)

import os  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_wa_score_window")

DEFAULT_BASE_SCORE = 70
# Mantener en sync con wa_daily_analyzer:
SCORE_WINDOW_DAYS = 30
DAY_DELTA_CAP_POS = 15
DAY_DELTA_CAP_NEG = -30


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _cap_day_delta(total: float) -> float:
    return _clamp(total, DAY_DELTA_CAP_NEG, DAY_DELTA_CAP_POS)


def _get_sb():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    from supabase import create_client

    return create_client(url, key)


def _fetch_all_rows(sb) -> list[dict]:
    rows: list[dict] = []
    page, page_size = 0, 1000
    while True:
        res = (
            sb.table("wa_daily_analysis")
            .select("id,account_id,analysis_date,score_delta,previous_score,new_score")
            .order("account_id")
            .order("analysis_date")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            return rows
        page += 1


def _fetch_bases(sb) -> dict[str, float]:
    res = sb.table("wa_account_scores").select("account_id,base_score").execute()
    return {
        str(r["account_id"]): float(r.get("base_score") or DEFAULT_BASE_SCORE)
        for r in (res.data or [])
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="solo reporta, no escribe")
    args = parser.parse_args()

    sb = _get_sb()
    rows = _fetch_all_rows(sb)
    bases = _fetch_bases(sb)
    logger.info("Filas de wa_daily_analysis: %d · cuentas con base: %d", len(rows), len(bases))

    by_account: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_account[str(row["account_id"])].append(row)

    today = date.today()
    updated_rows = 0
    for account_id, acc_rows in sorted(by_account.items()):
        base = bases.get(account_id, DEFAULT_BASE_SCORE)

        # Delta total por día (todas las corridas/grupos del día suman).
        delta_by_date: dict[date, float] = defaultdict(float)
        for row in acc_rows:
            d = date.fromisoformat(row["analysis_date"])
            delta_by_date[d] += float(row.get("score_delta") or 0)

        def day_level(d: date) -> float:
            return _clamp(base + _cap_day_delta(delta_by_date.get(d, 0.0)), 0, 100)

        def window_avg(end: date, days: int = SCORE_WINDOW_DAYS) -> float:
            start = end - timedelta(days=days - 1)
            levels = [day_level(d) for d in delta_by_date if start <= d <= end]
            return _clamp(sum(levels) / len(levels), 0, 100) if levels else _clamp(base, 0, 100)

        new_scores: list[float] = []
        for row in acc_rows:
            d = date.fromisoformat(row["analysis_date"])
            # previous = score vigente hasta ayer; new = nivel de ESTA fila (su delta acotado).
            prev = round(window_avg(d - timedelta(days=1)), 1)
            new = _clamp(base + _cap_day_delta(float(row.get("score_delta") or 0)), 0, 100)
            new_scores.append(new)
            old_prev, old_new = row.get("previous_score"), row.get("new_score")
            if old_prev == prev and old_new == new:
                continue
            updated_rows += 1
            if not args.dry_run:
                (
                    sb.table("wa_daily_analysis")
                    .update({"previous_score": prev, "new_score": new})
                    .eq("id", row["id"])
                    .execute()
                )

        # Score vigente de la cuenta: promedio de niveles de la ventana a hoy.
        current = round(window_avg(today), 1)
        total_delta = round(current - base, 1)
        if not args.dry_run:
            (
                sb.table("wa_account_scores")
                .update({
                    "current_score": current,
                    "total_delta": total_delta,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("account_id", account_id)
                .execute()
            )

        lo, hi = (min(new_scores), max(new_scores)) if new_scores else (None, None)
        logger.info(
            "%s: %d filas · new_score min %.1f / max %.1f · score vigente %.1f (base %.0f %+0.1f)",
            account_id, len(acc_rows), lo or 0, hi or 0, current, base, total_delta,
        )

    logger.info("%s%d fila(s) actualizadas.", "[dry-run] " if args.dry_run else "", updated_rows)


if __name__ == "__main__":
    main()
