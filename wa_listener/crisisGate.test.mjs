import { evaluateMessage, scoreText, normalize } from "./crisisGate.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra); }
}

// --- normalización ---
check("normaliza acentos/mayus", normalize("MANIFESTACIÓN") === "manifestacion");
check("colapsa repeticiones", normalize("ayudaaaaa") === "ayudaa");
check("no mutila años", /2026/.test(normalize("el 21 de julio 2026")));
check("url -> token", normalize("miren esto https://x.com/abc") .includes("_url_"));

// --- POSITIVOS: deben DISPARAR (cuenta no en crisis, umbral 3) ---
const P = [
  ["marcha convocada", "El esposo publicó un video y convoca a una MARCHA afuera del hospital mañana"],
  ["manifestacion", "Hay una manifestación programada en las instalaciones"],
  ["demanda legal", "El afectado dice que va a proceder legalmente y meter una demanda"],
  ["viral", "Esto se está volviendo viral en TikTok, ya es tendencia"],
  ["escalada explicita", "Esto se está saliendo de control, cada vez peor"],
  ["exhibir/amenaza", "Amenaza con exhibir al hospital y hacerlo público, ya grabé todo"],
  ["cliente furioso + urgente", "Esto es inaceptable, exijo una respuesta urgente ahora mismo"],
];
for (const [name, text] of P) {
  const r = evaluateMessage({ text, fromClient: true }, {});
  check("DISPARA " + name, r.tripped, `score=${r.score} thr=${r.threshold} [${r.reasons}]`);
}

// --- NEGATIVOS: NO deben disparar ---
const N = [
  ["saludo", "Buenos días equipo, ¿cómo amanecieron?"],
  ["agradecimiento", "Gracias por el reporte, todo bien por acá"],
  ["reporte BWS sin novedad", "Reporte de monitoreo: sin menciones negativas al corte de hoy"],
  ["negado: no hay marcha", "Tranquilos, NO hay ninguna marcha, se descartó"],
  ["negado: cancelaron manifestacion", "Buenas noticias: cancelaron la manifestación"],
  ["una sola señal media", "vi un reportero por ahí"],
  ["operativo normal", "¿Me confirmas el título de la nota para publicarla?"],
];
for (const [name, text] of N) {
  const r = evaluateMessage({ text, fromClient: true }, {});
  check("NO dispara " + name, !r.tripped, `score=${r.score} thr=${r.threshold} [${r.reasons}]`);
}

// --- Reporte de monitoreo de BWS: palabras de medios pesan menos ---
const bwsReport = "Reporte: hubo una nota negativa en un medio menor, cobertura de un periodista";
const asClient = evaluateMessage({ text: bwsReport, fromClient: true }, {});
const asBWS = evaluateMessage({ text: bwsReport, fromClient: false }, {});
check("BWS pesa menos que cliente", asBWS.score < asClient.score, `bws=${asBWS.score} cli=${asClient.score}`);

// --- Umbral adaptativo: en crisis activa una señal media basta ---
const midSignal = "oye vi un reportero por aqui rondando";
const notInCrisis = evaluateMessage({ text: midSignal, fromClient: true }, { alreadyInCrisis: false });
const inCrisis = evaluateMessage({ text: midSignal, fromClient: true }, { alreadyInCrisis: true });
check("en crisis es más sensible", inCrisis.tripped && !notInCrisis.tripped,
  `inCrisis=${inCrisis.tripped}(${inCrisis.score}/${inCrisis.threshold}) normal=${notInCrisis.tripped}(${notInCrisis.score}/${notInCrisis.threshold})`);

// --- Pico de volumen dispara sin palabras clave ---
const volume = evaluateMessage({ text: "??", fromClient: true }, { recentCount: 15, windowMinutes: 20, volumeBaseline: 3 });
check("pico de volumen dispara", volume.tripped, `score=${volume.score} [${volume.reasons}]`);

// --- De-escalación se detecta (para cierre) ---
const de = scoreText("Ya se resolvió, se disculparon y cancelaron la marcha, todo en calma");
check("detecta de-escalación", de.deEscalationScore >= 2, `deEsc=${de.deEscalationScore}`);

// --- Caso real Dalinde ---
const dalinde = "El esposo de la paciente publicó un reel acusando al hospital de negligencia y convocó a una manifestación afuera del Hospital San Ángel Inn para mañana a las 12";
const rd = evaluateMessage({ text: dalinde, fromClient: false }, {});
check("caso Dalinde dispara (aun reportado por BWS)", rd.tripped, `score=${rd.score} [${rd.reasons}]`);

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
