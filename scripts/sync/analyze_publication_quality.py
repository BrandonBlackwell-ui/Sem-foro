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
    existing_urls = _existing_urls(sb) if not args.force else set()

    analyzed: list[dict[str, Any]] = []
    for publication in publications:
        if len(analyzed) >= args.limit:
            break
        url = str(publication.get("url") or "").strip()
        if not url or url in existing_urls:
            continue
        try:
            row = _analyze_publication(publication, config, args.model)
        except Exception as exc:  # keep the batch moving
            logger.warning("Could not analyze %s: %s", url, exc)
            row = _error_row(publication, args.model, exc)
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
        _upsert_chunks(sb, "publication_quality_analyses", analyzed, "url")
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
    return parser.parse_args()


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


def _existing_urls(sb: Any) -> set[str]:
    try:
        res = sb.table("publication_quality_analyses").select("url").limit(10000).execute()
        return {str(row.get("url")) for row in (res.data or []) if row.get("url")}
    except Exception as exc:
        logger.warning("Could not read existing publication_quality_analyses; continuing as empty: %s", exc)
        return set()


def _analyze_publication(publication: dict[str, Any], config: dict[str, Any], model: str) -> dict[str, Any]:
    article = _fetch_article(str(publication["url"]))
    aliases = _aliases_for_publication(publication, config)
    mention = _detect_mentions(article, aliases)
    tier, tier_points = _tier_for_publication(publication, config)
    llm = _classify_with_llm(publication, article, aliases, mention, tier, model)

    editorial_quality = _canonical(llm.get("editorial_quality"), config["editorial_points"], "sin_mencion")
    focus = _canonical(llm.get("focus"), config["focus_points"], "no_aplica")
    editorial_points = float(config["editorial_points"][editorial_quality])
    focus_points = float(config["focus_points"][focus])
    content_score = editorial_points + focus_points
    pq_score = None if tier_points is None else float(tier_points) + content_score
    status = "scored" if pq_score is not None else "needs_tier"

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
        "status": status,
        "evidence": llm.get("evidence") if isinstance(llm.get("evidence"), list) else [],
        "raw_analysis": {
            "llm": llm,
            "mention_detection": mention,
            "aliases": aliases,
            "source_row_number": publication.get("source_row_number"),
        },
        "model": model,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _error_row(publication: dict[str, Any], model: str, exc: Exception) -> dict[str, Any]:
    return {
        "account_id": publication.get("account_id"),
        "account_name": publication.get("account_name"),
        "sheet_client_name": publication.get("sheet_client_name"),
        "media_name": publication.get("media_name"),
        "publication_date": publication.get("publication_date"),
        "publication_year": publication.get("publication_year"),
        "publication_month": publication.get("publication_month"),
        "url": publication.get("url"),
        "status": "fetch_error",
        "raw_analysis": {"error": str(exc), "source_row_number": publication.get("source_row_number")},
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
    media_tiers = ((config.get("accounts") or {}).get(account_id) or {}).get("media_tiers") or {}
    tier = None
    for name, value in media_tiers.items():
        if _normalize(name) == media_name:
            tier = str(value)
            break
    if not tier:
        return None, None
    key = tier.lower().replace(" ", "_").replace("-", "_")
    return key, float((config.get("tier_points") or {}).get(key, 0))


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

Deteccion deterministica previa:
{json.dumps(mention, ensure_ascii=False)}

Titulo extraido:
{article.get('title') or '(sin titulo)'}

Texto de la nota:
{article.get('text')[:12000]}

Clasifica la nota con estas reglas PQ:
- editorial_quality:
  - "exclusiva": Blackwell/cliente origina la narrativa o el cliente es fuente central/protagonista claro.
  - "reactiva": nota responde a coyuntura, entrevista, declaracion o gestion de una situacion.
  - "mencion_principal": cliente/personaje aparece como actor principal, pero no necesariamente origen/exclusiva.
  - "mencion_secundaria": cliente/personaje aparece marginalmente.
  - "sin_mencion": no hay mencion verificable de los aliases oficiales.
- focus:
  - "narrativa_propia": posiciona al cliente en la narrativa deseada o lo presenta favorablemente/proactivamente.
  - "neutral": menciona hechos sin posicionamiento claro.
  - "defensivo": crisis, aclaracion, reclamo, investigacion, daño reputacional o postura defensiva.
  - "no_aplica": no hay mencion verificable.

Devuelve JSON:
{{
  "editorial_quality": "exclusiva|reactiva|mencion_principal|mencion_secundaria|sin_mencion",
  "focus": "narrativa_propia|neutral|defensivo|no_aplica",
  "reasoning": "explicacion breve",
  "evidence": [{{"quote":"fragmento corto", "why_it_matters":"por que importa"}}]
}}
""".strip()
    text = _openrouter_chat_completion(model, system, prompt, max_tokens=900)
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
    for start in range(0, len(rows), 100):
        sb.table(table).upsert(rows[start : start + 100], on_conflict=conflict).execute()


if __name__ == "__main__":
    main()
