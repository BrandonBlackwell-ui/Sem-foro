"""
claude_analyzer.py — Análisis narrativo de cuentas con Claude API.

Solo se llama cuando hay cuentas con cambios reales detectados por el delta.
Usa claude-haiku (el más barato) para análisis por cuenta y claude-sonnet
para el executive briefing del portafolio completo.

Escribe / actualiza data/drive_intelligence.js con:
  - accounts[].account_summary  (narrativa, riesgo, acción recomendada)
  - cross_account_findings      (hallazgos transversales)
  - executive_briefing          (resumen ejecutivo del portafolio)
  - coverage_summary            (cobertura del análisis)
"""
from __future__ import annotations

import json
import logging
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import os

import anthropic
from anthropic import APIStatusError

import drive_content
import wa_parser
import wa_supabase
from config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    DATA_DIR,
    DRIVE_INTELLIGENCE_JS,
)

logger = logging.getLogger(__name__)

# Modelo caro solo para el briefing ejecutivo — cambiado a Haiku porque el briefing
# es solo síntesis de texto, no requiere visión ni razonamiento complejo.
SONNET_MODEL = os.getenv("BRIEFING_MODEL", "claude-haiku-4-5")
# Modelo para el análisis POR CUENTA.
ACCOUNT_MODEL = os.getenv("ACCOUNT_ANALYSIS_MODEL", "claude-haiku-4-5")
# Pausa base entre llamadas para no chocar con rate limits
RATE_LIMIT_SLEEP = 1.0
# Máximo de batches (pasadas) por cuenta en el análisis multipasada.
# Cap = 2: primer batch lee contratos + archivos clave; segundo batch lee el resto.
# Sube a 3 si necesitas leer más archivos a cambio de mayor costo.
MAX_BATCHES_PER_ACCOUNT = int(os.getenv("MAX_BATCHES_PER_ACCOUNT", "3"))

# Etiquetas que indican una cuenta NO ACTIVA — se salta el análisis profundo.
INACTIVE_LABELS = {
    "proyecto concluido", "terminación anticipada", "terminacion anticipada",
    "terminanción anticipada", "pausa", "histórico", "historico",
    "proyecto pausado", "detenido", "evento único", "evento unico",
    "leadsales", "concluido",
}

# ── Control de rate limit (Input Tokens Per Minute) ──────────────────────────
# Tier 1: Sonnet 30k ITPM, Haiku 50k ITPM. Un request con muchos PDFs puede
# superar el ITPM y entonces NUNCA pasa (429 permanente). Por eso:
#   1) recortamos el payload de cada cuenta para que quepa bajo un presupuesto, y
#   2) marcamos el ritmo entre llamadas para no exceder el ITPM/min acumulado.
# Ambos son configurables por env para cuando el cliente suba de tier.
ANTHROPIC_ITPM = int(os.getenv("ANTHROPIC_ITPM", "50000"))
# Presupuesto de tokens de entrada por request.
# Subimos a 88% del ITPM para que quepan más archivos sin superar el rate limit.
# El pacing automático se encarga de esperar lo necesario entre llamadas.
MAX_INPUT_TOKENS = int(os.getenv("MAX_INPUT_TOKENS", str(int(ANTHROPIC_ITPM * 0.88))))

# ── Política de reintentos para errores 429/529 ───────────────────────────────
# Intentos máximos por llamada (incluyendo el primero)
MAX_RETRIES = 6
# Espera base en segundos — se duplica con cada intento (backoff exponencial)
RETRY_BASE_SLEEP = 10  # 10s, 20s, 40s, 80s, 160s, 320s

# ── Precios por millón de tokens (USD) ───────────────────────────────────────
# Fuente: https://www.anthropic.com/pricing (actualizar si cambian)
PRICING: dict[str, dict[str, float]] = {
    "claude-haiku-4-5":   {"input": 0.80,  "output": 4.00},
    "claude-haiku-3-5":   {"input": 0.80,  "output": 4.00},
    "claude-sonnet-4-5":  {"input": 3.00,  "output": 15.00},
    "claude-opus-4-5":    {"input": 15.00, "output": 75.00},
}

def _price(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calcula el costo en USD para una llamada."""
    rates = PRICING.get(model, PRICING["claude-haiku-4-5"])
    return (input_tokens / 1_000_000 * rates["input"]
            + output_tokens / 1_000_000 * rates["output"])


# ── Tool Use schema — garantiza que Claude retorne JSON válido siempre ────────
# Con tool_choice forzado, Claude DEBE usar este tool. Nunca retorna texto libre
# ni JSON inválido. Elimina el fallback de parseo.
ACCOUNT_ANALYSIS_TOOL: dict = {
    "name": "report_account_analysis",
    "description": (
        "Reporta el análisis estructurado y profesional de una cuenta de PR. "
        "Llena TODOS los campos con base en los archivos leídos y el dossier previo."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "project_purpose": {
                "type": "string",
                "description": "1 frase: para qué contrató el cliente a Blackwell y qué objetivo central perseguimos."
            },
            "scope_of_service": {
                "type": "array", "items": {"type": "string"},
                "description": "Lista de servicios concretos que Blackwell entrega a este cliente."
            },
            "client_promises": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "promise": {"type": "string"},
                        "cadence": {"type": "string", "enum": ["mensual","semanal","quincenal","evento","único","continuo","null"]},
                        "status": {"type": "string", "enum": ["cumplido","en_proceso","pendiente","en_riesgo"]}
                    },
                    "required": ["promise","cadence","status"]
                },
                "description": "Cada compromiso concreto que Blackwell hizo al cliente, con su estado actual."
            },
            "action_plan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "step": {"type": "string"},
                        "status": {"type": "string", "enum": ["hecho","en_proceso","pendiente"]},
                        "owner": {"type": ["string","null"]},
                        "due": {"type": ["string","null"]}
                    },
                    "required": ["step","status"]
                },
                "description": "Pasos del plan de trabajo con estado de avance."
            },
            "current_status": {
                "type": "string",
                "description": "1-2 frases muy concretas de en qué punto va el proyecto HOY."
            },
            "fulfilled": {
                "type": "array", "items": {"type": "string"},
                "description": "Bullets de lo YA cumplido con evidencia (archivo/fecha)."
            },
            "pending": {
                "type": "array", "items": {"type": "string"},
                "description": "Bullets de lo que FALTA o está vencido."
            },
            "risks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "risk": {"type": "string"},
                        "severity": {"type": "string", "enum": ["alta","media","baja"]}
                    },
                    "required": ["risk","severity"]
                },
                "description": "Riesgos detectados con nivel de severidad."
            },
            "opportunities": {
                "type": "array", "items": {"type": "string"},
                "description": "Oportunidades accionables de PR o negocio detectadas."
            },
            "urgent_actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string"},
                        "owner": {"type": ["string","null"]},
                        "due": {"type": ["string","null"]}
                    },
                    "required": ["action"]
                },
                "description": "Acciones concretas para esta semana con responsable y fecha."
            },
            "strategic_recommendations": {
                "type": "array", "items": {"type": "string"},
                "description": "Recomendaciones estratégicas de mediano plazo, accionables."
            },
            "per_file_notes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "file": {"type": "string"},
                        "folder": {"type": "string"},
                        "finding": {"type": "string"}
                    },
                    "required": ["file","folder","finding"]
                },
                "description": "Una nota por CADA archivo leído: qué aporta en 1 frase concreta."
            },
            "key_facts": {
                "type": "array", "items": {"type": "string"},
                "description": "Datos duros puntuales con número/fecha/nombre leídos de los archivos."
            },
            "content_summary": {
                "type": "string",
                "description": "2-3 frases ejecutivas del estado actual y lo más importante."
            },
            "notes": {
                "type": ["string","null"],
                "description": "Contexto o matices que no caben en otra sección. null si no aplica."
            },
            "pq_assessment": {
                "type": "object",
                "properties": {
                    "placements": {"type": ["integer","null"]},
                    "tier_mix": {"type": ["string","null"]},
                    "quality_narrative": {"type": ["string","null"]},
                    "result_vs_objective": {"type": ["string","null"]},
                    "score_estimate": {"type": ["integer","null"]}
                }
            },
            "sc_signals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {"type": ["string","null"]},
                        "type": {"type": "string", "enum": ["positive","negative"]},
                        "signal": {"type": "string", "enum": ["approval","praise","scope_expand","referral","complaint","no_response","no_show"]},
                        "note": {"type": ["string","null"]},
                        "source": {"type": ["string","null"]}
                    },
                    "required": ["type","signal"]
                }
            },
            "co_assessment": {
                "type": "object",
                "properties": {
                    "committed": {"type": ["integer","null"]},
                    "delivered": {"type": ["integer","null"]},
                    "on_time": {"type": ["integer","null"]},
                    "late": {"type": ["integer","null"]},
                    "missed": {"type": ["integer","null"]},
                    "note": {"type": ["string","null"]}
                }
            },
            "media_reconciliation": {
                "type": "object",
                "properties": {
                    "placements": {"type": ["integer","null"]},
                    "reports": {"type": ["integer","null"]},
                    "gap": {"type": ["string","null"]}
                }
            },
            "business_risk": {"type": ["string","null"], "description": "El riesgo MÁS grave en 1 frase para liderazgo."},
            "opportunity": {"type": ["string","null"], "description": "La oportunidad MÁS relevante en 1 frase para liderazgo."},
            "recommended_action": {"type": ["string","null"], "description": "La acción MÁS urgente en 1 frase para liderazgo."},
            "score_adjustment_recommendation": {
                "type": "object",
                "properties": {
                    "co_delta": {"type": "integer"},
                    "pq_delta": {"type": "integer"},
                    "sc_delta": {"type": "integer"},
                    "reason": {"type": ["string","null"]}
                },
                "required": ["co_delta","pq_delta","sc_delta"]
            },
            "monday_ticket": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": ["urgente","prioridad","normal"]},
                    "trigger": {"type": ["string","null"]}
                },
                "required": ["tipo"]
            }
        },
        "required": [
            "project_purpose","content_summary","current_status",
            "client_promises","fulfilled","pending",
            "urgent_actions","strategic_recommendations","per_file_notes"
        ]
    }
}


def _call_with_retry(
    client: anthropic.Anthropic,
    *,
    estimated_input_tokens: int | None = None,
    **kwargs,
) -> Any:
    """
    Llama a client.messages.create con reintentos para 429 (rate limit)
    y 529 (overloaded). Usa backoff exponencial con jitter.

    Pasa `estimated_input_tokens` (del count_tokens previo) para el throttle ITPM.

    Intentos: hasta MAX_RETRIES veces.
    Esperas:  10s, 20s, 40s, 80s, 160s (+ jitter aleatorio de ±2s).
    """
    budget = estimated_input_tokens or 5_000

    for attempt in range(1, MAX_RETRIES + 1):
        _itpm_tracker.wait_for_capacity(budget)
        try:
            result = client.messages.create(**kwargs)
            actual = getattr(getattr(result, "usage", None), "input_tokens", None) or budget
            _itpm_tracker.record(actual)
            return result
        except APIStatusError as e:
            if e.status_code in (429, 529) and attempt < MAX_RETRIES:
                wait = RETRY_BASE_SLEEP * (2 ** (attempt - 1)) + random.uniform(-2, 2)
                wait = max(wait, 5)  # mínimo 5s
                logger.warning(
                    "    Claude %d (intento %d/%d) — esperando %.0fs y reintentando...",
                    e.status_code, attempt, MAX_RETRIES, wait,
                )
                time.sleep(wait)
            else:
                raise


class _UsageTracker:
    """Acumula tokens y costo a través de todas las llamadas del análisis."""
    def __init__(self) -> None:
        self.calls: int = 0
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.cost_usd: float = 0.0
        self.by_model: dict[str, dict] = {}

    def add(self, model: str, usage: Any) -> None:
        inp = getattr(usage, "input_tokens", 0) or 0
        out = getattr(usage, "output_tokens", 0) or 0
        cost = _price(model, inp, out)
        self.calls += 1
        self.input_tokens += inp
        self.output_tokens += out
        self.cost_usd += cost
        if model not in self.by_model:
            self.by_model[model] = {"calls": 0, "input": 0, "output": 0, "cost": 0.0}
        self.by_model[model]["calls"] += 1
        self.by_model[model]["input"] += inp
        self.by_model[model]["output"] += out
        self.by_model[model]["cost"] += cost

    def log_summary(self) -> None:
        logger.info("=" * 60)
        logger.info("  RESUMEN DE USO — Claude API")
        logger.info("=" * 60)
        logger.info("  Llamadas totales : %d", self.calls)
        logger.info("  Tokens entrada   : %s", f"{self.input_tokens:,}")
        logger.info("  Tokens salida    : %s", f"{self.output_tokens:,}")
        logger.info("  Tokens totales   : %s", f"{self.input_tokens + self.output_tokens:,}")
        logger.info("  Costo estimado   : $%.4f USD (~$%.2f MXN)",
                    self.cost_usd, self.cost_usd * 17.5)
        if len(self.by_model) > 1:
            logger.info("  Desglose por modelo:")
            for model, m in self.by_model.items():
                logger.info("    %-22s  %2d calls  $%.4f USD", model, m["calls"], m["cost"])
        logger.info("=" * 60)


# Instancia global por ejecución
_tracker = _UsageTracker()


# ─────────────────────────────────────────────────────────────────────────────
# Entry point público
# ─────────────────────────────────────────────────────────────────────────────

def run_analysis(
    account_numbers_with_changes: set[str],
    all_accounts: list[dict],
    delta_files: list[dict],
    is_baseline: bool = False,
    drive_service=None,
) -> None:
    """
    Analiza con Claude las cuentas con cambios y actualiza drive_intelligence.js.

    Args:
        account_numbers_with_changes: Números de cuenta que tienen cambios.
        all_accounts: Lista completa de cuentas del snapshot actual.
        delta_files: Archivos detectados en la ventana del delta.
        is_baseline: True si es un crawl completo (analiza todas las cuentas).
        drive_service: Servicio autenticado de Drive. Si se provee, Claude LEE el
            contenido real de los archivos. Si es None, cae a análisis de metadata.
    """
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY no configurada. Saltando análisis Claude.")
        return

    # Resetear tracker para esta ejecución
    global _tracker
    _tracker = _UsageTracker()

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    files_api = drive_service.files() if drive_service is not None else None
    if files_api is None:
        logger.warning(
            "Sin servicio de Drive: el análisis usará solo metadata (no leerá archivos)."
        )

    # Cargar drive_intelligence.js existente (para no perder análisis de cuentas sin cambios)
    existing_di = _load_existing_drive_intelligence()
    existing_by_number: dict[str, dict] = {
        a.get("number", a.get("account_id", "")): a
        for a in existing_di.get("accounts", [])
    }

    # Determinar qué cuentas analizar
    if is_baseline:
        accounts_to_analyze = all_accounts
        logger.info("Modo baseline: analizando %d cuentas con Claude", len(accounts_to_analyze))
    else:
        accounts_to_analyze = [
            a for a in all_accounts if a.get("number") in account_numbers_with_changes
        ]
        logger.info(
            "Analizando %d cuentas con cambios (de %d totales)",
            len(accounts_to_analyze), len(all_accounts),
        )

    # Separar activas de inactivas para optimizar costo
    def _is_inactive(account: dict) -> bool:
        title = (account.get("folderTitle") or "").lower()
        status = (account.get("derivedStatus") or "").lower()
        if any(label in title for label in INACTIVE_LABELS):
            return True
        if status in ("concluded", "terminated_early", "paused", "historical",
                      "event_single", "terminated"):
            return True
        return False

    active_accounts = [a for a in accounts_to_analyze if not _is_inactive(a)]
    inactive_accounts = [a for a in accounts_to_analyze if _is_inactive(a)]

    # Estimación de costo antes de arrancar
    est_active = len(active_accounts) * MAX_BATCHES_PER_ACCOUNT * 40_000  # tokens/batch aprox
    est_inactive = len(inactive_accounts) * 8_000                          # análisis ligero
    est_total_m = (est_active + est_inactive) / 1_000_000
    est_cost_usd = est_total_m * PRICING.get(ACCOUNT_MODEL, PRICING["claude-haiku-4-5"])["input"]
    est_cost_usd += (len(active_accounts) * MAX_BATCHES_PER_ACCOUNT + len(inactive_accounts)) * 4_000 / 1_000_000 * PRICING.get(ACCOUNT_MODEL, PRICING["claude-haiku-4-5"])["output"]
    logger.info(
        "  Cuentas activas: %d (hasta %d batches c/u) | Inactivas/ligeras: %d | Costo estimado: ~$%.2f USD",
        len(active_accounts), MAX_BATCHES_PER_ACCOUNT, len(inactive_accounts), est_cost_usd,
    )

    # ── Análisis por cuenta ──────────────────────────────────────────────────
    analyzed: list[dict] = []
    failed: list[str] = []
    consecutive_errors = 0

    for i, account in enumerate(accounts_to_analyze):
        number = account.get("number", "?")
        title = account.get("folderTitle", number)
        is_inactive = _is_inactive(account)
        label = "LIGERO" if is_inactive else f"activa, máx {MAX_BATCHES_PER_ACCOUNT} batches"
        logger.info("  [%d/%d] Analizando %s... (%s)", i + 1, len(accounts_to_analyze), title, label)

        # Si hubo errores consecutivos, esperar más antes de seguir
        if consecutive_errors >= 2:
            extra_wait = min(30 * consecutive_errors, 120)
            logger.warning(
                "    %d errores seguidos — esperando %ds extra antes de continuar...",
                consecutive_errors, extra_wait,
            )
            time.sleep(extra_wait)

        try:
            prev = existing_by_number.get(number)
            account_analysis = _analyze_account(
                client, account, delta_files, files_api, prev,
                lightweight=_is_inactive(account),
            )
            analyzed.append(account_analysis)
            consecutive_errors = 0  # resetear contador al tener éxito
            if i < len(accounts_to_analyze) - 1:
                time.sleep(RATE_LIMIT_SLEEP)
        except Exception as e:
            logger.error("    Error analizando %s: %s", title, e)
            failed.append(number)
            consecutive_errors += 1
            # Conservar análisis anterior si existe
            if number in existing_by_number:
                analyzed.append(existing_by_number[number])

    # Mergeamos: cuentas analizadas + cuentas sin cambios (conservan análisis anterior)
    analyzed_numbers = {a.get("number") for a in analyzed}
    for number, prev in existing_by_number.items():
        if number not in analyzed_numbers:
            analyzed.append(prev)

    # ── Executive briefing del portafolio ────────────────────────────────────
    executive_briefing = ""
    cross_account_findings: list[Any] = []

    if analyzed:
        try:
            # Sonnet has 30k ITPM on Tier 1 — wait a full minute before the
            # briefing call so the bucket is fresh after account-level Haiku calls.
            logger.info("  Esperando 65s antes del briefing para refrescar ITPM de Sonnet...")
            time.sleep(65)
            executive_briefing, cross_account_findings = _generate_portfolio_briefing(
                client, analyzed, all_accounts
            )
        except Exception as e:
            logger.error("Error generando executive briefing: %s", e)

    # ── Reconciliación de medios (placements vs reportes) a nivel portafolio ──
    media_reconciliation = _aggregate_media_reconciliation(analyzed)

    # ── Armar y escribir drive_intelligence.js ───────────────────────────────
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    di = {
        "generated_at": now,
        "schema_version": "4.2-content",
        "is_baseline": is_baseline,
        "accounts": analyzed,
        "cross_account_findings": cross_account_findings,
        "media_reconciliation": media_reconciliation,
        "coverage_summary": {
            "total_accounts": len(all_accounts),
            "analyzed_accounts": len(accounts_to_analyze),
            "accounts_missing_baseline": failed,
        },
        "executive_briefing": executive_briefing,
    }

    _write_drive_intelligence(di)
    logger.info(
        "drive_intelligence.js actualizado: %d cuentas analizadas, %d con error",
        len(analyzed), len(failed),
    )
    _tracker.log_summary()


# ─────────────────────────────────────────────────────────────────────────────
# Análisis por cuenta
# ─────────────────────────────────────────────────────────────────────────────

def _build_prev_dossier_ctx(previous: dict | None) -> str:
    """
    Condensa el dossier (account_summary) de la corrida anterior en texto compacto
    para dárselo a Claude como contexto persistente. Devuelve "" si no hay nada útil.
    """
    if not previous:
        return ""
    summary = previous.get("account_summary") or {}
    if not isinstance(summary, dict) or not summary:
        return ""

    parts: list[str] = []
    purpose = summary.get("project_purpose")
    if isinstance(purpose, str) and purpose.strip():
        parts.append(f"  Propósito: {purpose.strip()}")

    promises = summary.get("client_promises") or summary.get("commitments")
    if isinstance(promises, list) and promises:
        lines = []
        for p in promises[:10]:
            if isinstance(p, dict):
                desc = p.get("promise") or p.get("description") or ""
                st = p.get("status")
                lines.append(f"    · {desc}" + (f" [{st}]" if st else ""))
            elif isinstance(p, str):
                lines.append(f"    · {p}")
        if lines:
            parts.append("  Lo que prometimos:\n" + "\n".join(lines))

    for key, label in (("fulfilled", "Ya cumplido"), ("pending", "Pendiente")):
        vals = summary.get(key)
        if isinstance(vals, list) and vals:
            lines = [f"    · {v}" for v in vals[:8] if isinstance(v, str)]
            if lines:
                parts.append(f"  {label}:\n" + "\n".join(lines))

    cs = summary.get("content_summary")
    if isinstance(cs, str) and cs.strip():
        parts.append(f"  Estado conocido: {cs.strip()[:400]}")

    analyzed_at = previous.get("analyzed_at")
    if not parts:
        return ""
    header = f"\nDOSSIER PREVIO (lo que ya sabíamos de esta cuenta"
    header += f", analizado {analyzed_at[:10]})" if isinstance(analyzed_at, str) else ")"
    header += " — ACTUALÍZALO con lo nuevo, no empieces de cero:\n"
    return header + "\n".join(parts) + "\n"


def _analyze_account(
    client: anthropic.Anthropic,
    account: dict,
    delta_files: list[dict],
    files_api=None,
    previous: dict | None = None,
    lightweight: bool = False,
) -> dict:
    """
    Genera el análisis de una cuenta.

    lightweight=True → para cuentas inactivas (concluidas/pausadas): lee solo los
    archivos más recientes en un único batch con un prompt simplificado.
    Cuesta ~3-5× menos que el análisis completo de una cuenta activa.

    Si `previous` trae el dossier anterior, se le pasa a Claude como contexto
    persistente para actualizar en vez de empezar de cero.
    """

    number = account.get("number", "?")
    title = (account.get("folderTitle") or "").replace(f"{number}.", "").split("/")[0].strip()
    status = account.get("derivedStatus", "active")
    subfolder_activity = account.get("subfolderActivity") or {}
    last_activity = account.get("lastActivity", "desconocida")
    latest_deliverable = account.get("latestDeliverable") or {}
    drive_files = account.get("driveFiles") or []

    # ── Mapa estructural de carpetas (se conserva como complemento) ──────────
    subfolder_lines = []
    for folder_name, data in subfolder_activity.items():
        if not isinstance(data, dict):
            continue
        fc = data.get("fileCount")
        lm = (data.get("latestModified") or "")[:10]
        lf = data.get("latestFile") or ""
        subfolder_lines.append(
            f"  - {folder_name}: {fc} archivo(s), último: {lm}"
            + (f" · {lf[:60]}" if lf else "")
        )
    subfolder_ctx = "\n".join(subfolder_lines) if subfolder_lines else "  (sin datos de subfolders)"

    # ── Inventario completo de todos los archivos por subfolder ──────────────
    # El AI ve TODOS los nombres aunque no pueda leer su contenido.
    # Esto es clave para que pueda determinar si el checklist está verde.
    all_files_by_sub: dict[str, list[str]] = {}
    for f in drive_files:
        sub = f.get("subfolderName") or f.get("subfolder", "?")
        all_files_by_sub.setdefault(sub, []).append(f.get("title", "?"))
    all_files_ctx_lines = []
    for sub_name, titles in all_files_by_sub.items():
        all_files_ctx_lines.append(f"  [{sub_name}]")
        for t in sorted(titles):
            all_files_ctx_lines.append(f"    · {t[:80]}")
    all_files_ctx = (
        "\n\nINVENTARIO COMPLETO DE ARCHIVOS EN DRIVE (todos, leídos o no):\n"
        + ("\n".join(all_files_ctx_lines) or "  (vacío)")
    )

    last_del_ctx = ""
    if latest_deliverable.get("modifiedTime"):
        last_del_ctx = f"\nÚltimo entregable: {latest_deliverable.get('title', '?')} ({latest_deliverable['modifiedTime'][:10]})"

    # ── Cargar watermark de WhatsApp para lectura incremental ────────────────
    # Prioridad: Supabase (compartido entre corridas en la nube) → wa_watermarks.json (local)
    if wa_supabase.is_available():
        _acc_wm = wa_supabase.get_watermark(number)
        _wm_source = "Supabase"
    else:
        _wa_watermarks = wa_parser.load_watermarks(DATA_DIR)
        _acc_wm = _wa_watermarks.get(number, {})
        _wm_source = "archivo local"

    wa_context_for_build: dict | None = {
        "watermark_iso": _acc_wm.get("last_ts"),
        "rolling_summary": _acc_wm.get("rolling_summary"),
    }
    logger.info(
        "    WA watermark cuenta %s [%s]: %s",
        number,
        _wm_source,
        _acc_wm.get("last_ts") or "ninguno (primera lectura)",
    )

    # ── Descargar y leer el contenido real de los archivos ───────────────────
    units: list[dict] = []
    skipped_notes: list[str] = []
    latest_wa_ts: str | None = None
    if files_api is not None and drive_files:
        selected = drive_content.select_files_for_analysis(drive_files)
        units, skipped_notes, latest_wa_ts = drive_content.build_content_blocks(
            files_api,
            selected,
            wa_context=wa_context_for_build,
        )
        logger.info(
            "    Empacados %d/%d archivos (%d omitidos)",
            len(units), len(selected), len(skipped_notes),
        )

        # GUARDIA: si seleccionamos archivos pero NO pudimos leer NINGUNO
        # (típicamente caída de red a mitad de corrida), no tiene sentido
        # analizar — sobrescribiríamos un dossier bueno con un fallback vacío.
        # Conservamos el análisis anterior intacto.
        if selected and not units and previous and previous.get("account_summary"):
            logger.warning(
                "    0/%d archivos legibles para %s (¿red caída?). "
                "Se conserva el análisis anterior sin cambios.",
                len(selected), number,
            )
            return previous

    # ── Actualizar watermark si procesamos un ZIP de WhatsApp ─────────────────
    if latest_wa_ts:
        if wa_supabase.is_available():
            wa_supabase.update_watermark(number, latest_wa_ts)
        else:
            wa_parser.update_watermark(DATA_DIR, number, latest_wa_ts)
        logger.info("    WA watermark actualizado: %s → %s", number, latest_wa_ts)

    skipped_ctx = (
        "\n⚠ Archivos existentes que NO pudieron leerse (formato/tamaño): "
        + "; ".join(skipped_notes[:12])
        + "\n  → Aunque no los lees, SÍ existen en Drive. Considera su presencia para el checklist."
    ) if skipped_notes else ""

    # ── Contexto persistente: dossier de la corrida anterior ─────────────────
    # Le pasamos a Claude lo que ya sabíamos del proyecto para que ACTUALICE el
    # conocimiento en vez de empezar de cero. Esto le da memoria entre corridas.
    prev_dossier_ctx = _build_prev_dossier_ctx(previous)

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Prompt ligero para cuentas inactivas — mucho más corto, menos tokens de output
    if lightweight:
        closing = """Analiza brevemente esta cuenta INACTIVA (concluida/pausada/detenida).
Llama a report_account_analysis con los campos más relevantes.

Esta cuenta ya no tiene trabajo activo. Tu análisis debe ser CORTO:
- project_purpose: qué era el proyecto (1-2 oraciones)
- content_summary: resumen ejecutivo breve de lo que se hizo
- fulfilled: qué se completó (con evidencia)
- pending: qué quedó sin completar al cierre
- per_file_notes: 1 línea por archivo leído
- pq_assessment: calidad del trabajo entregado
- co_assessment: cumplimiento operativo al cierre

NO generes action_plan ni urgent_actions — la cuenta no tiene trabajo activo.
Respuesta concisa, sin relleno.""".strip()
    else:
        closing = """Analiza la cuenta usando la herramienta report_account_analysis.
Llama a esa herramienta con todos los campos completos.

═══════════════════════════════════════════════════════════════════════
CÓMO PIENSA UN ANALISTA SENIOR (sigue este orden mental):
═══════════════════════════════════════════════════════════════════════

PASO 1 — ENTENDER EL PROYECTO (contrato / plan / propuesta):
Lee primero el contrato (carpeta 01) y cualquier plan de trabajo, propuesta o
brief. Responde: ¿PARA QUÉ contrató el cliente a Blackwell? ¿Qué problema le
resolvemos? ¿Qué le PROMETIMOS exactamente (entregables, métricas, frecuencia,
plazos, targets de medios)?

PASO 2 — LEER LA EVIDENCIA (todos los archivos):
Para CADA archivo adjunto, una nota de 1 frase concreta: qué es y qué dato/fecha
/nombre/resultado aporta. Nada de relleno. TODOS los archivos, sin excepción.

PASO 3 — COMPARAR PROMESA vs REALIDAD:
Cruza lo prometido (PASO 1) con la evidencia (PASO 2). Marca qué se CUMPLIÓ (con
evidencia: archivo/fecha) y qué está PENDIENTE o vencido. Asigna status a cada
client_promise: cumplido / en_proceso / pendiente / en_riesgo.

PASO 4 — RECOMENDAR COMO PROFESIONAL:
Riesgos (con severidad alta/media/baja), oportunidades, recomendaciones
estratégicas de mediano plazo, y acciones urgentes de esta semana con
responsable y fecha.

═══════════════════════════════════════════════════════════════════════
ESTILO DE REDACCIÓN (CRÍTICO — el cliente debe entenderlo de un vistazo):
═══════════════════════════════════════════════════════════════════════
- BULLETS CORTOS Y CONCRETOS. Una idea por bullet. Máximo ~20 palabras.
- Empieza cada bullet con la acción o el hecho, no con preámbulo.
- NADA de párrafos largos tipo acta. NADA de "se reportó que en la reunión...".
- Datos duros siempre que existan: medio, fecha, número, nombre, monto.
- Si no hay dato, deja null o lista vacía — NO inventes.
- Escribe en español neutro, profesional, directo.

Reglas críticas para los campos:
- "project_purpose": SIEMPRE se llena — dedúcelo del contrato o del conjunto de archivos.
- "client_promises": NUNCA vacío si hay contrato o plan; marca status de cada promesa.
- "per_file_notes": UNA entrada por CADA archivo adjunto, sin excepción.
- "fulfilled" / "pending": se derivan de cruzar client_promises con la evidencia.
- "urgent_actions": ≥ 1 si la cuenta está activa y tiene pendientes.
- "strategic_recommendations": ≥ 1 si la cuenta está activa.
- Si recibiste un DOSSIER PREVIO: actualízalo con lo nuevo, conserva lo vigente.
- T1 = medios nacionales de alto impacto · T2 = sectoriales/regionales · T3 = locales."""

    def _assemble(use_units: list[dict], accumulated: dict | None = None,
                  batch_label: str = "") -> tuple[list[dict], list[dict]]:
        """Construye el content multimodal para una pasada (batch)."""
        read = [u["read_file"] for u in use_units]
        read_summary = (
            "\n".join(f"  - [{rf['subfolder']}] {rf['title']} ({rf['kind']})" for rf in read)
            if read else "  (no se pudo leer contenido de archivos en este corte)"
        )
        acc_ctx = ""
        if accumulated:
            # Inyectar el análisis acumulado de pasadas anteriores
            acc_json = json.dumps(accumulated, ensure_ascii=False, indent=2)
            acc_ctx = (
                f"\n\nANÁLISIS ACUMULADO DE PASADAS ANTERIORES — ACTUALIZA ESTE JSON:\n"
                f"```json\n{acc_json[:6000]}\n```\n"
                "Conserva todo lo que sigue vigente. Agrega lo nuevo que encuentres "
                "en ESTOS archivos. No elimines evidencia ya registrada.\n"
            )
        batch_ctx = f"\n{batch_label}\n" if batch_label else ""
        intro = f"""Eres el analista senior del portafolio de relaciones públicas de Blackwell.

Vas a analizar la cuenta **{title} (#{number})** leyendo el CONTENIDO REAL de los
documentos adjuntos (entregables, reportes, transcripciones, contratos, chats).
NO te quedes en la metadata: extrae hechos sustantivos — medios y su tier (T1/T2/T3),
alcances/impactos, voceros, fechas de publicación, acuerdos, montos, estado de firma,
riesgos narrativos o regulatorios, y qué cambió respecto al periodo anterior.

IMPORTANTE — EVIDENCIA VISUAL: varios archivos pueden ser IMÁGENES o PDFs escaneados
(capturas de aprobaciones del cliente, screenshots de WhatsApp, recortes/clippings de
prensa, fotos de publicaciones impresas, gráficas dentro de reportes). Analízalos
VISUALMENTE igual que el texto: describe qué muestran y extrae los datos (medio, fecha,
titular, mensaje del cliente, si es una aprobación o una queja, números de alcance).
Un PDF que sea imagen escaneada NO es "ilegible": léelo con visión.

CUENTA: {title} (#{number})
ESTATUS: {status}
ÚLTIMA ACTIVIDAD: {last_activity}{last_del_ctx}

MAPA DE CARPETAS (estructura, complementario al contenido):
{subfolder_ctx}
{all_files_ctx}
{prev_dossier_ctx}{acc_ctx}
ARCHIVOS QUE SE TE ADJUNTAN AHORA:{batch_ctx}
{read_summary}{skipped_ctx}

A continuación vienen los archivos adjuntos. Léelos con cuidado."""
        content: list[dict] = [{"type": "text", "text": intro}]
        for u in use_units:
            content.extend(u["blocks"])
        content.append({"type": "text", "text": closing})
        return content, read

    def _assemble_for_budget(use_units: list[dict]) -> tuple[list[dict], list[dict]]:
        """Wrapper sin argumentos extra para _fit_units_to_budget."""
        return _assemble(use_units)

    # ── Determinar tamaño de batch midiendo cuántos archivos caben ────────────
    if units:
        sample, _, _ = _fit_units_to_budget(client, ACCOUNT_MODEL, list(units), _assemble_for_budget)
        batch_size = max(1, len(sample))
    else:
        batch_size = 1

    # Dividir todos los archivos en batches del tamaño calculado
    batches = [units[i:i + batch_size] for i in range(0, len(units), batch_size)]
    # Aplicar cap: cuentas inactivas = 1 batch, activas = MAX_BATCHES_PER_ACCOUNT
    max_b = 1 if lightweight else MAX_BATCHES_PER_ACCOUNT
    if len(batches) > max_b:
        logger.info(
            "    Cap de batches: %d → %d (lightweight=%s)",
            len(batches), max_b, lightweight,
        )
        batches = batches[:max_b]
    total_batches = len(batches)

    logger.info(
        "    Multipasada: %d archivo(s) → %d batch(es) de ~%d archivos c/u",
        len(units), total_batches, batch_size,
    )

    # ── Ejecutar cada batch acumulando el análisis ────────────────────────────
    accumulated_analysis: dict | None = None
    all_read_files: list[dict] = []
    total_input_tokens = 0
    raw = ""  # garantizar que raw siempre está definido para el fallback

    for batch_idx, batch_units in enumerate(batches):
        batch_num = batch_idx + 1
        is_last = batch_num == total_batches

        if total_batches > 1:
            if is_last:
                batch_label = f"LOTE FINAL {batch_num}/{total_batches} — consolida TODO en el análisis definitivo."
            else:
                batch_label = (
                    f"LOTE {batch_num}/{total_batches} — quedan {total_batches - batch_num} lote(s) más. "
                    "Actualiza el análisis acumulado con estos archivos; habrá más pasadas."
                )
        else:
            batch_label = ""

        content, read = _assemble(batch_units, accumulated=accumulated_analysis, batch_label=batch_label)
        input_tokens = _count_tokens(client, ACCOUNT_MODEL, content) or 0
        total_input_tokens += input_tokens

        logger.info(
            "    Batch %d/%d: %d archivos (~%s tokens)",
            batch_num, total_batches, len(batch_units),
            f"{input_tokens:,}" if input_tokens else "?",
        )

        response = _call_with_retry(
            client,
            estimated_input_tokens=input_tokens,
            model=ACCOUNT_MODEL,
            max_tokens=6000,
            tools=[ACCOUNT_ANALYSIS_TOOL],
            tool_choice={"type": "tool", "name": "report_account_analysis"},
            messages=[{"role": "user", "content": content}],
        )
        _tracker.add(ACCOUNT_MODEL, response.usage)

        # Extraer resultado del bloque tool_use
        batch_result = None
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "report_account_analysis":
                batch_result = block.input
                break

        if batch_result is None:
            raw = _first_text(response).strip()
            logger.warning("    Batch %d: tool_use block no encontrado — intentando parseo de texto.", batch_num)
            batch_result = _parse_json_lenient(raw)

        if batch_result is not None:
            accumulated_analysis = batch_result
            all_read_files.extend(read)
        else:
            logger.warning("    Batch %d: sin resultado — manteniendo análisis acumulado anterior.", batch_num)

    # ── Usar el análisis acumulado final ──────────────────────────────────────
    analysis = accumulated_analysis
    if analysis is None:
        logger.warning("JSON inválido de Claude para cuenta %s. Usando fallback.", number)
        analysis = {
            "project_purpose": None,
            "content_summary": raw[:300] if raw else "Sin análisis disponible.",
            "client_promises": [],
            "action_plan": [],
            "fulfilled": [],
            "pending": [],
            "risks": [],
            "opportunities": [],
            "urgent_actions": [],
            "strategic_recommendations": [],
            "business_risk": None,
            "opportunity": None,
            "recommended_action": None,
            "score_adjustment_recommendation": {"co_delta": 0, "pq_delta": 0, "sc_delta": 0, "reason": None},
            "monday_ticket": {"tipo": "normal", "trigger": None},
        }

    return {
        "number": number,
        "account_id": number,
        "account_name": title,
        "cadenceType": None,
        "files": all_read_files,
        "files_read_count": len(all_read_files),
        "files_skipped": skipped_notes,
        "account_summary": analysis,
        "analyzed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _first_text(response) -> str:
    """Devuelve el primer bloque de texto de la respuesta de Anthropic."""
    for block in getattr(response, "content", []) or []:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def _parse_json_lenient(raw: str) -> dict | None:
    """
    Intenta parsear JSON tolerando code fences y texto alrededor.
    Devuelve dict o None si es irrecuperable.
    """
    if not raw:
        return None
    text = raw.strip()

    # Quitar code fences ```json ... ```
    if "```" in text:
        parts = text.split("```")
        # Tomar el fragmento más largo que parezca JSON
        candidates = [p[4:] if p.lstrip().startswith("json") else p for p in parts]
        text = max(candidates, key=len).strip()

    # Intento directo
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return _sanitize_summary_fields(result)
        return result
    except json.JSONDecodeError:
        pass

    # Recortar al primer '{' … último '}'
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            result = json.loads(text[start:end + 1])
            if isinstance(result, dict):
                return _sanitize_summary_fields(result)
            return result
        except json.JSONDecodeError:
            return None
    return None


def _sanitize_summary_fields(d: dict) -> dict:
    """
    Detecta y limpia campos de texto que Claude haya puesto como JSON anidado.
    Si un campo string empieza con ```json o con '{', intenta extraer el valor
    real del nivel superior (ej. content_summary dentro de content_summary).
    """
    TEXT_FIELDS = ("content_summary", "project_purpose", "current_status",
                   "business_risk", "recommended_action", "opportunity", "notes")
    for field in TEXT_FIELDS:
        val = d.get(field)
        if not isinstance(val, str):
            continue
        stripped = val.strip()
        # Si empieza con backtick-fence o '{' probablemente es JSON anidado
        if stripped.startswith("```") or stripped.startswith("{"):
            nested = _parse_json_lenient(stripped)
            if isinstance(nested, dict):
                # El verdadero texto estaba adentro del JSON anidado
                if field in nested and isinstance(nested[field], str):
                    d[field] = nested[field]
                # Aprovechar también otros campos del JSON anidado
                for other in TEXT_FIELDS:
                    if other not in d or not d[other]:
                        if other in nested and isinstance(nested[other], str):
                            d[other] = nested[other]
                for extra in ("key_facts", "scope_of_service", "client_promises",
                              "action_plan", "fulfilled", "pending", "risks",
                              "opportunities", "urgent_actions", "strategic_recommendations",
                              "per_file_notes", "opportunity",
                              "pq_assessment", "sc_signals", "co_assessment",
                              "media_reconciliation", "score_adjustment_recommendation",
                              "monday_ticket"):
                    if extra not in d or not d[extra]:
                        if extra in nested:
                            d[extra] = nested[extra]
    return d


def _count_tokens(client: anthropic.Anthropic, model: str, content: list[dict]) -> int | None:
    """Cuenta los tokens de entrada reales del payload (incluye PDFs/imágenes)."""
    try:
        r = client.messages.count_tokens(
            model=model, messages=[{"role": "user", "content": content}]
        )
        return r.input_tokens
    except Exception as e:  # noqa: BLE001
        logger.warning("    count_tokens falló (%s); usando recorte conservador.", type(e).__name__)
        return None


def _fit_units_to_budget(client, model, units, assemble):
    """
    Recorta las unidades de archivos para que el payload quepa bajo MAX_INPUT_TOKENS.

    Un request por encima del ITPM del tier devuelve 429 PERMANENTE (nunca pasa),
    así que medimos los tokens reales y vamos descartando los archivos de menor
    prioridad (los últimos) hasta entrar en presupuesto.

    Returns: (units_finales, content_ensamblado, tokens_estimados).
    """
    content, _ = assemble(units)
    if not units:
        return units, content, _count_tokens(client, model, content) or 0

    tokens = _count_tokens(client, model, content)
    if tokens is None:
        # Sin medición fiable: recorte conservador por número de archivos.
        units = units[:4]
        content, _ = assemble(units)
        return units, content, 0

    iterations = 0
    while units and tokens > MAX_INPUT_TOKENS and iterations < 10:
        iterations += 1
        ratio = tokens / MAX_INPUT_TOKENS
        drop = max(1, int(len(units) * (1 - 1 / ratio)))
        drop = min(drop, len(units))
        dropped = units[len(units) - drop:]
        units = units[: len(units) - drop]
        logger.info(
            "    Payload %s tokens > presupuesto %s — descartando %d archivo(s) de menor prioridad",
            f"{tokens:,}", f"{MAX_INPUT_TOKENS:,}", len(dropped),
        )
        content, _ = assemble(units)
        tokens = _count_tokens(client, model, content) or 0

    return units, content, tokens


def _aggregate_media_reconciliation(analyzed: list[dict]) -> list[dict]:
    """
    Reúne la reconciliación de medios por cuenta (placements vs reportes) para
    que la pestaña Auditoría del dashboard la muestre. Solo incluye cuentas con
    algún dato cuantitativo leído del contenido.
    """
    out: list[dict] = []
    for a in analyzed:
        summary = a.get("account_summary") or {}
        mr = summary.get("media_reconciliation") or {}
        placements = _as_int(mr.get("placements"))
        reports = _as_int(mr.get("reports"))
        gap = mr.get("gap")
        if placements is None and reports is None and not gap:
            continue
        out.append({
            "account": a.get("account_name") or a.get("number"),
            "placements": placements if placements is not None else 0,
            "reports": reports if reports is not None else 0,
            "gap": gap if isinstance(gap, str) else None,
        })
    return out


def _as_int(v) -> int | None:
    try:
        if v is None or isinstance(v, bool):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


class _ItpmTracker:
    """
    Ventana deslizante de 60 segundos que rastrea los tokens consumidos.
    Antes de cada llamada, calcula cuánto tiempo hay que esperar para que la
    suma de tokens en la ventana no supere ANTHROPIC_ITPM.
    """
    def __init__(self) -> None:
        self._entries: list[tuple[float, int]] = []  # (timestamp, tokens)

    def _purge(self, now: float) -> None:
        cutoff = now - 60.0
        self._entries = [(t, tk) for (t, tk) in self._entries if t > cutoff]

    def tokens_in_window(self) -> int:
        self._purge(time.monotonic())
        return sum(tk for _, tk in self._entries)

    def wait_for_capacity(self, tokens: int) -> None:
        """Espera hasta que quepan `tokens` en la ventana de 60s."""
        if tokens <= 0:
            return
        # Un solo request puede superar el ITPM — no hay forma de esperar, hay que enviarlo.
        if tokens > ANTHROPIC_ITPM:
            logger.info(
                "    ITPM note: batch ~%s tokens > límite %s/min — enviando (esperará rate limit si aplica)",
                f"{tokens:,}", f"{ANTHROPIC_ITPM:,}",
            )
            return
        while True:
            now = time.monotonic()
            self._purge(now)
            used = sum(tk for _, tk in self._entries)
            available = ANTHROPIC_ITPM - used
            if tokens <= available:
                return
            if self._entries:
                oldest_time = self._entries[0][0]
                wait_secs = max(0.5, (oldest_time + 60.0) - now + 0.5)
            else:
                return  # ventana vacía pero tokens > available → imposible, salir
            wait_secs = min(wait_secs, 30.0)
            logger.info(
                "    ITPM throttle: %d tokens en ventana / %d límite — esperando %.0fs",
                used, ANTHROPIC_ITPM, wait_secs,
            )
            time.sleep(wait_secs)

    def record(self, tokens: int) -> None:
        """Registra tokens consumidos tras una llamada exitosa."""
        if tokens > 0:
            self._entries.append((time.monotonic(), tokens))


_itpm_tracker = _ItpmTracker()


# ─────────────────────────────────────────────────────────────────────────────
# Executive briefing del portafolio
# ─────────────────────────────────────────────────────────────────────────────

def _generate_portfolio_briefing(
    client: anthropic.Anthropic,
    analyzed_accounts: list[dict],
    all_accounts: list[dict],
) -> tuple[str, list]:
    """Genera el resumen ejecutivo del portafolio y hallazgos transversales."""

    # Resumir el estado de cada cuenta (solo las activas con análisis)
    account_summaries = []
    for a in analyzed_accounts[:30]:  # máximo 30 para no exceder contexto
        summary = a.get("account_summary", {})
        if not summary:
            continue
        risk = summary.get("business_risk") or ""
        action = summary.get("recommended_action") or ""
        line = f"- {a.get('account_name', a.get('number', '?'))}: {(summary.get('content_summary') or '')[:120]}"
        if risk:
            line += f" | RIESGO: {(risk or '')[:80]}"
        if action:
            line += f" | ACCIÓN: {(action or '')[:80]}"
        account_summaries.append(line)

    if not account_summaries:
        return "", []

    context = "\n".join(account_summaries)

    prompt = f"""Eres el director de operaciones de Blackwell. Tienes el estado de {len(analyzed_accounts)} cuentas del portafolio.

ESTADO DEL PORTAFOLIO:
{context}

Genera:
1. Un "executive_briefing" de 3-5 frases: qué está pasando en el portafolio, cuáles son las prioridades de la semana y qué cuentas requieren atención inmediata de liderazgo.
2. Hasta 5 "cross_account_findings": patrones o problemas que afectan a múltiples cuentas.

Responde SOLO con JSON válido:

{{
  "executive_briefing": "Texto de 3-5 frases para Daniel y Esteban.",
  "cross_account_findings": [
    {{
      "title": "Nombre corto del hallazgo",
      "description": "Descripción del patrón observado",
      "severity": "high|medium|low",
      "affected_accounts": ["nombre1", "nombre2"]
    }}
  ]
}}"""

    response = _call_with_retry(
        client,
        model=SONNET_MODEL,
        max_tokens=2500,
        messages=[{"role": "user", "content": prompt}],
    )
    _tracker.add(SONNET_MODEL, response.usage)

    raw = _first_text(response).strip()
    result = _parse_json_lenient(raw)
    if result is None:
        logger.warning("JSON inválido en portfolio briefing.")
        return raw[:500], []
    return result.get("executive_briefing", ""), result.get("cross_account_findings", [])


# ─────────────────────────────────────────────────────────────────────────────
# I/O de drive_intelligence.js
# ─────────────────────────────────────────────────────────────────────────────

def _load_existing_drive_intelligence() -> dict:
    """Carga el drive_intelligence.js existente para hacer merge (no pierde datos de cuentas sin cambios)."""
    if not DRIVE_INTELLIGENCE_JS.exists():
        return {"accounts": []}
    try:
        text = DRIVE_INTELLIGENCE_JS.read_text(encoding="utf-8")
        # Quitar el wrapper JS: "window.DRIVE_INTELLIGENCE = {...};"
        text = text.strip()
        if text.startswith("window.DRIVE_INTELLIGENCE"):
            text = text.split("=", 1)[1].strip().rstrip(";")
        return json.loads(text)
    except Exception as e:
        logger.warning("No se pudo cargar drive_intelligence.js existente: %s", e)
        return {"accounts": []}


def _write_drive_intelligence(di: dict) -> None:
    """Escribe drive_intelligence.js con el wrapper window.DRIVE_INTELLIGENCE = {...}
    y también drive_intelligence.json por cuenta en data/accounts/{folder}/"""
    import re as _re

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_str = json.dumps(di, ensure_ascii=False, indent=2)
    js_content = f"window.DRIVE_INTELLIGENCE = {json_str};\n"
    DRIVE_INTELLIGENCE_JS.write_text(js_content, encoding="utf-8")
    logger.info(
        "drive_intelligence.js escrito: %d cuentas · %.1f KB",
        len(di.get("accounts", [])),
        len(js_content) / 1024,
    )

    # Escribir por cuenta en data/accounts/{number}_{name}/drive_intelligence.json
    accounts_dir = DATA_DIR / "accounts"
    written = 0
    for acc in di.get("accounts", []):
        number = acc.get("number", "")
        name_raw = (acc.get("account_name") or "").strip()
        slug = _re.sub(r"[^A-Z0-9]+", "_", name_raw.upper()).strip("_")
        folder_name = f"{number}_{slug}" if slug else number
        folder = accounts_dir / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "drive_intelligence.json").write_text(
            json.dumps(acc, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        written += 1
    logger.info("drive_intelligence.json escrito por cuenta: %d carpetas", written)
