#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Limpieza de items duplicados en Monday creados por el bug del write-back
(wa_monday_tasks paso 2: el PATCH fallaba, monday_item_id quedaba null y cada
corrida re-creaba todas las tareas "pendientes").

Dos pasadas:

1. Board interno ("Equipo interno"): las tareas de cuentas 00_ (INTERNAL /
   UNMAPPED) nunca debieron empujarse ahí. Se ELIMINAN todos los items cuyo
   nombre coincida exactamente con una tarea wa_tasks de cuentas 00_.

2. Boards de cuenta: para cada tarea pendiente (monday_item_id null, cuenta
   real), se buscan los items con el mismo nombre en su board; se CONSERVA el
   más antiguo (y se escribe su id en wa_tasks para sellar la tarea) y se
   eliminan las copias sobrantes.

delete_item manda a la papelera del board (recuperable ~30 días en Monday).

Uso:
    python scripts/sync/monday_cleanup_duplicates.py --dry-run   # reporte, no borra
    python scripts/sync/monday_cleanup_duplicates.py             # limpia
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.sync.wa_monday_tasks import (
        _fetch_all_monday_boards, _load_boards_config, _fetch_account_names,
        _resolve_board, _monday_api_key, _monday_request, _supabase_request,
        _account_id,
    )
except ModuleNotFoundError:
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.wa_monday_tasks import (
        _fetch_all_monday_boards, _load_boards_config, _fetch_account_names,
        _resolve_board, _monday_api_key, _monday_request, _supabase_request,
        _account_id,
    )

logger = logging.getLogger("monday_cleanup")

INTERNAL_BOARD_ID = os.getenv("INTERNAL_CLEANUP_BOARD_ID", "18421312283")
DELETE_PAUSE_S = 0.15  # respiro entre mutaciones para no chocar con rate limits


def norm_name(s: str | None) -> str:
    return " ".join(str(s or "").split()).strip()[:255]


def fetch_board_items(api_key: str, board_id: str) -> list[dict]:
    items: list[dict] = []
    cursor = None
    query = """
    query($boardId: [ID!], $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: 500, cursor: $cursor) {
          cursor
          items { id name created_at }
        }
      }
    }"""
    while True:
        payload = _monday_request(api_key, query, {"boardId": [str(board_id)], "cursor": cursor})
        boards = payload.get("data", {}).get("boards") or []
        if not boards:
            break
        page = boards[0].get("items_page") or {}
        items.extend(page.get("items") or [])
        cursor = page.get("cursor")
        if not cursor:
            break
    return items


def delete_item(api_key: str, item_id: str) -> None:
    query = "mutation($id: ID!) { delete_item(item_id: $id) { id } }"
    _monday_request(api_key, query, {"id": str(item_id)})
    time.sleep(DELETE_PAUSE_S)


def cleanup_internal_board(api_key: str, dry_run: bool) -> tuple[int, int]:
    """Borra del board interno todos los items que vinieron de tareas 00_."""
    rows = _supabase_request(
        "GET", "wa_tasks",
        params={"select": "id,action,account_id", "account_id": "like.00_*"},
    ) or []
    injected_names = {norm_name(r.get("action")) for r in rows if norm_name(r.get("action"))}
    logger.info("Board interno %s: %d nombres de tareas 00_ a buscar.", INTERNAL_BOARD_ID, len(injected_names))

    items = fetch_board_items(api_key, INTERNAL_BOARD_ID)
    logger.info("Board interno tiene %d items.", len(items))
    targets = [it for it in items if norm_name(it.get("name")) in injected_names]
    logger.info("Items que coinciden con tareas 00_ (a eliminar): %d · se conservan: %d",
                len(targets), len(items) - len(targets))

    deleted = 0
    for it in targets:
        if dry_run:
            deleted += 1
            continue
        try:
            delete_item(api_key, it["id"])
            deleted += 1
            if deleted % 100 == 0:
                logger.info("  … %d/%d eliminados", deleted, len(targets))
        except Exception as exc:  # noqa: BLE001
            logger.warning("No pude eliminar item %s (%s): %s", it.get("id"), it.get("name"), exc)
    return deleted, len(items) - len(targets)


def cleanup_account_boards(api_key: str, dry_run: bool) -> tuple[int, int]:
    """Sella tareas pendientes con un item existente y borra las copias extra."""
    boards_config = _load_boards_config()
    account_names = _fetch_account_names()
    monday_boards = _fetch_all_monday_boards(api_key)

    pending = _supabase_request(
        "GET", "wa_tasks",
        params={
            "select": "id,account_id,action,created_at",
            "monday_item_id": "is.null",
            "account_id": "not.like.00_*",
            "deleted_at": "is.null",
            "order": "created_at.asc",
        },
    ) or []
    logger.info("Tareas pendientes en cuentas reales: %d", len(pending))

    # Agrupar por board resuelto
    by_board: dict[str, dict] = {}
    for task in pending:
        account_id = _account_id(task)
        board = _resolve_board(boards_config, account_id, account_names, monday_boards)
        if not board:
            logger.warning("Sin board para tarea %s (cuenta %s) — se omite.", task.get("id"), account_id)
            continue
        bid = str(board["board_id"])
        by_board.setdefault(bid, {"board": board, "tasks": []})["tasks"].append(task)

    sealed = 0
    deleted = 0
    for bid, group in by_board.items():
        board_name = group["board"].get("board_name") or bid
        items = fetch_board_items(api_key, bid)
        by_name: dict[str, list[dict]] = {}
        for it in items:
            by_name.setdefault(norm_name(it.get("name")), []).append(it)
        for matches in by_name.values():
            matches.sort(key=lambda it: it.get("created_at") or "")

        # tareas del board agrupadas por nombre (para repartir copias entre
        # tareas homónimas antes de borrar los sobrantes)
        tasks_by_name: dict[str, list[dict]] = {}
        for task in group["tasks"]:
            tasks_by_name.setdefault(norm_name(task.get("action")), []).append(task)

        for name, tasks in tasks_by_name.items():
            matches = by_name.get(name) or []
            if not matches:
                logger.info("[%s] Sin item para '%s' — la tarea sigue pendiente (la creará el sync normal).", board_name, name[:60])
                continue
            keep_n = min(len(tasks), len(matches))
            for i in range(keep_n):
                task, item = tasks[i], matches[i]
                if not dry_run:
                    _supabase_request(
                        "PATCH", "wa_tasks",
                        params={"id": f"eq.{task['id']}"},
                        body={
                            "monday_item_id": item["id"],
                            "last_synced_to_monday_at": datetime.now(timezone.utc).isoformat(),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                sealed += 1
            for extra in matches[keep_n:]:
                if not dry_run:
                    try:
                        delete_item(api_key, extra["id"])
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("No pude eliminar copia %s en %s: %s", extra.get("id"), board_name, exc)
                        continue
                deleted += 1
        logger.info("[%s] listo — selladas acumuladas: %d · copias eliminadas acumuladas: %d", board_name, sealed, deleted)
    return sealed, deleted


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    ap = argparse.ArgumentParser(description="Limpia items duplicados en Monday y sella tareas pendientes.")
    ap.add_argument("--dry-run", action="store_true", help="Solo reporta; no borra ni escribe.")
    ap.add_argument("--skip-internal", action="store_true", help="No tocar el board interno.")
    ap.add_argument("--skip-accounts", action="store_true", help="No tocar boards de cuenta.")
    args = ap.parse_args()

    api_key = _monday_api_key()
    if not api_key:
        raise RuntimeError("MONDAY_API_KEY is required.")

    mode = "DRY-RUN" if args.dry_run else "LIVE"
    logger.info("Monday cleanup (%s) — los deletes van a la papelera del board (recuperables).", mode)

    if not args.skip_internal:
        del_int, kept = cleanup_internal_board(api_key, args.dry_run)
        logger.info("BOARD INTERNO: %s %d items · conservados (no nuestros): %d",
                    "eliminaría" if args.dry_run else "eliminados", del_int, kept)

    if not args.skip_accounts:
        sealed, del_acc = cleanup_account_boards(api_key, args.dry_run)
        logger.info("BOARDS DE CUENTA: tareas selladas: %d · copias %s: %d",
                    sealed, "que eliminaría" if args.dry_run else "eliminadas", del_acc)

    logger.info("Cleanup %s terminado.", mode)


if __name__ == "__main__":
    main()
