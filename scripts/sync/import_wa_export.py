#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import a WhatsApp exported chat (_chat.txt) into wa_messages.

Useful when the listener joined a group late and history is missing.

Usage:
    python -m scripts.sync.import_wa_export --chat-file "_chat.txt" \
        --group-jid 120363...@g.us --account-id 02 --group-name "MAJA A+ Blackwell" \
        --since 2026-07-01
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from scripts.sync.config import SUPABASE_SERVICE_KEY, SUPABASE_URL
except ModuleNotFoundError:
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import SUPABASE_SERVICE_KEY, SUPABASE_URL

from supabase import create_client

log = logging.getLogger(__name__)
TZ = ZoneInfo("America/Mexico_City")

# [dd/mm/yy, h:mm:ss p. m.] Author: text   (may start with U+200E and use U+202F/U+00A0 spaces)
LINE_RE = re.compile(
    r"^‎?\[(\d{1,2})/(\d{1,2})/(\d{2,4}),\s*(\d{1,2}):(\d{2}):(\d{2})[\s  ]*([ap])\.?\s*m\.?\]\s*([^:]+):\s?(.*)$",
    re.IGNORECASE,
)


def parse_chat(path: Path) -> list[dict]:
    messages: list[dict] = []
    current: dict | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.replace("‎", "").replace(" ", " ").replace(" ", " ")
        m = LINE_RE.match(line)
        if m:
            if current:
                messages.append(current)
            day, month, year, hour, minute, second, ampm, author, body = m.groups()
            year_n = int(year) + (2000 if int(year) < 100 else 0)
            hour_n = int(hour) % 12 + (12 if ampm.lower() == "p" else 0)
            sent = datetime(year_n, int(month), int(day), hour_n, int(minute), int(second), tzinfo=TZ)
            current = {"sent_at": sent, "author": author.strip(), "body": body.strip()}
        elif current is not None:
            current["body"] = (current["body"] + "\n" + line).strip()
    if current:
        messages.append(current)
    return messages


def is_noise(body: str) -> bool:
    lowered = body.lower()
    return (
        "<adjunto:" in lowered
        or "documento omitido" in lowered
        or "imagen omitida" in lowered
        or "video omitido" in lowered
        or "sticker omitido" in lowered
        or "audio omitido" in lowered
        or lowered.strip() == ""
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    ap = argparse.ArgumentParser(description="Import WhatsApp export into wa_messages")
    ap.add_argument("--chat-file", required=True)
    ap.add_argument("--group-jid", required=True)
    ap.add_argument("--account-id", required=True)
    ap.add_argument("--group-name", required=True)
    ap.add_argument("--since", required=True, help="Only import messages on/after this date (YYYY-MM-DD, local)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    since = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=TZ)
    parsed = parse_chat(Path(args.chat_file))
    recent = [m for m in parsed if m["sent_at"] >= since]
    log.info("Parsed %d messages, %d on/after %s", len(parsed), len(recent), args.since)

    rows = []
    for m in recent:
        if is_noise(m["body"]):
            continue
        msg_id = "import-" + hashlib.sha1(
            f"{args.group_jid}|{m['sent_at'].isoformat()}|{m['author']}|{m['body'][:80]}".encode()
        ).hexdigest()[:24]
        rows.append({
            "msg_id": msg_id,
            "remote_jid": args.group_jid,
            "group_jid": args.group_jid,
            "from_me": False,
            "account_id": args.account_id,
            "group_name": args.group_name,
            "push_name": m["author"].lstrip("~ ").strip(),
            "author": m["author"].lstrip("~ ").strip(),
            "body": m["body"],
            "msg_type": "text",
            "sent_at": m["sent_at"].isoformat(),
            "key": {"id": msg_id, "remoteJid": args.group_jid, "fromMe": False},
            "raw": {"imported_from_export": True, "source": "whatsapp_chat_export"},
        })

    log.info("%d text messages to import", len(rows))
    for r in rows[:5]:
        log.info("  %s | %s: %s", r["sent_at"], r["author"], r["body"][:70])

    if args.dry_run:
        log.info("Dry-run: nothing saved.")
        return

    if rows:
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        for start in range(0, len(rows), 200):
            sb.table("wa_messages").upsert(
                rows[start:start + 200], on_conflict="msg_id,remote_jid", ignore_duplicates=True
            ).execute()
        log.info("Imported %d messages into wa_messages for %s", len(rows), args.group_name)


if __name__ == "__main__":
    main()
