#!/usr/bin/env python3
"""
Backfill CIMA WhatsApp exports into wa_messages and wa_daily_analysis.

The script imports only text from WhatsApp _chat.txt exports. Attachments,
images, documents, videos and other omitted media placeholders are ignored.
Long exports are summarized by month; short exports are summarized by day.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "wa_listener" / ".env", override=False)

try:
    from scripts.sync.config import OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
    from scripts.sync.wa_daily_analyzer import (
        _clamp,
        _json_list,
        _normalize_action_items,
        _normalize_choice,
        _openrouter_chat_completion,
        _parse_json,
    )
    from scripts.sync.wa_parser import parse_messages
except ModuleNotFoundError:
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
    from scripts.sync.wa_daily_analyzer import (
        _clamp,
        _json_list,
        _normalize_action_items,
        _normalize_choice,
        _openrouter_chat_completion,
        _parse_json,
    )
    from scripts.sync.wa_parser import parse_messages


ACCOUNT_ID = "13"
ACCOUNT_NAME = "CIMA"
MAIN_GROUP_JID = "120363422907876366@g.us"
INTERNAL_FALLBACK_JID = "historical_cima_interno@g.us"
DEFAULT_BASE_SCORE = 70.0
MAX_TRANSCRIPT_MESSAGES = 900

log = logging.getLogger("backfill_cima_whatsapp_history")


@dataclass(frozen=True)
class ExportConfig:
    chat_file: Path
    group_name: str
    group_jid: str | None
    period_mode: str


@dataclass
class PeriodBatch:
    period_key: str
    analysis_date: date
    period_start: date
    period_end: date
    messages: list[dict[str, Any]]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    args = _parse_args()

    exports = [
        ExportConfig(
            chat_file=Path(args.main_export) / "_chat.txt",
            group_name="CIMA + Blackwell",
            group_jid=MAIN_GROUP_JID,
            period_mode="monthly",
        ),
        ExportConfig(
            chat_file=Path(args.internal_export) / "_chat.txt",
            group_name="Interno CIMA",
            group_jid=None,
            period_mode="daily",
        ),
    ]

    groups = []
    for config in exports:
        messages = _load_text_messages(config.chat_file)
        if not messages:
            log.info("%s: no text messages found.", config.group_name)
            continue
        groups.append((config, messages))
        first_day = messages[0]["ts"].date()
        last_day = messages[-1]["ts"].date()
        log.info(
            "%s: %d text message(s), %s to %s, mode=%s",
            config.group_name,
            len(messages),
            first_day.isoformat(),
            last_day.isoformat(),
            config.period_mode,
        )

    if args.dry_run:
        for config, messages in groups:
            for batch in _period_batches(messages, config.period_mode):
                log.info(
                    "  %s %s: %d message(s), %s to %s",
                    config.group_name,
                    batch.period_key,
                    len(batch.messages),
                    batch.period_start.isoformat(),
                    batch.period_end.isoformat(),
                )
        log.info("Dry-run: nothing saved or analyzed.")
        return

    sb = _supabase_client()
    internal_jid = _resolve_internal_group_jid(sb)
    model = args.model or os.getenv("OPENROUTER_MODEL") or OPENROUTER_MODEL
    score_state = _get_score_state(sb, ACCOUNT_ID)
    previous_score = float(score_state.get("current_score") or score_state.get("base_score") or DEFAULT_BASE_SCORE)

    total_imported = 0
    total_analyses = 0

    for config, messages in groups:
        group_jid = config.group_jid or internal_jid
        _upsert_group(sb, group_jid, config.group_name)
        rows = _message_rows(messages, group_jid, config.group_name)
        total_imported += _upsert_messages(sb, rows)

        for batch in _period_batches(messages, config.period_mode):
            analysis = _analyze_period(model, config.group_name, group_jid, config.period_mode, batch)
            row = _analysis_row(
                group_name=config.group_name,
                group_jid=group_jid,
                period_mode=config.period_mode,
                batch=batch,
                previous_score=previous_score,
                model=model,
                analysis=analysis,
            )
            _save_analysis_row(sb, row)
            total_analyses += 1
            log.info(
                "Saved %s analysis for %s (%d msg)",
                config.period_mode,
                f"{config.group_name} {batch.period_key}",
                len(batch.messages),
            )

    log.info("Done. Imported/upserted %d message rows and %d analysis rows for CIMA.", total_imported, total_analyses)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill CIMA WhatsApp export history.")
    parser.add_argument(
        "--main-export",
        default=r"C:\Users\Brand\Downloads\WhatsApp Chat - CIMA + Blackwell",
        help="Folder containing CIMA + Blackwell _chat.txt",
    )
    parser.add_argument(
        "--internal-export",
        default=r"C:\Users\Brand\Downloads\WhatsApp Chat - Interno CIMA",
        help="Folder containing Interno CIMA _chat.txt",
    )
    parser.add_argument("--model", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def _load_text_messages(chat_file: Path) -> list[dict[str, Any]]:
    raw = chat_file.read_text(encoding="utf-8")
    parsed = parse_messages(raw)
    text_messages = []
    for msg in parsed:
        text = str(msg.get("text") or "").strip()
        ts = msg.get("ts")
        if not ts or msg.get("is_system") or _is_omitted_media(text):
            continue
        text_messages.append({"ts": ts, "author": str(msg.get("author") or "").strip(), "text": text})
    return sorted(text_messages, key=lambda row: row["ts"])


def _is_omitted_media(text: str) -> bool:
    lowered = text.lower().strip()
    if not lowered:
        return True
    noise_terms = (
        "<multimedia omitido>",
        "<media omitted>",
        "<adjunto:",
        "documento omitido",
        "imagen omitida",
        "video omitido",
        "audio omitido",
        "sticker omitido",
        "gif omitido",
        "contacto omitido",
    )
    return any(term in lowered for term in noise_terms)


def _period_batches(messages: list[dict[str, Any]], mode: str) -> list[PeriodBatch]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for msg in messages:
        ts: datetime = msg["ts"]
        key = ts.strftime("%Y-%m") if mode == "monthly" else ts.strftime("%Y-%m-%d")
        buckets[key].append(msg)

    batches: list[PeriodBatch] = []
    for key in sorted(buckets):
        rows = buckets[key]
        start = rows[0]["ts"].date()
        end = rows[-1]["ts"].date()
        analysis_date = date(start.year, start.month, 1) if mode == "monthly" else start
        batches.append(
            PeriodBatch(
                period_key=key,
                analysis_date=analysis_date,
                period_start=start,
                period_end=end,
                messages=rows,
            )
        )
    return batches


def _message_rows(messages: list[dict[str, Any]], group_jid: str, group_name: str) -> list[dict[str, Any]]:
    rows = []
    for idx, msg in enumerate(messages):
        ts: datetime = msg["ts"]
        author = str(msg.get("author") or "").lstrip("~ ").strip()
        body = str(msg.get("text") or "").strip()
        digest = hashlib.sha1(f"{group_jid}|{ts.isoformat()}|{author}|{body[:120]}|{idx}".encode("utf-8")).hexdigest()
        msg_id = f"export-cima-{digest[:24]}"
        rows.append(
            {
                "msg_id": msg_id,
                "remote_jid": group_jid,
                "group_jid": group_jid,
                "from_me": False,
                "account_id": ACCOUNT_ID,
                "group_name": group_name,
                "push_name": author,
                "author": author,
                "body": body,
                "msg_type": "text",
                "sent_at": ts.isoformat(),
                "message_timestamp": int(ts.timestamp()),
                "key": {"id": msg_id, "remoteJid": group_jid, "fromMe": False},
                "message": {"conversation": body},
                "raw": {
                    "imported_from_export": True,
                    "source": "whatsapp_chat_export",
                    "account_name": ACCOUNT_NAME,
                    "group_name": group_name,
                },
                "source": "whatsapp_txt_export_backfill",
            }
        )
    return rows


def _upsert_messages(sb: Any, rows: list[dict[str, Any]]) -> int:
    for start in range(0, len(rows), 200):
        sb.table("wa_messages").upsert(
            rows[start : start + 200],
            on_conflict="msg_id,remote_jid",
            ignore_duplicates=True,
        ).execute()
    return len(rows)


def _resolve_internal_group_jid(sb: Any) -> str:
    existing = (
        sb.table("wa_groups")
        .select("jid,name,account_id,active")
        .eq("account_id", ACCOUNT_ID)
        .ilike("name", "%Interno CIMA%")
        .execute()
    )
    rows = existing.data or []
    if rows:
        jid = rows[0]["jid"]
        log.info("Using existing Interno CIMA group jid: %s", jid)
        return jid
    log.info("Interno CIMA is not mapped yet; using historical fallback jid: %s", INTERNAL_FALLBACK_JID)
    return INTERNAL_FALLBACK_JID


def _upsert_group(sb: Any, group_jid: str, group_name: str) -> None:
    sb.table("wa_groups").upsert(
        {
            "jid": group_jid,
            "name": group_name,
            "account_id": ACCOUNT_ID,
            "active": True,
        },
        on_conflict="jid",
    ).execute()


def _save_analysis_row(sb: Any, row: dict[str, Any]) -> None:
    existing = (
        sb.table("wa_daily_analysis")
        .select("id")
        .eq("account_id", row["account_id"])
        .eq("group_jid", row["group_jid"])
        .eq("analysis_date", row["analysis_date"])
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        sb.table("wa_daily_analysis").update(row).eq("id", existing.data["id"]).execute()
        return
    sb.table("wa_daily_analysis").insert(row).execute()


def _analyze_period(model: str, group_name: str, group_jid: str, mode: str, batch: PeriodBatch) -> dict[str, Any]:
    transcript = _format_transcript(batch.messages)
    system = (
        "Eres analista de satisfaccion y riesgo para Blackwell. "
        "Evalua conversaciones historicas de WhatsApp de clientes. "
        "No inventes datos fuera del transcript. "
        "Responde unicamente JSON valido."
    )
    prompt = f"""
Cliente: {ACCOUNT_NAME}
Cuenta: {ACCOUNT_ID}
Grupo: {group_name} ({group_jid})
Tipo de periodo: {mode}
Periodo: {batch.period_start.isoformat()} a {batch.period_end.isoformat()}
Mensajes de texto visibles: {len(batch.messages)}

Analiza solo la conversacion textual exportada abajo.
No analices documentos, imagenes, videos, audios, stickers ni adjuntos omitidos.
Si se menciona un archivo o reporte adjunto, evalua solo lo que este escrito en el chat, sin inferir el contenido del archivo.
Los timestamps estan en hora local America/Mexico_City.

Devuelve este JSON:
{{
  "score_delta": number,
  "sentiment": "positive|neutral|negative|mixed",
  "satisfaction": "satisfied|neutral|unsatisfied|unknown",
  "risk_level": "low|medium|high",
  "summary": "resumen breve del periodo",
  "positive_signals": ["..."],
  "negative_signals": ["..."],
  "action_items": [{{"action":"...", "owner":"...", "owner_type":"client|blackwell|shared|unknown", "urgency":"low|medium|high", "due_date":"YYYY-MM-DD|null", "work_type":"Reunion / Seguimiento|Campana|Nota a cliente|Crisis|Media training|Analisis|Reporte|Otro", "evidence_speaker":"...", "evidence_quote":"...", "evidence_reason":"..."}}],
  "evidence": [{{"quote":"fragmento corto", "why_it_matters":"..."}}],
  "historical_notes": ["..."]
}}

Reglas:
- score_delta debe reflejar la sugerencia historica del periodo, pero no uses un score base.
- Si no hay senales claras de satisfaccion o riesgo, usa score_delta 0.
- No inventes tareas; action_items solo si queda una accion abierta o recurrente en el transcript.
- Usa citas cortas y literales en evidence.

Transcript:
{transcript}
"""
    response = _openrouter_chat_completion(model, system, prompt, max_tokens=4500)
    analysis = _parse_json(response)
    analysis["backfill_period_type"] = mode
    analysis["period_start"] = batch.period_start.isoformat()
    analysis["period_end"] = batch.period_end.isoformat()
    analysis["period_key"] = batch.period_key
    analysis["source"] = "cima_whatsapp_history_backfill"
    return analysis


def _format_transcript(messages: list[dict[str, Any]]) -> str:
    rows = messages[-MAX_TRANSCRIPT_MESSAGES:]
    lines = []
    omitted = len(messages) - len(rows)
    if omitted > 0:
        lines.append(f"[Se omitieron {omitted} mensajes mas antiguos para mantener el contexto dentro del limite.]")
    for msg in rows:
        ts: datetime = msg["ts"]
        author = str(msg.get("author") or "Sin autor").strip()
        text = str(msg.get("text") or "").strip()
        lines.append(f"[{ts.strftime('%Y-%m-%d %H:%M')}] {author}: {text}")
    return "\n".join(lines)


def _analysis_row(
    group_name: str,
    group_jid: str,
    period_mode: str,
    batch: PeriodBatch,
    previous_score: float,
    model: str,
    analysis: dict[str, Any],
) -> dict[str, Any]:
    suggested_delta = _clamp(float(analysis.get("score_delta") or 0), -10, 10)
    stored_delta = 0.0
    normalized = {
        "account_id": ACCOUNT_ID,
        "group_jid": group_jid,
        "group_name": group_name,
        "analysis_date": batch.analysis_date.isoformat(),
        "group_names": [group_name],
        "message_count": len(batch.messages),
        "first_message_at": batch.messages[0]["ts"].isoformat(),
        "last_message_at": batch.messages[-1]["ts"].isoformat(),
        "previous_score": previous_score,
        "score_delta": stored_delta,
        "new_score": previous_score,
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
        "action_items": _normalize_action_items(analysis.get("action_items"), group_name=group_name),
        "evidence": _json_list(analysis.get("evidence")),
        "model": model,
        "raw_analysis": {
            **analysis,
            "historical_backfill": True,
            "stored_score_delta": stored_delta,
            "suggested_score_delta": suggested_delta,
            "score_note": "Historical import stores score_delta=0 to avoid changing the live account score.",
            "period_type": period_mode,
        },
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    return normalized


def _get_score_state(sb: Any, account_id: str) -> dict[str, Any]:
    res = sb.table("wa_account_scores").select("*").eq("account_id", account_id).maybe_single().execute()
    if res and res.data:
        return res.data
    return {"base_score": DEFAULT_BASE_SCORE, "current_score": DEFAULT_BASE_SCORE}


def _supabase_client() -> Any:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


if __name__ == "__main__":
    main()
