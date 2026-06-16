"""
schema_validator.py — Valida accounts_status.json contra el schema v4.1
antes de publicar el dashboard.

Si la validación falla, el build se detiene y se imprime un reporte claro
indicando exactamente qué está mal y en qué cuenta/subfolder.

Uso:
    # Desde Python
    from schema_validator import validate_snapshot
    ok, errors = validate_snapshot(snapshot_dict)

    # Desde la terminal (valida el archivo en disco)
    python schema_validator.py
    python schema_validator.py --file /ruta/a/accounts_status.json
    python schema_validator.py --strict   # falla también con warnings
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Intentar usar jsonschema si está instalado (validación estructural completa)
try:
    import jsonschema
    _HAS_JSONSCHEMA = True
except ImportError:
    _HAS_JSONSCHEMA = False
    logger.debug("jsonschema no instalado. Usando validación manual.")


@dataclass
class ValidationResult:
    ok: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, msg: str) -> None:
        self.errors.append(msg)
        self.ok = False

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def print_report(self) -> None:
        if self.ok and not self.warnings:
            print("[OK] Schema valido - snapshot listo para publicar.")
            return

        if self.errors:
            print(f"\n[ERROR] ERRORES DE SCHEMA ({len(self.errors)}) - NO publicar el dashboard:\n")
            for e in self.errors:
                print(f"   ERROR  {e}")

        if self.warnings:
            print(f"\n[WARN] ADVERTENCIAS ({len(self.warnings)}):\n")
            for w in self.warnings:
                print(f"   WARN   {w}")

        print()


# ─────────────────────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────────────────────

def validate_snapshot(snapshot: dict, strict: bool = False) -> ValidationResult:
    """
    Valida el snapshot completo de accounts_status.json.

    Args:
        snapshot: contenido completo del JSON ya parseado
        strict:   si True, los warnings también cuentan como fallo

    Returns:
        ValidationResult con ok=True si el snapshot es publicable
    """
    result = ValidationResult()

    # ── Nivel raíz ────────────────────────────────────────────────────────────
    _validate_root(snapshot, result)
    if not result.ok:
        # Si el root ya está mal, no tiene sentido validar cada cuenta
        return result

    # ── Cada account ──────────────────────────────────────────────────────────
    accounts = snapshot.get("accounts", [])
    for acc in accounts:
        _validate_account(acc, result)

    # ── cross_account_findings ────────────────────────────────────────────────
    _validate_findings(snapshot.get("cross_account_findings", []), result)

    # ── Consistencia accountCount ─────────────────────────────────────────────
    declared = snapshot.get("accountCount")
    actual = len(accounts)
    if declared is not None and declared != actual:
        result.warn(
            f"accountCount={declared} pero hay {actual} cuentas en el array. "
            f"Actualizar accountCount."
        )

    # ── Validación con jsonschema si está disponible ──────────────────────────
    if _HAS_JSONSCHEMA:
        _validate_with_jsonschema(snapshot, result)

    if strict and result.warnings:
        result.ok = False

    return result


def validate_file(path: Path, strict: bool = False) -> ValidationResult:
    """Carga un archivo JSON y lo valida."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        r = ValidationResult()
        r.error(f"JSON inválido en {path}: {e}")
        return r
    except FileNotFoundError:
        r = ValidationResult()
        r.error(f"Archivo no encontrado: {path}")
        return r

    return validate_snapshot(data, strict=strict)


# ─────────────────────────────────────────────────────────────────────────────
# Validaciones internas
# ─────────────────────────────────────────────────────────────────────────────

def _validate_root(snapshot: dict, r: ValidationResult) -> None:

    # syncedAt requerido y con formato ISO
    synced_at = snapshot.get("syncedAt")
    if not synced_at:
        r.error("syncedAt es requerido y está ausente o vacío.")
    elif not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", synced_at):
        r.error(f"syncedAt tiene formato incorrecto: '{synced_at}'. Esperado: ISO 8601.")

    # accounts requerido y no vacío
    accounts = snapshot.get("accounts")
    if not isinstance(accounts, list):
        r.error("'accounts' debe ser un array. Actualmente es: " + type(accounts).__name__)
    elif len(accounts) == 0:
        r.error("'accounts' está vacío. No se publicará un snapshot sin cuentas.")

    # type válido
    sync_type = snapshot.get("type")
    valid_types = {"delta", "delta+hotfix", "baseline", "structural_refresh"}
    if sync_type and sync_type not in valid_types:
        r.warn(f"type='{sync_type}' no es un valor conocido. Valores válidos: {valid_types}")

    # schemaVersion
    schema_ver = snapshot.get("schemaVersion", "")
    if schema_ver and not schema_ver.startswith("4."):
        r.warn(f"schemaVersion='{schema_ver}'. Se espera versión 4.x.")


_VALID_STATUSES = {
    "active", "onboarding", "active_litigation", "active_new",
    "active_crisis_high", "concluded", "terminated_early", "paused", "historical",
}


def _validate_account(acc: dict, r: ValidationResult) -> None:
    title = acc.get("folderTitle", f"número {acc.get('number', '?')}")

    # Campos requeridos
    for field_name in ("number", "folderTitle", "folderId", "derivedStatus"):
        if not acc.get(field_name):
            r.error(f"[{title}] Campo requerido ausente o vacío: '{field_name}'")

    # number debe ser 2 dígitos
    number = acc.get("number", "")
    if number and not re.match(r"^\d{2}$", str(number)):
        r.error(f"[{title}] 'number' debe ser 2 dígitos. Valor actual: '{number}'")

    # derivedStatus válido
    status = acc.get("derivedStatus")
    if status and status not in _VALID_STATUSES:
        r.error(
            f"[{title}] derivedStatus='{status}' no es válido. "
            f"Valores válidos: {sorted(_VALID_STATUSES)}"
        )

    # subfolderActivity
    subs = acc.get("subfolderActivity")
    if subs is None:
        r.error(f"[{title}] 'subfolderActivity' es requerido.")
        return
    if not isinstance(subs, dict):
        r.error(f"[{title}] 'subfolderActivity' debe ser un objeto, no {type(subs).__name__}.")
        return
    if len(subs) == 0:
        r.warn(f"[{title}] 'subfolderActivity' está vacío. ¿Se crawleó correctamente?")

    for sub_name, entry in subs.items():
        _validate_subfolder(title, sub_name, entry, r)


def _validate_subfolder(
    account_title: str, sub_name: str, entry: Any, r: ValidationResult
) -> None:
    ctx = f"[{account_title} / {sub_name}]"

    if not isinstance(entry, dict):
        r.error(f"{ctx} La entrada debe ser un objeto, no {type(entry).__name__}.")
        return

    # fileCount: entero o null, nunca string
    fc = entry.get("fileCount")
    if fc is not None and not isinstance(fc, int):
        r.error(
            f"{ctx} 'fileCount' debe ser entero o null. "
            f"Tipo actual: {type(fc).__name__} (valor: {fc!r}). "
            f"Esto rompe el cálculo de scores en el dashboard."
        )

    # subfolderMissing requerido
    if "subfolderMissing" not in entry:
        r.warn(f"{ctx} 'subfolderMissing' ausente. Se asumirá False.")

    # last_verified_at recomendado
    if "last_verified_at" not in entry:
        r.warn(f"{ctx} 'last_verified_at' ausente. Este subfolder no se re-verificará correctamente.")

    # latestModified: si tiene valor, debe ser ISO
    lm = entry.get("latestModified")
    if lm and not re.match(r"^\d{4}-\d{2}-\d{2}T", str(lm)):
        r.warn(
            f"{ctx} 'latestModified' tiene formato inesperado: '{lm}'. "
            f"Esperado: ISO 8601."
        )

    # Si subfolderMissing=False y fileCount=None, es sospechoso
    if not entry.get("subfolderMissing", True) and fc is None:
        source = entry.get("source", "")
        if "permissions" not in source and not entry.get("permissionsIssue"):
            r.warn(
                f"{ctx} fileCount=null pero subfolderMissing=False. "
                f"¿Error de crawl? Source: '{source}'"
            )


def _validate_findings(findings: list, r: ValidationResult) -> None:
    if not isinstance(findings, list):
        r.error(
            f"'cross_account_findings' debe ser un array de objetos. "
            f"Tipo actual: {type(findings).__name__}. "
            f"Esto rompe la pestaña de Auditoría en el dashboard."
        )
        return

    valid_severities = {"high", "medium", "low", "info"}
    for i, f in enumerate(findings):
        # El bug histórico: a veces se emitían strings en lugar de objetos
        if isinstance(f, str):
            r.error(
                f"cross_account_findings[{i}] es un string ('{f[:60]}...'). "
                f"DEBE ser un objeto con campos: id, finding, severity. "
                f"Esto rompe el tab de Auditoría."
            )
            continue

        if not isinstance(f, dict):
            r.error(f"cross_account_findings[{i}] no es un objeto: {type(f).__name__}")
            continue

        if not f.get("finding"):
            r.warn(f"cross_account_findings[{i}] no tiene campo 'finding'.")

        severity = f.get("severity")
        if severity and severity not in valid_severities:
            r.warn(
                f"cross_account_findings[{i}] severity='{severity}' no reconocido. "
                f"Valores válidos: {valid_severities}"
            )


def _validate_with_jsonschema(snapshot: dict, r: ValidationResult) -> None:
    """Validación adicional con jsonschema si está disponible."""
    schema_path = (
        Path(__file__).resolve().parent.parent.parent
        / "data" / "schemas" / "accounts_status.schema.json"
    )
    if not schema_path.exists():
        return

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        validator = jsonschema.Draft7Validator(schema)
        errors = list(validator.iter_errors(snapshot))
        for e in errors:
            path = " → ".join(str(p) for p in e.absolute_path) or "raíz"
            r.error(f"[jsonschema] {path}: {e.message}")
    except Exception as exc:
        r.warn(f"jsonschema no pudo validar: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    ap = argparse.ArgumentParser(
        description="Valida accounts_status.json antes de publicar el dashboard."
    )
    ap.add_argument(
        "--file", "-f",
        default=None,
        help="Ruta al archivo a validar. Default: data/accounts_status.json del proyecto.",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Tratar warnings como errores (falla el proceso).",
    )
    args = ap.parse_args()

    if args.file:
        path = Path(args.file)
    else:
        path = Path(__file__).resolve().parent.parent.parent / "data" / "accounts_status.json"

    print(f"\nValidando: {path}\n")
    result = validate_file(path, strict=args.strict)
    result.print_report()

    if not result.ok:
        print("El dashboard NO debe publicarse con este snapshot.")
        sys.exit(1)
    else:
        print("El snapshot puede publicarse.")
        sys.exit(0)


if __name__ == "__main__":
    main()
