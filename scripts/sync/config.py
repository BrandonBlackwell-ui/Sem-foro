"""
config.py — Configuración central del pipeline de sync.

Lee variables de entorno desde .env en la raíz del proyecto.
Todos los demás módulos importan constantes desde aquí.
"""
import os
import pathlib
from dotenv import load_dotenv

# Raíz del proyecto (dos niveles arriba de scripts/sync/)
ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# Carga .env si existe
load_dotenv(ROOT / ".env", override=False)

# ── Google Drive ──────────────────────────────────────────────────────────────
DRIVE_ROOT_FOLDER_ID: str = os.getenv(
    "DRIVE_ROOT_FOLDER_ID", "1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_"
)
# Ruta al JSON de credenciales OAuth2 descargado desde Google Cloud Console.
# Alternativa: usar GOOGLE_SERVICE_ACCOUNT_JSON para service account.
GOOGLE_CREDENTIALS_PATH: str = os.getenv(
    "GOOGLE_CREDENTIALS_PATH", str(ROOT / "credentials.json")
)
GOOGLE_TOKEN_PATH: str = os.getenv(
    "GOOGLE_TOKEN_PATH", str(ROOT / "token.json")
)
_sa_raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
# Resolver ruta relativa desde ROOT si no es absoluta
GOOGLE_SERVICE_ACCOUNT_JSON: str = (
    str(ROOT / _sa_raw) if _sa_raw and not os.path.isabs(_sa_raw) else _sa_raw
)

# ── Anthropic (Claude) ────────────────────────────────────────────────────────

def _resolve_anthropic_api_key() -> tuple[str, str]:
    """Siempre usa ANTHROPIC_API_KEY, tanto en local como en producción."""
    return os.getenv("ANTHROPIC_API_KEY", "").strip(), "ANTHROPIC_API_KEY"


ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_SOURCE = _resolve_anthropic_api_key()
# Modelo a usar para análisis de archivos. Haiku es el más barato.
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")

# ── Supabase (tareas por cliente → Monday) ───────────────────────────────────
# Misma instancia y llave publishable que usa el dashboard React.
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "https://vqgfkfvywbpjldreuplb.supabase.co").rstrip("/")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "sb_publishable_MQ8JlDI41ymSUpcrV_8o_w_uLl8g1SM")

# ── Paths locales ─────────────────────────────────────────────────────────────
DATA_DIR = ROOT / "data"
LOGS_DIR = ROOT / "logs"
SCRIPTS_DIR = ROOT / "scripts"

ACCOUNTS_STATUS_JSON = DATA_DIR / "accounts_status.json"
ACCOUNTS_STATUS_JS   = DATA_DIR / "accounts_status.js"
DRIVE_INTELLIGENCE_JS = DATA_DIR / "drive_intelligence.js"

# ── Política de crawl ─────────────────────────────────────────────────────────
# Niveles máximos de recursión dentro de un subfolder (ej: Entregables/ABRIL/archivo.pdf = 2)
CRAWL_MAX_DEPTH: int = int(os.getenv("CRAWL_MAX_DEPTH", "4"))
# Resultados por página en Drive API (máximo permitido por Google: 1000)
CRAWL_PAGE_SIZE: int = int(os.getenv("CRAWL_PAGE_SIZE", "1000"))
# Prefijos de los 6 subfolders estándar del playbook
PLAYBOOK_PREFIXES: tuple = ("01.", "02.", "03.", "04.", "05.", "06.")

# ── Política de staleness ─────────────────────────────────────────────────────
# Re-verificar subfolders cuyo last_verified_at sea mayor a este número de días
STALE_MAX_AGE_DAYS: int = int(os.getenv("STALE_MAX_AGE_DAYS", "7"))
# Para cuentas con menos de N días desde su creación, re-crawl semanal obligatorio
ONBOARDING_FULL_RECRAWL_DAYS: int = int(os.getenv("ONBOARDING_FULL_RECRAWL_DAYS", "30"))
# Para cuentas nuevas con fileCount=0, tratar como sospechoso si llevan más de N días
ONBOARDING_SUSPECT_FC0_DAYS: int = int(os.getenv("ONBOARDING_SUSPECT_FC0_DAYS", "3"))
# Máximo de subfolders a re-verificar por corrida (límite de eficiencia)
STALE_MAX_REVERIFY_PER_RUN: int = int(os.getenv("STALE_MAX_REVERIFY_PER_RUN", "40"))

# ── Scopes de Google Drive API ────────────────────────────────────────────────
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
