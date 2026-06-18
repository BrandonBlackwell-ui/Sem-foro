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
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "wa_listener" / ".env", override=False)

logger = logging.getLogger("wa_daily_analyzer")

DEFAULT_BASE_SCORE = 70
MAX_MESSAGES_PER_GROUP = 600
MAX_AMBIGUOUS_CONTEXT_MESSAGES = 5
DEFAULT_MAX_ABS_SCORE_DELTA = 3
WORK_TYPE_LABELS = {
    "Reunión / Seguimiento",
    "Campaña",
    "Nota a cliente",
    "Crisis",
    "Media training",
    "Análisis",
    "Reporte",
    "Otro",
}
LOCAL_TZ = ZoneInfo(os.getenv("WA_ANALYSIS_TIMEZONE", "America/Mexico_City"))


@dataclass
class GroupBatch:
    account_id: str
    group_jid: str
    group_name: str | None
    messages: list[dict[str, Any]]
    context_messages: list[dict[str, Any]]
    new_messages: list[dict[str, Any]]
    existing_analysis: dict[str, Any] | None = None

    @property
    def first_message_at(self) -> str | None:
        return self.messages[0].get("sent_at") if self.messages else None

    @property
    def last_message_at(self) -> str | None:
        return self.messages[-1].get("sent_at") if self.messages else None

    @property
    def first_new_message_at(self) -> str | None:
        return self.new_messages[0].get("sent_at") if self.new_messages else None

    @property
    def last_new_message_at(self) -> str | None:
        return self.new_messages[-1].get("sent_at") if self.new_messages else None


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
    batches = _load_changed_group_batches(sb, target_date, start_at, end_at)
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
            logger.info(
                "  %s / %s: %d new message(s), %d context message(s)",
                batch.account_id,
                batch.group_name or batch.group_jid,
                len(batch.new_messages),
                len(batch.context_messages),
            )
        return

    model = os.getenv("OPENROUTER_MODEL", "google/gemini-3.1-flash-lite")

    for batch in batches:
        score_state = _get_score_state(sb, batch.account_id)
        existing = batch.existing_analysis or {}
        existing_delta = float(existing.get("score_delta") or 0)
        current_score = float(score_state.get("current_score") or score_state.get("base_score") or DEFAULT_BASE_SCORE)
        previous_score = current_score if existing else _clamp(current_score - existing_delta, 0, 100)
        analysis = _analyze_group_day(model, target_date, batch, previous_score)
        score_delta = _score_delta_from_analysis(analysis)
        daily_row = _build_daily_row(target_date, batch, previous_score, score_delta, model, analysis)

        if existing:
            daily_row = _merge_existing_daily_row(existing, daily_row, score_delta)
            (
                sb.table("wa_daily_analysis")
                .update(daily_row)
                .eq("id", existing["id"])
                .execute()
            )
        else:
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
            len(batch.new_messages),
            daily_row["sentiment"],
            score_delta,
            current_score,
        )


def _load_changed_group_batches(sb, target_date: date, start_at: datetime, end_at: datetime) -> list[GroupBatch]:
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
        messages = by_group[key][-MAX_MESSAGES_PER_GROUP:]
        existing = _load_existing_daily_analysis(sb, account_id, group_jid, target_date)
        last_analyzed_at = _parse_dt(existing.get("last_message_at")) if existing else None

        if last_analyzed_at:
            new_messages = [row for row in messages if _parse_dt(row.get("sent_at")) and _parse_dt(row.get("sent_at")) > last_analyzed_at]
            prior_messages = [row for row in messages if _parse_dt(row.get("sent_at")) and _parse_dt(row.get("sent_at")) <= last_analyzed_at]
            context_messages = prior_messages[-MAX_AMBIGUOUS_CONTEXT_MESSAGES:] if _needs_micro_context(new_messages) else []
        else:
            new_messages = messages
            context_messages = []

        if not new_messages:
            logger.info(
                "%s / %s has no messages newer than last analysis. Skipping LLM.",
                account_id,
                names.get(key) or group_jid,
            )
            continue

        batches.append(
            GroupBatch(
                account_id=account_id,
                group_jid=group_jid,
                group_name=names.get(key),
                messages=messages,
                context_messages=context_messages,
                new_messages=new_messages,
                existing_analysis=existing,
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


def _needs_micro_context(messages: list[dict[str, Any]]) -> bool:
    ambiguous_terms = {
        "ok",
        "ok enterado",
        "enterado",
        "listo",
        "va",
        "sale",
        "si",
        "sí",
        "claro",
        "perfecto",
        "gracias",
        "de acuerdo",
        "recibido",
        "confirmado",
    }
    for message in messages:
        body = str(message.get("body") or "").strip().lower()
        normalized = " ".join(body.replace(".", " ").replace(",", " ").split())
        if normalized in ambiguous_terms:
            return True
        if len(normalized) <= 18 and len(normalized.split()) <= 4:
            return True
    return False


def _analyze_group_day(model: str, target_date: date, batch: GroupBatch, previous_score: float) -> dict:
    context_transcript = "\n".join(
        f"[{m.get('sent_at')}] {m.get('push_name') or m.get('author') or '?'}: {m.get('body')}"
        for m in batch.context_messages
    )
    new_transcript = "\n".join(
        f"[{m.get('sent_at')}] {m.get('push_name') or m.get('author') or '?'}: {m.get('body')}"
        for m in batch.new_messages
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
Fecha de hoy para calcular vencimientos: {target_date.isoformat()}
Score actual antes de este grupo: {previous_score}

Analiza solamente los MENSAJES NUEVOS NO ANALIZADOS.
El contexto principal es el resumen previo y las tareas ya detectadas.
El MICRO-CONTEXTO opcional solo aparece cuando los mensajes nuevos son ambiguos,
por ejemplo "ok", "listo", "sí", "enterado" o referencias muy cortas.

Reglas criticas sobre contexto:
- No generes tareas basadas solamente en el resumen previo, tareas previas o MICRO-CONTEXTO.
- No repitas tareas que ya aparecen en el analisis previo.
- action_items debe incluir solo tareas nuevas o actualizaciones claras que surjan de MENSAJES NUEVOS NO ANALIZADOS.
- score_delta debe medir solamente el impacto incremental de los MENSAJES NUEVOS NO ANALIZADOS.
- Si el mensaje nuevo es "ok" o similar, usa el contexto para decidir si confirma algo positivo, pero no inventes tareas nuevas ni repitas las existentes.

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
  "action_items": [{{"action":"...", "owner":"...", "owner_type":"client|blackwell|shared|unknown", "urgency":"low|medium|high", "due_date":"YYYY-MM-DD|null", "work_type":"Reunión / Seguimiento|Campaña|Nota a cliente|Crisis|Media training|Análisis|Reporte|Otro"}}],
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
- Siempre devuelve due_date por accion:
  - Si urgency es high/urgente y no hay fecha explicita, due_date debe ser {target_date.isoformat()}.
  - Si urgency es medium o low y no hay fecha explicita, due_date debe ser el dia siguiente a {target_date.isoformat()}.
  - Si el mensaje menciona una fecha relativa o textual ("siguiente miercoles", "mañana", "viernes", etc.), calcula la fecha calendario usando {target_date.isoformat()} como fecha base.
  - Si realmente no se puede inferir una fecha, usa null.
- Siempre devuelve work_type usando exactamente una de estas etiquetas:
  - "Reunión / Seguimiento": follow-up, confirmar, validar, monitorear, agendar, coordinar, revisar avances.
  - "Campaña": acciones de campaña, pauta, difusión masiva, activación, estrategia de comunicación.
  - "Nota a cliente": redactar, enviar o preparar nota/comunicado/documento para cliente o vocería.
  - "Crisis": riesgo reputacional, queja, reclamo, incidente, urgencia sensible o contención.
  - "Media training": entrenamiento, preparación de vocero, simulación, Q&A, talking points de entrevista.
  - "Análisis": investigar, analizar, diagnosticar, evaluar, revisar datos o cobertura.
  - "Reporte": reportes, métricas, entregables de resultados, compilados, dashboards.
  - "Otro": si ninguna etiqueta encaja claramente.
- Si no hay tareas accionables reales, devuelve action_items como [].

Analisis previo del dia, resumido:
{_analysis_context(batch.existing_analysis)}

MICRO-CONTEXTO opcional, ya analizado; NO crear tareas desde aqui:
{context_transcript or "(sin contexto anterior)"}

MENSAJES NUEVOS NO ANALIZADOS; analizar solo esto:
{new_transcript}
""".strip()
    text = _openrouter_chat_completion(
        model=model,
        system=system,
        prompt=prompt,
        max_tokens=1200,
    )
    return _parse_json(text)


def _score_delta_from_analysis(analysis: dict) -> float:
    raw_delta = float(analysis.get("score_delta", 0) or 0)
    sentiment = str(analysis.get("sentiment") or "neutral").lower()
    satisfaction = str(analysis.get("satisfaction") or "unknown").lower()
    max_abs_delta = float(os.getenv("WA_ANALYSIS_MAX_ABS_DELTA", DEFAULT_MAX_ABS_SCORE_DELTA))

    if sentiment == "neutral" and satisfaction in ("neutral", "unknown"):
        return 0
    return _clamp(raw_delta, -max_abs_delta, max_abs_delta)


def _analysis_context(existing: dict[str, Any] | None) -> str:
    if not existing:
        return "(sin analisis previo)"

    compact = {
        "summary": existing.get("summary") or "",
        "score_delta_so_far": existing.get("score_delta"),
        "sentiment_so_far": existing.get("sentiment"),
        "satisfaction_so_far": existing.get("satisfaction"),
        "risk_level_so_far": existing.get("risk_level"),
        "existing_action_items_do_not_repeat": _json_list(existing.get("action_items"))[:20],
        "positive_signals_so_far": _json_list(existing.get("positive_signals"))[:8],
        "negative_signals_so_far": _json_list(existing.get("negative_signals"))[:8],
    }
    return json.dumps(compact, ensure_ascii=False)


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
        "action_items": _normalize_action_items(analysis.get("action_items"), group_name=batch.group_name),
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


def _load_existing_daily_analysis(sb, account_id: str, group_jid: str, target_date: date) -> dict[str, Any] | None:
    res = (
        sb.table("wa_daily_analysis")
        .select("*")
        .eq("account_id", account_id)
        .eq("group_jid", group_jid)
        .eq("analysis_date", target_date.isoformat())
        .maybe_single()
        .execute()
    )
    return res.data if res and res.data else None


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


def _merge_existing_daily_row(existing: dict[str, Any], incremental: dict[str, Any], new_delta: float) -> dict[str, Any]:
    existing_delta = float(existing.get("score_delta") or 0)
    previous_score = float(existing.get("previous_score") or incremental["previous_score"] or DEFAULT_BASE_SCORE)
    combined_delta = _clamp(existing_delta + new_delta, -10, 10)

    existing_actions = existing.get("action_items") if isinstance(existing.get("action_items"), list) else []
    new_actions = incremental.get("action_items") if isinstance(incremental.get("action_items"), list) else []

    return {
        **incremental,
        "previous_score": previous_score,
        "score_delta": combined_delta,
        "new_score": _clamp(previous_score + combined_delta, 0, 100),
        "summary": _merge_summary(existing.get("summary"), incremental.get("summary")),
        "positive_signals": _dedupe_json_list(_json_list(existing.get("positive_signals")) + _json_list(incremental.get("positive_signals"))),
        "negative_signals": _dedupe_json_list(_json_list(existing.get("negative_signals")) + _json_list(incremental.get("negative_signals"))),
        "action_items": _dedupe_action_items(existing_actions + new_actions),
        "evidence": _dedupe_json_list(_json_list(existing.get("evidence")) + _json_list(incremental.get("evidence"))),
        "raw_analysis": {
            "previous_raw_analysis": existing.get("raw_analysis"),
            "incremental_raw_analysis": incremental.get("raw_analysis"),
        },
    }


def _supabase_client():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    from supabase import create_client

    return create_client(url, key)


def _openrouter_chat_completion(model: str, system: str, prompt: str, max_tokens: int) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required for daily analysis.")

    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "https://github.com/BrandonBlackwell-ui/Sem-foro"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Blackwell Semaforo"),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter request failed: {exc.code} {detail[:500]}") from exc

    content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content)


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


def _dedupe_json_list(items: list[Any]) -> list[Any]:
    seen: set[str] = set()
    deduped: list[Any] = []
    for item in items:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True) if isinstance(item, (dict, list)) else str(item)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _dedupe_action_items(items: list[Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "").strip().lower()
        owner = str(item.get("owner") or "").strip().lower()
        key = f"{action}|{owner}"
        if not action or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _normalize_action_items(value: Any, group_name: str | None = None) -> list[dict[str, Any]]:
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

        internal_group = bool(group_name and "interno" in group_name.lower())

        if internal_group and owner_type == "client" and owner != "Cliente":
            owner_type = "blackwell"
        elif owner == "Cliente":
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
                "due_date": _normalize_due_date(item.get("due_date")),
                "work_type": _normalize_work_type(item.get("work_type")),
            }
        )

    return normalized


def _normalize_work_type(value: Any) -> str:
    text = str(value or "").strip()
    if text in WORK_TYPE_LABELS:
        return text
    normalized = text.lower()
    aliases = {
        "reunion / seguimiento": "Reunión / Seguimiento",
        "reunión/seguimiento": "Reunión / Seguimiento",
        "seguimiento": "Reunión / Seguimiento",
        "campana": "Campaña",
        "campaña": "Campaña",
        "nota": "Nota a cliente",
        "nota cliente": "Nota a cliente",
        "crisis": "Crisis",
        "media training": "Media training",
        "analisis": "Análisis",
        "análisis": "Análisis",
        "reporte": "Reporte",
        "otro": "Otro",
    }
    return aliases.get(normalized, "Otro")


def _normalize_due_date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "unknown", "sin fecha", "n/a"}:
        return None
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


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


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


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
