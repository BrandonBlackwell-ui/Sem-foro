/**
 * Motor de crisis (crisis engine) — vive en el wa_listener (siempre encendido).
 *
 * Orquesta: portero (crisisGate) → evaluación de nivel (LLM) → máquina de estados →
 * generación del documento (Generador + Revisor, metodologías Blackwell) → outbox
 * (crisis_alerts) → envío por Baileys. Timers internos manejan el digest de las 7am y
 * el cierre a las 48h de calma. Todo con dedup e idempotencia.
 *
 * Reglas duras: el documento va a los CONSULTORES (allowlist), NUNCA al cliente.
 * El envío está detrás de CRISIS_ALERTS_ENABLED (apagado por defecto).
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = join(__dir, "..", "data", "crisis_prompts.json");

let PROMPTS = null;
export function loadPrompts() {
  if (!PROMPTS) PROMPTS = JSON.parse(readFileSync(PROMPTS_PATH, "utf-8"));
  return PROMPTS;
}

// ---------------------------------------------------------------------------
// LÓGICA PURA (máquina de estados) — testeable sin red.
// ---------------------------------------------------------------------------

function hoursBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(b - a) / 3600000;
}

export function emptyState(accountId, accountName) {
  return {
    account_id: String(accountId),
    account_name: accountName || null,
    status: "none",
    level: 0,
    peak_level: 0,
    crisis_signature: null,
    opened_at: null,
    last_escalation_at: null,
    last_active_at: null,
    last_reeval_at: null,
    last_digest_on: null,
    closed_at: null,
  };
}

/**
 * Aplica una observación de nivel al estado. Devuelve { action, state }.
 * action: 'open' | 'escalate' | 'sustain' | 'deescalate' | 'none'
 * Solo 'open' y 'escalate' ameritan enviar un documento nuevo.
 */
export function applyLevel(prevState, observedLevel, nowIso, cfg) {
  const threshold = cfg.level_threshold ?? 3;
  const s = { ...prevState };
  const lvl = Math.max(0, Math.min(4, Number(observedLevel) || 0));
  s.last_reeval_at = nowIso;

  if (lvl >= threshold) {
    if (s.status !== "active" && s.status !== "deescalating") {
      // Nueva crisis
      s.status = "active";
      s.level = lvl;
      s.peak_level = lvl;
      s.opened_at = nowIso;
      s.last_escalation_at = nowIso;
      s.last_active_at = nowIso;
      s.closed_at = null;
      s.crisis_signature = `${s.account_id}:${nowIso.slice(0, 10)}`;
      return { action: "open", state: s };
    }
    // Crisis en curso
    s.status = "active";
    s.last_active_at = nowIso;
    if (lvl > s.peak_level) {
      s.peak_level = lvl;
      s.level = lvl;
      s.last_escalation_at = nowIso;
      return { action: "escalate", state: s };
    }
    s.level = lvl;
    return { action: "sustain", state: s };
  }

  // lvl < threshold
  if (s.status === "active") {
    s.status = "deescalating";
    s.level = lvl;
    return { action: "deescalate", state: s };
  }
  if (s.status === "deescalating") {
    s.level = lvl;
    return { action: "none", state: s };
  }
  s.level = lvl;
  return { action: "none", state: s };
}

/** ¿Cerrar por calma sostenida? (48h sin nivel >= umbral). */
export function decideClosure(state, nowIso, cfg) {
  if (state.status !== "active" && state.status !== "deescalating") return false;
  if (!state.last_active_at) return false;
  return hoursBetween(state.last_active_at, nowIso) >= (cfg.calm_hours ?? 48);
}

export function closeState(state, nowIso) {
  return { ...state, status: "closed", level: 0, closed_at: nowIso };
}

/** ¿Toca digest? (hora local == digest_hour, crisis activa, no enviado hoy). */
export function shouldSendDigest(state, localHour, localDate, cfg) {
  if (state.status !== "active" && state.status !== "deescalating") return false;
  if (Number(localHour) !== (cfg.digest_hour_local ?? 7)) return false;
  return state.last_digest_on !== localDate;
}

/** Throttle del portero: no re-evaluar con LLM más seguido que N minutos. */
export function throttleOk(state, nowIso, cfg) {
  const mins = cfg.reeval_throttle_minutes ?? 45;
  if (!state.last_reeval_at) return true;
  return hoursBetween(state.last_reeval_at, nowIso) * 60 >= mins;
}

export function dedupKey(kind, state, extra) {
  if (kind === "escalation") return `esc:${state.account_id}:${state.opened_at}:L${state.peak_level}`;
  if (kind === "digest") return `dig:${state.account_id}:${extra}`; // extra = localDate
  if (kind === "closure") return `clo:${state.account_id}:${state.opened_at}`;
  return `${kind}:${state.account_id}:${extra || ""}`;
}

// ---------------------------------------------------------------------------
// LLM (OpenRouter) — evaluación de nivel + Generador/Revisor del documento.
// ---------------------------------------------------------------------------

async function callLLM(system, user, maxTokens, opts = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY no configurada");
  const model = opts.model || loadPrompts().config.model;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com/BrandonBlackwell-ui/Sem-foro",
      "X-Title": "Blackwell Semaforo Crisis",
    },
    body: JSON.stringify({
      model,
      temperature: opts.json ? 0.1 : 0.3,
      max_tokens: maxTokens,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJsonLoose(text) {
  const t = String(text || "").trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1"));
  throw new Error("respuesta LLM no es JSON");
}

/** Evalúa el nivel de crisis (0-4) con base en el contexto reciente. */
export async function assessLevel(context) {
  const P = loadPrompts().level_eval;
  const out = await callLLM(P.system, `${P.instructions}\n\n=== CONTEXTO ===\n${context}`, P.max_tokens, { json: true });
  const j = parseJsonLoose(out);
  return {
    level: Math.max(0, Math.min(4, Number(j.crisis_level) || 0)),
    type: j.crisis_type || null,
    oneLiner: j.one_liner || null,
  };
}

/** Genera el documento (Generador) y lo pasa por el Revisor. Devuelve el texto final. */
export async function buildCrisisDocument({ accountName, level, context, kind = "escalation" }) {
  const prompts = loadPrompts();
  const brief = prompts.methodology_brief;
  if (kind === "digest") {
    const P = prompts.digest;
    const user = `${P.instructions.replace(/\{account_name\}/g, accountName).replace(/\{level\}/g, level)}\n\n${brief}\n\n=== EVOLUCIÓN DEL DÍA ANTERIOR ===\n${context}`;
    return (await callLLM(P.system, user, P.max_tokens)).trim();
  }
  if (kind === "closure") {
    const P = prompts.closure;
    const user = `${P.instructions.replace(/\{account_name\}/g, accountName)}\n\n=== RESUMEN ===\n${context}`;
    return (await callLLM(P.system, user, P.max_tokens)).trim();
  }
  // escalation: generador + revisor
  const G = prompts.generator;
  const genUser = `${G.instructions.replace(/\{account_name\}/g, accountName).replace(/\{level\}/g, level)}\n\n${brief}\n\n=== CONTEXTO DE LA CRISIS ===\n${context}`;
  const draft = (await callLLM(G.system, genUser, G.max_tokens)).trim();
  try {
    const R = prompts.reviewer;
    const revOut = await callLLM(R.system, `${R.instructions}\n\n=== BORRADOR ===\n${draft}`, R.max_tokens, { json: true });
    const reviewed = parseJsonLoose(revOut);
    if (reviewed.document && String(reviewed.document).trim().length > 40) return String(reviewed.document).trim();
  } catch (e) {
    // Si el revisor falla, enviamos el borrador (mejor eso que nada en una crisis).
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Supabase (REST) — estado + outbox.
// ---------------------------------------------------------------------------

function sb() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY requeridas");
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

export async function loadState(accountId, accountName) {
  const { url, headers } = sb();
  const r = await fetch(`${url}/rest/v1/crisis_state?account_id=eq.${encodeURIComponent(accountId)}&select=*`, { headers });
  if (r.ok) {
    const rows = await r.json();
    if (rows.length) return rows[0];
  }
  return emptyState(accountId, accountName);
}

export async function saveState(state) {
  const { url, headers } = sb();
  const body = { ...state, account_id: String(state.account_id), updated_at: new Date().toISOString() };
  await fetch(`${url}/rest/v1/crisis_state?on_conflict=account_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
}

/** Encola un envío (idempotente por dedup_key). */
export async function enqueue(alert) {
  const { url, headers } = sb();
  const r = await fetch(`${url}/rest/v1/crisis_alerts?on_conflict=dedup_key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(alert),
  });
  return r.ok;
}

/** Texto de contexto: últimos N mensajes de la cuenta (orden cronológico). */
export async function recentMessagesText(accountId, limit = 40) {
  const { url, headers } = sb();
  const r = await fetch(
    `${url}/rest/v1/wa_messages?account_id=eq.${encodeURIComponent(accountId)}&select=speaker_team,speaker_name,author,body,sent_at&order=sent_at.desc&limit=${limit}`,
    { headers }
  );
  if (!r.ok) return "";
  const rows = await r.json();
  return rows.reverse().map((m) => {
    const who = m.speaker_name || m.author || "?";
    const team = /bws|blackwell/i.test(m.speaker_team || "") ? "Blackwell" : /client|cliente/i.test(m.speaker_team || "") ? "Cliente" : "?";
    return `[${team}] ${who}: ${String(m.body || "").slice(0, 400)}`;
  }).filter((l) => l.length > 6).join("\n");
}

/** Cuentas con crisis activa o en descenso. */
export async function activeCrises() {
  const { url, headers } = sb();
  const r = await fetch(`${url}/rest/v1/crisis_state?status=in.(active,deescalating)&select=*`, { headers });
  return r.ok ? r.json() : [];
}

/** Resumen del día indicado (para el digest / cierre). */
export async function daySummary(accountId, dateIso) {
  const { url, headers } = sb();
  const r = await fetch(
    `${url}/rest/v1/wa_daily_analysis?account_id=eq.${encodeURIComponent(accountId)}&analysis_date=eq.${dateIso}&select=summary,negative_signals,positive_signals,crisis_level&order=updated_at.desc&limit=1`,
    { headers }
  );
  if (!r.ok) return "";
  const rows = await r.json();
  if (!rows.length) return "";
  const x = rows[0];
  const neg = Array.isArray(x.negative_signals) ? x.negative_signals.join("; ") : "";
  return `Resumen: ${x.summary || "(sin resumen)"}\nSeñales negativas: ${neg || "ninguna"}\nNivel de crisis del día: ${x.crisis_level ?? "?"}`;
}

export async function fetchPending(limit = 5) {
  const { url, headers } = sb();
  const r = await fetch(`${url}/rest/v1/crisis_alerts?status=eq.pending&order=created_at.asc&limit=${limit}`, { headers });
  return r.ok ? r.json() : [];
}

export async function markAlert(id, patch) {
  const { url, headers } = sb();
  await fetch(`${url}/rest/v1/crisis_alerts?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Envío por Baileys (con kill-switch y allowlist).
// ---------------------------------------------------------------------------

export function allowlist() {
  const env = (process.env.CRISIS_ALERT_PHONES || "").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);
  return env.length ? env : loadPrompts().config.default_allowlist.map((s) => s.replace(/\D/g, ""));
}

export function sendingEnabled() {
  return String(process.env.CRISIS_ALERTS_ENABLED || "").toLowerCase() === "true";
}

/** Procesa la outbox: envía los pendientes a la allowlist vía sock. */
export async function sendPending(sock) {
  const pending = await fetchPending();
  if (!pending.length) return 0;
  const phones = allowlist();
  let sent = 0;
  for (const a of pending) {
    // allowlist manda: solo enviamos a números de consultor autorizados (nunca a un cliente).
    const targets = (Array.isArray(a.to_phones) && a.to_phones.length ? a.to_phones : phones)
      .map((s) => String(s).replace(/\D/g, ""))
      .filter((p) => phones.includes(p)); // intersección con la allowlist
    if (!sendingEnabled()) {
      await markAlert(a.id, { status: "skipped", error: "CRISIS_ALERTS_ENABLED=false", attempts: (a.attempts || 0) + 1 });
      continue;
    }
    if (!targets.length) {
      await markAlert(a.id, { status: "skipped", error: "sin destino en allowlist", attempts: (a.attempts || 0) + 1 });
      continue;
    }
    try {
      const header = a.title ? `${a.title}\n\n` : "";
      for (const phone of targets) {
        const jid = `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: header + a.document });
      }
      await markAlert(a.id, { status: "sent", sent_at: new Date().toISOString(), attempts: (a.attempts || 0) + 1 });
      sent++;
    } catch (err) {
      await markAlert(a.id, { status: (a.attempts || 0) >= 3 ? "failed" : "pending", error: String(err), attempts: (a.attempts || 0) + 1 });
    }
  }
  return sent;
}

export default {
  loadPrompts, emptyState, applyLevel, decideClosure, closeState, shouldSendDigest,
  throttleOk, dedupKey, assessLevel, buildCrisisDocument,
  loadState, saveState, enqueue, fetchPending, markAlert, sendPending, allowlist, sendingEnabled,
};
