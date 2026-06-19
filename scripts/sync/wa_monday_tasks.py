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


def main() -> None:
    _setup_logging()
    args = _parse_args()
    target_date = _resolve_target_date(args.date)
    boards_config = _load_boards_config()
    monday_users = _load_monday_users()
    analyses = _fetch_daily_analyses(target_date, args.account_id)

    if args.limit is not None:
        analyses = analyses[: args.limit]

    if not analyses:
        logger.info("No wa_daily_analysis rows found for %s.", target_date.isoformat())
        return

    api_key = _monday_api_key()
    if not api_key and not args.dry_run:
        logger.info("MONDAY_API_KEY is not set. Skipping Monday sync.")
        return

    totals = {"created": 0, "skipped": 0, "unmapped": 0, "empty": 0}
    for row in analyses:
        row_totals = _sync_analysis_row(row, boards_config, monday_users, api_key, args.dry_run)
        for key, value in row_totals.items():
            totals[key] += value

    mode = "dry-run" if args.dry_run else "live"
    logger.info(
        "Monday sync %s complete for %s: created=%d skipped=%d unmapped=%d empty=%d",
        mode,
        target_date.isoformat(),
        totals["created"],
        totals["skipped"],
        totals["unmapped"],
        totals["empty"],
    )


def _sync_analysis_row(
    row: dict[str, Any],
    boards_config: dict[str, Any],
    monday_users: dict[str, dict[str, Any]],
    api_key: str,
    dry_run: bool,
) -> dict[str, int]:
    totals = {"created": 0, "skipped": 0, "unmapped": 0, "empty": 0}
    action_items = row.get("action_items") if isinstance(row.get("action_items"), list) else []
    if not action_items:
        totals["empty"] += 1
        return totals

    account_id = _account_id(row)
    board = _board_for_row(boards_config, account_id)
    if not board:
        logger.warning(
            "No Monday board configured for account %s (%s). Skipping %d task(s).",
            account_id,
            row.get("group_name") or row.get("group_jid"),
            len(action_items),
        )
        totals["unmapped"] += len(action_items)
        return totals

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
        column_values = _column_values(boards_config, row, item, board, monday_users)

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

        created = _create_monday_item(
            api_key=api_key,
            board_id=str(board["board_id"]),
            group_id=str(boards_config["defaults"].get("group_active", "topics")),
            item_name=item_name,
            column_values=column_values,
        )
        _create_monday_update(api_key, str(created["id"]), _evidence_text(row, item))
        updated = dict(item)
        updated["monday_item_id"] = created["id"]
        updated["monday_item_name"] = created.get("name") or item_name
        updated["monday_sync_key"] = sync_key
        updated["monday_synced_at"] = datetime.now(timezone.utc).isoformat()
        updated_items.append(updated)
        _upsert_wa_task(row, updated, sync_key=sync_key)
        changed = True
        totals["created"] += 1
        logger.info("Created Monday item %s for %s.", created["id"], item_name)

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
        "monday_item_id": monday_item_id,
        "monday_item_name": item.get("monday_item_name"),
        "monday_sync_key": sync_key,
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
        if "wa_tasks" in message or "PGRST" in message or "does not exist" in message:
            logger.warning("wa_tasks mirror table is not available yet. Run migration 004 to enable Monday sync.")
            return
        raise


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

    columns = boards_config["column_ids_template"]
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
    owner = str(item.get("owner") or "Por definir").strip()
    owner_type = str(item.get("owner_type") or "unknown").strip()
    action = str(item.get("action") or "").strip()
    group_name = str(row.get("group_name") or row.get("group_jid") or "").strip()
    prefix = "Cliente" if owner_type == "client" else owner
    name = f"WA | {group_name} | {prefix}: {action}"
    return name[:255]


def _evidence_text(row: dict[str, Any], item: dict[str, Any]) -> str:
    action = str(item.get("action") or "").strip()
    owner = str(item.get("owner") or "Por definir").strip()
    owner_type = str(item.get("owner_type") or "unknown").strip()
    urgency = _normalize_urgency(item.get("urgency"))
    lines = [
        f"Tarea: {action}",
        "",
        f"Fuente: WhatsApp / analisis diario {row.get('analysis_date')}",
        f"Grupo: {row.get('group_name') or row.get('group_jid')}",
        f"Responsable inferido: {owner} ({owner_type})",
        f"Urgencia: {urgency}",
        f"Fecha de entrega: {_due_date_for_item(item, urgency).isoformat()}",
        f"Tipo de trabajo: {_normalize_work_type(item.get('work_type'))}",
        f"Cliente / BW: {_client_label_for_row(row) or 'Sin etiqueta inferida'}",
        f"Sentimiento: {row.get('sentiment')} | Satisfaccion: {row.get('satisfaction')} | Riesgo: {row.get('risk_level')}",
        f"Score: {row.get('new_score')} | Delta: {row.get('score_delta')}",
        "",
        "Resumen:",
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
