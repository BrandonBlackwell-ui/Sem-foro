"""
wa_supabase.py — Persistencia de WhatsApp en Supabase.

Reemplaza wa_watermarks.json con las tablas wa_analysis y wa_messages.

Usado por claude_analyzer.py para:
  - Leer watermark (último mensaje procesado) antes del análisis
  - Guardar mensajes del chat txt en wa_messages
  - Actualizar watermark y rolling_summary después del análisis

Variables de entorno requeridas:
  SUPABASE_URL          https://vqgfkfvywbpjldreuplb.supabase.co
  SUPABASE_SERVICE_KEY  eyJ...  (service_role key — NO la anon key)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Lazy import — supabase-py puede no estar instalado en entornos sin DB
_client = None


def _get_client():
    """Retorna el cliente Supabase (singleton). Lanza si no está configurado."""
    global _client
    if _client is not None:
        return _client

    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")

    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridos. "
            "Agrégalos al .env o a los secrets de GitHub Actions."
        )

    from supabase import create_client
    _client = create_client(url, key)
    return _client


def is_available() -> bool:
    """True si Supabase está configurado en el entorno."""
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY"))


# ─────────────────────────────────────────────────────────────────────────────
# Watermark (wa_analysis)
# ─────────────────────────────────────────────────────────────────────────────

def get_watermark(account_id: str) -> dict:
    """
    Retorna el watermark de una cuenta.

    Returns dict con:
      last_msg_ts:     ISO string o None
      rolling_summary: str o None
    """
    try:
        sb = _get_client()
        res = (
            sb.table("wa_analysis")
            .select("last_msg_ts, rolling_summary, msg_count_total")
            .eq("account_id", account_id)
            .maybe_single()
            .execute()
        )
        if res.data:
            ts = res.data.get("last_msg_ts")
            # Supabase retorna timestamptz como string ISO con timezone
            if ts and ts.endswith("+00:00"):
                ts = ts.replace("+00:00", "")
            return {
                "last_ts": ts,
                "rolling_summary": res.data.get("rolling_summary"),
                "msg_count_total": res.data.get("msg_count_total", 0),
            }
    except Exception as e:
        logger.warning("wa_supabase: no se pudo leer watermark para %s: %s", account_id, e)
    return {"last_ts": None, "rolling_summary": None, "msg_count_total": 0}


def update_watermark(
    account_id: str,
    latest_ts_iso: str,
    *,
    rolling_summary: str | None = None,
    msg_count: int | None = None,
    sc_signals: dict | None = None,
) -> None:
    """Actualiza (upsert) el watermark de una cuenta en wa_analysis."""
    try:
        sb = _get_client()
        payload: dict[str, Any] = {
            "account_id": account_id,
            "last_msg_ts": latest_ts_iso,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if rolling_summary is not None:
            payload["rolling_summary"] = rolling_summary
        if msg_count is not None:
            payload["msg_count_total"] = msg_count
        if sc_signals is not None:
            payload["sc_signals"] = sc_signals

        sb.table("wa_analysis").upsert(payload, on_conflict="account_id").execute()
        logger.info("wa_supabase: watermark actualizado — %s → %s", account_id, latest_ts_iso)
    except Exception as e:
        logger.error("wa_supabase: error al actualizar watermark %s: %s", account_id, e)


# ─────────────────────────────────────────────────────────────────────────────
# Mensajes (wa_messages) — ingesta desde _chat.txt de Drive
# ─────────────────────────────────────────────────────────────────────────────

def bulk_insert_messages(account_id: str, group_jid: str, messages: list[dict]) -> int:
    """
    Inserta mensajes en wa_messages con deduplicación automática.

    messages: lista de dicts de wa_parser.parse_messages() con keys:
      ts, ts_iso, author, text, is_system

    Retorna el número de mensajes insertados (0 si todos ya existían).
    """
    if not messages:
        return 0

    rows = []
    for i, m in enumerate(messages):
        ts = m.get("ts_iso") or ""
        if not ts:
            continue
        # Generamos un msg_id determinístico desde el timestamp + author + índice
        # (los exports de Drive no traen el ID nativo de WhatsApp)
        msg_id = f"txt_{account_id}_{ts}_{i}"
        rows.append({
            "msg_id": msg_id,
            "remote_jid": group_jid,
            "group_jid": group_jid,
            "from_me": False,
            "participant_jid": None,
            "account_id": account_id,
            "group_name": None,
            "push_name": None,
            "author": m.get("author", ""),
            "body": m.get("text", ""),
            "msg_type": "system" if m.get("is_system") else "text",
            "sent_at": ts + "Z" if not ts.endswith("Z") and "+" not in ts else ts,
            "message_timestamp": int(m["ts"].timestamp()) if m.get("ts") else None,
            "status": None,
            "broadcast": None,
            "key": {
                "id": msg_id,
                "remoteJid": group_jid,
                "fromMe": False,
            },
            "message": {
                "conversation": m.get("text", ""),
            },
            "raw": {
                "source": "whatsapp_txt_export",
                "key": {
                    "id": msg_id,
                    "remoteJid": group_jid,
                    "fromMe": False,
                },
                "message": {
                    "conversation": m.get("text", ""),
                },
                "pushName": m.get("author", ""),
                "messageTimestamp": int(m["ts"].timestamp()) if m.get("ts") else None,
            },
            "source": "whatsapp_txt_export",
        })

    if not rows:
        return 0

    try:
        sb = _get_client()
        # ignore_duplicates=True → ON CONFLICT DO NOTHING
        res = sb.table("wa_messages").upsert(
            rows,
            on_conflict="msg_id,remote_jid",
            ignore_duplicates=True,
        ).execute()
        inserted = len(res.data) if res.data else 0
        logger.info(
            "wa_supabase: %d/%d mensajes insertados para %s",
            inserted, len(rows), account_id,
        )
        return inserted
    except Exception as e:
        logger.error("wa_supabase: error insertando mensajes para %s: %s", account_id, e)
        return 0


def get_messages_since(
    account_id: str,
    since_iso: str | None,
    *,
    limit: int = 500,
    include_system: bool = False,
) -> list[dict]:
    """
    Retorna mensajes de una cuenta desde `since_iso`.
    Si since_iso es None, retorna los últimos `limit` mensajes.
    """
    try:
        sb = _get_client()
        q = (
            sb.table("wa_messages")
            .select("sent_at, author, body, msg_type")
            .eq("account_id", account_id)
            .order("sent_at", desc=False)
            .limit(limit)
        )
        if since_iso:
            q = q.gt("sent_at", since_iso)
        if not include_system:
            q = q.neq("msg_type", "system")

        res = q.execute()
        return res.data or []
    except Exception as e:
        logger.warning("wa_supabase: error leyendo mensajes %s: %s", account_id, e)
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Score overrides (reemplaza localStorage del dashboard)
# ─────────────────────────────────────────────────────────────────────────────

def get_all_score_overrides() -> dict[str, dict]:
    """
    Retorna todos los score overrides como dict keyed por account_id.
    Usado al generar drive_intelligence.js para que los overrides
    de Supabase se apliquen en el build.
    """
    try:
        sb = _get_client()
        res = sb.table("score_overrides").select("*").execute()
        return {row["account_id"]: row for row in (res.data or [])}
    except Exception as e:
        logger.warning("wa_supabase: error leyendo score_overrides: %s", e)
        return {}
