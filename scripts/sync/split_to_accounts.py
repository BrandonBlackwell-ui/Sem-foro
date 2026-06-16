"""
split_to_accounts.py — Migración one-time.

Crea data/accounts/{number}_{name}/ para cada cuenta con:
  account_status.json     ← del accounts_status.json global
  drive_intelligence.json ← del drive_intelligence.js global
  checklist.json          ← del checklist_recalc.json global (sección scores)

Los archivos globales NO se borran — siguen siendo la fuente del dashboard.
Este script es idempotente: vuelve a correrlo sin problema.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# ── Rutas ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data"
ACCOUNTS_DIR = DATA_DIR / "accounts"

ACCOUNTS_STATUS_JSON = DATA_DIR / "accounts_status.json"
DRIVE_INTELLIGENCE_JS = DATA_DIR / "drive_intelligence.js"
CHECKLIST_RECALC_JSON = DATA_DIR / "checklist_recalc.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def slug(name: str) -> str:
    """Convierte un nombre en slug seguro para nombres de carpeta."""
    s = name.upper().strip()
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    return s.strip("_")


def folder_name(number: str, name: str) -> str:
    return f"{number}_{slug(name)}"


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def read_js_var(path: Path) -> dict:
    """Lee window.VARIABLE = {...}; extrayendo el JSON robusto."""
    text = path.read_text(encoding="utf-8")
    # Buscar la primera = y tomar todo a partir de ahí
    eq_idx = text.find("=")
    if eq_idx == -1:
        raise ValueError(f"No se encontró '=' en {path}")
    raw = text[eq_idx + 1:].strip()
    if raw.endswith(";"):
        raw = raw[:-1].strip()
    # Intentar parsear directamente
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Limpiar caracteres problemáticos (sustituciones de codificación)
        raw_clean = raw.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
        # Eliminar caracteres de control excepto tabs/newlines
        raw_clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw_clean)
        return json.loads(raw_clean)


def write_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"ROOT: {ROOT}")
    print(f"Carpeta destino: {ACCOUNTS_DIR}")

    # 1. Leer fuentes
    print("\n[1/3] Leyendo accounts_status.json...")
    status_data = read_json(ACCOUNTS_STATUS_JSON)
    status_by_number: dict[str, dict] = {
        a["number"]: a for a in status_data.get("accounts", [])
    }
    print(f"  {len(status_by_number)} cuentas en accounts_status.json")

    print("[2/3] Leyendo drive_intelligence.js...")
    di_data = read_js_var(DRIVE_INTELLIGENCE_JS)
    di_by_number: dict[str, dict] = {
        a["number"]: a for a in di_data.get("accounts", [])
    }
    print(f"  {len(di_by_number)} cuentas en drive_intelligence.js")

    print("[3/3] Leyendo checklist_recalc.json...")
    checklist_data = read_json(CHECKLIST_RECALC_JSON)
    checklist_schema = checklist_data.get("schema", {})
    checklist_scores: dict[str, dict] = checklist_data.get("scores", {})
    # También buscar bajo "accounts" o raíz (compatibilidad)
    if not checklist_scores:
        checklist_scores = {
            k: v for k, v in checklist_data.items()
            if isinstance(v, dict) and k not in ("schema", "generated", "meta")
        }
    print(f"  {len(checklist_scores)} cuentas en checklist_recalc.json (scores)")

    # 2. Crear carpeta por cuenta
    all_numbers = sorted(set(status_by_number) | set(di_by_number))
    print(f"\nCreando {len(all_numbers)} carpetas en data/accounts/...\n")

    created = 0
    for number in all_numbers:
        status = status_by_number.get(number, {})
        di = di_by_number.get(number, {})

        # Determinar nombre
        name = (
            di.get("account_name")
            or status.get("folderTitle", "").split("/")[0].strip()
            or number
        )
        # Quitar número del prefijo si ya está en el folderTitle (e.g. "01. TURBOFIN")
        name = re.sub(r"^\d+\.\s*", "", name).strip()

        folder = ACCOUNTS_DIR / folder_name(number, name)
        folder.mkdir(parents=True, exist_ok=True)

        # account_status.json
        if status:
            write_json(folder / "account_status.json", status)

        # drive_intelligence.json
        if di:
            write_json(folder / "drive_intelligence.json", di)

        # checklist.json — buscar por account_id o número
        account_id = (
            di.get("account_id")
            or status.get("number")
            or number
        ).lower()
        # Buscar en checklist_scores por account_id o nombre slug
        cl = (
            checklist_scores.get(account_id)
            or checklist_scores.get(slug(name).lower())
            or checklist_scores.get(number)
        )
        if cl or checklist_schema:
            checklist_out = {
                "account_number": number,
                "account_name": name,
                "schema": checklist_schema,
                "scores": cl or {},
            }
            write_json(folder / "checklist.json", checklist_out)

        print(f"  OK {folder.name}")
        print(f"      account_status.json  ({len(status)} campos)")
        print(f"      drive_intelligence.json  ({len(di)} campos)")
        if cl:
            print(f"      checklist.json  (scores para {account_id})")
        created += 1

    print(f"\n{'='*60}")
    print(f"Migracion completada: {created} carpetas creadas en:")
    print(f"   {ACCOUNTS_DIR}")
    print("\nLos archivos globales NO fueron modificados.")
    print("Para copiar al dashboard, corre el sync o copia manualmente.")


if __name__ == "__main__":
    main()
