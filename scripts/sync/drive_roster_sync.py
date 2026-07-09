#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Crawl the canonical Google Drive root folder and mirror the client roster into
Supabase (table `drive_account_roster`). "If there's a folder, there's a project."

Each top-level folder is named like "NN. CLIENT NAME /status", e.g.:
  "45. INOVAMEDIK /proyecto concluido"  -> number 45, client INOVAMEDIK, concluded
  "08. ULDIS/Terminación Anticipada"    -> number 08, client ULDIS,    terminated_early

Runs twice a day from the drive_roster_sync GitHub Action. The dashboard reads
this table (Supabase-first) to label the Cuentas list with client names + status.

Auth: a Google service account (GOOGLE_SERVICE_ACCOUNT_JSON) that has read access
to DRIVE_ROOT_FOLDER_ID (share the folder with the service-account email).

Usage:
    python scripts/sync/drive_roster_sync.py            # crawl + upsert
    python scripts/sync/drive_roster_sync.py --dry-run  # print, don't write
    python scripts/sync/drive_roster_sync.py --no-prune # keep rows for folders no longer present
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.sync.config import (
        SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_ROOT_FOLDER_ID,
    )
except ModuleNotFoundError:
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import (
        SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_ROOT_FOLDER_ID,
    )

log = logging.getLogger("drive_roster_sync")

# --- status derived from the folder-name label (Playbook §5) -----------------
# Mirrors dashboard/src/hooks/useAccounts.ts and App.tsx. Order matters:
# terminación anticipada is checked before "concluido".
EXCLUSION_LABELS = [
    (re.compile(r"(terminaci[oó]n\s+anticipada|terminanci[oó]n\s+anticipada|early\s+termination)", re.I), "terminated_early"),
    (re.compile(r"(proyecto\s+conclu[ií]d[oa]|conclu[ií]d[oa]|concluded)", re.I), "concluded"),
    (re.compile(r"(evento\s+[uú]nico|one[\s-]?off)", re.I), "event_single"),
    (re.compile(r"(pausa|paused|detenido)", re.I), "paused"),
    (re.compile(r"(hist[oó]rico|historical)", re.I), "historical"),
]
STATUS_LABEL = {
    "active": None,
    "concluded": "Concluido",
    "terminated_early": "Terminación anticipada",
    "paused": "Pausa",
    "event_single": "Evento único",
    "historical": "Histórico",
}


def status_from_title(folder_title: str) -> str:
    """Read the status only from the part after '/' or inside parentheses, so a
    client name that happens to contain a keyword isn't misclassified."""
    after_slash = folder_title[folder_title.index("/"):] if "/" in folder_title else ""
    paren = re.search(r"\(([^)]*)\)", folder_title)
    scope = f"{after_slash} {paren.group(1) if paren else ''}"
    for rx, status in EXCLUSION_LABELS:
        if rx.search(scope):
            return status
    return "active"


def clean_name(folder_title: str) -> str:
    """'03. ADUANAS/proyecto concluido' -> 'ADUANAS'."""
    no_num = re.sub(r"^\s*\d+\.\s*", "", folder_title)
    return no_num.split("/")[0].split("(")[0].strip()


def parse_number(folder_title: str) -> str | None:
    m = re.match(r"^\s*(\d+)", folder_title)
    return str(int(m.group(1))).zfill(2) if m else None


# --- Google Drive ------------------------------------------------------------

def build_drive_service():
    if not GOOGLE_SERVICE_ACCOUNT_JSON.strip():
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON is required (service-account key JSON).")
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    info = json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive.metadata.readonly"]
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_child_folders(service, root_id: str) -> list[dict]:
    """List immediate subfolders of root_id (works for My Drive and Shared Drives)."""
    folders: list[dict] = []
    page_token = None
    q = (
        f"'{root_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    while True:
        resp = service.files().list(
            q=q,
            fields="nextPageToken, files(id, name, modifiedTime)",
            pageSize=1000,
            orderBy="name",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            corpora="allDrives",
            pageToken=page_token,
        ).execute()
        folders.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return folders


def to_row(folder: dict) -> dict | None:
    title = (folder.get("name") or "").strip()
    number = parse_number(title)
    if not number:
        log.info("Skipping non-numbered folder: %r", title)
        return None
    status = status_from_title(title)
    return {
        "account_number": number,
        "folder_id": folder.get("id"),
        "folder_title": title,
        "client_name": clean_name(title),
        "status": status,
        "status_label": STATUS_LABEL.get(status),
        "modified_time": folder.get("modifiedTime"),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    ap = argparse.ArgumentParser(description="Mirror the Google Drive client roster into Supabase.")
    ap.add_argument("--dry-run", action="store_true", help="Print the roster without writing to Supabase.")
    ap.add_argument("--no-prune", action="store_true", help="Do not delete rows for folders that no longer exist.")
    args = ap.parse_args()

    service = build_drive_service()
    log.info("Crawling Drive root %s ...", DRIVE_ROOT_FOLDER_ID)
    folders = list_child_folders(service, DRIVE_ROOT_FOLDER_ID)
    rows = [r for r in (to_row(f) for f in folders) if r]
    # Deduplicate by account_number (keep the most recently modified folder if collision).
    by_num: dict[str, dict] = {}
    for r in sorted(rows, key=lambda x: x.get("modified_time") or ""):
        by_num[r["account_number"]] = r
    rows = sorted(by_num.values(), key=lambda x: x["account_number"])

    print("\n" + "=" * 64)
    print(f"  DRIVE ROSTER — {len(rows)} clientes")
    print("=" * 64)
    for r in rows:
        badge = f"  [{r['status_label']}]" if r["status_label"] else ""
        print(f"  {r['account_number']} | {r['client_name']}{badge}")
    print("=" * 64 + "\n")

    if args.dry_run:
        log.info("Dry-run — nothing written.")
        return

    if not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_KEY is required.")
    if not rows:
        log.warning("Crawl returned 0 folders — skipping write to avoid wiping the roster.")
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    sb.table("drive_account_roster").upsert(rows, on_conflict="account_number").execute()
    log.info("Upserted %d roster rows.", len(rows))

    if not args.no_prune:
        seen = [r["account_number"] for r in rows]
        existing = sb.table("drive_account_roster").select("account_number").execute().data or []
        stale = [e["account_number"] for e in existing if e["account_number"] not in seen]
        if stale:
            sb.table("drive_account_roster").delete().in_("account_number", stale).execute()
            log.info("Pruned %d stale roster rows: %s", len(stale), stale)

    log.info("Done.")


if __name__ == "__main__":
    main()
