#!/usr/bin/env python3
"""
Mirror Monday.com task columns back into Supabase wa_tasks.

Monday remains the operational board. Supabase keeps a chatbot/front-friendly
copy of current task status, due date, responsible, work type, and client label.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "wa_listener" / ".env", override=False)

MONDAY_API_URL = "https://api.monday.com/v2"
logger = logging.getLogger("wa_monday_to_supabase")


def _get_board_info(api_key: str, board_id: str) -> dict[str, Any]:
    query = """
    query GetBoardInfo($boardId: [ID!]!) {
      boards(ids: $boardId) {
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
            return {"columns": {}}
        
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

        return {"columns": mapping}
    except Exception as e:
        logger.error("Error fetching board columns for board %s: %s", board_id, e)
        return {"columns": {}}


def main() -> None:
    _setup_logging()
    args = _parse_args()
    api_key = _monday_api_key()
    if not api_key:
        raise RuntimeError("MONDAY_API_KEY is required.")

    tasks = _fetch_supabase_tasks(args.limit)
    if not tasks:
        logger.info("No Supabase wa_tasks with monday_item_id found.")
        return

    board_info_cache = {}
    synced = 0
    for chunk in _chunks(tasks, 50):
        ids = [str(task["monday_item_id"]) for task in chunk if task.get("monday_item_id")]
        monday_items = _fetch_monday_items(api_key, ids)
        by_id = {str(item["id"]): item for item in monday_items}
        for task in chunk:
            monday_id = str(task.get("monday_item_id") or "")
            monday_item = by_id.get(monday_id)
            if not monday_item:
                logger.warning("Monday item %s was not returned by API.", monday_id)
                continue

            board_id = str(monday_item.get("board", {}).get("id") or "")
            if not board_id:
                logger.warning("No board ID returned for Monday item %s.", monday_id)
                continue

            if board_id not in board_info_cache:
                board_info_cache[board_id] = _get_board_info(api_key, board_id)

            board_columns = board_info_cache[board_id]["columns"]
            payload = _supabase_payload_from_monday(monday_item, board_columns)
            
            if args.dry_run:
                logger.info("[dry-run] Would update wa_tasks Monday %s: %s", monday_id, payload)
                synced += 1
                continue
            _patch_supabase_task(monday_id, payload)
            synced += 1

    logger.info("Synced %d Monday task(s) back into Supabase.", synced)


def _fetch_supabase_tasks(limit: int | None) -> list[dict[str, Any]]:
    params = {
        "select": "id,monday_item_id",
        "monday_item_id": "not.is.null",
        "order": "updated_at.desc",
    }
    if limit:
        params["limit"] = str(limit)
    try:
        return _supabase_request("GET", "wa_tasks", params=params) or []
    except RuntimeError as exc:
        message = str(exc)
        if "wa_tasks" in message or "PGRST" in message or "does not exist" in message:
            logger.warning("wa_tasks mirror table is not available yet. Run migration 004 to enable Monday sync.")
            return []
        raise


def _fetch_monday_items(api_key: str, ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    query = """
    query Items($ids: [ID!]!) {
      items(ids: $ids) {
        id
        name
        created_at
        updated_at
        board {
          id
        }
        column_values {
          id
          text
          value
        }
      }
    }
    """
    payload = _monday_request(api_key, query, {"ids": ids})
    return payload.get("data", {}).get("items") or []


def _supabase_payload_from_monday(item: dict[str, Any], columns: dict[str, str]) -> dict[str, Any]:
    values = {str(col.get("id")): col for col in item.get("column_values") or [] if isinstance(col, dict)}
    status = _column_text(values, columns.get("estado"))
    due_date = _column_date(values, columns.get("fecha_entrega"))
    responsible = _column_text(values, columns.get("responsable"))
    work_type = _column_text(values, columns.get("tipo_trabajo"))
    client_label = _column_text(values, columns.get("link_entregable"))

    payload: dict[str, Any] = {
        "monday_item_name": item.get("name"),
        "monday_created_at": item.get("created_at"),
        "monday_status": status,
        "monday_due_date": due_date,
        "monday_responsible_text": responsible,
        "monday_work_type": work_type,
        "monday_client_label": client_label,
        "monday_updated_at": item.get("updated_at"),
        "last_synced_from_monday_at": datetime.now(timezone.utc).isoformat(),
        "raw_monday": item,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return {key: value for key, value in payload.items() if value is not None}


def _column_text(values: dict[str, dict[str, Any]], column_id: str | None) -> str | None:
    if not column_id:
        return None
    text = values.get(column_id, {}).get("text")
    return str(text).strip() if text else None


def _column_date(values: dict[str, dict[str, Any]], column_id: str | None) -> str | None:
    if not column_id:
        return None
    raw = values.get(column_id, {}).get("value")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    date_text = data.get("date") if isinstance(data, dict) else None
    return str(date_text) if date_text else None


def _patch_supabase_task(monday_item_id: str, payload: dict[str, Any]) -> None:
    try:
        _supabase_request(
            "PATCH",
            "wa_tasks",
            params={"monday_item_id": f"eq.{monday_item_id}"},
            body=payload,
            prefer="return=minimal",
        )
    except RuntimeError as exc:
        message = str(exc).lower()
        if "monday_created_at" in message:
            logger.warning("wa_tasks.monday_created_at is not available yet. Retrying without it.")
            payload.pop("monday_created_at", None)
            _supabase_request(
                "PATCH",
                "wa_tasks",
                params={"monday_item_id": f"eq.{monday_item_id}"},
                body=payload,
                prefer="return=minimal",
            )
            return
        raise


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





def _chunks(items: list[dict[str, Any]], size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _monday_api_key() -> str:
    return os.getenv("MONDAY_API_KEY", "").strip()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mirror Monday task state to Supabase wa_tasks.")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


if __name__ == "__main__":
    main()
