import { emptyState, applyLevel, decideClosure, closeState, shouldSendDigest, throttleOk, dedupKey } from "./crisisEngine.js";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, e); } };
const cfg = { level_threshold: 3, calm_hours: 48, reeval_throttle_minutes: 45, digest_hour_local: 7 };

// Abre crisis al cruzar el umbral
let st = emptyState("14", "DALINDE");
let r = applyLevel(st, 3, "2026-07-20T18:00:00Z", cfg);
ok("abre crisis en nivel 3", r.action === "open" && r.state.status === "active" && r.state.peak_level === 3);
st = r.state;

// Sostiene (mismo nivel) → no re-envía
r = applyLevel(st, 3, "2026-07-20T20:00:00Z", cfg);
ok("sostiene sin re-enviar", r.action === "sustain");
st = r.state;

// Escala a 4 → nuevo envío
r = applyLevel(st, 4, "2026-07-21T10:00:00Z", cfg);
ok("escala a 4", r.action === "escalate" && r.state.peak_level === 4);
st = r.state;

// Baja de umbral → deescalating (sin envío)
r = applyLevel(st, 1, "2026-07-22T09:00:00Z", cfg);
ok("baja a deescalating", r.action === "deescalate" && r.state.status === "deescalating");
st = r.state;

// last_active_at debe seguir siendo la última vez que estuvo >=3 (21 jul 10:00)
ok("last_active_at conserva último >=3", st.last_active_at === "2026-07-21T10:00:00Z");

// Cierre: aún no pasan 48h desde last_active (21 10:00 -> 22 09:00 = 23h)
ok("no cierra antes de 48h", decideClosure(st, "2026-07-22T09:00:00Z", cfg) === false);
// Cierre: pasan 48h+ (21 10:00 -> 23 12:00 = 50h)
ok("cierra tras 48h de calma", decideClosure(st, "2026-07-23T12:00:00Z", cfg) === true);
const closed = closeState(st, "2026-07-23T12:00:00Z");
ok("closeState marca closed", closed.status === "closed" && closed.closed_at);

// Re-apertura tras cierre: nueva crisis
r = applyLevel(closed, 3, "2026-08-01T15:00:00Z", cfg);
ok("reabre como nueva crisis", r.action === "open" && r.state.opened_at === "2026-08-01T15:00:00Z");

// Digest: 7am, activa, no enviado hoy
const active = { ...emptyState("21", "Nuvoil"), status: "active", last_active_at: "2026-07-21T10:00:00Z" };
ok("digest a las 7am", shouldSendDigest(active, 7, "2026-07-22", cfg) === true);
ok("no digest a otra hora", shouldSendDigest(active, 11, "2026-07-22", cfg) === false);
ok("no digest si ya se envió hoy", shouldSendDigest({ ...active, last_digest_on: "2026-07-22" }, 7, "2026-07-22", cfg) === false);
ok("no digest si no hay crisis", shouldSendDigest(emptyState("9"), 7, "2026-07-22", cfg) === false);

// Throttle
ok("throttle permite si nunca", throttleOk(emptyState("1"), "2026-07-22T07:00:00Z", cfg) === true);
ok("throttle bloquea <45min", throttleOk({ ...emptyState("1"), last_reeval_at: "2026-07-22T07:00:00Z" }, "2026-07-22T07:30:00Z", cfg) === false);
ok("throttle permite >=45min", throttleOk({ ...emptyState("1"), last_reeval_at: "2026-07-22T07:00:00Z" }, "2026-07-22T07:50:00Z", cfg) === true);

// Dedup keys
const s2 = { account_id: "14", opened_at: "2026-07-20T18:00:00Z", peak_level: 4 };
ok("dedup escalation por pico", dedupKey("escalation", s2) === "esc:14:2026-07-20T18:00:00Z:L4");
ok("dedup digest por día", dedupKey("digest", s2, "2026-07-22") === "dig:14:2026-07-22");
ok("dedup closure por crisis", dedupKey("closure", s2) === "clo:14:2026-07-20T18:00:00Z");

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
