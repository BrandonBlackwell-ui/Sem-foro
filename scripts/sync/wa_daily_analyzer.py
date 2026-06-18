#!/usr/bin/env python3
"""
Daily WhatsApp group analyzer for Semaforo.

It reads only one local-date window from wa_messages, analyzes only groups with
messages in that window, and writes:
  - wa_daily_analysis: one analysis row per group per day
  - wa_account_scores: account base score plus cumulative group/day deltas

Default date behavior:
  If today is 2026-06-18 in America/Mexico_City, the default analysis date is
  2026-06-17. The query window is 2026-06-17 00:00 to 2026-06-18 00:00 local,
  converted to UTC for Supabase.
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
MAX_MESSAGES_PER_GROUP = 600
LOCAL_TZ = ZoneInfo(os.getenv("WA_ANALYSIS_TIMEZONE", "America/Mexico_City"))


@dataclass
class GroupBatch:
    account_id: str
    group_jid: str
    group_name: str | None
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

    logger.info(
        "Analyzing WhatsApp messages for %s local (%s to %s UTC)",
        target_date.isoformat(),
        start_at.isoformat(),
        end_at.isoformat(),
    )

    sb = _supabase_client()
    batches = _load_changed_group_batches(sb, start_at, end_at)
    if args.group_jid:
        batches = [batch for batch in batches if batch.group_jid == args.group_jid]
    if args.limit_groups is not None:
        batches = batches[: args.limit_groups]

    if not batches:
        logger.info("No WhatsApp groups with message text found for %s.", target_date)
        return

    if args.dry_run:
        logger.info("Dry run: %d group(s) would be analyzed.", len(batches))
        for batch in batches:
            logger.info("  %s / %s: %d messages", batch.account_id, batch.group_name or batch.group_jid, len(batch.messages))
        return

    client = _anthropic_client()
    model = os.getenv("WA_ANALYSIS_MODEL", "claude-haiku-4-5")

    for batch in batches:
        score_state = _get_score_state(sb, batch.account_id)
        existing_delta = _load_existing_daily_delta(sb, batch.account_id, batch.group_jid, target_date)
        current_score = float(score_state.get("current_score") or score_state.get("base_score") or DEFAULT_BASE_SCORE)
        previous_score = _clamp(current_score - existing_delta, 0, 100)
        analysis = _analyze_group_day(client, model, target_date, batch, previous_score)
        score_delta = _score_delta_from_analysis(analysis)
        daily_row = _build_daily_row(target_date, batch, previous_score, score_delta, model, analysis)

        (
            sb.table("wa_daily_analysis")
            .delete()
            .eq("account_id", batch.account_id)
            .eq("group_jid", batch.group_jid)
            .eq("analysis_date", target_date.isoformat())
            .execute()
        )
        sb.table("wa_daily_analysis").insert(daily_row).execute()

        total_delta = _load_total_delta(sb, batch.account_id)
        base_score = float(score_state.get("base_score") or DEFAULT_BASE_SCORE)
        current_score = _clamp(base_score + total_delta, 0, 100)
        score_row = {
            "account_id": batch.account_id,
            "account_name": batch.group_name,
            "base_score": base_score,
            "current_score": current_score,
            "total_delta": total_delta,
            "last_analyzed_date": target_date.isoformat(),
            "last_message_at": batch.last_message_at,
            "rolling_summary": _merge_summary(score_state.get("rolling_summary"), daily_row["summary"]),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        sb.table("wa_account_scores").upsert(score_row, on_conflict="account_id").execute()

        logger.info(
            "%s / %s: %d msg(s), %s, delta=%+.1f, account_score=%.1f",
            batch.account_id,
            batch.group_name or batch.group_jid,
            len(batch.messages),
            daily_row["sentiment"],
            score_delta,
            current_score,
        )


def _load_changed_group_batches(sb, start_at: datetime, end_at: datetime) -> list[GroupBatch]:
    rows = _fetch_messages(sb, start_at, end_at)
    by_group: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    names: dict[tuple[str, str], str | None] = {}

    for row in rows:
        account_id = str(row.get("account_id") or "").strip()
        group_jid = str(row.get("group_jid") or "").strip()
        body = str(row.get("body") or "").strip()

        if not account_id or account_id == "00_UNMAPPED":
            continue
        if not group_jid or not body:
            continue

        key = (account_id, group_jid)
        by_group[key].append(row)
        names.setdefault(key, str(row["group_name"]) if row.get("group_name") else None)

    batches: list[GroupBatch] = []
    for account_id, group_jid in sorted(by_group):
        key = (account_id, group_jid)
        batches.append(
            GroupBatch(
                account_id=account_id,
                group_jid=group_jid,
                group_name=names.get(key),
                messages=by_group[key][-MAX_MESSAGES_PER_GROUP:],
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
            .select("id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at")
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
    logger.info("Loaded %d WhatsApp message(s) from selected date window.", len(rows))
    return rows


def _analyze_group_day(client, model: str, target_date: date, batch: GroupBatch, previous_score: float) -> dict:
    transcript = "\n".join(
        f"[{m.get('sent_at')}] {m.get('push_name') or m.get('author') or '?'}: {m.get('body')}"
        for m in batch.messages
    )
    system = (
        "Eres analista de satisfaccion y riesgo para Blackwell. "
        "Evalua conversaciones de WhatsApp de clientes. "
        "No inventes datos fuera del transcript. "
        "Responde unicamente JSON valido."
    )
    prompt = f"""
Cuenta: {batch.account_id}
Grupo: {batch.group_name or batch.group_jid}
Fecha analizada: {target_date.isoformat()}
Score actual antes de este grupo: {previous_score}

Analiza solo los mensajes de este grupo y de este dia.

Reglas de score_delta:
- Devuelve un numero entre -10 y +10.
- Si el cliente esta satisfecho, aprueba avances, agradece, desbloquea o hay buena coordinacion: suma puntos.
- Si el dia es neutral o solo operativo sin senales claras: 0.
- Si hay quejas, frustracion, reclamos, retrasos, urgencias no atendidas o riesgo de churn: resta puntos.
- Se conservador: normalmente usa -3 a +3. Solo usa mas si hay evidencia fuerte.

Devuelve este JSON:
{{
  "score_delta": number,
  "sentiment": "positive|neutral|negative|mixed",
  "satisfaction": "satisfied|neutral|unsatisfied|unknown",
  "risk_level": "low|medium|high",
  "summary": "resumen breve del dia en este grupo",
  "positive_signals": ["..."],
  "negative_signals": ["..."],
  "action_items": [{{"action":"...", "owner":"...", "owner_type":"client|blackwell|shared|unknown", "urgency":"low|medium|high"}}],
  "evidence": [{{"quote":"fragmento corto", "why_it_matters":"..."}}]
}}

Reglas obligatorias para action_items:
- No devuelvas owner vacio.
- Si la accion depende del cliente, usa owner "Cliente" y owner_type "client".
- Si la accion depende de Blackwell, usa como owner el nombre exacto de la persona que respondio, acepto, confirmo, resolvio o quedo implicada en el transcript.
- Si no hay una persona clara pero la responsabilidad es de Blackwell, usa owner "Blackwell" y owner_type "blackwell".
- Si la accion es compartida, usa owner "Cliente + <nombre/persona/equipo Blackwell>" y owner_type "shared".
- Si no se puede inferir responsable con evidencia del transcript, usa owner "Por definir" y owner_type "unknown".
- Para tareas tipo confirmar, validar, monitorear o dar seguimiento: asigna owner a quien debe hacer la siguiente accion, no necesariamente a quien la pidio.
- Usa nombres reales visibles en el transcript, por ejemplo el push_name del mensaje. No inventes cargos ni nombres.
- Si no hay tareas accionables reales, devuelve action_items como [].

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


def _score_delta_from_analysis(analysis: dict) -> float:
    raw_delta = float(analysis.get("score_delta", 0) or 0)
    sentiment = str(analysis.get("sentiment") or "neutral").lower()
    satisfaction = str(analysis.get("satisfaction") or "unknown").lower()

    if sentiment == "neutral" and satisfaction in ("neutral", "unknown"):
        return 0
    return _clamp(raw_delta, -10, 10)


def _build_daily_row(
    target_date: date,
    batch: GroupBatch,
    previous_score: float,
    score_delta: float,
    model: str,
    analysis: dict,
) -> dict:
    new_score = _clamp(previous_score + score_delta, 0, 100)
    return {
        "account_id": batch.account_id,
        "group_jid": batch.group_jid,
        "group_name": batch.group_name,
        "analysis_date": target_date.isoformat(),
        "group_names": [batch.group_name] if batch.group_name else [],
        "message_count": len(batch.messages),
        "first_message_at": batch.first_message_at,
        "last_message_at": batch.last_message_at,
        "previous_score": previous_score,
        "score_delta": score_delta,
        "new_score": new_score,
        "sentiment": _normalize_choice(analysis.get("sentiment"), {"positive", "neutral", "negative", "mixed"}, "neutral"),
        "satisfaction": _normalize_choice(
            analysis.get("satisfaction"),
            {"satisfied", "neutral", "unsatisfied", "unknown"},
            "unknown",
            aliases={"high": "satisfied", "positive": "satisfied", "negative": "unsatisfied", "low": "unsatisfied"},
        ),
        "risk_level": _normalize_choice(analysis.get("risk_level"), {"low", "medium", "high"}, "low"),
        "summary": str(analysis.get("summary") or "")[:4000],
        "positive_signals": _json_list(analysis.get("positive_signals")),
        "negative_signals": _json_list(analysis.get("negative_signals")),
        "action_items": _normalize_action_items(analysis.get("action_items")),
        "evidence": _json_list(analysis.get("evidence")),
        "model": model,
        "raw_analysis": analysis,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


def _get_score_state(sb, account_id: str) -> dict:
    res = (
        sb.table("wa_account_scores")
        .select("*")
        .eq("account_id", account_id)
        .maybe_single()
        .execute()
    )
    if res and res.data:
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


def _load_existing_daily_delta(sb, account_id: str, group_jid: str, target_date: date) -> float:
    res = (
        sb.table("wa_daily_analysis")
        .select("score_delta")
        .eq("account_id", account_id)
        .eq("group_jid", group_jid)
        .eq("analysis_date", target_date.isoformat())
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        return 0
    return float(res.data.get("score_delta") or 0)


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


def _normalize_action_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, str):
            action = item.strip()
            if action:
                normalized.append(
                    {
                        "action": action,
                        "owner": "Por definir",
                        "owner_type": "unknown",
                        "urgency": "medium",
                    }
                )
            continue

        if not isinstance(item, dict):
            continue

        action = str(item.get("action") or "").strip()
        if not action:
            continue

        owner = str(item.get("owner") or "").strip()
        if not owner or owner.lower() in {"null", "none", "unknown", "sin responsable"}:
            owner = "Por definir"

        owner_type = _normalize_choice(
            item.get("owner_type"),
            {"client", "blackwell", "shared", "unknown"},
            "unknown",
            aliases={"cliente": "client", "bw": "blackwell", "equipo": "blackwell", "both": "shared"},
        )

        if owner == "Cliente":
            owner_type = "client"
        elif owner.startswith("Cliente +"):
            owner_type = "shared"
        elif owner != "Por definir" and owner_type == "unknown":
            owner_type = "blackwell"

        normalized.append(
            {
                "action": action,
                "owner": owner,
                "owner_type": owner_type,
                "urgency": _normalize_choice(item.get("urgency"), {"low", "medium", "high"}, "medium"),
            }
        )

    return normalized


def _normalize_choice(value: Any, allowed: set[str], default: str, aliases: dict[str, str] | None = None) -> str:
    text = str(value or default).strip().lower()
    if aliases and text in aliases:
        text = aliases[text]
    return text if text in allowed else default


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
    parser = argparse.ArgumentParser(description="Analyze daily WhatsApp messages by group.")
    parser.add_argument("--date", help="Date to analyze in YYYY-MM-DD. Defaults to yesterday in Mexico City.")
    parser.add_argument("--group-jid", help="Analyze only this WhatsApp group JID.")
    parser.add_argument("--limit-groups", type=int, help="Analyze only the first N groups from the selected date.")
    parser.add_argument("--dry-run", action="store_true", help="List groups that would be analyzed.")
    return parser.parse_args()


if __name__ == "__main__":
    main()
