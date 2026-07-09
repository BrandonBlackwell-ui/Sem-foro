#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analyze Meet/session transcriptions for SC (Satisfacción del Cliente) signals.

Based on Formula SC Blackwell methodology (BW-26-KPI-SC-001 v1.0):
  - Sesion_score starts at 50 (neutral base)
  - Adjustments: +25 positive comments, +15 attendance, +15 active participation,
    +10 shares strategic info, -15 defensive tone, -25 explicit complaint/escalation
  - Output stored in checklist scores for 'transcripciones' item

Usage:
    python -m scripts.sync.analyze_meet_transcription --account-id tello --period 2026-06
    python -m scripts.sync.analyze_meet_transcription --account-id tello --period 2026-06 --transcript-file transcript.txt
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.sync.config import DATA_DIR, OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
except ModuleNotFoundError:
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import DATA_DIR, OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL

from supabase import create_client

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LLM prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
Eres un analista interno de Blackwell Strategy. Tu tarea es evaluar la transcripción \
de una junta de estatus (Meet/Zoom/Teams) con un cliente para determinar las señales \
de satisfacción presentes según la metodología SC de Blackwell.

Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto extra).
"""

USER_PROMPT_TEMPLATE = """\
TRANSCRIPCIÓN DE JUNTA
Cliente: {account_name}
Fecha: {period}

---
{transcript}
---

INSTRUCCIONES:

PASO 1 — ASISTENCIA Y PUNTUALIDAD
Determina si el cliente (no el equipo Blackwell) asistió a la junta.
Si hay evidencia de que el cliente llegó a tiempo (dentro de los primeros 5 min), marca attended_on_time=true.
Si el cliente llegó tarde o no asistió, ajusta correspondientemente.

PASO 2 — PARTICIPACIÓN ACTIVA
¿El cliente hizo preguntas, aportó contexto, compartió información estratégica sobre su negocio, \
o lideró partes de la conversación? Una respuesta activa va más allá de solo confirmar o responder \
con monosílabos. Evalúa y asigna nivel: "alta", "media", "baja" o "ninguna".

PASO 3 — COMENTARIOS POSITIVOS EXPLÍCITOS
¿El cliente expresó satisfacción, felicitó al equipo, validó resultados o agradeció el trabajo? \
Busca frases como "me gustó", "excelente", "buen trabajo", "gracias por", "quedó bien", etc. \
Detecta el tono general: positivo, neutro, negativo o mixto.

PASO 4 — INFORMACIÓN ESTRATÉGICA COMPARTIDA
¿El cliente compartió información sensible de negocio, nuevos objetivos, contexto interno o \
datos confidenciales que demuestran confianza en el equipo? Ejemplos: planes de expansión, \
cambios organizacionales, presupuestos, crisis internas.

PASO 5 — SEÑALES NEGATIVAS
¿Hay señales de presión, molestia, queja explícita, crítica al equipo o al servicio, \
o comentarios que indiquen insatisfacción? Detecta frases como "sigo esperando", \
"no entiendo por qué", "eso no es lo que pedí", escalamientos o tono defensivo del cliente.

PASO 5.5 — EVALUACIÓN DE ENCUESTA (SURVEY)
Identifica si durante la junta se formularon y respondieron de viva voz preguntas directas de satisfacción (encuesta) del cliente:
- Tipo A (Satisfacción General): Ejemplos: "¿cómo calificarías el servicio?", "¿qué tan satisfecho estás con la atención?".
  Si se responde con escala numérica (1 a 10), mapea: 9-10 -> score 100, 7-8 -> score 75, 5-6 -> score 50, 3-4 -> score 25, 1-2 -> score 0.
- Tipo B (Impacto en Objetivo): Ejemplos: "¿el trabajo movió la aguja?", "¿la cobertura refuerza la narrativa?".
  Mapea la respuesta: "Sí claramente/Sí" -> score 100, "En proceso/parcialmente" -> score 60, "Poco" -> score 20, "No" -> score 0.
Si no se hicieron estas preguntas directas y no hay respuesta en la transcripción, pon tanto "question_a" como "question_b" en null.

PASO 6 — CALCULA EL SESION_SCORE
Aplica la siguiente tabla de ajustes partiendo de base=50:
  +25  si hay comentarios positivos explícitos del cliente
  +15  si el cliente asistió y llegó puntual
  +15  si el cliente participó activamente (nivel "alta")
  +10  si el cliente compartió información estratégica
  +5   si participación fue "media" (en lugar de +15)
  0    si participación fue "baja" o "ninguna"
  -15  si tono general fue defensivo o hubo presión/molestia
  -25  si hubo queja explícita o escalamiento

Mínimo: 0. Máximo: 100.

PASO 7 — CHECKLIST DE EVIDENCIA
Genera 3-5 frases "Si:" (señal positiva detectada) o "No:" (señal negativa o ausente) \
que expliquen el score. Usa lenguaje descriptivo y concreto.

RESPONDE con este JSON exacto:
{{
  "attended": true_o_false,
  "attended_on_time": true_o_false,
  "participation_level": "alta|media|baja|ninguna",
  "positive_comments": true_o_false,
  "shared_strategic_info": true_o_false,
  "negative_signals": true_o_false,
  "negative_detail": "descripción breve si hay señales negativas, sino null",
  "tone": "positivo|neutro|negativo|mixto",
  "sesion_score": número_entero_0_a_100,
  "checklist": ["Si: ...", "No: ...", ...],
  "reasoning": "explicación breve de 2-3 oraciones del score asignado",
  "accionables": ["accionable 1 si hay Tipo C o señales negativas", ...],
  "survey": {{
    "question_a": {{
      "question": "texto de la pregunta tipo A o null",
      "answer": "respuesta del cliente o null",
      "score": 100|75|50|25|0|null
    }},
    "question_b": {{
      "question": "texto de la pregunta tipo B o null",
      "answer": "respuesta del cliente o null",
      "score": 100|60|20|0|null
    }}
  }}
}}
"""

# ---------------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------------

def _call_llm(transcript: str, account_name: str, period: str) -> dict:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is required.")

    user_msg = USER_PROMPT_TEMPLATE.format(
        account_name=account_name,
        period=period,
        transcript=transcript[:12000],  # safety truncation
    )

    payload = json.dumps({
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 1000,
        "temperature": 0.1,
    }).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/BrandonBlackwell-ui/Sem-foro",
            "X-Title": "Blackwell Semaforo",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"OpenRouter HTTP {exc.code}: {exc.read().decode()}") from exc

    raw = body["choices"][0]["message"]["content"].strip()
    raw = raw.strip("```json").strip("```").strip()
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def _get_account_info(account_id: str) -> dict:
    """Load checklist.json for the account to get account_name and account_number."""
    # Look for checklist in public/data/accounts
    base = DATA_DIR.parent / "dashboard" / "public" / "data" / "accounts"
    for folder in base.iterdir():
        cl = folder / "checklist.json"
        if cl.exists():
            data = json.loads(cl.read_text(encoding="utf-8"))
            name = data.get("account_name", "")
            aid = data.get("account_id", "")
            if name.lower() == account_id.lower() or account_id in folder.name or aid.lower() == account_id.lower():
                return {
                    "account_number": data.get("account_number"),
                    "account_name": name,
                    "folder": folder.name,
                }
    raise ValueError(f"No checklist.json found for account_id='{account_id}'")


def _upsert_session_analysis(
    sb,
    account_number: str,
    period: str,
    llm: dict,
    transcript_snippet: str,
) -> None:
    row = {
        "account_number": account_number,
        "period": period,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "sesion_score": llm["sesion_score"],
        "attended": llm.get("attended"),
        "attended_on_time": llm.get("attended_on_time"),
        "participation_level": llm.get("participation_level"),
        "positive_comments": llm.get("positive_comments"),
        "shared_strategic_info": llm.get("shared_strategic_info"),
        "negative_signals": llm.get("negative_signals"),
        "tone": llm.get("tone"),
        "evidence": {
            "checklist": llm.get("checklist", []),
            "reasoning": llm.get("reasoning", ""),
            "accionables": llm.get("accionables", []),
            "negative_detail": llm.get("negative_detail"),
        },
        "transcript_snippet": transcript_snippet[:500],
    }

    try:
        existing = (
            sb.table("session_quality_analyses")
            .select("id")
            .eq("account_number", account_number)
            .eq("period", period)
            .execute()
        )
        if existing.data:
            sb.table("session_quality_analyses").update(row).eq("id", existing.data[0]["id"]).execute()
            log.info("Updated session analysis id=%s", existing.data[0]["id"])
        else:
            sb.table("session_quality_analyses").insert(row).execute()
            log.info("Inserted new session analysis for %s / %s", account_number, period)
    except Exception as exc:
        log.warning("Could not save to session_quality_analyses (table may not exist yet): %s", exc)
        log.info("Score saved to checklist.json only.")


# ---------------------------------------------------------------------------
# Checklist score update
# ---------------------------------------------------------------------------

def _update_checklist_score(account_folder: str, period: str, sesion_score: int, llm: dict) -> None:
    """Write full SC evidence into checklist.json scores.transcripciones for the period."""
    for subfolder in ["public/data/accounts", "dist/data/accounts"]:
        cl_path = (
            DATA_DIR.parent / "dashboard" / subfolder / account_folder / "checklist.json"
        )
        if not cl_path.exists():
            continue
        data = json.loads(cl_path.read_text(encoding="utf-8"))
        scores = data.setdefault("scores", {})
        period_scores = scores.setdefault(period, {})
        if sesion_score >= 80:
            status = "ok"
        elif sesion_score >= 50:
            status = "partial"
        else:
            status = "missing"
        period_scores["transcripciones"] = {
            "status": status,
            "score": sesion_score,
            "sesion_score": sesion_score,
            "attended": llm.get("attended"),
            "attended_on_time": llm.get("attended_on_time"),
            "participation_level": llm.get("participation_level"),
            "tone": llm.get("tone"),
            "positive_comments": llm.get("positive_comments"),
            "shared_strategic_info": llm.get("shared_strategic_info"),
            "negative_signals": llm.get("negative_signals"),
            "checklist": llm.get("checklist", []),
            "reasoning": llm.get("reasoning", ""),
            "accionables": llm.get("accionables", []),
            "survey": llm.get("survey"),
        }
        cl_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("Updated checklist score transcripciones=%s in %s", status, cl_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    ap = argparse.ArgumentParser(description="Analyze Meet transcription for SC signals")
    ap.add_argument("--account-id", required=True, help="Account name or folder prefix (e.g. tello, MTV)")
    ap.add_argument("--period", required=True, help="Month in YYYY-MM format (e.g. 2026-06)")
    ap.add_argument("--transcript-file", help="Path to .txt transcript file (stdin if omitted)")
    ap.add_argument("--dry-run", action="store_true", help="Print result without saving to Supabase")
    ap.add_argument("--no-checklist", action="store_true", help="Skip updating checklist.json")
    args = ap.parse_args()

    # Load transcript
    if args.transcript_file:
        transcript = Path(args.transcript_file).read_text(encoding="utf-8")
    else:
        log.info("Reading transcript from stdin (Ctrl+Z/D to finish)...")
        transcript = sys.stdin.read()

    if not transcript.strip():
        log.error("Empty transcript — nothing to analyze.")
        sys.exit(1)

    # Get account info
    account_info = _get_account_info(args.account_id)
    log.info("Account: %s (folder: %s)", account_info["account_name"], account_info["folder"])

    # Call LLM
    log.info("Calling LLM for SC session analysis...")
    llm = _call_llm(transcript, account_info["account_name"], args.period)

    # Print result
    print("\n" + "=" * 60)
    print(f"  SC SESSION ANALYSIS — {account_info['account_name']} / {args.period}")
    print("=" * 60)
    print(f"  Sesion_score : {llm['sesion_score']}/100")
    print(f"  Attended     : {llm.get('attended')} (on time: {llm.get('attended_on_time')})")
    print(f"  Participation: {llm.get('participation_level')}")
    print(f"  Tone         : {llm.get('tone')}")
    print(f"  Positive cmts: {llm.get('positive_comments')}")
    print(f"  Shared intel : {llm.get('shared_strategic_info')}")
    print(f"  Negative sigs: {llm.get('negative_signals')}")
    if llm.get("negative_detail"):
        print(f"  Neg. detail  : {llm['negative_detail']}")
    print("\n  Checklist:")
    for item in llm.get("checklist", []):
        prefix = "  [SI]" if item.lower().startswith("si:") else "  [NO]"
        print(f"    {prefix} {item}")
    print(f"\n  Reasoning: {llm.get('reasoning')}")
    if llm.get("accionables"):
        print("\n  Accionables:")
        for a in llm["accionables"]:
            print(f"    -> {a}")
    print("=" * 60 + "\n")

    if args.dry_run:
        log.info("Dry-run mode — nothing saved.")
        return

    # Save to Supabase
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    _upsert_session_analysis(
        sb,
        account_info["account_number"],
        args.period,
        llm,
        transcript[:500],
    )

    # Update checklist.json
    if not args.no_checklist:
        _update_checklist_score(account_info["folder"], args.period, llm["sesion_score"], llm)

    log.info("Done.")


if __name__ == "__main__":
    main()
