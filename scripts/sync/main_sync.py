#!/usr/bin/env python3
"""
Semaforo sync entrypoint.

The old Google Drive crawler/reader pipeline is no longer the operational sync.
Daily scoring now comes from WhatsApp messages stored in Supabase.
"""
from __future__ import annotations

from wa_daily_analyzer import main


if __name__ == "__main__":
    main()
