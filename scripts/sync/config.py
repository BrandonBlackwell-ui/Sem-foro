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

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
WA_ANALYSIS_MODEL = os.getenv("WA_ANALYSIS_MODEL", "claude-haiku-4-5")
