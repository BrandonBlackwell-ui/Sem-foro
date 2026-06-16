// netlify/functions/ask.js  — Ask Drive · Blackwell
//
// Arquitectura agente de 2 etapas:
//
//  Etapa 1 · PLANIFICADOR (haiku, ~600ms)
//    Recibe: pregunta + índice ligero (~2KB: #NN nombre | score | color | status)
//    Devuelve: { fields, accounts, model, reasoning }
//    "fields" es un subconjunto de los campos disponibles (ver FIELD_CATEGORIES)
//    "accounts" es "all" o un array de números ["09","19",...]
//
//  Etapa 2 · RESPONDEDOR (haiku o sonnet según dificultad)
//    Recibe: pregunta + contexto quirúrgico extraído (~4-8KB)
//    Devuelve: respuesta en texto
//
// FIELD_CATEGORIES disponibles:
//   scores        global, CO, PQ, SC, color, tier
//   risk          business_risk, content_summary (200 chars)
//   action        recommended_action, urgent_actions (top 2)
//   contract      contractStatus (status, evidencia, antigüedad)
//   checklist     fulfilled count, pending count, pending items (top 3)
//   activity      subfolderActivity (fileCount + latestModified por carpeta)
//   briefing      executive_briefing del portafolio
//   opportunities opportunities (top 2) + strategic_recommendations (top 2)
//

const NETLIFY_BUDGET_MS = 9000;

// Solo haiku para ambas etapas — 3x más rápido, cabe dentro del límite de 10s
const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-haiku-4-5"; // alias — en Netlify free solo haiku es viable

const PRICING = {
  "claude-haiku-4-5":  { input: 0.80,  output: 4.00 },
  "claude-sonnet-4-5": { input: 3.00,  output: 15.00 },
};

// Campos que el planificador puede pedir
const VALID_FIELDS = new Set([
  "scores", "risk", "action", "contract",
  "checklist", "activity", "briefing", "opportunities",
]);

// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(200, {});
  if (event.httpMethod !== "POST")    return cors(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return cors(400, { error: "JSON inválido" }); }

  const question = (body.question || "").trim();
  if (!question)              return cors(400, { error: "Falta 'question'" });
  if (question.length > 3000) return cors(413, { error: "Pregunta demasiado larga" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return cors(500, { error: "ANTHROPIC_API_KEY no configurada en el entorno de Netlify" });

  const driveIntelligence = body.driveIntelligence || null;
  const computedAccounts  = Array.isArray(body.computedAccounts) ? body.computedAccounts : [];
  const syncData          = body.syncData || null;

  const tStart = Date.now();

  // ── Índice ligero: #NN Nombre | score | color | status (~2KB) ─────────────
  const accountIndex = buildAccountIndex(driveIntelligence, computedAccounts);

  // ── ETAPA 1 · Planificador ────────────────────────────────────────────────
  let plan;
  try {
    plan = await runPlanner({ apiKey, question, accountIndex,
      budgetMs: Math.min(3000, NETLIFY_BUDGET_MS - 500) });
  } catch (e) {
    return cors(502, { error: `Planificador falló: ${e.message}` });
  }

  // ── Extracción quirúrgica de contexto ─────────────────────────────────────
  const context = buildContext({
    plan, driveIntelligence, computedAccounts, syncData, accountIndex,
  });

  // ── ETAPA 2 · Respondedor ─────────────────────────────────────────────────
  let answerText, answerUsage;
  try {
    const remaining = Math.max(2500, NETLIFY_BUDGET_MS - (Date.now() - tStart) - 400);
    const result = await runAnswerer({ apiKey, question, context,
      model: plan.model, budgetMs: remaining });
    answerText  = result.text;
    answerUsage = result.usage;
  } catch (e) {
    return cors(502, { error: `Respondedor falló: ${e.message}` });
  }

  return cors(200, {
    answer: answerText,
    citations: extractCitations(answerText, accountIndex),
    plan: {
      fields: plan.fields,
      accounts: plan.accounts,
      model: plan.model,
      reasoning: plan.reasoning,
      context_chars: context.length,
    },
    ms: { total: Date.now() - tStart },
    usage: answerUsage,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 1 · Planificador
// ─────────────────────────────────────────────────────────────────────────────

async function runPlanner({ apiKey, question, accountIndex, budgetMs }) {
  const indexStr = accountIndex
    .map(a => `  #${a.number} ${a.name} | score=${a.global ?? "—"} | ${a.color ?? "sin color"} | ${a.status ?? ""}`)
    .join("\n");

  const system = `Eres el PLANIFICADOR de Ask Drive para Blackwell (firma de RP).
Tu único trabajo: leer la pregunta y devolver un JSON que le diga al respondedor QUÉ datos necesita leer y de QUÉ cuentas.

CAMPOS DISPONIBLES (elige solo los necesarios, mínimo 1, máximo 4):
  "scores"       → global, CO, PQ, SC, color, tier por cuenta
  "risk"         → texto de riesgo de negocio + resumen de estado (200 chars)
  "action"       → acción recomendada + acciones urgentes (top 2)
  "contract"     → estado contractual (firmado/faltante/vencido + evidencia)
  "checklist"    → items cumplidos vs pendientes (top 3 pendientes)
  "activity"     → actividad por subcarpeta (conteo archivos + última modificación)
  "briefing"     → briefing ejecutivo semanal del portafolio completo
  "opportunities"→ oportunidades y recomendaciones estratégicas

ÍNDICE DE CUENTAS DISPONIBLES:
${indexStr}

MODELO A USAR:
  - "haiku"  → preguntas simples, listados, búsquedas factuales (usar SIEMPRE en duda)
  - "sonnet" → análisis profundo multi-dimensional (solo si realmente lo justifica)

RESPONDE SOLO CON JSON (sin markdown):
{
  "fields": ["campo1", "campo2"],
  "accounts": "all" | ["09", "19"],
  "model": "haiku" | "sonnet",
  "reasoning": "frase corta"
}`;

  const resp = await callAnthropic({
    apiKey, model: HAIKU,
    system,
    messages: [{ role: "user", content: `PREGUNTA: "${question}"\n\nDevuelve el JSON del plan.` }],
    max_tokens: 200,
    temperature: 0,
    budgetMs,
  });

  const raw = extractText(resp).trim();
  return parsePlan(raw);
}

function parsePlan(raw) {
  let txt = raw.replace(/```[a-z]*/g, "").replace(/```/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(txt); }
  catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return defaultPlan();
    try { parsed = JSON.parse(m[0]); } catch { return defaultPlan(); }
  }
  return {
    fields: Array.isArray(parsed.fields)
      ? parsed.fields.filter(f => VALID_FIELDS.has(f)).slice(0, 4)
      : ["scores", "risk"],
    accounts: Array.isArray(parsed.accounts)
      ? parsed.accounts.map(String)
      : "all",
    model: parsed.model === "sonnet" ? SONNET : HAIKU,
    reasoning: String(parsed.reasoning || "").slice(0, 200),
  };
}

function defaultPlan() {
  return { fields: ["scores", "risk", "action"], accounts: "all", model: HAIKU, reasoning: "fallback" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción del contexto quirúrgico
// ─────────────────────────────────────────────────────────────────────────────

function buildContext({ plan, driveIntelligence, computedAccounts, syncData, accountIndex }) {
  const wantAll = plan.accounts === "all";
  const wantSet = wantAll ? null : new Set(plan.accounts.map(String));
  const fields  = new Set(plan.fields);

  // Merge de datos por número de cuenta
  const byNumber = new Map();
  for (const a of accountIndex) byNumber.set(a.number, { ...a });

  // Enriquecer con drive intelligence
  const diAccounts = (driveIntelligence && Array.isArray(driveIntelligence.accounts))
    ? driveIntelligence.accounts : [];
  for (const d of diAccounts) {
    const n = String(d.number || d.account_id || "").trim();
    if (!n) continue;
    const rec = byNumber.get(n) || {};
    byNumber.set(n, { ...rec, number: n, _di: d });
  }

  // Enriquecer con computedAccounts
  for (const a of computedAccounts) {
    const n = String(a.number || "").trim();
    if (!n) continue;
    const rec = byNumber.get(n) || {};
    byNumber.set(n, { ...rec, number: n, _ca: a });
  }

  const lines = [];

  // Briefing ejecutivo (no filtrado por cuenta)
  if (fields.has("briefing") && driveIntelligence?.executive_briefing) {
    lines.push("## Briefing ejecutivo del portafolio");
    lines.push(String(driveIntelligence.executive_briefing).slice(0, 2000));
    lines.push("");
  }

  // Datos por cuenta
  const accounts = Array.from(byNumber.values())
    .filter(a => wantAll || wantSet.has(a.number))
    .slice(0, 20); // máximo 20 cuentas en contexto

  if (accounts.length) {
    lines.push("## Datos de cuentas");
    for (const a of accounts) {
      const ca = a._ca || {};
      const di = a._di || {};
      const summary = di.account_summary || {};
      const parts = [`**#${a.number} ${a.name || ca.name || di.account_name || "?"}**`];

      if (fields.has("scores")) {
        const g = ca.global ?? a.global ?? "—";
        const co = ca.co ?? "—"; const pq = ca.pq ?? "—"; const sc = ca.sc ?? "—";
        const color = ca.color ?? a.color ?? "—";
        parts.push(`score=${g} (CO=${co} PQ=${pq} SC=${sc}) color=${color}`);
      }

      if (fields.has("risk")) {
        const risk = summary.business_risk;
        const txt  = summary.content_summary;
        if (risk) parts.push(`riesgo: ${String(risk).slice(0, 150)}`);
        if (txt)  parts.push(`estado: ${String(txt).slice(0, 200)}`);
      }

      if (fields.has("action")) {
        const act = summary.recommended_action;
        const urg = _toArr(summary.urgent_actions || summary.immediate_actions)
          .slice(0, 2).map(x => _str(x)).filter(Boolean);
        if (act) parts.push(`acción: ${String(act).slice(0, 150)}`);
        if (urg.length) parts.push(`urgente: ${urg.join(" | ")}`);
      }

      if (fields.has("contract")) {
        const cs = ca.contractStatus || {};
        if (cs.status) {
          let c = `contrato=${cs.status}`;
          if (cs.filename_evidence) c += ` (${String(cs.filename_evidence).slice(0, 50)})`;
          if (cs.months_old != null) c += ` ${cs.months_old}m antigüedad`;
          parts.push(c);
        }
      }

      if (fields.has("checklist")) {
        const ful = _toArr(summary.fulfilled);
        const pen = _toArr(summary.pending);
        if (ful.length || pen.length) {
          parts.push(`checklist: ✓${ful.length} cumplidos | ✗${pen.length} pendientes`);
          if (pen.length) {
            parts.push(`pendientes: ${pen.slice(0, 3).map(x => _str(x)).join(" · ")}`);
          }
        }
      }

      if (fields.has("activity") && syncData) {
        const syncAcc = (syncData.accounts || []).find(s => String(s.number) === a.number);
        if (syncAcc?.subfolderActivity) {
          const sa = syncAcc.subfolderActivity;
          const bits = Object.entries(sa)
            .map(([k, v]) => v ? `${k}:${v.fileCount ?? 0}f(${(v.latestModified || "").slice(0,10)})` : null)
            .filter(Boolean);
          if (bits.length) parts.push(`actividad: ${bits.join(" | ")}`);
        }
      }

      if (fields.has("opportunities")) {
        const opps = _toArr(summary.opportunities).slice(0, 2).map(x => _str(x)).filter(Boolean);
        const recs = _toArr(summary.strategic_recommendations).slice(0, 2).map(x => _str(x)).filter(Boolean);
        if (opps.length) parts.push(`oportunidades: ${opps.join(" · ")}`);
        if (recs.length) parts.push(`recomendaciones: ${recs.join(" · ")}`);
      }

      lines.push(parts.join("\n  "));
      lines.push("");
    }
  }

  let ctx = lines.join("\n");
  // Cap de seguridad: 12KB
  if (ctx.length > 12000) ctx = ctx.slice(0, 12000) + "\n[...contexto recortado]";
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 2 · Respondedor
// ─────────────────────────────────────────────────────────────────────────────

async function runAnswerer({ apiKey, question, context, model, budgetMs }) {
  const system = `Eres el analista del portafolio de Blackwell (firma de RP). Español mexicano, directo y operacional.

REGLAS:
1. Basa CADA afirmación en el CONTEXTO. Si algo no está, dilo: "no hay evidencia en Drive".
2. Cita cuentas con [#NN Nombre] — ej: [#09 AZVI], [#19 Casa Mata].
3. Sé conciso: máximo 6 frases o bullets cortos. Para listados usa "- ".
4. Si la pregunta es estratégica, termina con "Acción inmediata:" + 1-2 bullets.
5. NO uses headers (#). SÍ puedes usar **negritas**.

CONTEXTO:
${context}`;

  const resp = await callAnthropic({
    apiKey, model,
    system,
    messages: [{ role: "user", content: question }],
    max_tokens: 600,
    temperature: 0.1,
    budgetMs,
  });

  const text = extractText(resp).trim();
  const u = resp.usage || {};
  const rates = PRICING[model] || PRICING[HAIKU];
  return {
    text,
    usage: {
      model,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cost_usd: ((u.input_tokens || 0) / 1e6 * rates.input + (u.output_tokens || 0) / 1e6 * rates.output).toFixed(6),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Índice ligero de cuentas (~50 chars / cuenta)
// ─────────────────────────────────────────────────────────────────────────────

function buildAccountIndex(driveIntelligence, computedAccounts) {
  const map = new Map();

  if (driveIntelligence && Array.isArray(driveIntelligence.accounts)) {
    for (const a of driveIntelligence.accounts) {
      const n = String(a.number || a.account_id || "").trim();
      if (!n) continue;
      map.set(n, { number: n, name: a.account_name || `cuenta ${n}`, global: null, color: null, status: null });
    }
  }
  for (const a of computedAccounts) {
    const n = String(a.number || "").trim();
    if (!n) continue;
    const prev = map.get(n) || {};
    map.set(n, {
      ...prev, number: n,
      name: a.name || prev.name || `cuenta ${n}`,
      global: a.global ?? prev.global ?? null,
      color: a.color || prev.color || null,
      status: a.status || prev.status || null,
    });
  }
  return Array.from(map.values()).sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente Anthropic
// ─────────────────────────────────────────────────────────────────────────────

async function callAnthropic({ apiKey, model, system, messages, max_tokens, temperature, budgetMs }) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, budgetMs - 150));
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, system, messages, max_tokens, temperature }),
    });
    const raw = await r.text();
    if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${raw.slice(0, 200)}`);
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`JSON inválido de Anthropic: ${raw.slice(0, 100)}`); }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Timeout (${budgetMs}ms) llamando a ${model}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Citas [#NN Nombre] en el texto de respuesta
// ─────────────────────────────────────────────────────────────────────────────

function extractCitations(text, accountIndex) {
  const byNumber = new Map(accountIndex.map(a => [a.number, a]));
  const seen = new Set();
  const citations = [];
  const re = /\[#(\d{1,3})\s+([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = m[1].replace(/^0+/, "") || m[1];
    if (seen.has(n)) continue;
    seen.add(n);
    const cat = byNumber.get(m[1]) || byNumber.get(n);
    citations.push({ type: "account", id: n, label: cat ? cat.name : m[2].trim(), raw: m[0] });
  }
  return citations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _toArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

function _str(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    for (const k of ["text", "action", "opportunity", "risk", "recommendation", "item", "description"]) {
      if (typeof v[k] === "string") return v[k];
    }
    const first = Object.values(v).find(x => typeof x === "string");
    if (first) return first;
  }
  return String(v ?? "");
}

function cors(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(payload),
  };
}
