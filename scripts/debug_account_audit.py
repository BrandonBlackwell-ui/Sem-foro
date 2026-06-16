"""
debug_account_audit.py — Auditoría en vivo de una cuenta contra Drive.

Lista recursivamente TODO lo que hay en la carpeta de la cuenta hoy,
lo compara contra el snapshot local y reporta:
  - archivos en Drive que NO están en el snapshot (no detectados)
  - archivos leídos vs omitidos por la IA y por qué
  - tipos de archivo problemáticos

Uso: python scripts/debug_account_audit.py <FOLDER_ID> <ACCOUNT_DIRNAME>
Ej:  python scripts/debug_account_audit.py 1gozsVYahJl5rKdbv0DCPtplzRZn6oqQc 08_ULDIS
"""
import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "sync"))

from drive_client import get_drive_service, paginate  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent

FOLDER_MIME = "application/vnd.google-apps.folder"


def list_recursive(svc, folder_id: str, path: str = "", depth: int = 0, max_depth: int = 6):
    """Lista todos los archivos bajo folder_id recursivamente."""
    items = paginate(
        svc.files().list,
        q=f"'{folder_id}' in parents and trashed=false",
        fields="nextPageToken, files(id,name,mimeType,modifiedTime,size,shortcutDetails)",
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
                "id": it["id"],
                "path": p,
                "name": it["name"],
                "mimeType": it["mimeType"],
                "modifiedTime": it.get("modifiedTime"),
                "size": it.get("size"),
            })
    return out


def main():
    folder_id = sys.argv[1]
    dirname = sys.argv[2]

    svc = get_drive_service()
    live = list_recursive(svc, folder_id)
    live.sort(key=lambda f: f.get("modifiedTime") or "", reverse=True)

    print(f"\n{'='*100}")
    print(f"ARCHIVOS EN DRIVE AHORA MISMO ({len(live)}):")
    print(f"{'='*100}")
    for f in live:
        size_kb = f"{int(f['size'])//1024}KB" if f.get("size") else "—"
        print(f"  {f['modifiedTime'] or '?':<26} {f['mimeType']:<75} {size_kb:>8}  {f['path']}")

    # Comparar contra snapshot
    snap_path = ROOT / "data" / "accounts" / dirname / "account_status.json"
    di_path = ROOT / "data" / "accounts" / dirname / "drive_intelligence.json"

    snap_ids = set()
    if snap_path.exists():
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        for f in snap.get("driveFiles", []):
            snap_ids.add(f["id"])
        print(f"\nSnapshot local: {len(snap_ids)} archivos (lastCrawledAt={snap.get('lastCrawledAt')})")

    read_ids = set()
    skipped = []
    if di_path.exists():
        di = json.loads(di_path.read_text(encoding="utf-8"))
        for f in di.get("files", []):
            read_ids.add(f["id"])
        skipped = di.get("files_skipped", [])
        print(f"Drive intelligence: {len(read_ids)} archivos LEÍDOS por la IA, "
              f"{len(skipped)} omitidos (analyzed_at={di.get('analyzed_at')})")

    live_ids = {f["id"] for f in live}

    missing_from_snapshot = [f for f in live if f["id"] not in snap_ids]
    print(f"\n{'='*100}")
    print(f"EN DRIVE PERO *NO* EN EL SNAPSHOT ({len(missing_from_snapshot)}):  ← archivos nuevos no detectados")
    print(f"{'='*100}")
    for f in missing_from_snapshot:
        print(f"  {f['modifiedTime'] or '?':<26} {f['mimeType']:<75} {f['path']}")

    not_read = [f for f in live if f["id"] not in read_ids]
    print(f"\n{'='*100}")
    print(f"EN DRIVE PERO *NO LEÍDOS* POR LA IA ({len(not_read)}):")
    print(f"{'='*100}")
    for f in not_read:
        print(f"  {f['modifiedTime'] or '?':<26} {f['mimeType']:<75} {f['path']}")

    ghost = snap_ids - live_ids
    if ghost:
        print(f"\nEN SNAPSHOT PERO YA NO EN DRIVE ({len(ghost)}): {ghost}")

    print(f"\n{'='*100}")
    print(f"OMITIDOS REGISTRADOS POR LA IA ({len(skipped)}):")
    print(f"{'='*100}")
    for s in skipped:
        print(f"  {s}")

    # Resumen por tipo de archivo
    print(f"\n{'='*100}")
    print("TIPOS DE ARCHIVO EN LA CUENTA:")
    print(f"{'='*100}")
    by_type: dict[str, int] = {}
    for f in live:
        by_type[f["mimeType"]] = by_type.get(f["mimeType"], 0) + 1
    for mt, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {n:>3} × {mt}")


if __name__ == "__main__":
    main()
