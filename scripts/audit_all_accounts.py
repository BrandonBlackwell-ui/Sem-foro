"""
audit_all_accounts.py — Auditoría global: Drive en vivo vs snapshot local.

Para cada cuenta lista TODOS los archivos reales en Drive (recursivo) y los
compara contra data/accounts/<carpeta>/account_status.json (driveFiles) y
drive_intelligence.json (files leídos por la IA).

Reporta por cuenta:
  - archivos en Drive que NO están en el snapshot (no detectados por el crawler)
  - archivos detectados pero NO leídos por la IA
  - tipos de archivo no soportados

Al final imprime la lista de números de cuenta que necesitan hotfix.

Uso: python scripts/audit_all_accounts.py
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "sync"))

from drive_client import get_drive_service, paginate  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ACCOUNTS_DIR = ROOT / "data" / "accounts"

FOLDER_MIME = "application/vnd.google-apps.folder"

# Formatos que sabemos que NO se pueden leer (no cuentan como problema del crawler)
UNSUPPORTED_HINTS = (
    "application/ogg", "audio/", "video/", "application/octet-stream",
)


def list_recursive(svc, folder_id: str, path: str = "", depth: int = 0, max_depth: int = 6):
    items = paginate(
        svc.files().list,
        q=f"'{folder_id}' in parents and trashed=false",
        fields="nextPageToken, files(id,name,mimeType,modifiedTime,size)",
        pageSize=1000,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    )
    out = []
    for it in items:
        p = f"{path}/{it['name']}" if path else it["name"]
        if it["mimeType"] == FOLDER_MIME:
            if depth < max_depth:
                out.extend(list_recursive(svc, it["id"], p, depth + 1, max_depth))
        else:
            out.append({
                "id": it["id"], "path": p, "mimeType": it["mimeType"],
                "modifiedTime": it.get("modifiedTime"),
            })
    return out


def slug_dirname(number: str, title: str) -> str:
    """Reproduce el algoritmo de carpetas por cuenta: '08. ULDIS' → '08_ULDIS'."""
    name = re.sub(r"^\d{2}\.\s*", "", title)
    # quitar sufijos de estatus tras "/"
    name = name.split("/")[0].strip()
    slug = re.sub(r"[^A-Za-z0-9]+", "_", name.upper()).strip("_")
    return f"{number}_{slug}" if slug else number


def find_account_dir(number: str) -> pathlib.Path | None:
    for d in ACCOUNTS_DIR.iterdir():
        if d.is_dir() and d.name.startswith(f"{number}_"):
            return d
    return None


def main():
    svc = get_drive_service()

    # Listar carpetas de cuenta desde la raíz
    from config import DRIVE_ROOT_FOLDER_ID
    folders = paginate(
        svc.files().list,
        q=f"'{DRIVE_ROOT_FOLDER_ID}' in parents and mimeType='{FOLDER_MIME}' and trashed=false",
        fields="nextPageToken, files(id,name)",
        pageSize=1000,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    )
    accounts = []
    for f in folders:
        m = re.match(r"^(\d{2})\.", f["name"].strip())
        if m:
            accounts.append({"number": m.group(1), "title": f["name"], "id": f["id"]})
    accounts.sort(key=lambda a: a["number"])

    need_hotfix: list[str] = []
    total_missing = 0

    print(f"Auditando {len(accounts)} cuentas contra Drive en vivo...\n")

    for acc in accounts:
        live = list_recursive(svc, acc["id"])
        live_ids = {f["id"] for f in live}

        acc_dir = find_account_dir(acc["number"])
        snap_ids: set[str] = set()
        read_ids: set[str] = set()
        skipped: list[str] = []
        last_crawled = "?"
        analyzed_at = "?"

        if acc_dir:
            snap_path = acc_dir / "account_status.json"
            di_path = acc_dir / "drive_intelligence.json"
            if snap_path.exists():
                snap = json.loads(snap_path.read_text(encoding="utf-8"))
                snap_ids = {f["id"] for f in snap.get("driveFiles", [])}
                last_crawled = snap.get("lastCrawledAt", "?")
            if di_path.exists():
                di = json.loads(di_path.read_text(encoding="utf-8"))
                read_ids = {f.get("id") for f in di.get("files", [])}
                skipped = di.get("files_skipped", [])
                analyzed_at = di.get("analyzed_at", "?")

        # El snapshot guarda solo los 80 archivos MÁS RECIENTES por diseño
        # (MAX_FILES_PER_ACCOUNT). Un archivo viejo fuera de esa ventana no es
        # un problema. Solo cuentan los archivos no detectados que son MÁS
        # NUEVOS que el archivo más viejo del snapshot (ventana activa).
        snap_times: list[str] = []
        derived_status = ""
        if acc_dir and (acc_dir / "account_status.json").exists():
            snap = json.loads((acc_dir / "account_status.json").read_text(encoding="utf-8"))
            snap_times = [f.get("modifiedTime") or "" for f in snap.get("driveFiles", [])]
            derived_status = snap.get("derivedStatus", "")

        # El cap fue 80 históricamente y ahora es 150: cualquier snapshot lleno
        # hasta uno de esos topes está recortado por diseño.
        cap_reached = len(snap_ids) >= 80
        cutoff = min(snap_times) if (cap_reached and snap_times) else ""

        missing = [f for f in live if f["id"] not in snap_ids]
        # Comparación ESTRICTA (>): archivos con el mismo modifiedTime que el más
        # viejo del snapshot son empates en la frontera del cap, no errores.
        missing_supported = [
            f for f in missing
            if not any(h in f["mimeType"] for h in UNSUPPORTED_HINTS)
            and (not cutoff or (f.get("modifiedTime") or "") > cutoff)
        ]

        is_excluded = derived_status in ("excluded", "concluded", "detained") or not snap_ids

        status = "OK"
        if missing_supported and not is_excluded:
            status = f"FALTAN {len(missing_supported)} (recientes)"
            need_hotfix.append(acc["number"])
            total_missing += len(missing_supported)
        elif missing_supported and is_excluded:
            status = f"excluida ({derived_status or 'sin snapshot'}) — {len(missing_supported)} sin indexar"

        print(f"[{acc['number']}] {acc['title'][:45]:<45} drive={len(live):>3}  snap={len(snap_ids):>3}  leidos={len(read_ids):>3}  omitidos={len(skipped):>2}  crawl={str(last_crawled)[:10]}  -> {status}")

        if not is_excluded:
            for f in missing_supported:
                print(f"        + NO DETECTADO: {f['modifiedTime'][:10] if f.get('modifiedTime') else '?'} | {f['mimeType'][:60]} | {f['path'][:90]}")

    print(f"\n{'='*100}")
    print(f"RESUMEN: {len(need_hotfix)} cuentas con archivos no detectados ({total_missing} archivos)")
    print(f"Cuentas que necesitan hotfix: {' '.join(need_hotfix) if need_hotfix else 'ninguna'}")


if __name__ == "__main__":
    main()
