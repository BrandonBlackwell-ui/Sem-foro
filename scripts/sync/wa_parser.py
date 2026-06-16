"""
wa_parser.py — Lectura incremental de exportaciones WhatsApp (_chat.txt).

Parsea el formato estándar de exportación de WhatsApp (iOS/Android, español/inglés).
Filtra mensajes de sistema y retorna solo los mensajes reales posteriores a un
timestamp dado (watermark incremental).

Formato soportado:
  [DD/MM/YY, H:MM:SS a. m.] Autor: Texto
  [DD/MM/YY, H:MM:SS p. m.] Autor: Texto  (con NARROW NO-BREAK SPACE U+202F)

Ahorro de tokens:
  Sin watermark:  55 000 tokens/cuenta/día (chat completo)
  Con watermark:  ~1 000-3 000 tokens/cuenta/día (solo mensajes nuevos)
"""
from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Regex para detectar inicio de un mensaje ──────────────────────────────────
# Acepta variaciones de a.m./p.m. con o sin espacios y con U+202F (narrow no-break space)
_AMPM = r"[aApP]\.?\s*[mM]\."
_TS_PART = r"\[(\d{1,2}/\d{1,2}/\d{2,4}),\s+(\d{1,2}:\d{2}:\d{2}[  \s]*" + _AMPM + r")\]\s+"
MSG_START_RE = re.compile(
    r"^" + _TS_PART + r"(.+?):\s+(.*)",
    re.UNICODE,
)

# ── Indicadores de mensaje de sistema ─────────────────────────────────────────
# WhatsApp antepone U+200E (LTR MARK) o U+202A (LTR EMBEDDING) al texto de sistema.
_SYSTEM_UNICODE_MARKS = ("‎", "‪", "‏", "‫")

# Frases que indican mensaje de sistema en el texto (sin marca unicode a veces)
_SYSTEM_SUBSTRINGS = [
    "creó el grupo", "te añadió", "añadió a", "salió del grupo",
    "fue eliminado", "cambió el asunto", "activó los mensajes temporales",
    "desactivó los mensajes temporales", "cambió la descripción del grupo",
    "cambió la foto del grupo", "eliminó este mensaje", "están cifrados de extremo",
    "eres admin.", "ya no es admin", "cambió el número de teléfono",
    "messages and calls are end-to-end encrypted",
    "this message was deleted", "you were added", "left the group",
    "created group", "added you", "changed the group",
    "se activaron los mensajes temporales", "los mensajes nuevos desaparecerán",
    "haz clic para cambiar esto",
]

# Líneas de apertura del export que no son mensajes
_HEADER_SUBSTRINGS = [
    "los mensajes y las llamadas están cifrados",
    "messages and calls are end-to-end encrypted",
]


# ─────────────────────────────────────────────────────────────────────────────
# Parsing
# ─────────────────────────────────────────────────────────────────────────────

def _parse_ts(date_str: str, time_str: str) -> datetime | None:
    """Convierte las cadenas de fecha y hora de WhatsApp a datetime UTC."""
    # Normalizar: narrow no-break space → espacio, colapsar espacios extra
    time_clean = (
        time_str
        .replace(" ", " ")
        .replace(" ", " ")
        .strip()
    )
    # "7:40:04 p. m." o "7:40:04 p.m." → "7:40:04 PM"
    time_clean = re.sub(r"\bp\.?\s*m\.", "PM", time_clean, flags=re.I)
    time_clean = re.sub(r"\ba\.?\s*m\.", "AM", time_clean, flags=re.I)
    time_clean = re.sub(r"\s+", " ", time_clean).strip()

    date_clean = date_str.strip()

    for fmt in ("%d/%m/%y %I:%M:%S %p", "%d/%m/%Y %I:%M:%S %p"):
        try:
            dt = datetime.strptime(f"{date_clean} {time_clean}", fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _is_system(text: str) -> bool:
    """True si el mensaje es generado por el sistema de WhatsApp (no por una persona)."""
    if not text:
        return True
    if text[0] in _SYSTEM_UNICODE_MARKS:
        return True
    text_lower = text.lower()
    return any(s.lower() in text_lower for s in _SYSTEM_SUBSTRINGS + _HEADER_SUBSTRINGS)


def parse_messages(raw_text: str) -> list[dict]:
    """
    Parsea el contenido de un _chat.txt de WhatsApp.

    Returns list of dicts:
      {
        "ts": datetime | None,
        "ts_iso": str,            # "2026-01-23T07:58:54" o ""
        "author": str,
        "text": str,
        "is_system": bool,
      }
    """
    messages: list[dict] = []
    current: dict | None = None

    for line in raw_text.splitlines():
        m = MSG_START_RE.match(line)
        if m:
            if current is not None:
                messages.append(current)
            date_s, time_s, author, text = m.group(1), m.group(2), m.group(3), m.group(4)
            ts = _parse_ts(date_s, time_s)
            current = {
                "ts": ts,
                "ts_iso": ts.strftime("%Y-%m-%dT%H:%M:%S") if ts else "",
                "author": author.strip(),
                "text": text,
                "is_system": _is_system(text),
            }
        elif current is not None:
            # Continuación de un mensaje multilínea
            current["text"] += "\n" + line

    if current is not None:
        messages.append(current)

    return messages


# ─────────────────────────────────────────────────────────────────────────────
# Filtro incremental
# ─────────────────────────────────────────────────────────────────────────────

def filter_after_watermark(
    messages: list[dict],
    watermark_iso: str | None,
) -> list[dict]:
    """Retorna solo los mensajes POSTERIORES al watermark. Si es None, retorna todos."""
    if not watermark_iso:
        return messages
    try:
        wm_dt = datetime.fromisoformat(watermark_iso).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        logger.warning("wa_parser: watermark inválido '%s', retornando todos", watermark_iso)
        return messages
    return [m for m in messages if m.get("ts") and m["ts"] > wm_dt]


def _format_msgs(messages: list[dict], max_chars: int = 8_000) -> str:
    """Formatea lista de mensajes reales para enviar a Claude."""
    lines = [f"[{m['ts_iso']}] {m['author']}: {m['text']}" for m in messages if not m["is_system"]]
    text = "\n".join(lines)
    if len(text) > max_chars:
        # Truncar por el principio (quedarse con los más recientes)
        text = "…[mensajes anteriores omitidos]\n" + text[-max_chars:]
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Entry point principal: extracción incremental desde bytes de un ZIP
# ─────────────────────────────────────────────────────────────────────────────

def extract_incremental(
    zip_data: bytes,
    watermark_iso: str | None,
    rolling_summary: str | None,
    *,
    context_window: int = 20,
    max_new_chars: int = 8_000,
) -> tuple[str, str | None]:
    """
    Extrae solo los mensajes nuevos de un ZIP de WhatsApp.

    Args:
        zip_data:        bytes del archivo .zip
        watermark_iso:   ISO timestamp del último mensaje ya procesado (o None para el primero)
        rolling_summary: resumen acumulado de corridas anteriores (contexto para Claude)
        context_window:  cuántos mensajes reales anteriores al watermark incluir como contexto
        max_new_chars:   límite de caracteres para los mensajes nuevos

    Returns:
        (text_for_claude, latest_ts_iso)
        - text_for_claude: texto listo para enviar a Haiku
        - latest_ts_iso:   ISO del mensaje más reciente encontrado (para actualizar watermark)
                           None si no se encontró ningún mensaje con timestamp válido
    """
    # ── Descomprimir ──────────────────────────────────────────────────────────
    raw_text = ""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            txt_names = [n for n in zf.namelist() if n.lower().endswith(".txt")]
            if not txt_names:
                return "(zip sin _chat.txt)", None
            # El chat principal suele ser el .txt más grande
            txt_names.sort(key=lambda n: zf.getinfo(n).file_size, reverse=True)
            with zf.open(txt_names[0]) as fh:
                raw_text = fh.read().decode("utf-8", errors="replace")
    except zipfile.BadZipFile:
        return "(archivo zip ilegible)", None

    # ── Parsear ───────────────────────────────────────────────────────────────
    all_messages = parse_messages(raw_text)
    if not all_messages:
        return "(chat sin mensajes parseables)", None

    # Timestamp más reciente del archivo (para actualizar watermark aunque no haya nuevos)
    valid_ts = [m["ts"] for m in all_messages if m.get("ts")]
    latest_ts_iso = max(valid_ts).strftime("%Y-%m-%dT%H:%M:%S") if valid_ts else None

    # ── Separar mensajes nuevos vs historial ──────────────────────────────────
    new_messages = filter_after_watermark(all_messages, watermark_iso)
    real_new = [m for m in new_messages if not m["is_system"]]

    total_real = sum(1 for m in all_messages if not m["is_system"])
    new_real_count = len(real_new)

    # ── Sin mensajes nuevos ───────────────────────────────────────────────────
    if watermark_iso and not real_new:
        ctx = f"\n[Resumen previo: {rolling_summary}]" if rolling_summary else ""
        return (
            f"(Sin mensajes nuevos desde {watermark_iso}. "
            f"Total histórico: {total_real} mensajes reales.{ctx})",
            latest_ts_iso,
        )

    # ── Construir ventana de contexto (mensajes anteriores al watermark) ──────
    prior_real: list[dict] = []
    if watermark_iso and context_window > 0:
        all_real = [m for m in all_messages if not m["is_system"]]
        new_ts_set = {id(m) for m in real_new}
        prior_real = [m for m in all_real if id(m) not in new_ts_set]
        prior_real = prior_real[-context_window:]  # últimos N

    # ── Armar el texto final ──────────────────────────────────────────────────
    sections: list[str] = []

    if rolling_summary:
        sections.append(
            "=== RESUMEN ACUMULADO (historial previo) ===\n" + rolling_summary
        )

    if prior_real:
        ctx_text = _format_msgs(prior_real, max_chars=2_000)
        sections.append(
            f"=== ÚLTIMAS {len(prior_real)} INTERACCIONES ANTES DEL CORTE "
            f"(contexto, no analizar de nuevo) ===\n" + ctx_text
        )

    if watermark_iso:
        sections.append(
            f"=== MENSAJES NUEVOS desde {watermark_iso} "
            f"({new_real_count} de {total_real} totales en el historial) ==="
        )
    else:
        sections.append(f"=== CHAT COMPLETO ({total_real} mensajes reales) ===")

    sections.append(_format_msgs(real_new, max_chars=max_new_chars))

    return "\n\n".join(filter(None, sections)), latest_ts_iso


# ─────────────────────────────────────────────────────────────────────────────
# Persistencia del watermark
# ─────────────────────────────────────────────────────────────────────────────

def load_watermarks(data_dir: Path) -> dict:
    """
    Lee data/wa_watermarks.json.

    Schema por account_number:
      {
        "last_ts": "2026-06-14T09:30:00",   # ISO del último mensaje procesado
        "rolling_summary": "...",             # resumen acumulado (opcional)
        "message_count_total": 1008,          # solo informativo
        "updated_at": "2026-06-15T06:10:00Z"
      }
    """
    path = data_dir / "wa_watermarks.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("wa_parser: no se pudo leer wa_watermarks.json: %s", e)
        return {}


def save_watermarks(data_dir: Path, watermarks: dict) -> None:
    """Escribe data/wa_watermarks.json."""
    path = data_dir / "wa_watermarks.json"
    try:
        path.write_text(json.dumps(watermarks, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.debug("wa_parser: watermarks guardados en %s", path)
    except OSError as e:
        logger.error("wa_parser: no se pudo escribir wa_watermarks.json: %s", e)


def update_watermark(
    data_dir: Path,
    account_number: str,
    latest_ts_iso: str,
    *,
    message_count: int | None = None,
    rolling_summary: str | None = None,
) -> None:
    """Actualiza el watermark de UNA cuenta y guarda el archivo."""
    watermarks = load_watermarks(data_dir)
    entry = watermarks.get(account_number, {})

    entry["last_ts"] = latest_ts_iso
    entry["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if message_count is not None:
        entry["message_count_total"] = message_count
    if rolling_summary is not None:
        entry["rolling_summary"] = rolling_summary

    watermarks[account_number] = entry
    save_watermarks(data_dir, watermarks)
    logger.info(
        "wa_parser: watermark actualizado — cuenta %s → %s",
        account_number, latest_ts_iso,
    )
