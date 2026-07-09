"""
Shared configuration for the WhatsApp-first Semaforo pipeline.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env", override=False)

DATA_DIR = ROOT / "data"
LOGS_DIR = ROOT / "logs"
SCRIPTS_DIR = ROOT / "scripts"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-3.1-flash-lite")

# Google Drive roster sync (drive_roster_sync.py). GOOGLE_SERVICE_ACCOUNT_JSON is
# the full service-account key JSON (raw string); the service account must have
# read access to the Drive root folder below (share the folder with its email).
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
DRIVE_ROOT_FOLDER_ID = os.getenv("DRIVE_ROOT_FOLDER_ID", "1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_")
