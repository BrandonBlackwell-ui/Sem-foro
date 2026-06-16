"""
drive_crawler.py — Crawl de Google Drive con todos los bugs del cron original corregidos.

Bugs que corrige este módulo:
  BUG-1  modifiedTime histórico: Drive conserva la fecha original cuando se sube
         un archivo, por lo que el delta anterior no lo detectaba.
         FIX: query incluye `createdTime > prevSync` además de `modifiedTime > prevSync`.

  BUG-2  fileCount=0 falsos en cuentas con sub-subcarpetas:
         el cron anterior no hacía crawl recursivo real.
         FIX: crawl recursivo hasta CRAWL_MAX_DEPTH niveles.

  BUG-3  subfolderMissing=true cuando la carpeta sí existe:
         el match de nombre era exacto y fallaba con variaciones.
         FIX: match por prefijo numérico ("01.", "02.", etc.) solamente.

  BUG-4  latestModified tomaba la fecha del folder, no del archivo más reciente.
         FIX: latestModified = max(modifiedTime de todos los archivos en el folder).

Uso:
    from drive_crawler import DriveCrawler
    crawler = DriveCrawler(service)

    # Crawl completo (baseline)
    accounts = crawler.crawl_all_accounts()

    # Delta: solo cuentas que tuvieron actividad desde prev_sync
    changed_ids, all_files = crawler.detect_changed_accounts(prev_sync_iso)
    accounts = crawler.crawl_accounts(changed_account_folder_ids)

    # Crawl de un subfolder específico (hotfix / stale re-verify)
    subfolder_data = crawler.crawl_subfolder(subfolder_id, subfolder_name)
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from googleapiclient.errors import HttpError

from config import CRAWL_MAX_DEPTH, CRAWL_PAGE_SIZE, DRIVE_ROOT_FOLDER_ID, PLAYBOOK_PREFIXES
from drive_client import execute_with_retry, paginate

logger = logging.getLogger(__name__)

# Tipos MIME que NO son carpetas
_FOLDER_MIME = "application/vnd.google-apps.folder"

# Campos que pedimos a la API por cada archivo/carpeta
_FILE_FIELDS = "id,name,mimeType,modifiedTime,createdTime,size,parents"
_LIST_FIELDS = f"nextPageToken,files({_FILE_FIELDS})"

# Máximo de archivos (metadata) que guardamos por cuenta en el snapshot.
# El analizador descargará y leerá solo un subconjunto priorizado de estos.
# 150 (antes 80): con 80, archivos con el mismo modifiedTime en la frontera
# del cap quedaban fuera de forma arbitraria (adjuntos de WhatsApp subidos en
# lote) y el inventario que ve la IA quedaba incompleto.
MAX_FILES_PER_ACCOUNT = 150


class DriveCrawler:
    """
    Crawlea la estructura de Drive y produce objetos compatibles con
    el schema accounts_status.json (v4.1+).
    """

    def __init__(self, service):
        self._svc = service
        self._files_api = service.files()

    # ─────────────────────────────────────────────────────────────────────────
    # API pública
    # ─────────────────────────────────────────────────────────────────────────

    def crawl_all_accounts(self) -> list[dict]:
        """
        Crawl completo: lee todas las carpetas de cuenta en la raíz de Drive
        y sus 6 subfolders del playbook. Equivale al 'baseline'.
        """
        account_folders = self._list_account_folders()
        logger.info("Encontradas %d carpetas de cuenta en Drive", len(account_folders))
        return [self._crawl_single_account(f) for f in account_folders]

    def detect_changed_accounts(
        self, prev_sync_iso: str
    ) -> tuple[set[str], list[dict]]:
        """
        Detecta qué archivos cambiaron desde prev_sync_iso.

        FIX BUG-1: usa `modifiedTime > X OR createdTime > X` para capturar
        archivos subidos con fecha histórica.

        Devuelve:
          - set de folderIds de cuentas que tuvieron actividad
          - lista de todos los archivos del delta (para análisis posterior)
        """
        query = (
            f"(modifiedTime > '{prev_sync_iso}' OR createdTime > '{prev_sync_iso}') "
            f"and trashed = false"
        )
        logger.info("Buscando archivos con delta desde %s...", prev_sync_iso)

        changed_files = paginate(
            self._files_api.list,
            q=query,
            fields=_LIST_FIELDS,
            pageSize=CRAWL_PAGE_SIZE,
        )
        logger.info("Delta: %d archivos/carpetas cambiados", len(changed_files))
        return changed_files

    def crawl_accounts(self, account_folders: list[dict]) -> list[dict]:
        """Crawlea una lista de carpetas de cuenta (delta mode)."""
        return [self._crawl_single_account(f) for f in account_folders]

    def crawl_subfolder(self, subfolder_id: str, subfolder_name: str) -> dict:
        """
        Re-crawl directo de un subfolder específico.
        Usado para hotfixes y re-verificación de subfolders stale (Step 2.6).
        """
        now_iso = _now_iso()
        result = self._crawl_folder_recursive(subfolder_id, depth=0)
        return {
            "subfolderId": subfolder_id,
            "fileCount": result["file_count"],
            "latestModified": result["latest_modified"],
            "latestFile": result["latest_file"],
            "hasNestedFolders": result["has_nested_folders"],
            "nestedFilesPresent": result["nested_files_present"],
            "subfolderMissing": False,
            "source": f"drive_crawl_{now_iso}_verify",
            "last_verified_at": now_iso,
            **({"nestedNote": result["nested_note"]} if result.get("nested_note") else {}),
        }

    def list_account_folders_with_ids(self) -> list[dict]:
        """Devuelve lista de {folderId, folderTitle, number} para todas las cuentas."""
        return self._list_account_folders()

    # ─────────────────────────────────────────────────────────────────────────
    # Lógica interna
    # ─────────────────────────────────────────────────────────────────────────

    def _list_account_folders(self) -> list[dict]:
        """Lista todas las subcarpetas de primer nivel en DRIVE_ROOT_FOLDER_ID."""
        folders = paginate(
            self._files_api.list,
            q=(
                f"'{DRIVE_ROOT_FOLDER_ID}' in parents "
                f"and mimeType = '{_FOLDER_MIME}' "
                f"and trashed = false"
            ),
            fields=_LIST_FIELDS,
            pageSize=CRAWL_PAGE_SIZE,
            orderBy="name",
        )
        result = []
        for f in folders:
            number = _extract_account_number(f["name"])
            if number:
                result.append({
                    "folderId": f["id"],
                    "folderTitle": f["name"],
                    "folderModifiedTime": f.get("modifiedTime"),
                    "number": number,
                })
        result.sort(key=lambda x: x["number"])
        return result

    def _crawl_single_account(self, account_folder: dict) -> dict:
        """
        Crawlea una carpeta de cuenta y devuelve el objeto account completo
        con subfolderActivity, derivedStatus, etc.
        """
        folder_id = account_folder["folderId"]
        folder_title = account_folder["folderTitle"]
        now_iso = _now_iso()

        logger.info("Crawleando cuenta: %s", folder_title)

        # Derivar status desde el nombre del folder
        derived_status, status_suffix = _derive_status(folder_title)

        # Listar subfolders directos
        subfolders_raw = self._list_direct_subfolders(folder_id)

        # Construir subfolderActivity
        subfolder_activity: dict[str, dict] = {}
        latest_deliverable = None
        latest_deliverable_time: datetime | None = None
        account_files: list[dict] = []  # archivos reales de toda la cuenta (para lectura)

        for slot_prefix in PLAYBOOK_PREFIXES:
            # FIX BUG-3: match por prefijo numérico, no por nombre exacto
            matched = _match_subfolder_by_prefix(subfolders_raw, slot_prefix)

            if matched is None:
                # El subfolder no existe en Drive
                subfolder_activity[f"{slot_prefix}(missing)"] = {
                    "subfolderMissing": True,
                    "fileCount": 0,
                    "latestModified": None,
                    "latestFile": None,
                    "hasNestedFolders": False,
                    "nestedFilesPresent": False,
                    "source": f"drive_crawl_{now_iso}",
                    "last_verified_at": now_iso,
                }
                continue

            sub_id = matched["id"]
            sub_name = matched["name"]  # nombre real en Drive, sin normalizar

            try:
                crawl = self._crawl_folder_recursive(sub_id, depth=0)
            except HttpError as e:
                logger.warning("Error de permisos en %s / %s: %s", folder_title, sub_name, e)
                subfolder_activity[sub_name] = {
                    "subfolderId": sub_id,
                    "fileCount": None,
                    "latestModified": None,
                    "latestFile": None,
                    "hasNestedFolders": False,
                    "nestedFilesPresent": False,
                    "subfolderMissing": False,
                    "permissionsIssue": True,
                    "source": f"drive_crawl_{now_iso}",
                    "last_verified_at": now_iso,
                }
                continue

            entry: dict[str, Any] = {
                "subfolderId": sub_id,
                "fileCount": crawl["file_count"],
                "latestModified": crawl["latest_modified"],
                "latestFile": crawl["latest_file"],
                "hasNestedFolders": crawl["has_nested_folders"],
                "nestedFilesPresent": crawl["nested_files_present"],
                "subfolderMissing": False,
                "source": f"drive_crawl_{now_iso}",
                "last_verified_at": now_iso,
            }
            if crawl.get("nested_note"):
                entry["nestedNote"] = crawl["nested_note"]

            subfolder_activity[sub_name] = entry

            # Acumular los archivos reales de este slot (con la subcarpeta de origen)
            slot_num = slot_prefix.rstrip(".")
            for f in crawl.get("files", []):
                account_files.append({
                    "id": f.get("id"),
                    "name": f.get("name"),
                    "mimeType": f.get("mimeType"),
                    "modifiedTime": f.get("modifiedTime"),
                    "size": f.get("size"),
                    "subfolder": slot_num,
                    "subfolderName": sub_name,
                    "nestedPath": f.get("nestedPath"),
                })

            # Rastrear el archivo más reciente de la cuenta para latestDeliverable
            if crawl["latest_modified"]:
                lm_dt = _parse_iso(crawl["latest_modified"])
                if lm_dt and (latest_deliverable_time is None or lm_dt > latest_deliverable_time):
                    latest_deliverable_time = lm_dt
                    latest_deliverable = {
                        "title": crawl["latest_file"],
                        "modifiedTime": crawl["latest_modified"],
                        "source": sub_name,
                    }

        # Ordenar los archivos por recencia y limitar para no inflar el snapshot.
        # Esta lista es la materia prima que el analizador descargará y leerá.
        account_files.sort(
            key=lambda f: f.get("modifiedTime") or "",
            reverse=True,
        )
        account_files = account_files[:MAX_FILES_PER_ACCOUNT]

        return {
            "number": account_folder["number"],
            "folderTitle": folder_title,
            "folderId": folder_id,
            "folderModifiedTime": account_folder.get("folderModifiedTime"),
            "derivedStatus": derived_status,
            "statusSuffix": status_suffix,
            "isActive": derived_status in {
                "active", "onboarding", "active_litigation",
                "active_new", "active_crisis_high",
            },
            "subfolderActivity": subfolder_activity,
            "latestDeliverable": latest_deliverable,
            "driveFiles": account_files,
            "lastCrawledAt": now_iso,
        }

    def _list_direct_subfolders(self, parent_id: str) -> list[dict]:
        """Lista las subcarpetas directas de una carpeta de cuenta."""
        return paginate(
            self._files_api.list,
            q=(
                f"'{parent_id}' in parents "
                f"and mimeType = '{_FOLDER_MIME}' "
                f"and trashed = false"
            ),
            fields=_LIST_FIELDS,
            pageSize=CRAWL_PAGE_SIZE,
        )

    def _crawl_folder_recursive(
        self, folder_id: str, depth: int
    ) -> dict[str, Any]:
        """
        FIX BUG-2: crawl recursivo real.

        Cuenta TODOS los archivos dentro de un folder incluyendo sub-subcarpetas,
        hasta CRAWL_MAX_DEPTH niveles.

        Devuelve:
            file_count          int  — total de archivos en todos los niveles
            latest_modified     str  — ISO del archivo más reciente (FIX BUG-4)
            latest_file         str  — nombre del archivo más reciente
            has_nested_folders  bool
            nested_files_present bool
            nested_note         str | None
        """
        file_count = 0
        latest_modified: datetime | None = None
        latest_file: str | None = None
        has_nested_folders = False
        nested_files_present = False
        nested_notes: list[str] = []
        files: list[dict] = []  # metadata real de cada archivo (para lectura posterior)

        # Listar contenido directo (archivos + subcarpetas)
        items = paginate(
            self._files_api.list,
            q=f"'{folder_id}' in parents and trashed = false",
            fields=_LIST_FIELDS,
            pageSize=CRAWL_PAGE_SIZE,
        )

        subfolders_to_recurse: list[dict] = []

        for item in items:
            if item["mimeType"] == _FOLDER_MIME:
                has_nested_folders = True
                if depth < CRAWL_MAX_DEPTH:
                    subfolders_to_recurse.append(item)
            else:
                file_count += 1
                files.append({
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "mimeType": item.get("mimeType"),
                    "modifiedTime": item.get("modifiedTime"),
                    "size": item.get("size"),
                })
                # FIX BUG-4: usar modifiedTime del archivo, no del folder
                item_modified = _parse_iso(item.get("modifiedTime"))
                if item_modified and (latest_modified is None or item_modified > latest_modified):
                    latest_modified = item_modified
                    latest_file = item["name"]

        # Recursión en subcarpetas
        for sub in subfolders_to_recurse:
            child = self._crawl_folder_recursive(sub["id"], depth + 1)
            file_count += child["file_count"]
            if child["file_count"] > 0:
                nested_files_present = True
            # Propagar archivos anidados, anotando la subcarpeta de origen
            for cf in child.get("files", []):
                nested_path = cf.get("nestedPath") or sub["name"]
                files.append({**cf, "nestedPath": nested_path})

            child_lm = _parse_iso(child["latest_modified"])
            if child_lm and (latest_modified is None or child_lm > latest_modified):
                latest_modified = child_lm
                latest_file = f"{child['latest_file']} (en {sub['name']})"

        if has_nested_folders and subfolders_to_recurse:
            sub_names = ", ".join(s["name"] for s in subfolders_to_recurse[:4])
            nested_notes.append(f"Contiene subcarpetas: {sub_names}")

        if depth == CRAWL_MAX_DEPTH and has_nested_folders:
            nested_notes.append(f"Profundidad máxima ({CRAWL_MAX_DEPTH}) alcanzada; puede haber más archivos")

        return {
            "file_count": file_count,
            "latest_modified": latest_modified.isoformat().replace("+00:00", "Z") if latest_modified else None,
            "latest_file": latest_file,
            "has_nested_folders": has_nested_folders,
            "nested_files_present": nested_files_present,
            "nested_note": " | ".join(nested_notes) if nested_notes else None,
            "files": files,
        }

    def find_accounts_touched_by_delta(
        self,
        delta_files: list[dict],
        account_folders: list[dict],
        known_subfolder_map: dict[str, str] | None = None,
    ) -> set[str]:
        """
        Dado el resultado de detect_changed_accounts, devuelve los folderIds
        de las cuentas que tuvieron actividad.

        FIX BUG: la versión anterior solo matcheaba archivos cuyo parent DIRECTO
        era la carpeta de cuenta — los archivos dentro de subcarpetas (casi todos)
        nunca hacían match. Ahora subimos la jerarquía de parents vía API
        (con caché) hasta encontrar una cuenta conocida.

        Args:
            known_subfolder_map: {subfolderId: accountFolderId} del snapshot
                anterior, para resolver sin llamadas extra a la API.
        """
        account_folder_ids = {af["folderId"] for af in account_folders}
        sub_map = dict(known_subfolder_map or {})
        # caché de resolución: folderId → accountFolderId (o None si no pertenece)
        resolved: dict[str, str | None] = {}
        touched: set[str] = set()

        def resolve_to_account(folder_id: str, depth: int = 0) -> str | None:
            """Sube por parents hasta encontrar una carpeta de cuenta (máx 6 niveles)."""
            if folder_id in account_folder_ids:
                return folder_id
            if folder_id in sub_map:
                return sub_map[folder_id]
            if folder_id in resolved:
                return resolved[folder_id]
            if depth >= 6:
                return None
            try:
                meta = execute_with_retry(self._files_api.get(
                    fileId=folder_id,
                    fields="id,parents",
                    supportsAllDrives=True,
                ))
            except Exception:
                resolved[folder_id] = None
                return None
            account = None
            for pid in meta.get("parents", []) or []:
                account = resolve_to_account(pid, depth + 1)
                if account:
                    break
            resolved[folder_id] = account
            return account

        for f in delta_files:
            for parent_id in f.get("parents", []) or []:
                account = resolve_to_account(parent_id)
                if account:
                    touched.add(account)
                    break

        return touched


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_account_number(folder_name: str) -> str | None:
    """
    Extrae el número de cuenta del nombre de la carpeta.
    "01. TURBOFIN" → "01"
    "37. LEADSALES (ONBOARDING)" → "37"
    """
    m = re.match(r"^(\d{2})\.", folder_name.strip())
    return m.group(1) if m else None


def _match_subfolder_by_prefix(
    subfolders: list[dict], prefix: str
) -> dict | None:
    """
    FIX BUG-3: busca un subfolder por su prefijo numérico solamente.
    Tolera cualquier variación de nombre después del número.

    Ejemplos de nombres que matchea para prefix="01.":
      "01_Contrato_OC"   (nombrado oficial del Playbook v1.0)
      "01.Contrato_OC"
      "01.CIMA_Contrato_OC"
      "01. Contratos_OC"
      "01 Contratos_OC"  (con espacio en lugar de punto)
    """
    # Extraer número del prefix ("01." → "01")
    prefix_num = prefix.rstrip(".")

    for sub in subfolders:
        name = sub["name"].strip()
        # Match: empieza con "NN" seguido de "." , espacio, "_" o "-".
        # El Playbook v1.0 usa guion bajo ("01_Contrato_OC"); toleramos las demás
        # variantes históricas para no romper carpetas ya creadas en Drive.
        if re.match(rf"^{re.escape(prefix_num)}[\.\s_\-]", name):
            return sub

    return None


def _derive_status(folder_title: str) -> tuple[str, str | None]:
    """
    Deriva el status de la cuenta a partir de la etiqueta del nombre de la carpeta.

    Playbook §5 — "La etiqueta en el nombre de la carpeta raíz es lo que el
    semáforo usa para excluir o incluir al proyecto en el score del portafolio."
    En Drive la etiqueta aparece tras una diagonal ("15. ARMOR /Terminación
    anticipada"), entre paréntesis ("(ONBOARDING)") o en texto plano. El matcher
    es tolerante al delimitador, a los acentos y a la errata real "terminanción".

    Etiquetas que SACAN la cuenta del score del portafolio (gris, sin color):
      proyecto concluido / concluded          → concluded
      terminación anticipada / early term.    → terminated_early
      pausa / detenido / paused               → paused
      evento único / one-off                  → event_single
      histórico / historical                  → historical

    Variantes que MANTIENEN la cuenta activa (solo entre paréntesis para no
    confundirse con nombres de cliente):
      (ONBOARDING)              → onboarding
      (LITIGIO) / (LITIGATION)  → active_litigation
      (NUEVA) / (NEW)           → active_new
      (CRISIS HIGH)             → active_crisis_high
    """
    # ── Etiquetas de exclusión: se buscan en cualquier parte del nombre ──
    exclusion_labels = (
        (r"TERMINACI[OÓ]N\s+ANTICIPADA|TERMINANCI[OÓ]N\s+ANTICIPADA|TERM\.?\s*ANTICIPADA|EARLY\s+TERMINATION",
         ("terminated_early", "TERMINACIÓN ANTICIPADA")),
        (r"PROYECTO\s+CONCLU[IÍ]DO|CONCLU[IÍ]DO|CONCLUDED",
         ("concluded", "CONCLUIDO")),
        (r"EVENTO\s+[UÚ]NICO|ONE[\s\-]?OFF",
         ("event_single", "EVENTO ÚNICO")),
        (r"PAUSA|PAUSED|DETENIDO",
         ("paused", "PAUSA")),
        (r"HIST[OÓ]RICO|HISTORICAL",
         ("historical", "HISTÓRICO")),
    )
    for pattern, (status, suffix) in exclusion_labels:
        if re.search(pattern, folder_title, re.IGNORECASE):
            return status, suffix

    # ── Variantes activas: solo válidas entre paréntesis ──
    active_variants = {
        r"ONBOARDING": ("onboarding", "ONBOARDING"),
        r"LITIGIO|LITIGATION": ("active_litigation", "LITIGIO"),
        r"NUEVA|NEW": ("active_new", "NUEVA"),
        r"CRISIS HIGH": ("active_crisis_high", "CRISIS HIGH"),
    }
    for pattern, (status, suffix) in active_variants.items():
        if re.search(rf"\({pattern}\)", folder_title, re.IGNORECASE):
            return status, suffix

    return "active", None


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
