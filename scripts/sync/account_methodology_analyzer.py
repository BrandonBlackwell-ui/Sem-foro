#!/usr/bin/env python3
"""
Generate a daily account-level diagnosis using the configured LLM.

The output is intentionally organized by methodology so the dashboard can show
which lens produced each finding and why.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client

try:
    from scripts.sync.config import OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
except ModuleNotFoundError:
    import sys

    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL


logger = logging.getLogger("account_methodology_analyzer")

# Nombres extra por cuenta (además del nombre de WhatsApp) para reforzar el match
# del snapshot y del dashboard. Opcional; la lista base se arma dinámica desde WA.
ACCOUNT_NAME_HINTS = {
    "12": ["Tello + Blackwell", "Interno Tello", "Miguel Tello", "Tello (MTV)", "MTV"],
    "02": ["MAJA", "Maja Sportswear", "MAJA Sportswear"],
}


def _load_target_accounts(sb: Any) -> dict[str, dict[str, Any]]:
    """Arma dinámicamente las cuentas a analizar desde los datos de WhatsApp.

    Cubre TODAS las cuentas con score de WA (excluye internos 00_*). Cada análisis
    queda con account_id = número de cuenta y account_name = nombre de WA, que el
    dashboard empata por score.account_id / score.account_name / grupos.
    """
    scores = sb.table("wa_account_scores").select("account_id,account_name").execute().data or []
    groups = sb.table("wa_groups").select("account_id,name").execute().data or []
    names_by_id: dict[str, list[str]] = {}
    for g in groups:
        aid = str(g.get("account_id") or "").strip()
        name = g.get("name")
        if aid and name:
            names_by_id.setdefault(aid, []).append(name)

    accounts: dict[str, dict[str, Any]] = {}
    for row in scores:
        aid = str(row.get("account_id") or "").strip()
        if not aid or aid.startswith("00"):  # excluir Interno Blackwell / unmapped
            continue
        account_name = str(row.get("account_name") or aid)
        names = list(dict.fromkeys([account_name, *names_by_id.get(aid, []), *ACCOUNT_NAME_HINTS.get(aid, [])]))
        accounts[aid.lower()] = {
            "account_id": aid,
            "account_name": account_name,
            "supabase_ids": [aid],
            "names": names,
        }
    return accounts

METHODOLOGY_BRIEF = """
Metodologias Blackwell (usa estos marcos para clasificar cada hallazgo y justificar acciones):

1) BLACKWELL R3 — framework propio de gobernanza reputacional. Comunicacion como SISTEMA DE DECISION (no publicity, no comunicacion reactiva, no solo PR). Se aplica en 5 capas, con tres lentes: construccion reputacional, riesgos/amenazas y presencia publica.
- Baseline: lectura y analisis integral del contexto. Mapear conversacion y percepcion actual de la marca/lider; identificar atributos reputacionales; analizar consistencia entre discurso historico, acciones y cobertura; detectar riesgos reputacionales latentes y activos por tema, vocero, canal y timing; detectar narrativas adversas con potencial de escalar; ubicar espacios donde el lider es legitimo.
- Bearing: definir el posicionamiento reputacional deseado y DEFENDIBLE; alinear ambicion reputacional con realidad operativa; decidir estrategicamente que conversaciones abordar y cuales evitar; definir indicadores de riesgo y de exito.
- Blueprint: arquitectura de narrativa. Disenar mensajes clave alineados al posicionamiento; construir narrativa consistente y sostenible; definir tonos, enfasis e hilos narrativos; disenar protocolos por escenario; integrar mensajes reactivos y preventivos; desarrollar contranarrativas que neutralicen conversacion negativa.
- Build: activacion. Activar mensajes y narrativas; seleccionar formatos y plataformas; construir credibilidad y autoridad progresivamente; controlar timing, frecuencia y exposicion; ajustes tacticos ante senales tempranas de friccion.
- Balance: monitoreo continuo. Evaluar percepcion y desempeno narrativo; identificar desviaciones entre narrativa planeada y recepcion real; correccion temprana de senales que puedan escalar; recalibrar mensajes y ajustar exposicion/postura.
Protocolo de crisis R3: Fase 1 Flash Assessment (<=20 min: determinar si es crisis y su magnitud, capa Baseline). Fase 2 Crisis Activation (30-60 min: gobernanza -quien decide, quien habla, como se coordina-, capa Bearing; en <2h debe haber crisis clasificada, comite activado, vocero definido y narrativa preliminar). Fase 3 Strategic Response Design (60-180 min: que decir, como y por donde, capa Blueprint; al final: narrativa definida, postura institucional, mensajes clave y materiales listos).

2) CHRIS LEHANE — gestion de crisis como CAMPANA PERMANENTE (logica de campana electoral, no PR defensivo tradicional). Filosofia: "contraataca y haz que duela"; la opinion publica es el jurado y la inaccion equivale a perder la narrativa.
- Principios: (a) Do no harm / una sola oportunidad: honestidad factica y transparencia radical; entregar TODOS los hechos duros en un unico bloque controlado e inmediato (one bite at the apple); el goteo informativo (drip, drip) es letal. (b) Contranarrativa ofensiva (counterspin): una vez fijados los hechos, exponer las motivaciones politicas/financieras/ideologicas del acusador y desacreditar su agenda. (c) Disciplina de mensaje: mensaje simple y consistente que consolide primero la BASE de apoyo propia, sin concesiones.
- Modelo de campana: convertir a usuarios/clientes en una constituency movilizable; adversario + narrativa de legitimacion + ground game + datos; infraestructura permanente, no campanas puntuales.
- Tacticas situacionales: federalismo inverso; movilizacion de base por interes economico propio; investigacion de oposicion asimetrica; reencuadre (de riesgo a soberania economica; de corporativo a "gente comun"/clase media).
- CUANDO ACTIVAR: solo si hay adversario, acusador, narrativa hostil, conflicto regulatorio o crisis publica clara. Si NO aplica, declararlo (status no_aplica) y no forzarla.
- Vulnerabilidades/limites a vigilar: la brecha organico-vs-ingeniado (astroturfing) es el mayor riesgo reputacional; el instinto combativo dana relaciones que el cliente necesita (calibrar combate<->coalicion); metricas auto-reportadas disputables; tacticas de intimidacion legal que invierten la legitimidad; efecto bumerang de las "artes oscuras"; el modelo se quiebra si los hechos colapsan o si el adversario tiene apoyo organico local masivo.

3) AGENTE IA CRISIS BLACKWELL — consultor de crisis 24/7 que opera como SOPORTE INTERNO (nunca decide ni contacta al cliente final; cada recomendacion cita su metodologia).
- Clasifica el riesgo en NIVEL 0-4: 0 sin crisis (mencion aislada sin traccion -> solo monitoreo); 1 riesgo bajo (medio menor, sin viralizacion -> 24-48h); 2 crisis moderada (medios relevantes, redes activas -> 4-12h); 3 crisis alta (viralizacion/trending/multiples medios -> 1-4h); 4 crisis severa (impacto en marca, regulatorio, riesgo legal -> inmediato).
- Dimensiones de evaluacion: veracidad, alcance, impacto reputacional, velocidad, stakeholders, precedente, riesgo legal.
- Propone 3-4 ESCENARIOS de respuesta, cada uno con justificacion, riesgos y requisitos: (1) Silencio estrategico (no emitir, monitorear evolucion); (2) Comunicado de prensa proactivo; (3) Carta aclaratoria / derecho de replica; (4) Accion correctiva visible (investigacion, disculpa, medida concreta).
"""


def main() -> None:
    _setup_logging()
    args = _parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is required.")

    target_date = date.fromisoformat(args.date) if args.date else _today_mx()
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    all_accounts = _load_target_accounts(sb)
    selection = (args.accounts or "").strip().lower()
    if selection in ("", "all"):
        accounts = list(all_accounts.values())
    else:
        keys = [k.strip().lower() for k in selection.split(",") if k.strip()]
        accounts = [all_accounts[k] for k in keys if k in all_accounts]
    if not accounts:
        raise RuntimeError(f"No valid accounts selected. Valid: {', '.join(sorted(all_accounts)) or '(ninguna con score WA)'}")
    logger.info("Methodology analysis for %d account(s).", len(accounts))

    rows = []
    for account in accounts:
        snapshot = _build_snapshot(sb, account, target_date)
        logger.info("Analyzing %s for %s", account["account_name"], target_date.isoformat())
        result = _analyze_account(snapshot, args.model)
        rows.append(_row_from_result(account, target_date, snapshot, result, args.model))

    if args.dry_run:
        for row in rows:
            logger.info("[dry-run] %s", json.dumps(row, ensure_ascii=False, indent=2)[:4000])
        return

    if rows:
        sb.table("account_methodology_daily_analysis").upsert(rows, on_conflict="account_id,analysis_date").execute()
    logger.info("Synced %d methodology diagnosis row(s).", len(rows))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD. Defaults to today in America/Mexico_City.")
    parser.add_argument("--accounts", default="all", help="'all' (default) o números de cuenta separados por coma, ej. 01,12.")
    parser.add_argument("--model", default=os.getenv("OPENROUTER_MODEL", OPENROUTER_MODEL))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _today_mx() -> date:
    # GitHub cron is UTC; Mexico City has no DST in current configuration.
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("America/Mexico_City")).date()


def _build_snapshot(sb: Any, account: dict[str, Any], target_date: date) -> dict[str, Any]:
    ids = set(account["supabase_ids"])
    names = { _key(name) for name in account["names"] }

    groups = sb.table("wa_groups").select("jid,name,account_id,active").execute().data or []
    account_groups = [
        row for row in groups
        if str(row.get("account_id")) in ids or _key(row.get("name")) in names
    ]
    group_jids = [row["jid"] for row in account_groups if row.get("jid")]

    analyses = _fetch_all(sb, "wa_daily_analysis", "id,account_id,group_jid,group_name,analysis_date,message_count,previous_score,score_delta,new_score,sentiment,satisfaction,risk_level,summary,positive_signals,negative_signals,action_items,evidence,analyzed_at")
    account_analyses = [
        row for row in analyses
        if row.get("group_jid") in group_jids or str(row.get("account_id")) in ids or _key(row.get("group_name")) in names
    ]
    account_analyses = sorted(account_analyses, key=lambda r: (str(r.get("analysis_date") or ""), str(r.get("analyzed_at") or "")), reverse=True)

    latest = account_analyses[:10]
    today_rows = [row for row in account_analyses if row.get("analysis_date") == target_date.isoformat()]
    history_summaries = [
        {
            "date": row.get("analysis_date"),
            "group": row.get("group_name"),
            "score": row.get("new_score"),
            "delta": row.get("score_delta"),
            "summary": row.get("summary"),
        }
        for row in latest[:6]
    ]

    scores = _fetch_all(sb, "wa_account_scores", "account_id,account_name,base_score,current_score,total_delta,last_analyzed_date,last_message_at")
    account_scores = [
        row for row in scores
        if str(row.get("account_id")) in ids or _key(row.get("account_name")) in names
    ]

    tasks = _fetch_optional(sb, "wa_tasks", "action,owner_type,owner_name,urgency,monday_status,monday_due_date,monday_responsible_text,monday_work_type,monday_client_label,evidence_speaker,evidence_quote,created_at,updated_at")
    account_tasks = [
        row for row in tasks
        if any(_key(row.get("monday_client_label")).find(_key(name)) >= 0 or _key(name).find(_key(row.get("monday_client_label"))) >= 0 for name in account["names"])
    ][:20]

    publications = _fetch_optional(sb, "publication_quality_scores", "account_id,account_name,period_year,period_month,publication_count,analyzed_count,scored_count,pq_score,status,updated_at")
    account_publication_scores = [
        row for row in publications
        if str(row.get("account_id")) in ids or _key(row.get("account_name")) in names
    ][:6]

    publication_details = _fetch_optional(sb, "publication_quality_analyses", "account_id,account_name,sheet_client_name,media_name,publication_date,article_title,title_match,body_match,editorial_quality,focus,content_score,pq_score,status")
    account_publication_details = [
        row for row in publication_details
        if str(row.get("account_id")) in ids or _key(row.get("account_name")) in names or _key(row.get("sheet_client_name")) in names
    ][:12]

    meetings = _fetch_optional(sb, "account_notes", "*")
    account_meetings = [
        row for row in meetings
        if any(_contains_account(row, name) for name in account["names"])
    ][:8]

    milestones = _fetch_optional(sb, "account_milestones", "account_id,account_name,event_date,event_type,title,description,impact_level")
    account_milestones = [
        row for row in milestones
        if str(row.get("account_id")) in ids or _key(row.get("account_name")) in names
    ]
    account_milestones = sorted(account_milestones, key=lambda r: str(r.get("event_date") or ""), reverse=True)[:15]

    return {
        "account": account,
        "analysis_date": target_date.isoformat(),
        "groups": account_groups,
        "wa_score": account_scores[:3],
        "wa_today": today_rows,
        "wa_recent_history": history_summaries,
        "wa_latest_raw": latest[:3],
        "tasks": account_tasks,
        "publication_quality_scores": account_publication_scores,
        "publication_quality_details": account_publication_details,
        "meet_notes": account_meetings,
        "key_milestones": account_milestones,
    }


def _analyze_account(snapshot: dict[str, Any], model: str) -> dict[str, Any]:
    system = (
        "Eres un director senior de estrategia reputacional de Blackwell. "
        "Debes diagnosticar el estado de una cuenta usando solo la evidencia provista. "
        "No inventes datos. Responde solo JSON valido."
    )
    prompt = f"""
{METHODOLOGY_BRIEF}

Datos de la cuenta:
{json.dumps(snapshot, ensure_ascii=False, default=str)[:28000]}

Genera un diagnostico diario con esta estructura JSON exacta:
{{
  "overall_status": "estable|atencion|riesgo|crisis",
  "summary": "parrafo ejecutivo corto de maximo 90 palabras",
  "methodology_bullets": [
    {{
      "methodology": "Blackwell R3|Chris Lehane|Agente IA Crisis Blackwell",
      "dimension": "Baseline|Bearing|Blueprint|Build|Balance|Rapid response|Contranarrativa|Nivel 0-4|Escenario|Otra",
      "status": "positivo|neutral|alerta|no_aplica",
      "bullet": "hallazgo accionable en una frase",
      "why": "por que esta metodologia aplica a la evidencia"
    }}
  ],
  "recommended_actions": [
    {{
      "priority": "alta|media|baja",
      "owner": "Blackwell|Cliente|Compartido",
      "action": "accion concreta",
      "methodology": "metodologia que justifica la accion"
    }}
  ]
}}

Reglas:
- Incluye bullets separados por metodologia.
- Blackwell R3 siempre debe aparecer.
- Agente IA Crisis siempre debe aparecer con nivel 0-4, aunque sea Nivel 0.
- Chris Lehane solo debe activarse si hay adversario, narrativa negativa, conflicto o crisis; si no aplica, incluye un bullet status no_aplica explicando por que.
- Cita el por que desde evidencia: WhatsApp, tareas, publicaciones, Meet, hitos historicos (key_milestones) o score.
- Maximo 9 bullets y maximo 5 acciones.
"""
    text = _openrouter_chat_completion(model, system, prompt, 2500)
    return _parse_json(text)


def _row_from_result(account: dict[str, Any], target_date: date, snapshot: dict[str, Any], result: dict[str, Any], model: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "account_id": account["account_id"],
        "account_name": account["account_name"],
        "analysis_date": target_date.isoformat(),
        "overall_status": str(result.get("overall_status") or "neutral"),
        "summary": str(result.get("summary") or ""),
        "methodology_bullets": _list_or_empty(result.get("methodology_bullets")),
        "recommended_actions": _list_or_empty(result.get("recommended_actions")),
        "input_snapshot": _compact_snapshot(snapshot),
        "model": model,
        "analyzed_at": now,
        "updated_at": now,
    }


def _compact_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "analysis_date": snapshot.get("analysis_date"),
        "groups": snapshot.get("groups"),
        "wa_score": snapshot.get("wa_score"),
        "wa_today_count": len(snapshot.get("wa_today") or []),
        "wa_recent_history": snapshot.get("wa_recent_history"),
        "task_count": len(snapshot.get("tasks") or []),
        "publication_quality_scores": snapshot.get("publication_quality_scores"),
        "publication_count": len(snapshot.get("publication_quality_details") or []),
        "meet_count": len(snapshot.get("meet_notes") or []),
        "milestone_count": len(snapshot.get("key_milestones") or []),
    }


def _fetch_all(sb: Any, table: str, columns: str) -> list[dict[str, Any]]:
    try:
        return sb.table(table).select(columns).limit(1000).execute().data or []
    except Exception as exc:
        logger.warning("Could not read %s: %s", table, exc)
        return []


def _fetch_optional(sb: Any, table: str, columns: str) -> list[dict[str, Any]]:
    return _fetch_all(sb, table, columns)


def _contains_account(row: dict[str, Any], name: str) -> bool:
    blob = json.dumps(row, ensure_ascii=False, default=str)
    return _key(name) in _key(blob)


def _key(value: Any) -> str:
    import unicodedata
    import re

    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _openrouter_chat_completion(model: str, system: str, prompt: str, max_tokens: int) -> str:
    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "https://github.com/BrandonBlackwell-ui/Sem-foro"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Blackwell Semaforo"),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter request failed: {exc.code} {detail[:500]}") from exc

    content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def _parse_json(text: str) -> dict[str, Any]:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.strip("`")
        clean = clean.removeprefix("json").strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        start = clean.find("{")
        end = clean.rfind("}")
        if start >= 0 and end > start:
            return json.loads(clean[start : end + 1])
        raise


if __name__ == "__main__":
    main()
