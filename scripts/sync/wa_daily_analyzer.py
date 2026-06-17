#!/usr/bin/env python3
"""
Daily WhatsApp analyzer for Semaforo.

It reads only one date window from wa_messages, analyzes only accounts with
messages in that window, and writes:
  - wa_daily_analysis: one analysis row per account per day
  - wa_account_scores: base score plus cumulative daily deltas

Required environment:
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  ANTHROPIC_API_KEY

Optional:
  WA_ANALYSIS_MODEL=claude-haiku-4-5
  WA_ANALYSIS_DATE=YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)

logger = logging.getLogger("wa_daily_analyzer")

DEFAULT_BASE_SCORE = 70
MAX_MESSAGES_PER_ACCOUNT = 600
LOCAL_TZ = ZoneInfo(os.getenv("WA_ANALYSIS_TIMEZONE", "America/Mexico_City"))


@dataclass
class AccountBatch:
    account_id: str
    group_names: list[str]
    messages: list[dict[str, Any]]

    @property
    def first_message_at(self) -> str | None:
        return self.messages[0].get("sent_at") if self.messages else None

    @property
    def last_message_at(self) -> str | None:
        return self.messages[-1].get("sent_at") if self.messages else None


def main() -> None:
    _setup_logging()
    args = _parse_args()
    target_date = _resolve_target_date(args.date)
    start_at, end_at = _day_window_utc(target_date)

    logger.info("Analyzing WhatsApp activity for %s", target_date.isoformat())
    sb = _supabase_client()
    batches = _load_changed_account_batches(sb, start_at, end_at)

    if not batches:
        logger.info("No WhatsApp messages found for %s. Nothing to analyze.", target_date)
        return

    if args.dry_run:
        logger.info("Dry run: %d account(s) would be analyzed.", len(batches))
        for batch in batches:
            logger.info("  %s: %d messages", batch.account_id, len(batch.messages))
        return

    client = _anthropic_client()
    model = os.getenv("WA_ANALYSIS_MODEL", "claude-haiku-4-5")

    for batch in batches:
        score_state = _get_score_state(sb, batch.account_id)
        previous_score = float(score_state.get("current_score") or score_state.get("base_score") or DEFAULT_BASE_SCORE)
        analysis = _analyze_account_day(client, model, target_date, batch, previous_score)
        score_delta = _clamp(float(analysis.get("score_delta", 0) or 0), -10, 10)
        new_score = _clamp(previous_score + score_delta, 0, 100)

        daily_row = {
            "account_id": batch.account_id,
            "analysis_date": target_date.isoformat(),
            "group_names": batch.group_names,
            "message_count": len(batch.messages),
            "first_message_at": batch.first_message_at,
            "last_message_at": batch.last_message_at,
            "previous_score": previous_score,
            "score_delta": score_delta,
            "new_score": new_score,
            "sentiment": str(analysis.get("sentiment") or "neutral")[:40],
            "satisfaction": str(analysis.get("satisfaction") or "unknown")[:40],
            "risk_level": str(analysis.get("risk_level") or "low")[:40],
            "summary": str(analysis.get("summary") or "")[:4000],
            "positive_signals": _json_list(analysis.get("positive_signals")),
            "negative_signals": _json_list(analysis.get("negative_signals")),
            "action_items": _json_list(analysis.get("action_items")),
            "evidence": _json_list(analysis.get("evidence")),
            "model": model,
            "raw_analysis": analysis,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

        sb.table("wa_daily_analysis").upsert(
            daily_row,
            on_conflict="account_id,analysis_date",
        ).execute()

        total_delta = _load_total_delta(sb, batch.account_id)
        base_score = float(score_state.get("base_score") or DEFAULT_BASE_SCORE)
        cumulative_score = _clamp(base_score + total_delta, 0, 100)
        score_row = {
            "account_id": batch.account_id,
            "account_name": batch.group_names[0] if batch.group_names else None,
            "base_score": base_score,
            "current_score": cumulative_score,
            "total_delta": total_delta,
            "last_analyzed_date": target_date.isoformat(),
            "last_message_at": batch.last_message_at,
            "rolling_summary": _merge_summary(score_state.get("rolling_summary"), daily_row["summary"]),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        sb.table("wa_account_scores").upsert(score_row, on_conflict="account_id").execute()

        logger.info(
            "%s: %d msg(s), delta=%+.1f, score %.1f -> %.1f",
            batch.account_id,
            len(batch.messages),
            score_delta,
            previous_score,
            cumulative_score,
        )


def _load_changed_account_batches(sb, start_at: datetime, end_at: datetime) -> list[AccountBatch]:
    rows = _fetch_messages(sb, start_at, end_at)
    by_account: dict[str, list[dict[str, Any]]] = defaultdict(list)
    groups_by_account: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        account_id = str(row.get("account_id") or "").strip()
        if not account_id or account_id == "00_UNMAPPED":
            continue
        body = str(row.get("body") or "").strip()
        if not body:
            continue
        by_account[account_id].append(row)
        if row.get("group_name"):
            groups_by_account[account_id].add(str(row["group_name"]))

    batches = []
    for account_id in sorted(by_account):
        messages = by_account[account_id][-MAX_MESSAGES_PER_ACCOUNT:]
        batches.append(
            AccountBatch(
                account_id=account_id,
                group_names=sorted(groups_by_account[account_id]),
                messages=messages,
            )
        )
    return batches


def _fetch_messages(sb, start_at: datetime, end_at: datetime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_size = 1000
    offset = 0
    while True:
        res = (
            sb.table("wa_messages")
            .select("id, account_id, group_name, group_jid, push_name, author, body, msg_type, sent_at")
            .gte("sent_at", start_at.isoformat())
            .lt("sent_at", end_at.isoformat())
            .neq("msg_type", "system")
            .order("sent_at", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    logger.info("Loaded %d WhatsApp message(s) from selected day.", len(rows))
    return rows


def _analyze_account_day(client, model: str, target_date: date, batch: AccountBatch, previous_score: float) -> dict:
    transcript = "\n".join(
        f"[{m.get('sent_at')}] {m.get('group_name') or '?'} | {m.get('push_name') or m.get('author') or '?'}: {m.get('body')}"
        for m in batch.messages
    )
    system = (
        "Eres analista de satisfacción y riesgo para Blackwell. "
        "Evalúas conversaciones de WhatsApp de clientes. "
        "No inventes datos fuera del transcript. "
        "Responde únicamente JSON válido."
    )
    prompt = f"""
Cuenta: {batch.account_id}
Fecha analizada: {target_date.isoformat()}
Score previo: {previous_score}
Grupos: {", ".join(batch.group_names) or "desconocido"}

Analiza solo estos mensajes del día. Decide si la conversación debe sumar o restar
puntos al score del cliente.

Reglas de score_delta:
- Rango permitido: -10 a +10.
- Cliente satisfecho, aprobaciones, avance claro, desbloqueos o buena coordinación: suma.
- Quejas, frustración, urgencias no atendidas, retrasos, regaños, riesgo de churn: resta.
- Ruido operativo normal sin señal clara: 0.
- Sé conservador: no muevas más de 3 puntos salvo evidencia fuerte.

Devuelve este JSON:
{{
  "score_delta": number,
  "sentiment": "positive|neutral|negative|mixed",
  "satisfaction": "satisfied|neutral|unsatisfied|unknown",
  "risk_level": "low|medium|high",
  "summary": "resumen breve del día",
  "positive_signals": ["..."],
  "negative_signals": ["..."],
  "action_items": [{{"action":"...", "owner":"...", "urgency":"low|medium|high"}}],
  "evidence": [{{"quote":"fragmento corto", "why_it_matters":"..."}}]
}}

Transcript:
{transcript}
""".strip()
    response = client.messages.create(
        model=model,
        max_tokens=1200,
        temperature=0,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
    return _parse_json(text)


def _get_score_state(sb, account_id: str) -> dict:
    res = (
        sb.table("wa_account_scores")
        .select("*")
        .eq("account_id", account_id)
        .maybe_single()
        .execute()
    )
    if res.data:
        return res.data
    return {
        "account_id": account_id,
        "base_score": DEFAULT_BASE_SCORE,
        "current_score": DEFAULT_BASE_SCORE,
        "total_delta": 0,
    }


def _load_total_delta(sb, account_id: str) -> float:
    res = (
        sb.table("wa_daily_analysis")
        .select("score_delta")
        .eq("account_id", account_id)
        .execute()
    )
    return sum(float(row.get("score_delta") or 0) for row in (res.data or []))


def _supabase_client():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    from supabase import create_client

    return create_client(url, key)


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required for daily analysis.")
    import anthropic

    return anthropic.Anthropic(api_key=api_key)


def _parse_json(text: str) -> dict:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.strip("`")
        clean = clean.removeprefix("json").strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        start = clean.find("{")
        end = clean.rfind("}")
        if start >= 0 and end > start:
            return json.loads(clean[start : end + 1])
        raise


def _json_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _merge_summary(previous: str | None, current: str) -> str:
    parts = [p for p in [previous, current] if p]
    return "\n\n".join(parts)[-6000:]


def _resolve_target_date(raw: str | None) -> date:
    raw = raw or os.getenv("WA_ANALYSIS_DATE")
    if raw:
        return date.fromisoformat(raw)
    return datetime.now(LOCAL_TZ).date() - timedelta(days=1)


def _day_window_utc(target_date: date) -> tuple[datetime, datetime]:
    local_start = datetime.combine(target_date, time.min, tzinfo=LOCAL_TZ)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _setup_logging() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def _parse_args():
    parser = argparse.ArgumentParser(description="Analyze daily WhatsApp messages.")
    parser.add_argument("--date", help="Date to analyze in YYYY-MM-DD. Defaults to yesterday UTC.")
    parser.add_argument("--dry-run", action="store_true", help="List accounts that would be analyzed.")
    return parser.parse_args()


if __name__ == "__main__":
    main()
