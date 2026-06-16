#!/usr/bin/env python3
"""
main_sync.py — Orquestador del sync diario del Proyecto Blackwell.

Reemplaza el cron de Claude para el trabajo mecánico (crawl, delta, stale).
Claude API solo se llama cuando hay archivos nuevos que analizar.

Flujo:
  1. Lee el snapshot anterior (accounts_status.json)
  2. Detecta archivos modificados en Drive desde el último sync (FIX BUG-1)
  3. Crawlea las cuentas afectadas (crawl recursivo real — FIX BUG-2, BUG-3, BUG-4)
  4. Re-verifica subfolders stale según política v4.1 (Python puro, sin LLM)
  5. Compara con snapshot anterior y lista deltas
  6. Si hay archivos nuevos: llama Claude API (Haiku) para análisis narrativo
  7. Escribe accounts_status.json y accounts_status.js
  8. Escribe sync_alerts.md con resumen de la corrida
  9. Llama build_v36.py para regenerar el HTML

Uso:
  python main_sync.py                  # delta normal
  python main_sync.py --mode baseline  # crawl completo de todas las cuentas
  python main_sync.py --mode hotfix --accounts 30 31 32  # cuentas específicas
  python main_sync.py --dry-run        # simula sin escribir nada

Variables de entorno requeridas (ver .env.example):
  GOOGLE_CREDENTIALS_PATH o GOOGLE_SERVICE_ACCOUNT_JSON
  ANTHROPIC_API_KEY  (solo necesario si hay archivos nuevos que analizar)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Asegurar que el directorio del script esté en el path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    ACCOUNTS_STATUS_JSON,
    ANTHROPIC_API_KEY,
    ANTHROPIC_API_KEY_SOURCE,
    DATA_DIR,
    DRIVE_ROOT_FOLDER_ID,
    LOGS_DIR,
    ROOT,
    SCRIPTS_DIR,
)
from claude_analyzer import run_analysis as claude_run_analysis
from task_sync import run_task_sync
from delta_detector import accounts_with_delta, compute_deltas, count_by_type
from drive_client import get_drive_service
from drive_crawler import DriveCrawler
from snapshot_writer import write_snapshot
from stale_checker import StaleChecker

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

LOGS_DIR.mkdir(parents=True, exist_ok=True)
_log_file = LOGS_DIR / f"sync_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"

# En Windows la consola usa cp1252 por defecto y revienta al imprimir caracteres
# como "→" en los mensajes de log. Forzamos UTF-8 en stdout/stderr.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_log_file, encoding="utf-8"),
    ],
)
logger = logging.getLogger("main_sync")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()
    logger.info("=== Blackwell Sync · modo=%s · dry_run=%s ===", args.mode, args.dry_run)

    try:
        _run(args)
    except KeyboardInterrupt:
        logger.info("Sync cancelado por el usuario.")
        sys.exit(0)
    except Exception:
        logger.error("ERROR fatal en sync:\n%s", traceback.format_exc())
        sys.exit(1)


def _run(args) -> None:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Step 1: leer snapshot anterior ───────────────────────────────────────
    prev_snapshot = _load_prev_snapshot()
    prev_synced_at = prev_snapshot.get("syncedAt", "")
    logger.info("Snapshot anterior: syncedAt=%s, %d cuentas",
                prev_synced_at, prev_snapshot.get("accountCount", 0))

    # ── Step 2: autenticar con Drive ──────────────────────────────────────────
    logger.info("Conectando a Google Drive...")
    service = get_drive_service()
    crawler = DriveCrawler(service)
    stale_checker = StaleChecker(crawler)

    # ── Step 3: obtener lista de carpetas de cuenta ───────────────────────────
    all_account_folders = crawler.list_account_folders_with_ids()
    logger.info("Carpetas de cuenta en Drive: %d", len(all_account_folders))

    # ── Step 4: decidir qué cuentas crawlear ──────────────────────────────────
    sync_type = "delta"
    accounts_to_crawl: list[dict] = []
    delta_files: list[dict] = []

    if args.mode == "baseline":
        logger.info("Modo BASELINE: crawleando todas las cuentas...")
        accounts_to_crawl = all_account_folders
        sync_type = "baseline"

    elif args.mode == "hotfix":
        # Filtrar por números de cuenta específicos
        target_numbers = set(args.accounts or [])
        accounts_to_crawl = [
            f for f in all_account_folders if f["number"] in target_numbers
        ]
        logger.info(
            "Modo HOTFIX: crawleando %d cuentas: %s",
            len(accounts_to_crawl), ", ".join(f["folderTitle"] for f in accounts_to_crawl),
        )
        sync_type = "delta+hotfix"

    else:
        # Modo delta: solo cuentas con actividad desde el último sync
        if not prev_synced_at:
            logger.warning("No hay syncedAt en snapshot anterior. Corriendo baseline completo.")
            accounts_to_crawl = all_account_folders
            sync_type = "baseline"
        else:
            # FIX BUG-1: detect_changed_accounts usa modifiedTime OR createdTime
            delta_files = crawler.detect_changed_accounts(prev_synced_at)

            if len(delta_files) > 200:
                logger.error(
                    "Delta devolvió %d archivos (> 200). "
                    "Por favor corre baseline completo: python main_sync.py --mode baseline",
                    len(delta_files),
                )
                sys.exit(2)

            # Mapa subfolderId → accountFolderId del snapshot anterior para
            # resolver archivos anidados sin llamadas extra a la API
            known_sub_map: dict[str, str] = {}
            for prev_acc in prev_snapshot.get("accounts", []):
                acc_fid = prev_acc.get("folderId")
                if not acc_fid:
                    continue
                for sub in (prev_acc.get("subfolderActivity") or {}).values():
                    sid = sub.get("subfolderId")
                    if sid:
                        known_sub_map[sid] = acc_fid

            touched_ids = crawler.find_accounts_touched_by_delta(
                delta_files, all_account_folders, known_subfolder_map=known_sub_map
            )
            logger.info("Cuentas con actividad en el delta: %d", len(touched_ids))

            accounts_to_crawl = [
                f for f in all_account_folders if f["folderId"] in touched_ids
            ]

    # ── Step 5: crawl de las cuentas seleccionadas ───────────────────────────
    if accounts_to_crawl:
        logger.info("Crawleando %d cuentas...", len(accounts_to_crawl))
        new_accounts = crawler.crawl_accounts(accounts_to_crawl)
    else:
        logger.info("Sin cuentas que crawlear en este delta.")
        new_accounts = []

    # ── Step 6: stale checker ─────────────────────────────────────────────────
    # Construir lista de accounts actualizada para el checker
    # (mezcla: nuevas + anteriores no tocadas)
    all_accounts_for_stale = _merge_for_stale(
        prev_accounts=prev_snapshot.get("accounts", []),
        new_accounts=new_accounts,
    )

    touched_folder_ids = {f["folderId"] for f in accounts_to_crawl}
    candidates = stale_checker.find_stale_candidates(
        all_accounts_for_stale, touched_folder_ids=touched_folder_ids
    )

    stale_results = stale_checker.reverify(candidates, now_iso=now_iso)
    all_accounts_for_stale, stale_fixes = stale_checker.apply_fixes(
        all_accounts_for_stale, stale_results
    )
    logger.info("Stale fixes aplicados: %d", stale_fixes)

    # ── Step 7: detectar deltas ───────────────────────────────────────────────
    deltas = compute_deltas(prev_snapshot, all_accounts_for_stale)
    delta_counts = count_by_type(deltas)
    logger.info("Deltas: %s", delta_counts)

    accounts_with_changes = accounts_with_delta(deltas)

    # En modo hotfix, forzar análisis de las cuentas especificadas aunque no haya delta
    # (útil para re-analizar cuentas que fallaron en una corrida anterior)
    if args.mode == "hotfix" and args.accounts:
        forced = set(str(n) for n in args.accounts)
        accounts_with_changes = accounts_with_changes | forced
        logger.info(
            "Modo HOTFIX: forzando análisis Claude para: %s",
            ", ".join(sorted(forced)),
        )

    # ── Checklist refresh: añadir cuentas con archivos skipped o análisis stale ──
    # En delta/baseline: siempre incluir cuentas que tienen archivos que no pudieron
    # leerse antes (reintento) O cuyo último análisis tiene más de CHECKLIST_REFRESH_DAYS
    # días. Esto garantiza que la IA revise el checklist aunque no haya archivos nuevos.
    CHECKLIST_REFRESH_DAYS = int(os.environ.get("CHECKLIST_REFRESH_DAYS", "7"))
    if args.mode in ("delta", "baseline"):
        now_utc = datetime.now(timezone.utc)
        now_utc = datetime.now(timezone.utc)
        accounts_dir = DATA_DIR / "accounts"
        refresh_candidates: set[str] = set()
        for acc in all_accounts_for_stale:
            number = str(acc.get("number", "")).zfill(2)
            # Saltar cuentas excluidas / sin archivos en Drive
            derived = acc.get("derivedStatus", "active")
            if derived in ("excluded", "concluded"):
                continue
            # Buscar el drive_intelligence.json de la cuenta
            slug = (acc.get("folderTitle") or "").split(".")[1].strip() if "." in (acc.get("folderTitle") or "") else ""
            slug = slug.upper().replace("/", "_").replace(" ", "_")
            import re as _re
            slug = _re.sub(r"[^A-Z0-9_]", "", slug).strip("_")
            folder_name = f"{number}_{slug}" if slug else number
            di_path = accounts_dir / folder_name / "drive_intelligence.json"
            if not di_path.exists():
                continue
            try:
                di_data = json.loads(di_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            skipped = di_data.get("files_skipped", [])
            analyzed_at = di_data.get("analyzed_at", "")
            n_skipped = len(skipped) if isinstance(skipped, list) else 0
            # Calcular días desde último análisis
            days_since = CHECKLIST_REFRESH_DAYS + 1  # por defecto forzar si no hay fecha
            if analyzed_at:
                try:
                    analyzed_dt = datetime.fromisoformat(analyzed_at.replace("Z", "+00:00"))
                    days_since = (now_utc - analyzed_dt).days
                except Exception:
                    pass
            if n_skipped > 0 or days_since >= CHECKLIST_REFRESH_DAYS:
                refresh_candidates.add(number)
        if refresh_candidates:
            new_forced = refresh_candidates - accounts_with_changes
            logger.info(
                "Checklist refresh: %d cuenta(s) añadidas al análisis "
                "(skipped>0 o análisis >%dd): %s",
                len(new_forced), CHECKLIST_REFRESH_DAYS,
                ", ".join(sorted(new_forced)),
            )
            accounts_with_changes = accounts_with_changes | refresh_candidates

    # ── Step 8: análisis con Claude (solo si hay cambios) ────────────────────
    if accounts_with_changes and not args.skip_claude:
        if not ANTHROPIC_API_KEY:
            logger.warning(
                "ANTHROPIC_API_KEY no configurada. "
                "Saltando análisis narrativo (los datos estructurales sí se guardaron)."
            )
        else:
            logger.info(
                "Llamando Claude API para %d cuentas con cambios... (key: %s)",
                len(accounts_with_changes),
                ANTHROPIC_API_KEY_SOURCE,
            )
            try:
                _run_claude_analysis(
                    accounts_with_changes,
                    all_accounts_for_stale,
                    delta_files,
                    is_baseline=(sync_type == "baseline"),
                    drive_service=service,
                )
            except Exception:
                logger.error(
                    "Error en análisis Claude (no crítico):\n%s", traceback.format_exc()
                )
    else:
        logger.info(
            "Sin cambios que analizar%s.",
            " (--skip-claude activo)" if args.skip_claude else "",
        )

    # ── Step 9: escribir snapshot ─────────────────────────────────────────────
    if not args.dry_run:
        snapshot = write_snapshot(
            accounts=all_accounts_for_stale,
            prev_snapshot=prev_snapshot,
            deltas=deltas,
            stale_fixes_applied=stale_fixes,
            sync_type=sync_type,
            sync_started_at=now_iso,
        )
        _write_sync_alerts(snapshot, stale_results, delta_files, args.mode)
        logger.info("Snapshot escrito: %s", ACCOUNTS_STATUS_JSON)
    else:
        logger.info("[DRY RUN] No se escribió nada.")
        snapshot = None

    # ── Step 10: sincronizar tareas por cliente con Supabase ─────────────────
    # En cada corrida: sube las tareas pendientes nuevas detectadas en el
    # análisis IA y marca como hechas las que ya no aparecen como pendientes.
    task_summary = None
    if not args.skip_tasks:
        try:
            task_summary = run_task_sync(dry_run=args.dry_run)
            logger.info(
                "Tareas Supabase: %d creadas · %d marcadas hechas · %d cuentas",
                task_summary["created"], task_summary["completed"], task_summary["accounts"],
            )
        except Exception:
            logger.error(
                "Error sincronizando tareas con Supabase (no crítico):\n%s",
                traceback.format_exc(),
            )

    # ── Step 11: rebuild del HTML ─────────────────────────────────────────────
    if not args.dry_run and not args.skip_build:
        _run_build()

    # ── Resumen final ─────────────────────────────────────────────────────────
    logger.info("=== Sync completado ===")
    logger.info("  Tipo:              %s", sync_type)
    logger.info("  Archivos en delta: %d", len(delta_files))
    logger.info("  Cuentas tocadas:   %d", len(accounts_to_crawl))
    logger.info("  Stale fixes:       %d", stale_fixes)
    logger.info("  Deltas detectados: %s", delta_counts)
    logger.info("  Log:               %s", _log_file)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_prev_snapshot() -> dict:
    if ACCOUNTS_STATUS_JSON.exists():
        try:
            return json.loads(ACCOUNTS_STATUS_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            logger.error("accounts_status.json corrupto: %s", e)
            return {}
    logger.warning("No existe accounts_status.json. Se creará desde cero.")
    return {}


def _merge_for_stale(
    prev_accounts: list[dict], new_accounts: list[dict]
) -> list[dict]:
    """
    Combina el snapshot anterior con los accounts recién crawleados
    para pasarle al stale_checker la visión completa.
    """
    new_by_number = {a["number"]: a for a in new_accounts}
    result: list[dict] = list(new_accounts)

    for prev in prev_accounts:
        number = prev["number"]
        if number not in new_by_number:
            result.append(prev)

    return result


def _run_claude_analysis(
    account_numbers_with_changes: set[str],
    all_accounts: list[dict],
    delta_files: list[dict],
    is_baseline: bool = False,
    drive_service=None,
) -> None:
    """Delega el análisis narrativo a claude_analyzer.run_analysis."""
    claude_run_analysis(
        account_numbers_with_changes=account_numbers_with_changes,
        all_accounts=all_accounts,
        delta_files=delta_files,
        is_baseline=is_baseline,
        drive_service=drive_service,
    )


def _run_build() -> None:
    """
    Copia los archivos de datos generados al dashboard/public/data/
    para que el React dev server los sirva actualizados.
    """
    import shutil

    dashboard_data = ROOT / "dashboard" / "public" / "data"
    if not dashboard_data.exists():
        logger.warning("dashboard/public/data no existe. Saltando copia.")
        return

    files_to_copy = [
        DATA_DIR / "accounts_status.json",
        DATA_DIR / "accounts_status.js",
        DATA_DIR / "drive_intelligence.js",
    ]
    copied = 0
    for src in files_to_copy:
        if src.exists():
            dest = dashboard_data / src.name
            shutil.copy2(src, dest)
            logger.info("  Copiado: %s -> %s", src.name, dest)
            copied += 1
        else:
            logger.warning("  No encontrado (aún no generado): %s", src.name)

    # Copiar carpetas por cuenta a dashboard/public/data/accounts/
    src_accounts = DATA_DIR / "accounts"
    if src_accounts.exists():
        dest_accounts = dashboard_data / "accounts"
        dest_accounts.mkdir(parents=True, exist_ok=True)
        account_dirs_copied = 0
        for account_folder in src_accounts.iterdir():
            if not account_folder.is_dir():
                continue
            dest_account = dest_accounts / account_folder.name
            dest_account.mkdir(parents=True, exist_ok=True)
            for json_file in account_folder.glob("*.json"):
                shutil.copy2(json_file, dest_account / json_file.name)
            account_dirs_copied += 1
        logger.info("  Copiadas carpetas por cuenta: %d -> dashboard/public/data/accounts/", account_dirs_copied)
        copied += 1

    logger.info("Datos copiados al dashboard: %d/%d archivos", copied, len(files_to_copy) + 1)


def _write_sync_alerts(
    snapshot: dict,
    stale_results: list[dict],
    delta_files: list[dict],
    mode: str,
) -> None:
    """Escribe sync_alerts.md con el resumen de la corrida."""
    now = snapshot["syncedAt"]
    fixes = [r for r in stale_results if r.get("changed")]
    errors = [r for r in stale_results if r.get("fix_type") == "permissions_error"]

    lines = [
        f"# Sync Alerts — Blackwell",
        f"",
        f"**Generated:** {now}",
        f"**Sync type:** {snapshot['type']}",
        f"**Previous sync:** {snapshot.get('previousSyncAt', 'N/A')}",
        f"**Schema:** {snapshot.get('schemaVersion', '?')}",
        f"",
        f"---",
        f"",
        f"## Resumen del sync",
        f"",
        f"- **Archivos en ventana del delta:** {len(delta_files)}",
        f"- **Cuentas afectadas:** {snapshot.get('accountsAffected', 0)}",
        f"- **Stale fixes aplicados:** {snapshot.get('staleFixesApplied', 0)}",
        f"",
    ]

    if fixes:
        lines += [
            "## Stale fixes aplicados",
            "",
            "| Cuenta | Subfolder | prev fc | new fc |",
            "|---|---|---|---|",
        ]
        for r in fixes:
            lines.append(
                f"| {r['account']} | {r['subfolder_name']} | "
                f"{r['prev_file_count']} | {r['new_data'].get('fileCount', '?')} |"
            )
        lines.append("")

    if errors:
        lines += ["## Errores de permisos", ""]
        for r in errors:
            lines.append(f"- {r['account']} / {r['subfolder_name']}: {r.get('error', '?')}")
        lines.append("")

    deltas = snapshot.get("deltas", [])
    if deltas:
        lines += [f"## Deltas detectados ({len(deltas)})", ""]
        for d in deltas[:20]:
            lines.append(
                f"- **{d['type']}** · {d.get('account', '?')} / {d.get('subfolder', '')}"
            )
        if len(deltas) > 20:
            lines.append(f"- _...y {len(deltas) - 20} más_")
        lines.append("")

    lines.append(f"---\n*Generated by main_sync.py · {now}*\n")

    alerts_path = LOGS_DIR / "sync_alerts.md"
    alerts_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("sync_alerts.md escrito: %s", alerts_path)


def _parse_args():
    p = argparse.ArgumentParser(description="Blackwell Drive Sync — orquestador Python")
    p.add_argument(
        "--mode",
        choices=["delta", "baseline", "hotfix"],
        default="delta",
        help="delta: solo cambios (default) | baseline: todo | hotfix: cuentas específicas",
    )
    p.add_argument(
        "--accounts",
        nargs="+",
        help="Para --mode hotfix: números de cuenta a procesar (ej: 30 31 32)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Simula el sync sin escribir ningún archivo",
    )
    p.add_argument(
        "--skip-claude",
        action="store_true",
        help="Omite el análisis narrativo con Claude API",
    )
    p.add_argument(
        "--skip-build",
        action="store_true",
        help="Omite el rebuild del HTML al final",
    )
    p.add_argument(
        "--skip-tasks",
        action="store_true",
        help="Omite la sincronización de tareas por cliente con Supabase",
    )
    return p.parse_args()


if __name__ == "__main__":
    main()
