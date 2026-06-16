#!/usr/bin/env python3
"""
build_v36.py — Wrapper de compatibilidad.

Este archivo ahora delega al nuevo sistema modular en scripts/build/build.py,
que usa el template actualizado en scripts/frontend/dashboard_template.html.

Para uso directo del nuevo sistema:
    python scripts/build/build.py

Para watch mode (rebuild automático al cambiar data/):
    python scripts/build/build.py --watch
"""
import pathlib
import subprocess
import sys

BUILD_SCRIPT = pathlib.Path(__file__).resolve().parent / "build" / "build.py"

if not BUILD_SCRIPT.exists():
    print(f"ERROR: no se encontró el nuevo build script en {BUILD_SCRIPT}")
    sys.exit(1)

# Pasar todos los argumentos al nuevo build script
result = subprocess.run(
    [sys.executable, str(BUILD_SCRIPT)] + sys.argv[1:],
    cwd=str(pathlib.Path(__file__).resolve().parent.parent),
)
sys.exit(result.returncode)
