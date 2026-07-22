/**
 * Portero de crisis (crisis gate) — FILTRO LOCAL SIN IA.
 *
 * Su único trabajo: decidir, por cada mensaje entrante en tiempo real, si vale la pena
 * gastar UNA re-evaluación con LLM del nivel de crisis de la cuenta. NO decide el nivel
 * (eso lo hace el LLM); solo filtra el costo. Diseñado para ser barato, robusto y
 * tolerante: los falsos positivos solo cuestan una llamada barata; los falsos negativos
 * los atrapan las corridas programadas (5/día).
 *
 * Robustez:
 *  - Normalización agresiva (acentos, mayúsculas, repetición de letras, leet básico, URLs).
 *  - Léxico ponderado por categoría (movilización, legal, viralidad, amenaza, sentimiento,
 *    escalada explícita) con límites de palabra para evitar coincidencias parciales.
 *  - Manejo de NEGACIÓN ("no hay marcha", "se canceló la manifestación") → no dispara, y
 *    alimenta la señal de DE-ESCALACIÓN (para cerrar la crisis).
 *  - Conciencia de hablante: los reportes de monitoreo de Blackwell traen palabras
 *    negativas por diseño (es el servicio), así que pesan menos que la angustia del cliente.
 *  - Picos de volumen y ráfagas de reenvíos/enlaces.
 *  - Umbral adaptativo: si la cuenta YA está en crisis, el portero es más sensible.
 *
 * Sin dependencias. ESM.
 */

// --- Normalización -----------------------------------------------------------

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

export function normalize(text) {
  let t = String(text == null ? "" : text).toLowerCase();
  // quitar acentos/diacríticos
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // URLs -> token (para no puntuar por el texto de un link, pero sí saber que hubo enlace)
  t = t.replace(/https?:\/\/\S+/g, " _url_ ");
  // leet básico SOLO cuando el símbolo está pegado a una letra (dentro de una palabra),
  // para no mutilar números sueltos (años, teléfonos, montos).
  t = t.replace(/(?<=[a-z])[013457@$]|[013457@$](?=[a-z])/g, (c) => LEET[c] || c);
  // colapsar repeticiones de 3+ letras iguales: "ayudaaaa" -> "ayuda"
  t = t.replace(/(.)\1{2,}/g, "$1$1");
  // dejar solo letras/números/espacios y guiones bajos del token _url_
  t = t.replace(/[^a-z0-9_\s]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// --- Léxico ponderado --------------------------------------------------------
// weight: 3 = fuerte (una sola dispara), 2 = medio (dos disparan), 1 = leve.
// Cada patrón es una expresión con límites de palabra ya insertados por buildRe().

function buildRe(term) {
  // term puede traer espacios (frase). Usamos límites de palabra en los extremos.
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`);
}

const RAW_SIGNALS = [
  // Movilización física — lo más grave en PR/reputación
  ["movilizacion", 3, ["marcha", "manifestacion", "manifestarse", "planton", "protesta", "protestar",
    "boicot", "boicotear", "bloqueo", "bloquear", "paro", "concentracion", "mitin",
    "nos vemos afuera", "afuera del", "toma de instalaciones", "tomar las instalaciones"]],
  // Legal
  ["legal", 3, ["demanda", "demandar", "denuncia", "denunciar", "fiscalia", "fgr", "profeco", "conapred",
    "citatorio", "amparo", "orden de", "notificacion legal", "accion legal", "proceder legalmente",
    "carpeta de investigacion", "querella"]],
  // Viralidad / medios
  ["viralidad", 3, ["viral", "viralizando", "viralizo", "tendencia", "trending", "se esta volviendo",
    "cadena nacional", "portada", "primera plana", "exhibio", "exhibir", "exhibiendo", "expuso",
    "ya salio en", "nota negativa", "reportaje", "columna en contra", "linchamiento", "funar", "funaron"]],
  ["medios_mencion", 2, ["reportero", "periodista", "medios", "prensa", "twitter", "tiktok",
    "facebook", "instagram", "youtube", "influencer", "youtuber", "tiktoker", "cobertura"]],
  // Amenaza / daño reputacional
  ["amenaza", 2, ["amenaza", "amenazo", "amenazar", "voy a subir", "ya grabe", "tengo evidencia",
    "tengo pruebas", "captura de pantalla", "screenshots", "difundir", "voy a exponer", "que se enteren",
    "hacerlo publico", "hacerlo viral", "lo voy a publicar", "video denunciando"]],
  // Escalada explícita
  ["escalada", 3, ["se esta saliendo de control", "fuera de control", "se salio de control",
    "cada vez peor", "esta explotando", "exploto", "se nos fue", "se desbordo", "esto ya es una crisis",
    "estamos en crisis", "situacion critica", "se agravo", "empeoro", "escalando"]],
  // Sentimiento negativo fuerte (pesa más si lo dice el cliente)
  ["sentimiento", 2, ["inaceptable", "indignante", "pesimo", "una verguenza", "exijo", "exigimos",
    "estoy muy molesto", "estoy muy molesta", "muy molesto", "muy molesta", "es el colmo",
    "no es posible", "como es posible", "esto no puede ser", "estoy furioso", "estoy furiosa",
    "decepcionado", "decepcionada", "queja formal", "pongo una queja"]],
  ["urgencia", 1, ["urgente", "emergencia", "urge", "ahora mismo", "de inmediato", "ya mismo",
    "no puede esperar", "prioridad maxima", "codigo rojo"]],
  // Actores/temas que suelen implicar crisis pública
  ["actores", 2, ["mananera", "presidencia", "gobernador", "alcaldesa", "alcalde", "diputado", "senador",
    "sindicato", "colectivo", "victima", "victimas", "afectado", "afectados", "negligencia"]],
];

// Señales de DE-ESCALACIÓN (para el cierre de crisis, ventana de calma 48h).
const RAW_DEESCALATION = [
  "se calmo", "se calmaron", "bajo la tension", "ya bajo", "se resolvio", "resuelto", "ya quedo",
  "quedo resuelto", "se aclaro", "aclarado", "se disculparon", "se disculpo", "se retracto",
  "retiraron la", "cancelaron la marcha", "cancelo la marcha", "se cancelo la manifestacion",
  "sin novedad", "sin novedades", "todo tranquilo", "todo en calma", "controlado", "bajo control",
  "cerramos el tema", "tema cerrado", "ya no hay", "se detuvo", "se freno"];

// Negadores que, si preceden de cerca a una señal, la anulan (o la vuelven de-escalación).
const NEGATORS = ["no", "sin", "ningun", "ninguna", "ningunos", "nunca", "jamas", "tampoco",
  "ya no", "se cancelo", "cancelaron", "cancelo", "cancelar", "cancelada", "cancelado",
  "descartado", "descartada", "descartamos", "evitar", "evitamos", "evito", "prevenir",
  "para que no", "no hubo", "no hay", "no habra", "se evito", "sin riesgo"];

// buildRe ya agrega límites de palabra; se prueba contra " "+texto+" " para cubrir extremos.
const SIGNALS = RAW_SIGNALS.flatMap(([category, weight, terms]) =>
  terms.map((term) => ({ category, weight, term, re: buildRe(term) }))
);
const DEESCALATION = RAW_DEESCALATION.map((term) => ({ term, re: buildRe(term) }));
const NEGATOR_RES = NEGATORS.map((n) => ({ term: n, re: buildRe(n) }));

// ¿Hay un negador dentro de las `windowWords` palabras ANTES de la posición idx (en palabras)?
function negatedNear(words, hitWordIdx, windowWords = 3) {
  const start = Math.max(0, hitWordIdx - windowWords);
  const slice = words.slice(start, hitWordIdx).join(" ");
  const padded = " " + slice + " ";
  return NEGATOR_RES.some((n) => n.re.test(padded));
}

function firstWordIndexOf(words, term) {
  const first = term.split(" ")[0];
  return words.indexOf(first);
}

// --- Evaluación de un texto --------------------------------------------------

/**
 * @param {string} text  texto crudo del mensaje
 * @param {object} opts  { fromClient?: boolean }  (mensajes del cliente pesan más;
 *                        los reportes de monitoreo de Blackwell pesan menos)
 * @returns {{score:number, deEscalationScore:number, signals:Array, negated:Array}}
 */
export function scoreText(text, opts = {}) {
  const norm = normalize(text);
  const padded = " " + norm + " ";
  const words = norm.split(" ").filter(Boolean);
  const fromClient = opts.fromClient !== false; // por defecto tratamos como cliente (más sensible)

  const signals = [];
  const negated = [];
  let score = 0;

  for (const sig of SIGNALS) {
    if (!sig.re.test(padded)) continue;
    const wIdx = firstWordIndexOf(words, sig.term);
    if (wIdx >= 0 && negatedNear(words, wIdx)) {
      negated.push({ ...pick(sig), reason: "negado" });
      continue;
    }
    let w = sig.weight;
    // Reportes de monitoreo de Blackwell: las palabras de medios/viralidad/sentimiento
    // son parte del servicio (no angustia del cliente) → pesan la mitad. La movilización,
    // lo legal y la escalada explícita pesan igual (un hecho es un hecho lo diga quien lo diga).
    if (!fromClient && ["viralidad", "medios_mencion", "sentimiento", "urgencia"].includes(sig.category)) {
      w = w / 2;
    }
    score += w;
    signals.push({ ...pick(sig), weight: w });
  }

  let deEscalationScore = 0;
  for (const d of DEESCALATION) {
    if (d.re.test(padded)) { deEscalationScore += 1; }
  }

  return { score: round1(score), deEscalationScore, signals, negated, norm };
}

function pick(sig) { return { category: sig.category, term: sig.term }; }
function round1(n) { return Math.round(n * 10) / 10; }

// --- Decisión del portero (con contexto) ------------------------------------

/**
 * Decide si disparar una re-evaluación con LLM.
 * @param {object} msg   { text, fromClient?, isForwarded?, hasMedia? }
 * @param {object} ctx   {
 *    alreadyInCrisis?: boolean,      // la cuenta ya está en crisis activa
 *    recentCount?: number,           // # de mensajes en la ventana reciente
 *    windowMinutes?: number,         // tamaño de esa ventana
 *    volumeBaseline?: number,        // volumen "normal" esperado en esa ventana
 *    forwardedBurst?: number,        // # de reenvíos recientes
 * }
 * @returns {{ tripped:boolean, score:number, deEscalationScore:number, threshold:number,
 *             reasons:string[], signals:Array }}
 */
export function evaluateMessage(msg = {}, ctx = {}) {
  const { score, deEscalationScore, signals } = scoreText(msg.text || "", { fromClient: msg.fromClient });
  const reasons = signals.map((s) => `${s.category}:${s.term}`);

  let total = score;

  // Pico de volumen: mucho más tráfico del normal en poco tiempo (indicador clásico de que
  // "algo está pasando" aunque las palabras no lo digan).
  const recent = Number(ctx.recentCount || 0);
  const baseline = Number(ctx.volumeBaseline || 0);
  const window = Number(ctx.windowMinutes || 0);
  if (recent >= 12 && (baseline === 0 || recent >= baseline * 3)) {
    total += 3; // pico fuerte: puede disparar por sí solo (algo está pasando)
    reasons.push(`volumen:${recent}${window ? `/${window}min` : ""}`);
  } else if (recent >= 8 && baseline && recent >= baseline * 2) {
    total += 1;
    reasons.push(`volumen:${recent}`);
  }

  // Ráfaga de reenvíos (una nota/video circulando).
  if (Number(ctx.forwardedBurst || 0) >= 3) {
    total += 1;
    reasons.push(`reenvios:${ctx.forwardedBurst}`);
  }
  if (msg.isForwarded && signals.length) {
    total += 0.5; // un reenvío CON señal pesa un poco más (algo se está difundiendo)
  }

  // Umbral adaptativo: si ya hay crisis activa, somos más sensibles (queremos cazar la escalada).
  const threshold = ctx.alreadyInCrisis ? 2 : 3;
  const tripped = total >= threshold;

  return {
    tripped,
    score: round1(total),
    deEscalationScore,
    threshold,
    reasons,
    signals,
  };
}

export const _internals = { SIGNALS, DEESCALATION, NEGATOR_RES, buildRe };
export default { normalize, scoreText, evaluateMessage };
