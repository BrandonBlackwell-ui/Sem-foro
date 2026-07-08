#!/usr/bin/env python3
"""
Backfill speaker_name/speaker_team/speaker_label on wa_messages.

The listener fills these fields for new messages. This script updates existing
messages using data/wa_participants.json so chatbot queries can ask "who said
what" without reparsing author phone numbers.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
PARTICIPANTS_PATH = ROOT / "data" / "wa_participants.json"
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "wa_listener" / ".env", override=False)

logger = logging.getLogger("wa_backfill_speakers")


def main() -> None:
    _setup_logging()
    args = _parse_args()
    participants = _load_participants()
    rows = _fetch_messages(args.date, args.group_name, args.limit)
    logger.info("Loaded %d message(s) for speaker backfill.", len(rows))

    updated = 0
    for row in rows:
        payload = _speaker_payload(row, participants)
        if not payload.get("speaker_label"):
            continue
        if args.dry_run:
            logger.info("[dry-run] %s -> %s", row.get("id"), payload)
        else:
            _supabase_request(
                "PATCH",
                "wa_messages",
                params={"id": f"eq.{row['id']}"},
                body=payload,
                prefer="return=minimal",
            )
        updated += 1

    logger.info("%s %d message speaker row(s).", "Would update" if args.dry_run else "Updated", updated)


def _fetch_messages(target_date: str | None, group_name: str | None, limit: int | None) -> list[dict[str, Any]]:
    params = {
        "select": "id,author,push_name,speaker_name,speaker_team,speaker_label,sent_at,group_name",
        "order": "sent_at.asc",
    }
    if target_date:
        params["sent_at"] = f"gte.{target_date}T00:00:00+00:00"
    if group_name:
        params["group_name"] = f"ilike.*{group_name}*"
    if limit:
        params["limit"] = str(limit)
    return _supabase_request("GET", "wa_messages", params=params) or []


def _speaker_payload(row: dict[str, Any], participants: dict[str, dict[str, Any]]) -> dict[str, str | None]:
    author = str(row.get("author") or "").strip()
    push_name = str(row.get("push_name") or "").strip()
    participant = _lookup_participant(author, participants)
    if participant:
        name = str(participant.get("name") or author or push_name).strip()
        team = _speaker_team_label(str(participant.get("team") or ""))
        return {
            "speaker_name": name,
            "speaker_team": team,
            "speaker_label": f"{name} ({team})" if team else name,
        }

    name = push_name or author or None
    return {
        "speaker_name": name,
        "speaker_team": None,
        "speaker_label": name,
    }


def _lookup_participant(value: str, participants: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    digits = _phone_digits(value)
    if not digits:
        return None
    return participants.get(digits) or participants.get(digits[-10:])


def _load_participants() -> dict[str, dict[str, Any]]:
    if not PARTICIPANTS_PATH.exists():
        return {}
    rows = json.loads(_strip_json_comments(PARTICIPANTS_PATH.read_text(encoding="utf-8")))
    participants: dict[str, dict[str, Any]] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        phone = _phone_digits(str(row.get("phone") or ""))
        if not phone:
            continue
        participants[phone] = row
        if len(phone) >= 10:
            participants[phone[-10:]] = row
    return participants


def _strip_json_comments(text: str) -> str:
    return re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)


def _speaker_team_label(team: str) -> str | None:
    normalized = team.strip().lower()
    if normalized in {"bws", "blackwell", "blackwell strategy"}:
        return "Blackwell"
    if normalized in {"cliente", "client"}:
        return "Cliente"
    return team.strip() or None


def _phone_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _supabase_request(
    method: str,
    table: str,
    params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    prefer: str | None = None,
) -> Any:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")

    query = urllib.parse.urlencode(params or {})
    endpoint = f"{url}/rest/v1/{table}"
    if query:
        endpoint = f"{endpoint}?{query}"

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed: {exc.code} {detail[:700]}") from exc

    return json.loads(raw) if raw else None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill resolved speaker fields on WhatsApp messages.")
    parser.add_argument("--date", default=None, help="UTC date lower bound, e.g. 2026-06-18")
    parser.add_argument("--group-name", default=None, help="Optional group name ilike filter, e.g. Tello")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


if __name__ == "__main__":
    main()
