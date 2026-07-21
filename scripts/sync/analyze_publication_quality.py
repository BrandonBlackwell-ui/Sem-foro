#!/usr/bin/env python3
"""
Analyze media publication quality (PQ) from Sheet links.

The LLM evaluates editorial quality and narrative focus. Media tier is never
invented by the LLM; it must come from data/publication_quality_config.json.
"""
from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from supabase import create_client

try:
    from scripts.sync.config import DATA_DIR, OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
    from scripts.sync.sync_media_sheet import (
        DEFAULT_GENERAL_GID,
        DEFAULT_SHEET_ID,
        _download_sheet_rows,
        _load_aliases,
        _publication_payloads,
    )
except ModuleNotFoundError:
    import sys

    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT))
    from scripts.sync.config import DATA_DIR, OPENROUTER_API_KEY, OPENROUTER_MODEL, SUPABASE_SERVICE_KEY, SUPABASE_URL
    from scripts.sync.sync_media_sheet import (
        DEFAULT_GENERAL_GID,
        DEFAULT_SHEET_ID,
        _download_sheet_rows,
        _load_aliases,
        _publication_payloads,
    )


logger = logging.getLogger("analyze_publication_quality")


def main() -> None:
    _setup_logging()
    args = _parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is required.")

    config = _load_config()
    publications = _load_publications(args.sheet_id, args.gid)
    publications = _filter_publications(publications, args)
    logger.info("Loaded %d candidate publication(s).", len(publications))

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if args.contract_window:
        windows = _contract_windows(sb)
        before = len(publications)
        publications = _filter_by_contract(publications, windows)
        logger.info(
            "Contract-window filter: %d -> %d publication(s) (solo dentro de la vigencia del contrato).",
            before, len(publications),
        )

    existing_urls = _existing_urls(sb) if not args.force else set()

    analyzed: list[dict[str, Any]] = []
    for publication in publications:
        if len(analyzed) >= args.limit:
            break
        url = str(publication.get("url") or "").strip()
        if not url or (url, str(publication.get("account_id"))) in existing_urls:
            continue
        try:
            row = _analyze_publication(publication, config, args.model)
        except Exception as exc:  # keep the batch moving
            logger.warning("Could not analyze %s: %s", url, exc)
            row = _error_row(publication, args.model, exc, config)
        analyzed.append(row)
        logger.info(
            "Analyzed %s | %s | status=%s score=%s",
            publication.get("media_name"),
            publication.get("sheet_client_name"),
            row.get("status"),
            row.get("pq_score"),
        )

    if args.dry_run:
        logger.info("[dry-run] Would upsert %d analysis row(s).", len(analyzed))
        for row in analyzed[:5]:
            logger.info("[dry-run] %s", json.dumps(row, ensure_ascii=False)[:1000])
        return

    if analyzed:
        _upsert_chunks(sb, "publication_quality_analyses", analyzed, "url,account_id")
    summaries = _summaries_from_rows(sb, analyzed)
    if summaries:
        _upsert_chunks(sb, "publication_quality_scores", summaries, "account_id,period_year,period_month")
    logger.info("Synced %d publication quality row(s) and %d period summary row(s).", len(analyzed), len(summaries))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet-id", default=os.getenv("MEDIA_SHEET_ID", DEFAULT_SHEET_ID))
    parser.add_argument("--gid", default=os.getenv("MEDIA_SHEET_GENERAL_GID", DEFAULT_GENERAL_GID))
    parser.add_argument("--model", default=os.getenv("OPENROUTER_MODEL", OPENROUTER_MODEL))
    parser.add_argument("--account-id")
    parser.add_argument("--period", help="YYYY-MM")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--contract-window",
        action="store_true",
        help="Solo analizar publicaciones cuya fecha caiga dentro de la vigencia del contrato del cliente (drive_account_intel).",
    )
    return parser.parse_args()


# Mapa slug del pipeline de medios -> número de cuenta (carpeta Drive).
# Mismo mapa que dashboard/src/hooks/useAccounts.ts (NUMBER_TO_ID invertido).
SLUG_TO_NUMBER = {
    "turbofin": "01", "maja": "02", "aduanas": "03", "idlayr": "04", "credix": "05",
    "rocha": "06", "apollo": "07", "uldis": "08", "azvi": "09", "jack": "10",
    "futbol": "11", "tello": "12", "cima": "13", "dalinde": "14", "armor": "15",
    "mapelly": "16", "irugami": "17", "stprm": "18", "pujol": "19", "veracruz": "20",
    "nuvoil": "21", "totalplay": "22", "luca": "23", "gicsa": "24", "andy": "25",
    "bernardo": "26", "cuernavaca": "27", "queretaro": "28", "coastoil": "29",
    "erikrubi": "30", "sasil": "31", "cojab": "32", "neza": "33", "supplypay": "34",
    "pepe": "35", "terry": "36", "leadsales": "37", "karpowership": "38",
    "ismerely": "39", "austria": "40", "ifaceltics": "41", "mtvlinkedin": "42",
    "iranguerrero": "43", "lch": "44", "inovamedik": "45", "arrendo": "46",
}


def _contract_windows(sb: Any) -> dict[str, tuple[str | None, str | None]]:
    """Vigencias de contrato por slug de cuenta, desde drive_account_intel."""
    try:
        res = sb.table("drive_account_intel").select("account_number,vigencia_inicio,vigencia_fin").execute()
    except Exception as exc:
        logger.warning("No pude leer drive_account_intel; sin filtro de contrato: %s", exc)
        return {}
    by_number = {str(row.get("account_number")): (row.get("vigencia_inicio"), row.get("vigencia_fin")) for row in (res.data or [])}
    return {slug: by_number[num] for slug, num in SLUG_TO_NUMBER.items() if num in by_number}


def _filter_by_contract(
    publications: list[dict[str, Any]],
    windows: dict[str, tuple[str | None, str | None]],
) -> list[dict[str, Any]]:
    """Deja pasar solo publicaciones dentro de la vigencia del contrato.
    Cuentas sin fechas de contrato conocidas se dejan pasar completas."""
    kept = []
    for row in publications:
        slug = str(row.get("account_id") or "")
        start, end = windows.get(slug, (None, None))
        if not start:
            kept.append(row)
            continue
        pub_date = str(row.get("publication_date") or "")
        if not pub_date:
            continue
        if pub_date < str(start):
            continue
        if end and pub_date > str(end):
            continue
        kept.append(row)
    return kept


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _load_config() -> dict[str, Any]:
    path = DATA_DIR / "publication_quality_config.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _load_publications(sheet_id: str, gid: str) -> list[dict[str, Any]]:
    aliases = _load_aliases()
    rows = _download_sheet_rows(sheet_id, gid)
    return _publication_payloads(rows, aliases, sheet_id, gid)


def _filter_publications(publications: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    result = publications
    if args.account_id:
        result = [row for row in result if str(row.get("account_id")) == args.account_id]
    if args.period:
        year, month = args.period.split("-", 1)
        result = [
            row for row in result
            if int(row.get("publication_year") or 0) == int(year)
            and int(row.get("publication_month") or 0) == int(month)
        ]
    return sorted(result, key=lambda row: (str(row.get("publication_date") or ""), int(row.get("source_row_number") or 0)), reverse=True)


def _existing_urls(sb: Any) -> set[tuple[str, str]]:
    # Llave (url, account_id): la misma URL registrada para DOS clientes distintos son
    # dos analisis independientes (antes el segundo cliente jamas se analizaba).
    # Solo se consideran "ya analizadas" las que se pudieron leer: las fetch_error se
    # dejan fuera para que el proximo run las reintente sin --force.
    try:
        res = sb.table("publication_quality_analyses").select("url,account_id,status").limit(10000).execute()
        return {
            (str(row.get("url")), str(row.get("account_id")))
            for row in (res.data or [])
            if row.get("url") and row.get("status") != "fetch_error"
        }
    except Exception as exc:
        logger.warning("Could not read existing publication_quality_analyses; continuing as empty: %s", exc)
        return set()


def _resolve_deliverable_type(service: Any, config: dict[str, Any]) -> tuple[str | None, str]:
    """Mapea la columna 'Servicio' del Sheet a un tipo canonico.

    Devuelve (tipo, origen). Si el Servicio viene vacio o 'Elegir:' devuelve
    (None, 'empty') para que el tipo se infiera leyendo el link.
    """
    dt = config.get("deliverable_types") or {}
    val = _normalize(str(service or ""))
    empties = {_normalize(x) for x in dt.get("empty_service_values", [])}
    if not val or val in empties:
        return None, "empty"
    for key, canonical in (dt.get("service_aliases") or {}).items():
        if _normalize(key) == val:
            return canonical, "sheet"
    # Servicio con texto no catalogado (Nota, Nota + RRSS, Trascendido, etc.) -> nota.
    return dt.get("default_type", "nota"), "sheet"


def _canonical_type(value: Any, config: dict[str, Any]) -> str | None:
    types = (config.get("deliverable_types") or {}).get("types") or {}
    normalized = _normalize(str(value or "")).replace(" ", "_")
    return normalized if normalized in types else None


def _nota_variant(
    editorial_quality: str,
    focus: str,
    mention: dict[str, Any],
    config: dict[str, Any],
) -> tuple[str, str, float]:
    """Resuelve la variante de una nota informativa leyendo el link (como ya se hacia).

    Devuelve (note_type, badge, pq) segun la tabla de aceptacion BW-07-SEM-0002.
    """
    variants = config["deliverable_types"]["nota_variants"]
    if editorial_quality == "exclusiva":
        v = variants["exclusiva"]
        bonus = float((v.get("focus_bonus") or {}).get(focus, 0))
        # El cliente en el encabezado sube el %; una exclusiva sin el cliente en el titulo
        # vale menos (p.ej. narrativa propia = 100 con titulo, 90 sin titulo).
        titulo = float(v.get("titulo_bonus", 0)) if mention.get("title_match") else 0.0
        pq = min(float(v["pq_max"]), float(v["pq_base"]) + bonus + titulo)
        return "exclusiva", v["badge"], pq
    if mention.get("title_match"):
        v = variants["cliente_titulo"]
        return "cliente_titulo", v["badge"], float(v["pq"])
    if editorial_quality in {"reactiva", "mencion_principal"} or mention.get("body_match"):
        v = variants["cliente_cuerpo"]
        return "cliente_cuerpo", v["badge"], float(v["pq"])
    v = variants["mencion"]
    return "mencion", v["badge"], float(v["pq"])


def _vinculacion_is_derived(publication: dict[str, Any], meta: dict[str, Any]) -> bool:
    """La vinculacion sube de 30 a 50 PQ si el Sheet indica que derivo en nota publicada.

    Hoy el Sheet no tiene una columna dedicada, asi que se leen los comentarios de la
    fila (fuente autoritativa) buscando las palabras clave configuradas.
    """
    keywords = [_normalize(k) for k in (meta.get("result_keywords") or [])]
    haystack = _normalize(" ".join([
        str(publication.get("comments") or ""),
        str(publication.get("service") or ""),
    ]))
    return any(k and k in haystack for k in keywords)


def _score_deliverable(
    effective_type: str,
    editorial_quality: str,
    focus: str,
    mention: dict[str, Any],
    publication: dict[str, Any],
    config: dict[str, Any],
) -> tuple[str, str | None, float, str]:
    """Devuelve (note_type, badge, pq_score, score_mode) para el tipo efectivo."""
    types = config["deliverable_types"]["types"]
    meta = types.get(effective_type) or {}
    scoring = meta.get("scoring", "nota_llm")
    badge = meta.get("badge")
    if scoring == "anchor":
        return effective_type, badge, float(meta["pq"]), "anchor"
    if scoring == "vinculacion":
        # Badge homologado unico "Vinculacion"; el 30 vs 50 solo cambia el puntaje.
        if _vinculacion_is_derived(publication, meta):
            return "vinculacion_con_resultado", badge, float(meta["pq_with_result"]), "vinculacion"
        return "vinculacion", badge, float(meta["pq"]), "vinculacion"
    # nota_llm: el badge es el tipo homologado (Nota / Trascendido). La variante leida del
    # link (exclusiva/cliente_titulo/cliente_cuerpo/mencion) NO se muestra como badge; solo
    # define el PQ. note_type conserva la variante para referencia.
    note_type, _variant_badge, pq = _nota_variant(editorial_quality, focus, mention, config)
    return note_type, badge, pq, "nota_llm"


# Hallazgo 01: como toda fila proviene del archivo de medios Blackwell, la gestion
# esta confirmada por definicion. Nunca dejamos que el checklist niegue la gestion.
_BANNED_CHECKLIST = [
    "sin evidencia", "no hay evidencia", "no es una exclusiva", "no gestionada",
    "no fue gestionada", "no se puede confirmar que blackwell", "no hay senales de exclusiv",
    "no es exclusiva gestionada", "no parece gestionada",
    # Que el cliente sea el SUJETO (no el autor) es normal en una nota informativa,
    # no un defecto: no lo marcamos como negativo. La autoria solo se señala en positivo.
    "no es el autor", "no es autor", "no es quien escribe", "no escribio la nota",
    "sino el sujeto", "sujeto de la cobertura", "sujeto de la nota",
    # El link a veces es EVIDENCIA (video, audio, captura) y no un articulo de prensa;
    # criticar el formato no aplica (el tipo/puntaje viene del archivo BW, no del link).
    "no dirige a una nota", "no es una nota periodistica", "no es un articulo de prensa",
    "no un articulo de prensa", "recurso multimedia", "no se detecta contenido editorial",
    "no es un articulo", "es un video", "archivo es un video", "no es una publicacion",
]

# Confirmacion POSITIVA por tipo (para tipos con puntaje por tipo, no por leer el link).
_TYPE_CONFIRM = {
    "columna_opinion": "Si: columna de opinion firmada por el propio cliente (cuenta como propia)",
    "entrevista": "Si: entrevista al cliente gestionada por Blackwell (registrada en el archivo BW)",
    "foro_panel": "Si: participacion del cliente en foro/panel gestionada por Blackwell",
    "vinculacion": "Si: vinculacion con el medio gestionada por Blackwell",
    "vinculacion_con_resultado": "Si: vinculacion que derivo en nota publicada",
}


# La ausencia de algo malo es un hallazgo POSITIVO: si el LLM lo prefija con "No:" por
# la forma gramatical ("No: la nota no presenta tono defensivo"), lo corregimos a "Si:"
# para que el front no lo pinte como ✗ rojo en algo que es bueno.
_POSITIVE_ABSENCE_RX = re.compile(
    r"\b(no\s+(presenta|tiene|hay|muestra|refleja|existe|adopta|contiene|se\s+detectan?)|sin)\b"
    r"[^.]*\b(defensiv|crisis|negativ|ataqu|confrontaci|hostil|riesgo\s+reputacional|"
    r"insatisfacci|presion\s+negativa|dano\s+reputacional)"
)


def _sanitize_checklist(items: Any) -> list[str]:
    out: list[str] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, str):
            continue
        normalized = _normalize(item)
        if any(banned in normalized for banned in _BANNED_CHECKLIST):
            continue
        # Corrige la polaridad: "No: <ausencia de algo malo>" -> "Si: ..."
        if normalized.startswith("no ") and _POSITIVE_ABSENCE_RX.search(normalized):
            item = re.sub(r"^\s*no\s*:\s*", "Si: ", item, count=1, flags=re.IGNORECASE)
        out.append(item)
    return out


def _analyze_publication(publication: dict[str, Any], config: dict[str, Any], model: str) -> dict[str, Any]:
    url = str(publication["url"])
    aliases = _aliases_for_publication(publication, config)
    tier, tier_points = _tier_for_publication(publication, config)
    declared_type, type_source = _resolve_deliverable_type(publication.get("service"), config)

    # Se lee el link como ya se hacia. Si falla y el tipo viene declarado en el Sheet
    # (columna/entrevista/foro/vinculacion), igual se puede puntuar desde el tipo.
    article = {"title": "", "text": ""}
    fetch_error: str | None = None
    try:
        article = _fetch_article(url)
    except Exception as exc:  # noqa: BLE001 - se maneja abajo
        fetch_error = str(exc)

    mention = _detect_mentions(article, aliases)

    # Paywall / muro de cookies / soft-404: el fetch responde 200 pero el texto NO es
    # el articulo. Sin esto, la nota caia a "mencion" (40) con status scored — un
    # puntaje fabricado. Solo aplica si ningun alias aparecio (si el cliente si sale,
    # el contenido cargo bien aunque haya banners).
    if fetch_error is None and not mention["title_match"] and not mention["body_match"] and _looks_paywalled(article):
        fetch_error = "paywall_or_softwall: el contenido no es el articulo (suscripcion/cookies)"

    llm = _classify_with_llm(publication, article, aliases, mention, tier, model, declared_type) if fetch_error is None else {}

    editorial_quality = _canonical(llm.get("editorial_quality"), config["editorial_points"], "sin_mencion")
    focus = _canonical(llm.get("focus"), config["focus_points"], "no_aplica")
    editorial_points = float(config["editorial_points"][editorial_quality])
    focus_points = float(config["focus_points"][focus])
    content_score = editorial_points + focus_points

    # Tipo efectivo: el valor del Sheet manda; si viene vacio, se infiere del link.
    detected_type = _canonical_type(llm.get("detected_type"), config)
    if declared_type:
        effective_type = declared_type
    elif detected_type:
        effective_type, type_source = detected_type, "inferred"
    else:
        effective_type, type_source = config["deliverable_types"].get("default_type", "nota"), "default"

    # Autoria del cliente gana sobre "Nota": si el cliente ESCRIBIO/firma la pieza, es
    # contenido propio (columna de opinion) aunque no se mencione a si mismo en el texto
    # y aunque el Sheet la haya registrado como Nota generica.
    client_is_author = bool(llm.get("client_is_author"))
    if effective_type == "nota" and (client_is_author or detected_type == "columna_opinion"):
        effective_type, type_source = "columna_opinion", "authored"

    note_type, badge, pq_score, _score_mode = _score_deliverable(
        effective_type, editorial_quality, focus, mention, publication, config
    )

    # Nota/Trascendido dependen del CONTENIDO del link para puntuar. Si no se pudo leer,
    # NO inventamos un 40 (Mencion) enganoso: se marca como no analizada (fetch_error) para
    # que el front diga "no se pudo leer" y no un puntaje falso. Los tipos con ancla propia
    # (columna/entrevista/foro/vinculacion) sí se puntuan aunque el link no cargue.
    if fetch_error is not None and (pq_score is None or _score_mode == "nota_llm"):
        return _error_row(publication, model, RuntimeError(fetch_error), config)

    if fetch_error is not None:
        status = "scored_from_sheet"
    elif pq_score is not None:
        status = "scored"
    else:
        status = "needs_review"

    checklist = _sanitize_checklist(llm.get("checklist"))
    # Tipos con puntaje por TIPO (anclado en el archivo BW, no en leer el link): el puntaje
    # es fijo, asi que NINGUN "No:" aplica (no tiene caso criticar titulo/formato en una
    # columna, entrevista, foro o vinculacion). El checklist queda solo confirmatorio.
    if _score_mode in ("anchor", "vinculacion"):
        checklist = [c for c in checklist if not _normalize(c).startswith("no ")]
        confirm = _TYPE_CONFIRM.get(note_type)
        if confirm and not any(_normalize(confirm)[:22] in _normalize(c) or "propia" in _normalize(c) for c in checklist):
            checklist = [confirm] + checklist

    return {
        "account_id": publication.get("account_id"),
        "account_name": publication.get("account_name"),
        "sheet_client_name": publication.get("sheet_client_name"),
        "media_name": publication.get("media_name"),
        "publication_date": publication.get("publication_date"),
        "publication_year": publication.get("publication_year"),
        "publication_month": publication.get("publication_month"),
        "url": publication.get("url"),
        "article_title": article["title"],
        "article_excerpt": article["text"][:1200],
        "matched_aliases": mention["matched_aliases"],
        "title_match": mention["title_match"],
        "body_match": mention["body_match"],
        "title_evidence": mention["title_evidence"],
        "body_evidence": mention["body_evidence"],
        "tier": tier,
        "tier_points": tier_points,
        "editorial_quality": editorial_quality,
        "editorial_points": editorial_points,
        "focus": focus,
        "focus_points": focus_points,
        "content_score": content_score,
        "pq_score": pq_score,
        "deliverable_type": effective_type,
        "note_type": note_type,
        "badge": badge,
        "type_source": type_source,
        "is_managed": True,
        "status": status,
        "evidence": {
            "items": llm.get("evidence") if isinstance(llm.get("evidence"), list) else [],
            "checklist": checklist,
            "reasoning": llm.get("reasoning") or "",
        },
        "raw_analysis": {
            "llm": llm,
            "mention_detection": mention,
            "aliases": aliases,
            "declared_type": declared_type,
            "detected_type": detected_type,
            "service": publication.get("service"),
            "fetch_error": fetch_error,
            "source_row_number": publication.get("source_row_number"),
        },
        "model": model,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _error_row(publication: dict[str, Any], model: str, exc: Exception, config: dict[str, Any]) -> dict[str, Any]:
    error_message = str(exc)
    declared_type, type_source = _resolve_deliverable_type(publication.get("service"), config)
    return {
        "account_id": publication.get("account_id"),
        "account_name": publication.get("account_name"),
        "sheet_client_name": publication.get("sheet_client_name"),
        "media_name": publication.get("media_name"),
        "publication_date": publication.get("publication_date"),
        "publication_year": publication.get("publication_year"),
        "publication_month": publication.get("publication_month"),
        "url": publication.get("url"),
        "article_title": None,
        "article_excerpt": None,
        "matched_aliases": [],
        "title_match": False,
        "body_match": False,
        "title_evidence": None,
        "body_evidence": error_message,
        "tier": None,
        "tier_points": None,
        "editorial_quality": None,
        "editorial_points": None,
        "focus": None,
        "focus_points": None,
        "content_score": None,
        "pq_score": None,
        "deliverable_type": declared_type,
        "note_type": None,
        "badge": None,
        "type_source": type_source,
        "is_managed": True,
        "status": "fetch_error",
        "evidence": [],
        "raw_analysis": {"error": error_message, "service": publication.get("service"), "source_row_number": publication.get("source_row_number")},
        "model": model,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _fetch_article(url: str) -> dict[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 BlackwellSemaforo/1.0 (+https://github.com/BrandonBlackwell-ui/Sem-foro)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read(2_500_000)
        content_type = response.headers.get("content-type", "")
    charset = _charset(content_type) or "utf-8"
    html_text = raw.decode(charset, errors="replace")
    parser = ArticleParser()
    parser.feed(html_text)
    title = parser.og_title or parser.h1 or parser.title or ""
    text = re.sub(r"\s+", " ", html.unescape(" ".join(parser.text_parts))).strip()
    if len(text) < 120:
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", html_text))).strip()
    return {"title": title.strip(), "text": text[:20000]}


def _charset(content_type: str) -> str | None:
    match = re.search(r"charset=([^;\s]+)", content_type, re.I)
    return match.group(1).strip("\"'") if match else None


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.og_title = ""
        self.h1 = ""
        self.text_parts: list[str] = []
        self._tag_stack: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr = {k.lower(): v or "" for k, v in attrs}
        if tag in {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside"}:
            self._skip_depth += 1
        if tag == "meta" and attr.get("property") in {"og:title", "twitter:title"}:
            self.og_title = attr.get("content", self.og_title)
        self._tag_stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside"} and self._skip_depth:
            self._skip_depth -= 1
        if self._tag_stack:
            self._tag_stack.pop()

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text or self._skip_depth:
            return
        tag = self._tag_stack[-1] if self._tag_stack else ""
        if tag == "title" and not self.title:
            self.title = text
        elif tag == "h1" and not self.h1:
            self.h1 = text
        elif tag in {"p", "h1", "h2", "h3", "li", "article", "main", "span", "div"} and len(text) > 2:
            self.text_parts.append(text)


def _aliases_for_publication(publication: dict[str, Any], config: dict[str, Any]) -> list[str]:
    account_id = str(publication.get("account_id") or "")
    account_cfg = (config.get("accounts") or {}).get(account_id) or {}
    aliases = list(account_cfg.get("aliases") or [])
    aliases.extend([
        str(publication.get("sheet_client_name") or ""),
        str(publication.get("legal_name") or ""),
        str(publication.get("account_name") or ""),
    ])
    return sorted({alias.strip() for alias in aliases if alias and alias.strip()}, key=len, reverse=True)


def _tier_for_publication(publication: dict[str, Any], config: dict[str, Any]) -> tuple[str | None, float | None]:
    account_id = str(publication.get("account_id") or "")
    media_name = _normalize(str(publication.get("media_name") or ""))
    # Fallback a default_media_tiers para cuentas sin entrada propia en accounts
    # (las nuevas con id numerico): antes quedaban en needs_tier permanente.
    media_tiers = ((config.get("accounts") or {}).get(account_id) or {}).get("media_tiers") \
        or (config.get("default_media_tiers") or {})
    tier = None
    for name, value in media_tiers.items():
        if name.startswith("_"):
            continue
        if _normalize(name) == media_name:
            tier = str(value)
            break
    if not tier:
        return None, None
    key = tier.lower().replace(" ", "_").replace("-", "_")
    return key, float((config.get("tier_points") or {}).get(key, 0))


_PAYWALL_MARKERS = [
    "suscribete para", "hazte suscriptor", "contenido exclusivo para suscriptores",
    "inicia sesion para continuar", "para seguir leyendo", "acceso ilimitado a",
    "este contenido es exclusivo", "ya soy suscriptor", "planes de suscripcion",
    "aceptar todas las cookies", "utilizamos cookies para", "politica de cookies",
    "pagina no encontrada", "error 404", "el contenido que buscas no existe",
]


def _looks_paywalled(article: dict[str, str]) -> bool:
    """True si el texto extraido parece muro de pago/cookies/404 y no un articulo."""
    text = _normalize(article.get("text") or "")
    if not text:
        return True
    hits = sum(1 for marker in _PAYWALL_MARKERS if _normalize(marker) in text)
    # Texto corto + un marcador, o dos marcadores en cualquier tamano.
    return (len(text) < 600 and hits >= 1) or hits >= 2


def _detect_mentions(article: dict[str, str], aliases: list[str]) -> dict[str, Any]:
    title = article.get("title") or ""
    body = article.get("text") or ""
    matched_aliases = []
    title_evidence = ""
    body_evidence = ""
    for alias in aliases:
        if _contains_alias(title, alias):
            matched_aliases.append(alias)
            title_evidence = title[:300]
        if _contains_alias(body, alias):
            matched_aliases.append(alias)
            if not body_evidence:
                body_evidence = _snippet(body, alias)
    return {
        "matched_aliases": sorted(set(matched_aliases), key=len, reverse=True),
        "title_match": bool(title_evidence),
        "body_match": bool(body_evidence),
        "title_evidence": title_evidence,
        "body_evidence": body_evidence,
    }


def _contains_alias(text: str, alias: str) -> bool:
    if not alias:
        return False
    return _normalize(alias) in _normalize(text)


def _snippet(text: str, alias: str) -> str:
    normalized = _normalize(text)
    target = _normalize(alias)
    index = normalized.find(target)
    if index < 0:
        return ""
    approx = max(0, min(len(text) - 1, index))
    start = max(0, approx - 180)
    end = min(len(text), approx + 260)
    return text[start:end].strip()


def _classify_with_llm(
    publication: dict[str, Any],
    article: dict[str, str],
    aliases: list[str],
    mention: dict[str, Any],
    tier: str | None,
    model: str,
    declared_type: str | None = None,
) -> dict[str, Any]:
    system = (
        "Eres analista de calidad editorial para Blackwell Strategy. "
        "Evalua notas publicadas. No inventes datos fuera del texto. Responde solo JSON valido."
    )
    prompt = f"""
Cuenta: {publication.get('account_name')} ({publication.get('account_id')})
Cliente en Sheet: {publication.get('sheet_client_name')}
Medio: {publication.get('media_name')}
URL: {publication.get('url')}
Aliases oficiales para buscar: {aliases}
Tier fijo configurado: {tier or 'SIN_TIER_CONFIGURADO'}
Tipo declarado en el Sheet (columna Servicio): {declared_type or 'NO DECLARADO'}

Deteccion deterministica previa:
{json.dumps(mention, ensure_ascii=False)}

Titulo / encabezado extraido:
{article.get('title') or '(sin titulo)'}

Texto de la nota:
{article.get('text')[:12000]}

PASO 0 — Tipo de entregable (detected_type):
Si "Tipo declarado en el Sheet" viene con un valor, respetalo y confirmalo. Si viene NO DECLARADO,
infiere el tipo leyendo el link. detected_type debe ser UNO de:
- "columna_opinion": el cliente FIRMA el texto como autor (byline), tipicamente en seccion de
  opinion/colaboradores/voces/invitados/tribuna. El cliente toma la voz editorial, no es solo el sujeto.
- "entrevista": formato Q&A o dialogo, o el cliente es la fuente principal con citas directas extensas.
- "foro_panel": el cliente aparece acreditado como ponente, panelista o speaker de un foro/evento.
- "vinculacion": gestion/reunion con el medio, no una nota publicada.
- "nota": cobertura informativa estandar (default).
client_is_author=true cuando el cliente ES el autor/firma de la pieza (la escribio el),
AUNQUE no se mencione a si mismo en el cuerpo y AUNQUE la seccion no diga "opinion". Una
nota firmada por el cliente es contenido propio: en ese caso detected_type debe ser
"columna_opinion". Pista: el nombre del cliente aparece como autor/byline (encabezado, "Por
<cliente>", firma al final), no como sujeto del que habla un tercero.

PASO 1 — Verifica el titulo/encabezado:
Busca EXACTAMENTE si alguno de los aliases oficiales aparece en el titulo/encabezado de arriba.
Esto determina title_in_headline (true/false). Es independiente de si aparece en el cuerpo.
El titulo en el encabezado tiene peso extra en la calidad editorial.

PASO 2 — Clasifica la nota con estas reglas PQ:
- editorial_quality (elige UNO):
  - "exclusiva": el equipo de Blackwell genero la historia proactivamente o coloco la nota en el medio.
    NOTA CLAVE: Dado que todas las notas evaluadas provienen del Excel de control de Blackwell, significa que Blackwell las gestiono y coloco. Por lo tanto, si el cliente es protagonista o actor relevante de la nota, y la narrativa es favorable o neutral, debes clasificarla como "exclusiva". No busques el nombre "Blackwell" en el texto (las agencias de relaciones publicas trabajan detras de escena).
  - "reactiva": el periodista o medio busco al cliente como fuente o para entrevistarlo (iniciativa del periodista, pero coordinada por Blackwell).
  - "mencion_principal": el cliente aparece como protagonista o actor relevante de la nota, pero el texto demuestra de forma inequivoca que fue un esfuerzo totalmente ajeno o no gestionado por Blackwell (caso sumamente raro en este control).
  - "mencion_secundaria": el cliente aparece de forma marginal, en una lista, o como referencia de fondo sin ser protagonista.
  - "sin_mencion": no hay mencion verificable de ninguno de los aliases oficiales en titulo ni cuerpo.
- focus (elige UNO):
  - "narrativa_propia": la nota posiciona al cliente en la narrativa deseada o lo presenta favorablemente/proactivamente.
  - "neutral": menciona hechos sin posicionamiento claro, cobertura informativa sin angulo estrategico.
  - "defensivo": crisis, aclaracion, reclamo, investigacion, dano reputacional o postura defensiva.
  - "no_aplica": no hay mencion verificable.

PASO 3 — Genera el checklist de calificacion:
Lista de 3 a 5 frases cortas que explican POR QUE le pusiste esa calificacion. Cada frase debe empezar con "Si:" o "No:" segun aplique.
POLARIDAD: "Si:" = hallazgo BUENO para el cliente; "No:" = hallazgo MALO. Guiate por si es bueno o malo, NO por la forma gramatical. La AUSENCIA de algo malo es BUENA: usa "Si:" (ej. "Si: la nota no tiene tono defensivo ni de crisis"). Nunca escribas "No: la nota no presenta tono defensivo" — eso es bueno, va con "Si:".
NOTA DE CONTEXTO: Nunca digas que "no hay evidencia de que Blackwell haya gestionado la nota" u oraciones similares en el checklist. El hecho de estar en esta evaluacion garantiza que Blackwell la gestiono.
AUTORIA: NO marques como negativo que "el cliente no es el autor" o que "es el sujeto y no el autor de la nota": eso es NORMAL en una nota informativa, no un defecto. Solo menciona la autoria en POSITIVO cuando el cliente SI escribio/firmo la pieza (ej. "Si: la firma el propio cliente").
Ejemplos de frases permitidas:
  "Si: el cliente aparece mencionado en el titulo/encabezado"
  "No: el cliente no aparece en el titular, solo en el cuerpo"
  "Si: la nota es una colocacion proactiva del equipo de Blackwell"
  "Si: el enfoque posiciona al cliente favorablemente"

Devuelve JSON:
{{
  "detected_type": "nota|columna_opinion|entrevista|foro_panel|vinculacion",
  "client_is_author": false,
  "title_in_headline": true,
  "editorial_quality": "exclusiva|reactiva|mencion_principal|mencion_secundaria|sin_mencion",
  "focus": "narrativa_propia|neutral|defensivo|no_aplica",
  "reasoning": "explicacion breve en 1-2 oraciones",
  "checklist": ["Si/No: razon 1", "Si/No: razon 2", "Si/No: razon 3"],
  "evidence": [{{"quote":"fragmento corto del texto", "why_it_matters":"por que importa"}}]
}}
""".strip()
    text = _openrouter_chat_completion(model, system, prompt, max_tokens=1200)
    return _parse_json(text)


def _openrouter_chat_completion(model: str, system: str, prompt: str, max_tokens: int) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "https://github.com/BrandonBlackwell-ui/Sem-foro"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Blackwell Semaforo"),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter HTTP {exc.code}: {body}") from exc
    return data["choices"][0]["message"]["content"]


def _parse_json(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def _canonical(value: Any, allowed: dict[str, Any], fallback: str) -> str:
    normalized = _normalize(str(value or "")).replace(" ", "_")
    return normalized if normalized in allowed else fallback


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _summaries_from_rows(sb: Any, new_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    periods = {(row["account_id"], row["publication_year"], row["publication_month"]) for row in new_rows if row.get("publication_year") and row.get("publication_month")}
    summaries = []
    for account_id, year, month in periods:
        res = (
            sb.table("publication_quality_analyses")
            .select("account_id,account_name,publication_year,publication_month,pq_score,status")
            .eq("account_id", account_id)
            .eq("publication_year", year)
            .eq("publication_month", month)
            .execute()
        )
        rows = res.data or []
        scored = [float(row["pq_score"]) for row in rows if row.get("pq_score") is not None]
        account_name = rows[0].get("account_name") if rows else None
        pq_score = round(sum(scored) / len(scored), 1) if scored else None
        summaries.append({
            "account_id": account_id,
            "account_name": account_name,
            "period_year": year,
            "period_month": month,
            "publication_count": len(rows),
            "analyzed_count": len(rows),
            "scored_count": len(scored),
            "pq_score": pq_score,
            "status": "scored" if pq_score is not None and len(scored) == len(rows) else "needs_tier",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return summaries


def _upsert_chunks(sb: Any, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
    # Dedupe by conflict key(s): duplicated Sheet rows (same URL twice) break
    # Postgres upsert with "cannot affect row a second time". Keep the last row.
    keys = [k.strip() for k in conflict.split(",")]
    deduped: dict[tuple, dict[str, Any]] = {}
    for row in rows:
        deduped[tuple(row.get(k) for k in keys)] = row
    rows = list(deduped.values())
    for start in range(0, len(rows), 100):
        sb.table(table).upsert(rows[start : start + 100], on_conflict=conflict).execute()


if __name__ == "__main__":
    main()
