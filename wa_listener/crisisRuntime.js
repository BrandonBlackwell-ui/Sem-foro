/**
 * Runtime de crisis para el wa_listener: conecta el portero (crisisGate) con el motor
 * (crisisEngine). Expone dos ganchos que index.js invoca:
 *   - onMessages(sock, rows): por cada lote de mensajes entrantes.
 *   - startTimers(sock): arranca el envío de la outbox, el digest de las 7am y el cierre 48h.
 *
 * Todo va envuelto en try/catch: una falla aquí NUNCA debe tumbar al listener.
 */

import { evaluateMessage } from "./crisisGate.js";
import * as engine from "./crisisEngine.js";

const IGNORE_ACCOUNTS = new Set(["00_UNMAPPED", "00_INTERNAL"]);
const VOLUME_WINDOW_MS = 20 * 60 * 1000;
const volume = new Map(); // account_id -> [epochMs,...] (últimos 20 min)

function trackVolume(accountId, epochMs) {
  const arr = (volume.get(accountId) || []).filter((t) => epochMs - t <= VOLUME_WINDOW_MS);
  arr.push(epochMs);
  volume.set(accountId, arr);
  return arr.length;
}

function isClient(team) {
  return /client|cliente/i.test(String(team || ""));
}

function crisisEnabledEnv() {
  // El motor puede DETECTAR y encolar aunque el envío esté apagado; esto solo evita
  // gastar LLM si ni siquiera hay API key.
  return Boolean(process.env.OPENROUTER_API_KEY) &&
    String(process.env.CRISIS_DETECT_ENABLED || "true").toLowerCase() !== "false";
}

/** Gancho por lote de mensajes. */
export async function onMessages(sock, rows) {
  if (!crisisEnabledEnv() || !Array.isArray(rows) || !rows.length) return;
  try {
    const cfg = engine.loadPrompts().config;

    // Agrupar por cuenta, ignorando salientes/sistema/cuentas internas.
    const byAccount = new Map();
    for (const r of rows) {
      const acc = String(r.account_id || "");
      if (!acc || IGNORE_ACCOUNTS.has(acc)) continue;
      if (r.from_me) continue;
      if (!r.body || r.msg_type === "system") continue;
      if (!byAccount.has(acc)) byAccount.set(acc, { name: r.group_name, msgs: [] });
      byAccount.get(acc).msgs.push(r);
    }

    for (const [accountId, { name, msgs }] of byAccount) {
      let state = await engine.loadState(accountId, name);
      const alreadyInCrisis = state.status === "active" || state.status === "deescalating";

      // Correr el portero por cada mensaje; quedarnos con el de mayor señal.
      let best = null;
      for (const m of msgs) {
        const epochMs = new Date(m.sent_at).getTime() || Date.now();
        const recentCount = trackVolume(accountId, epochMs);
        const res = evaluateMessage(
          { text: m.body, fromClient: isClient(m.speaker_team), isForwarded: false },
          { alreadyInCrisis, recentCount, windowMinutes: 20 }
        );
        if (res.tripped && (!best || res.score > best.score)) best = res;
      }
      if (!best) continue;

      const now = new Date().toISOString();
      if (!engine.throttleOk(state, now, cfg)) {
        console.log(`[crisis] ${accountId}: portero disparó (${best.reasons.join(",")}) pero throttle activo, se omite reeval.`);
        // Igual registramos el intento para el throttle.
        await engine.saveState({ ...state, last_reeval_at: now });
        continue;
      }

      console.log(`[crisis] ${accountId}: portero disparó [${best.reasons.join(",")}] score=${best.score} → re-evaluando nivel...`);
      let assessed;
      try {
        const context = await engine.recentMessagesText(accountId, 40);
        assessed = await engine.assessLevel(context || msgs.map((m) => m.body).join("\n"));
      } catch (e) {
        console.error(`[crisis] ${accountId}: fallo assessLevel:`, e?.message || e);
        await engine.saveState({ ...state, last_reeval_at: now });
        continue;
      }

      const { action, state: newState } = engine.applyLevel(state, assessed.level, now, cfg);
      newState.account_name = newState.account_name || name;
      if (assessed.type) newState.crisis_signature = newState.crisis_signature; // firma ya seteada al abrir
      await engine.saveState(newState);
      console.log(`[crisis] ${accountId}: nivel=${assessed.level} (${assessed.type || "-"}) acción=${action}`);

      if (action === "open" || action === "escalate") {
        try {
          const context = await engine.recentMessagesText(accountId, 50);
          const document = await engine.buildCrisisDocument({
            accountName: newState.account_name || accountId,
            level: newState.peak_level,
            context: `${assessed.oneLiner || ""}\n${context}`.trim(),
            kind: "escalation",
          });
          await engine.enqueue({
            account_id: accountId,
            account_name: newState.account_name || null,
            kind: "escalation",
            level: newState.peak_level,
            title: `🚨 CRISIS NIVEL ${newState.peak_level} — ${newState.account_name || accountId}`,
            document,
            to_phones: engine.allowlist(),
            dedup_key: engine.dedupKey("escalation", newState),
          });
          console.log(`[crisis] ${accountId}: documento de escalada encolado (nivel ${newState.peak_level}).`);
        } catch (e) {
          console.error(`[crisis] ${accountId}: fallo generando/encolando documento:`, e?.message || e);
        }
      }
    }
  } catch (e) {
    console.error("[crisis] onMessages error:", e?.message || e);
  }
}

function localHourAndDate(tz) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Revisa crisis activas: manda digest a las 7am y cierra tras 48h de calma. */
async function digestAndClosureTick() {
  if (!crisisEnabledEnv()) return;
  try {
    const cfg = engine.loadPrompts().config;
    const { hour, date } = localHourAndDate(cfg.timezone || "America/Mexico_City");
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const crises = await engine.activeCrises();
    const now = new Date().toISOString();

    for (const state of crises) {
      // Cierre por calma 48h
      if (engine.decideClosure(state, now, cfg)) {
        try {
          const ctx = await engine.daySummary(state.account_id, yesterday);
          const document = await engine.buildCrisisDocument({
            accountName: state.account_name || state.account_id, level: state.peak_level, context: ctx, kind: "closure",
          });
          await engine.enqueue({
            account_id: state.account_id, account_name: state.account_name, kind: "closure", level: 0,
            title: `✅ CRISIS CERRADA — ${state.account_name || state.account_id}`,
            document, to_phones: engine.allowlist(), dedup_key: engine.dedupKey("closure", state),
          });
          await engine.saveState(engine.closeState(state, now));
          console.log(`[crisis] ${state.account_id}: cerrada (48h de calma).`);
        } catch (e) { console.error("[crisis] cierre error:", e?.message || e); }
        continue;
      }
      // Digest 7am
      if (engine.shouldSendDigest(state, hour, date, cfg)) {
        try {
          const ctx = await engine.daySummary(state.account_id, yesterday);
          const document = await engine.buildCrisisDocument({
            accountName: state.account_name || state.account_id, level: state.level || state.peak_level, context: ctx, kind: "digest",
          });
          await engine.enqueue({
            account_id: state.account_id, account_name: state.account_name, kind: "digest", level: state.level || state.peak_level,
            title: `📋 ACTUALIZACIÓN CRISIS — ${state.account_name || state.account_id}`,
            document, to_phones: engine.allowlist(), dedup_key: engine.dedupKey("digest", state, date),
          });
          await engine.saveState({ ...state, last_digest_on: date });
          console.log(`[crisis] ${state.account_id}: digest 7am encolado.`);
        } catch (e) { console.error("[crisis] digest error:", e?.message || e); }
      }
    }
  } catch (e) {
    console.error("[crisis] digestAndClosureTick error:", e?.message || e);
  }
}

/**
 * Arranca los timers: envío de outbox (frecuente) + digest/cierre (cada 15 min).
 * @param {Function|object} sockOrGetter  socket o función que devuelve el socket vigente
 *   (usar getter para que sobreviva a reconexiones).
 */
let timersStarted = false;
export function startTimers(sockOrGetter) {
  if (timersStarted) return;
  timersStarted = true;
  const getSock = typeof sockOrGetter === "function" ? sockOrGetter : () => sockOrGetter;
  const senderMs = 45 * 1000;
  const tickMs = 15 * 60 * 1000;
  const s1 = setInterval(() => {
    const sock = getSock();
    if (sock) engine.sendPending(sock).catch((e) => console.error("[crisis] sendPending:", e?.message || e));
  }, senderMs);
  const s2 = setInterval(() => { digestAndClosureTick().catch((e) => console.error("[crisis] tick:", e?.message || e)); }, tickMs);
  s1.unref?.(); s2.unref?.();
  console.log(`[crisis] timers activos (envío cada ${senderMs / 1000}s, digest/cierre cada ${tickMs / 60000}min). Envío ${engine.sendingEnabled() ? "HABILITADO" : "APAGADO (CRISIS_ALERTS_ENABLED!=true)"}. Allowlist: ${engine.allowlist().join(",")}`);
}

export default { onMessages, startTimers };
