#!/usr/bin/env python3
"""
Sync WhatsApp daily analysis action items to Monday.com.

Reads wa_daily_analysis.action_items, creates Monday items on the configured
central board, then writes monday_item_id back into the JSON so reruns do not
duplicate tasks.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "wa_listener" / ".env", override=False)

LOCAL_TZ = ZoneInfo(os.getenv("WA_ANALYSIS_TIMEZONE", "America/Mexico_City"))
MONDAY_API_URL = "https://api.monday.com/v2"

logger = logging.getLogger("wa_monday_tasks")


def normalize(s: str) -> str:
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not (0x0300 <= ord(ch) <= 0x036F))
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def _fetch_all_monday_boards(api_key: str) -> list[dict[str, Any]]:
    query = """
    query {
      boards(limit: 250) {
        id
        name
        workspace {
          id
          name
        }
      }
    }
    """
    try:
        payload = _monday_request(api_key, query, {})
        return payload.get("data", {}).get("boards", []) or []
    except Exception as e:
        logger.error("Error fetching Monday boards: %s", e)
        return []


def _fetch_account_names() -> dict[str, str]:
    try:
        rows = _supabase_request("GET", "wa_account_scores", params={"select": "account_id,account_name"}) or []
        mapping = {}
        for r in rows:
            acc_id = str(r.get("account_id") or "").strip()
            acc_name = str(r.get("account_name") or "").strip()
            if acc_id and acc_name:
                mapping[acc_id] = acc_name
        return mapping
    except Exception as e:
        logger.error("Error fetching account names: %s", e)
        return {}


def _find_board_by_name(boards: list[dict[str, Any]], account_name: str) -> dict[str, Any] | None:
    acc_name_norm = normalize(account_name)
    acc_words = set(acc_name_norm.split())
    STOP = {"blackwell", "bws", "strategy", "consultoria", "cuentas", "grupo", "de", "y", "a", "a+", "la", "el"}
    acc_words = {w for w in acc_words if w not in STOP and len(w) >= 2}
    
    if not acc_words:
        acc_words = set(acc_name_norm.split())

    best_match = None
    best_score = 0
    
    for board in boards:
        board_name = board["name"]
        board_name_norm = normalize(board_name)
        board_words = set(board_name_norm.split())
        board_words = {w for w in board_words if w not in STOP}
        
        ws_name = (board.get("workspace") or {}).get("name", "").lower()
        is_correct_ws = "consultoria" in ws_name or "cuentas" in ws_name
        
        clean_board_name = re.sub(r'^\d+[\s\.\-_]+', '', board_name_norm).strip()
        clean_acc_name = re.sub(r'^\d+[\s\.\-_]+', '', acc_name_norm).strip()
        
        clean_board_name = clean_board_name.replace("blackwell", "").replace("bws", "").strip()
        clean_acc_name = clean_acc_name.replace("blackwell", "").replace("bws", "").strip()
        
        if clean_board_name == clean_acc_name:
            score = 100
        elif clean_board_name in clean_acc_name or clean_acc_name in clean_board_name:
            score = 90
        else:
            matched_words = acc_words.intersection(board_words)
            if matched_words:
                score = (len(matched_words) / len(acc_words)) * 80
            else:
                score = 0
                
        if is_correct_ws and score > 0:
            score += 15
            
        if score > best_score:
            best_score = score
            best_match = board
            
    if best_match and best_score >= 40:
        return best_match
    return None


def _resolve_board(
    boards_config: dict[str, Any],
    account_id: str,
    account_names: dict[str, str],
    monday_boards: list[dict[str, Any]],
) -> dict[str, Any] | None:
    boards = boards_config.get("boards", {})
    mapped = boards.get(account_id) or boards.get(account_id.lstrip("0"))
    if mapped:
        return {
            "board_id": str(mapped["board_id"]),
            "board_name": mapped.get("board_name", account_id),
            "central": False,
        }
        
    account_name = account_names.get(account_id) or account_names.get(account_id.lstrip("0"))
    if account_name and monday_boards:
        matched = _find_board_by_name(monday_boards, account_name)
        if matched:
            return {
                "board_id": str(matched["id"]),
                "board_name": matched["name"],
                "central": False,
            }
            
    return None


def _get_board_info(api_key: str, board_id: str) -> dict[str, Any]:
    query = """
    query GetBoardInfo($boardId: [ID!]!) {
      boards(ids: $boardId) {
        groups {
          id
          title
        }
        columns {
          id
          title
          type
        }
      }
    }
    """
    try:
        payload = _monday_request(api_key, query, {"boardId": [board_id]})
        boards = payload.get("data", {}).get("boards", [])
        if not boards:
            return {"columns": {}, "group_id": "topics"}
        
        groups = boards[0].get("groups", [])
        group_id = "topics"
        if groups:
            matched_group = next((g for g in groups if "tareas de la cuenta" in g["title"].lower().strip()), None)
            if matched_group:
                group_id = matched_group["id"]
            else:
                group_id = groups[0]["id"]
                
        cols = boards[0].get("columns", [])
        mapping = {}
        for col in cols:
            col_id = col["id"]
            title = col["title"].lower().strip()
            col_type = col["type"]
            
            if title == "estado":
                mapping["estado"] = col_id
            elif "tipo de" in title or "work type" in title:
                mapping["tipo_trabajo"] = col_id
            elif "link" in title or col_type == "link":
                mapping["link_entregable"] = col_id
            elif title in ("responsable", "responsables", "assignee", "person", "assigned to") or col_type in ("person", "multiple-person"):
                if not mapping.get("responsable") or title == "responsable":
                    mapping["responsable"] = col_id
            elif "fecha" in title or "due" in title or col_type == "date":
                if not mapping.get("fecha_entrega") or "entrega" in title:
                    mapping["fecha_entrega"] = col_id

        status_cols = [c for c in cols if c["type"] == "status"]
        if "estado" not in mapping and status_cols:
            non_work_status = [c for c in status_cols if "tipo" not in c["title"].lower()]
            if non_work_status:
                mapping["estado"] = non_work_status[0]["id"]
            else:
                mapping["estado"] = status_cols[0]["id"]

        return {"columns": mapping, "group_id": group_id}
    except Exception as e:
        logger.error("Error fetching board info for board %s: %s", board_id, e)
        return {"columns": {}, "group_id": "topics"}


def _fetch_pending_wa_tasks() -> list[dict[str, Any]]:
    params = {
        "select": "id,account_id,group_name,group_jid,analysis_date,action,owner,owner_type,urgency,due_date,work_type,client_label,raw_action,created_at",
        "monday_item_id": "is.null",
        "order": "created_at.asc",
    }
    return _supabase_request("GET", "wa_tasks", params=params) or []


def main() -> None:
    _setup_logging()
    args = _parse_args()
    target_date = _resolve_target_date(args.date)
    boards_config = _load_boards_config()
    monday_users = _load_monday_users()
    
    api_key = _monday_api_key()
    if not api_key and not args.dry_run:
        logger.info("MONDAY_API_KEY is not set. Skipping Monday sync.")
        return

    # Fetch all Monday boards
    monday_boards = []
    if api_key:
        monday_boards = _fetch_all_monday_boards(api_key)
        
    # Fetch account names map
    account_names = _fetch_account_names()
    
    board_info_cache = {}

    # Step 1: Sync WhatsApp daily analysis tasks
    logger.info("Step 1: Syncing WhatsApp daily analysis tasks for %s...", target_date.isoformat())
    analyses = _fetch_daily_analyses(target_date, args.account_id)
    if args.limit is not None:
        analyses = analyses[: args.limit]

    totals = {"created": 0, "skipped": 0, "unmapped": 0, "empty": 0}
    for row in analyses:
        row_totals = _sync_analysis_row(
            row,
            boards_config,
            monday_users,
            api_key,
            args.dry_run,
            account_names,
            monday_boards,
            board_info_cache
        )
        for key, value in row_totals.items():
            totals[key] += value

    # Step 2: Sync other pending tasks in wa_tasks (Meet / Session tasks)
    logger.info("Step 2: Syncing other pending tasks in wa_tasks (Meet, Notes, etc.)...")
    pending_tasks = _fetch_pending_wa_tasks()
    if args.account_id:
        pending_tasks = [t for t in pending_tasks if str(t.get("account_id")) == str(args.account_id)]
        
    meet_totals = {"created": 0, "skipped": 0, "unmapped": 0}
    for task in pending_tasks:
        # Determine board
        account_id = _account_id(task)
        # Las tareas internas (00_INTERNAL) NO se empujan a Monday: el matcher
        # fuzzy las mandaba al board "Equipo interno", que no es su destino.
        # Definir board explícito en monday_boards.json antes de reactivarlas.
        if str(account_id).startswith("00_"):
            meet_totals["skipped"] += 1
            continue
        board = _resolve_board(boards_config, account_id, account_names, monday_boards)
        if not board:
            logger.warning("No board found for pending task %s (account: %s).", task.get("id"), account_id)
            meet_totals["unmapped"] += 1
            continue
            
        board_id = str(board["board_id"])
        if board_id not in board_info_cache and api_key:
            board_info_cache[board_id] = _get_board_info(api_key, board_id)
        board_info = board_info_cache.get(board_id, {"columns": {}, "group_id": "topics"})
        
        # Prepare task item dict for _column_values and _evidence_text
        item = {
            "action": task.get("action"),
            "owner": task.get("owner"),
            "owner_type": task.get("owner_type") or "unknown",
            "urgency": task.get("urgency"),
            "due_date": task.get("due_date"),
            "work_type": task.get("work_type"),
            "delivery_link": task.get("raw_action", {}).get("delivery_link") or task.get("raw_action", {}).get("link"),
        }
        
        sync_key = task.get("monday_sync_key") or f"meet-{task.get('id')}"
        item_name = task.get("action")[:255]
        column_values = _column_values(boards_config, task, item, board, monday_users, board_info)
        
        if args.dry_run:
            logger.info(
                "[dry-run] Would create Monday item for pending task %s on board %s (%s): %s",
                task["id"],
                board["board_id"],
                board["board_name"],
                item_name,
            )
            meet_totals["created"] += 1
            continue
            
        try:
            created = _create_monday_item(
                api_key=api_key,
                board_id=board_id,
                group_id=board_info["group_id"],
                item_name=item_name,
                column_values=column_values,
            )

            # CRÍTICO: guardar monday_item_id INMEDIATAMENTE después de crear el
            # item, con el payload mínimo. Si este write-back falla, la tarea
            # queda "pendiente" y cada corrida vuelve a crear el item en Monday
            # (así se duplicaron miles de items en el board interno).
            _supabase_request(
                "PATCH", "wa_tasks",
                params={"id": f"eq.{task['id']}"},
                body={
                    "monday_item_id": created["id"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as e:
            logger.error("Error syncing pending task %s: %s", task["id"], e)
            meet_totals["skipped"] += 1
            continue

        meet_totals["created"] += 1
        logger.info("Synced pending task %s to Monday item %s.", task["id"], created["id"])

        # Lo que sigue es best-effort: si falla, el item ya quedó registrado y
        # NO se re-creará en la próxima corrida.
        try:
            # Create update if there is any meeting summary or detail
            source = task.get("raw_action", {}).get("source") or "gemini_meet_notes"
            source_label = "Google Meet (Gemini Notes desde Gmail)" if source == "gemini_meet_email_sync" else "Minuta de Google Meet"
            meeting_date = task.get("analysis_date") or (task.get("created_at") or "")[:10]

            evidence_text = (
                f"Origen: {source_label}\n"
                f"Fecha del origen: {meeting_date}\n\n"
            )
            detail_summary = task.get("summary") or task.get("raw_action", {}).get("summary") or ""
            if not detail_summary and task.get("raw_action", {}).get("email_subject"):
                detail_summary = f"Reunión: {task.get('raw_action', {}).get('email_subject')}"

            evidence_text += detail_summary
            _create_monday_update(api_key, str(created["id"]), evidence_text)

            # Metadatos restantes (sin monday_created_at: esa columna no existe
            # en wa_tasks y hacía fallar el PATCH completo).
            _supabase_request(
                "PATCH", "wa_tasks",
                params={"id": f"eq.{task['id']}"},
                body={
                    "monday_item_name": created.get("name") or item_name,
                    "monday_status": "Por hacer",
                    "monday_due_date": task.get("due_date") or _due_date_for_item(item, "medium").isoformat(),
                    "monday_work_type": task.get("work_type"),
                    "last_synced_to_monday_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as e:
            logger.warning("Post-sync metadata for task %s failed (item %s already registered): %s", task["id"], created["id"], e)

    mode = "dry-run" if args.dry_run else "live"
    logger.info(
        "Monday sync %s complete. WhatsApp tasks: created=%d skipped=%d unmapped=%d empty=%d. Meet/Session tasks: created=%d skipped=%d unmapped=%d",
        mode,
        totals["created"],
        totals["skipped"],
        totals["unmapped"],
        totals["empty"],
        meet_totals["created"],
        meet_totals["skipped"],
        meet_totals["unmapped"],
    )


def _sync_analysis_row(
    row: dict[str, Any],
    boards_config: dict[str, Any],
    monday_users: dict[str, dict[str, Any]],
    api_key: str,
    dry_run: bool,
    account_names: dict[str, str],
    monday_boards: list[dict[str, Any]],
    board_info_cache: dict[str, dict[str, Any]],
) -> dict[str, int]:
    totals = {"created": 0, "skipped": 0, "unmapped": 0, "empty": 0}
    action_items = row.get("action_items") if isinstance(row.get("action_items"), list) else []
    if not action_items:
        totals["empty"] += 1
        return totals

    account_id = _account_id(row)
    board = _resolve_board(boards_config, account_id, account_names, monday_boards)
    if not board:
        logger.warning(
            "No Monday board configured/found for account %s (%s). Skipping %d task(s).",
            account_id,
            row.get("group_name") or row.get("group_jid"),
            len(action_items),
        )
        totals["unmapped"] += len(action_items)
        return totals

    board_id = str(board["board_id"])
    if board_id not in board_info_cache and api_key:
        board_info_cache[board_id] = _get_board_info(api_key, board_id)
    board_info = board_info_cache.get(board_id, {"columns": {}, "group_id": "topics"})

    updated_items: list[dict[str, Any]] = []
    changed = False
    for index, item in enumerate(action_items):
        if not isinstance(item, dict):
            updated_items.append(item)
            totals["skipped"] += 1
            continue

        action = str(item.get("action") or "").strip()
        if not action:
            updated_items.append(item)
            totals["skipped"] += 1
            continue

        if item.get("monday_item_id"):
            _upsert_wa_task(row, item, sync_key=item.get("monday_sync_key") or _sync_key(row, index, action))
            updated_items.append(item)
            totals["skipped"] += 1
            continue

        sync_key = item.get("monday_sync_key") or _sync_key(row, index, action)
        item_name = _monday_item_name(row, item)
        column_values = _column_values(boards_config, row, item, board, monday_users, board_info)

        if dry_run:
            logger.info(
                "[dry-run] Would create Monday item on board %s (%s): %s",
                board["board_id"],
                board.get("board_name", account_id),
                item_name,
            )
            updated = dict(item)
            updated["monday_sync_key"] = sync_key
            updated_items.append(updated)
            totals["created"] += 1
            continue

        try:
            created = _create_monday_item(
                api_key=api_key,
                board_id=board_id,
                group_id=board_info["group_id"],
                item_name=item_name,
                column_values=column_values,
            )
            _create_monday_update(api_key, str(created["id"]), _evidence_text(row, item))
            updated = dict(item)
            updated["monday_item_id"] = created["id"]
            updated["monday_item_name"] = created.get("name") or item_name
            updated["monday_created_at"] = created.get("created_at")
            updated["monday_sync_key"] = sync_key
            updated["monday_synced_at"] = datetime.now(timezone.utc).isoformat()
            updated_items.append(updated)
            _upsert_wa_task(row, updated, sync_key=sync_key)
            changed = True
            totals["created"] += 1
            logger.info("Created Monday item %s for %s.", created["id"], item_name)
        except Exception as e:
            logger.error("Failed to sync item %s to board %s: %s", item_name, board_id, e)
            updated_items.append(item)
            totals["skipped"] += 1

    if changed:
        _patch_analysis_action_items(str(row["id"]), updated_items)

    return totals


def _create_monday_item(
    api_key: str,
    board_id: str,
    group_id: str,
    item_name: str,
    column_values: dict[str, Any],
) -> dict[str, Any]:
    mutation = """
    mutation CreateItem($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
        id
        name
        created_at
      }
    }
    """
    variables = {
        "boardId": board_id,
        "groupId": group_id,
        "itemName": item_name,
        "columnValues": json.dumps(column_values, ensure_ascii=False),
    }
    payload = _monday_request(api_key, mutation, variables)
    return payload["data"]["create_item"]


def _create_monday_update(api_key: str, item_id: str, body: str) -> None:
    mutation = """
    mutation CreateUpdate($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
    """
    _monday_request(api_key, mutation, {"itemId": item_id, "body": body})


def _monday_request(api_key: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        MONDAY_API_URL,
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
            "API-Version": "2024-10",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Monday request failed: {exc.code} {detail[:700]}") from exc

    if payload.get("errors"):
        raise RuntimeError(f"Monday GraphQL error: {json.dumps(payload['errors'], ensure_ascii=False)[:1000]}")
    return payload


def _fetch_daily_analyses(target_date: date, account_id: str | None) -> list[dict[str, Any]]:
    params = {
        "select": "id,account_id,group_name,group_jid,analysis_date,score_delta,new_score,sentiment,satisfaction,risk_level,summary,action_items",
        "analysis_date": f"eq.{target_date.isoformat()}",
        "order": "account_id.asc",
    }
    if account_id:
        params["account_id"] = f"eq.{account_id}"

    return _supabase_request("GET", "wa_daily_analysis", params=params) or []


def _patch_analysis_action_items(row_id: str, action_items: list[dict[str, Any]]) -> None:
    _supabase_request(
        "PATCH",
        "wa_daily_analysis",
        params={"id": f"eq.{row_id}"},
        body={"action_items": action_items},
        prefer="return=minimal",
    )


def _upsert_wa_task(row: dict[str, Any], item: dict[str, Any], sync_key: str) -> None:
    monday_item_id = str(item.get("monday_item_id") or "").strip()
    if not monday_item_id:
        return

    urgency = _normalize_urgency(item.get("urgency"))
    due_date = _due_date_for_item(item, urgency)
    work_type = _normalize_work_type(item.get("work_type"))
    client_label = _client_label_for_row(row)
    payload = {
        "analysis_id": row.get("id"),
        "account_id": row.get("account_id"),
        "group_jid": row.get("group_jid"),
        "group_name": row.get("group_name"),
        "analysis_date": row.get("analysis_date"),
        "action": str(item.get("action") or "").strip(),
        "owner": str(item.get("owner") or "").strip() or None,
        "owner_type": str(item.get("owner_type") or "").strip() or None,
        "urgency": urgency,
        "due_date": due_date.isoformat(),
        "work_type": work_type,
        "client_label": client_label,
        "evidence_speaker": str(item.get("evidence_speaker") or "").strip() or None,
        "evidence_quote": str(item.get("evidence_quote") or "").strip() or None,
        "evidence_reason": str(item.get("evidence_reason") or "").strip() or None,
        "monday_item_id": monday_item_id,
        "monday_item_name": item.get("monday_item_name"),
        "monday_sync_key": sync_key,
        "monday_created_at": item.get("monday_created_at") or item.get("monday_synced_at"),
        "monday_status": "Bloqueada" if str(item.get("owner_type") or "").strip().lower() == "client" else "Por hacer",
        "monday_due_date": due_date.isoformat(),
        "monday_work_type": work_type,
        "monday_client_label": client_label,
        "last_synced_to_monday_at": datetime.now(timezone.utc).isoformat(),
        "raw_action": item,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        _supabase_request(
            "POST",
            "wa_tasks",
            params={"on_conflict": "monday_sync_key"},
            body=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    except RuntimeError as exc:
        message = str(exc)
        if _looks_like_missing_optional_task_column(message):
            logger.warning("wa_tasks optional evidence/Monday-created columns are not available yet. Retrying legacy mirror payload.")
            for key in ("evidence_speaker", "evidence_quote", "evidence_reason", "monday_created_at"):
                payload.pop(key, None)
            _supabase_request(
                "POST",
                "wa_tasks",
                params={"on_conflict": "monday_sync_key"},
                body=payload,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            return
        if "wa_tasks" in message or "PGRST" in message or "does not exist" in message:
            logger.warning("wa_tasks mirror table is not available yet. Run migration 004 to enable Monday sync.")
            return
        raise


def _looks_like_missing_optional_task_column(message: str) -> bool:
    lowered = message.lower()
    return any(
        column in lowered
        for column in ("evidence_speaker", "evidence_quote", "evidence_reason", "monday_created_at")
    )


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


def _column_values(
    boards_config: dict[str, Any],
    row: dict[str, Any],
    item: dict[str, Any],
    board: dict[str, Any],
    monday_users: dict[str, dict[str, Any]],
    board_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if board.get("central"):
        urgency = _normalize_urgency(item.get("urgency"))
        owner_type = str(item.get("owner_type") or "unknown").strip().lower()
        status_label = "Bloqueada" if owner_type == "client" else "Por hacer"
        values: dict[str, Any] = {
            os.getenv("MONDAY_TASKS_STATUS_COLUMN_ID", "color_mm452en1"): {"label": status_label},
            os.getenv("MONDAY_TASKS_DUE_DATE_COLUMN_ID", "date_mm45ncq9"): {
                "date": _due_date_for_item(item, urgency).isoformat()
            },
            os.getenv("MONDAY_TASKS_WORK_TYPE_COLUMN_ID", "color_mm4513mj"): {
                "label": _normalize_work_type(item.get("work_type"))
            },
        }
        client_label = _client_label_for_row(row)
        group_column_id = _monday_group_column_id()
        if client_label and group_column_id:
            values[group_column_id] = {"label": client_label}

        monday_user = _resolve_monday_user(item, monday_users)
        if monday_user:
            values[os.getenv("MONDAY_TASKS_RESPONSIBLE_COLUMN_ID", "multiple_person_mm453tee")] = {
                "personsAndTeams": [{"id": int(monday_user["monday_id"]), "kind": "person"}]
            }
        return values

    columns = dict(boards_config["column_ids_template"])
    if board_info and "columns" in board_info:
        info_cols = board_info["columns"]
        if "estado" in info_cols:
            columns["estado"] = info_cols["estado"]
        if "fecha_entrega" in info_cols:
            columns["date"] = info_cols["fecha_entrega"]
        if "tipo_trabajo" in info_cols:
            columns["work_type"] = info_cols["tipo_trabajo"]
        if "responsable" in info_cols:
            columns["person"] = info_cols["responsable"]
            columns["owner"] = info_cols["responsable"]

    defaults = boards_config["defaults"]
    urgency = _normalize_urgency(item.get("urgency"))
    due_date = _due_date_for_item(item, urgency, int(defaults.get("due_days_from_sync", 5)))

    values: dict[str, Any] = {
        columns["date"]: {"date": due_date.isoformat()},
        columns["estado"]: {"label": "Por hacer"},
        columns["prioridad"]: {"label": _priority_label(urgency)},
        columns["dimension"]: {"label": "SC"},
        columns["categoria"]: {"label": "Comunicacion"},
        columns["impacto_score"]: _score_note(row),
        columns["evidencia"]: _evidence_text(row, item),
    }

    # Add work type column if configured (new boards require this)
    work_type_column = columns.get("work_type")
    if work_type_column:
        values[work_type_column] = {"label": _normalize_work_type(item.get("work_type"))}

    owner_column = columns.get("owner")
    if owner_column:
        monday_user = _resolve_monday_user(item, monday_users)
        if monday_user:
            values[owner_column] = {
                "personsAndTeams": [{"id": int(monday_user["monday_id"]), "kind": "person"}]
            }

    assignee_id = defaults.get("assignee_user_id")
    if assignee_id and columns.get("person"):
        values[columns["person"]] = {
            "personsAndTeams": [{"id": int(assignee_id), "kind": "person"}]
        }

    return values


def _resolve_monday_user(item: dict[str, Any], monday_users: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    owner_type = str(item.get("owner_type") or "unknown").strip().lower()
    if owner_type == "client":
        return None

    owner = str(item.get("owner") or "").strip()
    if not owner or owner in {"Cliente", "Por definir", "Blackwell"}:
        return None

    candidates = [owner]
    for separator in ("+", "/", ",", " y ", " and "):
        split_candidates: list[str] = []
        for candidate in candidates:
            split_candidates.extend(part.strip() for part in candidate.split(separator) if part.strip())
        candidates = split_candidates or candidates

    for candidate in candidates:
        key = _name_key(candidate)
        if key in monday_users:
            return monday_users[key]
    return None


def _monday_item_name(row: dict[str, Any], item: dict[str, Any]) -> str:
    action = str(item.get("action") or "").strip()
    return action[:255]


def _evidence_text(row: dict[str, Any], item: dict[str, Any]) -> str:
    urgency = _normalize_urgency(item.get("urgency"))
    urgency_label = {"high": "Alta", "medium": "Media", "low": "Baja"}.get(urgency, "Media")
    evidence_speaker = str(item.get("evidence_speaker") or "").strip()
    analysis_date = row.get("analysis_date")
    lines = [
        f"Origen: Análisis diario de WhatsApp",
        f"Fecha del origen: {analysis_date}",
        f"Quién lo mencionó: {evidence_speaker or 'No inferido'}",
        f"Urgencia: {urgency_label}",
        "",
        str(row.get("summary") or ""),
    ]
    return "\n".join(lines)[:20000]


def _score_note(row: dict[str, Any]) -> str:
    delta = row.get("score_delta")
    try:
        delta_text = f"{float(delta):+.1f}"
    except (TypeError, ValueError):
        delta_text = str(delta)
    return f"WA {row.get('analysis_date')} | delta {delta_text} | score {row.get('new_score')}"


def _sync_key(row: dict[str, Any], index: int, action: str) -> str:
    seed = f"{row.get('id')}|{row.get('account_id')}|{row.get('analysis_date')}|{index}|{action}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
    return f"wa-{row.get('id')}-{index}-{digest}"


def _due_date_for_item(item: dict[str, Any], urgency: str, default_days: int = 1) -> date:
    due_date = str(item.get("due_date") or "").strip()
    if due_date:
        try:
            return date.fromisoformat(due_date[:10])
        except ValueError:
            pass

    return _due_date_for_urgency(urgency, default_days)


def _due_date_for_urgency(urgency: str, default_days: int) -> date:
    days = {"high": 0, "medium": 1, "low": 1}.get(urgency, default_days)
    return datetime.now(LOCAL_TZ).date() + timedelta(days=days)


def _priority_label(urgency: str) -> str:
    return {"high": "Alta", "medium": "Media", "low": "Baja"}.get(urgency, "Media")


def _normalize_urgency(value: Any) -> str:
    urgency = str(value or "medium").strip().lower()
    return urgency if urgency in {"high", "medium", "low"} else "medium"


def _normalize_work_type(value: Any) -> str:
    text = str(value or "").strip()
    allowed = {
        "Reunión / Seguimiento",
        "Campaña",
        "Nota a cliente",
        "Crisis",
        "Media training",
        "Análisis",
        "Reporte",
        "Otro",
    }
    if text in allowed:
        return text
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
    return aliases.get(text.lower(), "Otro")


def _client_label_for_row(row: dict[str, Any]) -> str | None:
    text = " ".join(
        str(row.get(key) or "")
        for key in ("group_name", "group_jid", "account_name", "account_id")
    )
    normalized = _name_key(text)

    label_rules = [
        ("Nuvoil", ("nuvoil", "nuvoil blackwell", "nuv oil")),
        ("ISMERELY", ("ismerely",)),
        ("Azvi", ("azvi", "grupo azvi")),
        ("Coast Oil", ("coast oil", "coastoil")),
        ("Tello", ("tello",)),
        ("Pepe Aguilar", ("pepe aguilar", "pepe")),
        ("Credix", ("credix",)),
    ]
    for label, needles in label_rules:
        if any(needle in normalized for needle in needles):
            return label
    return None


def _monday_group_column_id() -> str:
    return (
        os.getenv("MONDAY_TASKS_GROUP_COLUMN_ID", "").strip()
        or os.getenv("MONDAY_TASKS_CLIENT_COLUMN_ID", "").strip()
        or "color_mm4ecz6r"
    )


def _account_id(row: dict[str, Any]) -> str:
    raw = str(row.get("account_id") or "").strip()
    return raw.zfill(2) if raw.isdigit() else raw


def _board_for_row(boards_config: dict[str, Any], account_id: str) -> dict[str, Any] | None:
    central_board_id = os.getenv("MONDAY_TASKS_BOARD_ID", "18418418634").strip()
    if central_board_id:
        return {
            "board_id": central_board_id,
            "board_name": os.getenv("MONDAY_TASKS_BOARD_NAME", "WhatsApp Tasks"),
            "central": True,
        }

    boards = boards_config.get("boards", {})
    return boards.get(account_id) or boards.get(account_id.lstrip("0"))


def _load_boards_config() -> dict[str, Any]:
    path = ROOT / "data" / "monday_boards.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _load_monday_users() -> dict[str, dict[str, Any]]:
    path = ROOT / "data" / "monday_users.json"
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    users: dict[str, dict[str, Any]] = {}
    for user in data.get("users", []):
        if not user.get("active", True):
            continue
        name = str(user.get("name") or "").strip()
        monday_id = user.get("monday_id")
        if not name or not monday_id:
            continue
        users[_name_key(name)] = user
        for alias in user.get("aliases", []):
            alias_key = _name_key(str(alias))
            if alias_key:
                users[alias_key] = user
    return users


def _name_key(value: str) -> str:
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).strip().lower()
    return " ".join(text.split())


def _monday_api_key() -> str:
    return (os.getenv("MONDAY_API_KEY") or os.getenv("MONDAY_TOKEN") or "").strip()


def _resolve_target_date(value: str | None) -> date:
    if value:
        return date.fromisoformat(value)
    return datetime.now(LOCAL_TZ).date() - timedelta(days=1)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync WhatsApp daily tasks to Monday.com.")
    parser.add_argument("--date", help="Analysis date in YYYY-MM-DD. Default: yesterday in Mexico City.")
    parser.add_argument("--account-id", help="Only sync one Semaforo account id, e.g. 21.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be created without writing Monday/Supabase.")
    parser.add_argument("--limit", type=int, help="Limit number of analysis rows to inspect.")
    return parser.parse_args()


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("%s", exc)
        sys.exit(1)
