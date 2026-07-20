// Simulador de escenarios de Pepe Aguilar ("PEPE QUEST").
// Toma los reportes REALES del Supabase dedicado de Pepe (solo lectura),
// arma un contexto compacto y le pide al LLM (z-ai/glm-5.2 vía OpenRouter)
// escenarios con probabilidades para una acción hipotética que escribe el usuario.
//
// Ruta de producción: POST /api/pepe-simulator (la key vive en Vercel).
// Fallback local (npm run dev sin funciones de Vercel): llamada directa a
// OpenRouter con VITE_OPENROUTER_API_KEY desde dashboard/.env.local.

import { fetchPepeReports, type PepeReport, type ReportAnalysis } from './pepeReports'

export const SIM_MODEL = 'z-ai/glm-5.2'

export type SimScenario = {
  titulo: string
  probabilidad: number // 0-100, todas suman ~100
  impacto_reputacion: number // -10 (desastre) .. +10 (triunfo)
  horizonte: string // ej. "24-48 horas"
  por_que: string // razonamiento anclado en los reportes
  senales: string[] // señales textuales de los reportes reales que lo sustentan
  reaccion_redes: string // qué pasaría en las redes monitoreadas
  riesgo: 'bajo' | 'medio' | 'alto' | 'critico'
}

export const SCENE_CHARACTERS = ['angela', 'emiliano', 'leonardo', 'fan', 'abogado'] as const
export type SceneCharacter = typeof SCENE_CHARACTERS[number]
export const SCENE_ANIMATIONS = ['cantar', 'foto', 'entrevista', 'fiesta', 'crisis', 'silencio', 'idle'] as const
export type SceneAnimation = typeof SCENE_ANIMATIONS[number]
export const SCENE_AMBIENTES = ['dia', 'atardecer', 'noche'] as const
export type SceneAmbiente = typeof SCENE_AMBIENTES[number]

export type SimDialog = { quien: string; texto: string }

// Dirección de escena: el oráculo dicta qué se actúa en el mundo 8-bits.
export type SimEscena = {
  personajes: SceneCharacter[] // quiénes entran a escena (además de Pepe y la prensa)
  animacion: SceneAnimation
  ambiente: SceneAmbiente // iluminación/hora del mundo según la situación
  dialogos: SimDialog[] // líneas cortas que van diciendo los personajes
}

export type SimTurn = {
  lectura: string // lectura del narrador sobre la jugada
  escenarios: SimScenario[]
  recomendacion: string // consejo del estratega
  escena: SimEscena
}

export type SimHistoryEntry = {
  accion: string
  escenario_ocurrido: string // título del escenario que el jugador eligió como "lo que pasó"
  impacto: number
}

// ── Contexto: comprimir los reportes reales a lo esencial ────────────────────

function compactAnalysis(a: ReportAnalysis | null): Record<string, unknown> | null {
  if (!a) return null
  const out: Record<string, unknown> = {}
  if (a.nivel_riesgo) out.nivel_riesgo = a.nivel_riesgo
  if (a.sentimiento) out.sentimiento = a.sentimiento
  if (Array.isArray(a.resumen_ejecutivo)) out.resumen = a.resumen_ejecutivo.slice(0, 3)
  if (Array.isArray(a.alertas)) out.alertas = a.alertas.slice(0, 4)
  if (Array.isArray(a.oportunidades)) out.oportunidades = a.oportunidades.slice(0, 3)
  if (a.desglose_por_red) {
    const redes: Record<string, unknown> = {}
    for (const [red, b] of Object.entries(a.desglose_por_red).slice(0, 6)) {
      redes[red] = {
        tendencia: b?.tendencia,
        lectura: typeof b?.lectura === 'string' ? b.lectura.slice(0, 220) : undefined,
        focos: Array.isArray(b?.focos) ? b.focos.slice(0, 3) : undefined,
        sentimiento: b?.sentimiento,
        posts: b?.posts,
        comentarios: b?.comentarios,
      }
    }
    out.por_red = redes
  }
  const voces = a.analisis_voces
  if (voces) {
    const pick = (arr?: import('./pepeReports').ReportVoice[]) =>
      (arr ?? []).slice(0, 3).map(v => ({
        quien: v.nombre || v.username,
        tono: v.tono,
        impacto: v.impacto,
        cita: (v.titular_ejemplo || v.comentario_o_post || '').slice(0, 140) || undefined,
        likes: v.likes,
        followers: v.followers,
        alcance: v.alcance,
      }))
    out.voces = {
      criticos: pick(voces.criticos_destacados),
      aliados: pick(voces.aliados_destacados),
      medios: pick(voces.medios_destacados),
    }
  }
  if (a.comparativa_historica?.resumen) out.tendencia_historica = a.comparativa_historica.resumen
  return out
}

/** Compactación ligera para reportes históricos (solo lo citable: fecha + datos duros). */
function compactHistorical(a: ReportAnalysis | null): Record<string, unknown> | null {
  if (!a) return null
  const out: Record<string, unknown> = {}
  if (a.nivel_riesgo) out.nivel_riesgo = a.nivel_riesgo
  if (a.sentimiento) out.sentimiento = a.sentimiento
  if (Array.isArray(a.resumen_ejecutivo)) out.resumen = a.resumen_ejecutivo.slice(0, 2)
  if (Array.isArray(a.alertas)) out.alertas = a.alertas.slice(0, 2)
  return out
}

/** Toma el reporte más reciente de cada tema + históricos con fecha para que el
 *  oráculo pueda citar "el 13 de julio en Facebook pasó X con tantas reacciones". */
export function buildReportsContext(reports: PepeReport[], max = 8, maxHist = 8): string {
  const byTheme = new Map<string, PepeReport>()
  for (const r of reports) {
    const key = r.theme_key || r.theme_label || 'otro'
    if (!byTheme.has(key)) byTheme.set(key, r) // ya vienen ordenados date_key desc
  }
  const picked = Array.from(byTheme.values()).slice(0, max)
  const pickedIds = new Set(picked.map(r => r.id))
  const ctx = picked.map(r => ({
    fecha: r.date_key,
    tema: r.theme_label || r.theme_key,
    analisis: compactAnalysis(r.ai_analysis),
  }))
  // Históricos: días anteriores (prioriza panoramas) para dar memoria con fechas.
  const historical = reports
    .filter(r => !pickedIds.has(r.id))
    .sort((a, b) => {
      const aPano = /panorama/i.test(a.theme_key || a.theme_label || '') ? 0 : 1
      const bPano = /panorama/i.test(b.theme_key || b.theme_label || '') ? 0 : 1
      return aPano - bPano || String(b.date_key).localeCompare(String(a.date_key))
    })
    .slice(0, maxHist)
    .map(r => ({
      fecha: r.date_key,
      tema: r.theme_label || r.theme_key,
      analisis: compactHistorical(r.ai_analysis),
    }))
  return JSON.stringify({ recientes_por_tema: ctx, historico_dias_previos: historical })
}

/** Nivel de riesgo del panorama más reciente → corazones iniciales (0-10). */
export function initialReputation(reports: PepeReport[]): { hearts: number; riesgo: string } {
  const pano = reports.find(r => /panorama/i.test(r.theme_key || r.theme_label || ''))
    ?? reports[0]
  const nivel = String(pano?.ai_analysis?.nivel_riesgo ?? 'medio').toLowerCase()
  const hearts =
    /cr[ií]tico/.test(nivel) ? 2 :
    /alto/.test(nivel) ? 3.5 :
    /medio/.test(nivel) ? 6 :
    /bajo/.test(nivel) ? 8 : 5
  return { hearts, riesgo: nivel }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el ORÁCULO de "PEPE QUEST", un simulador de escenarios de reputación para Pepe Aguilar (cantante mexicano de regional/mariachi, dinastía Aguilar: esposa Aneliz, hijos Emiliano, Aneliz, Leonardo; Ángela y Leonardo también cantantes; Emiliano estuvo alejado del ojo público y es tema sensible/mediático).

Recibes:
1) MONITOREO REAL: los reportes más recientes de redes y reputación de Pepe (datos reales, generados por su sistema de monitoreo).
2) HISTORIA: las jugadas previas del jugador en esta partida (si las hay).
3) ACCIÓN: lo que el jugador propone que Pepe haga.

Tu trabajo: proyectar qué pasaría, ANCLADO en los datos del monitoreo (sentimiento actual, alertas activas, focos por red, voces críticas/aliadas, tendencias). No inventes datos de monitoreo; si citas una señal, debe venir del contexto.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`), con esta forma exacta:
{
  "lectura": "1-2 frases de narrador de videojuego sobre la jugada, en español",
  "escenarios": [
    {
      "titulo": "nombre corto del escenario (máx 8 palabras)",
      "probabilidad": 45,
      "impacto_reputacion": -3,
      "horizonte": "24-48 horas",
      "por_que": "explicación de 2-4 frases. OBLIGATORIO: cita al menos una FECHA concreta del monitoreo (date_key), la RED donde pasó y una CIFRA (posts, comentarios, % de sentimiento, likes) o una cita textual. Ejemplo del nivel esperado: 'El 18 de julio Facebook consolidó el apodo X con 85% de sentimiento crítico en 8 notas; una colaboración reactivaría a esas mismas voces.'",
      "senales": ["cada señal con formato 'DD mes · Red: hecho textual — cifra' (ej. '18 jul · Facebook: apodo migajero consolidado — 85% crítico, 8 notas')", "otra señal con fecha+red+cifra"],
      "reaccion_redes": "qué pasaría red por red (TikTok/X/Instagram/Facebook/News) citando sus focos y números actuales",
      "riesgo": "bajo|medio|alto|critico"
    }
  ],
  "recomendacion": "consejo táctico de estratega de crisis en 1-3 frases, citando el dato que más pesa",
  "escena": {
    "personajes": ["angela"],
    "animacion": "cantar",
    "ambiente": "noche",
    "dialogos": [
      {"quien": "pepe", "texto": "¡Esta va con todo, mija!"},
      {"quien": "angela", "texto": "¡Vamos, apá!"},
      {"quien": "prensa", "texto": "*click* ¡exclusiva!"}
    ]
  }
}

Reglas de escenarios:
- Entre 3 y 4 escenarios, del más probable al menos probable.
- Las probabilidades son enteros y suman 100 (±2).
- impacto_reputacion: entero entre -10 y +10.
- ESPECIFICIDAD: cada "por_que" y cada señal DEBE anclar en fechas, redes, cifras y nombres/citas reales del MONITOREO. Nada de generalidades tipo "podría generar críticas": di quién, cuándo, dónde y cuánto. Si el monitoreo no trae el dato exacto, usa el más cercano que sí traiga (con su fecha).
- Si la HISTORIA trae jugadas previas, el estado del mundo YA incorpora esos efectos: sé consistente con lo que pasó.

Reglas de escena (el teatro 8-bits que acompaña la jugada):
- "personajes": 0 a 3 de esta lista EXACTA: "angela", "emiliano", "leonardo", "fan", "abogado". Pepe y la prensa siempre están; NO los listes. Elige según la ACCIÓN (dueto con Ángela → ["angela"]; foto con Emiliano → ["emiliano"]; concierto → ["angela","fan"]).
- "animacion": una de "cantar" (dueto/concierto/canción), "foto" (posts/fotos/anuncios en redes), "entrevista" (declaraciones/prensa), "fiesta" (celebración/triunfo), "crisis" (escándalo/pleito/funada), "silencio" (no hacer nada/esperar), "idle" (otra cosa).
- "ambiente": "dia", "atardecer" o "noche" — la iluminación del mundo según la situación (concierto/palenque → "noche"; anuncio matutino o rueda de prensa → "dia"; momento familiar/nostálgico o cierre de jornada → "atardecer").
- "dialogos": 3 a 5 líneas cortas (máx 45 caracteres cada una) que actúen la situación, con sabor mexicano y de videojuego. "quien" ∈ "pepe", "prensa" o un personaje listado.

Tono: narrador de RPG retro, pero el análisis es serio y profesional (esto lo usa un equipo real de manejo de crisis). Todo en español mexicano.`

export function buildMessages(
  reportsContext: string,
  history: SimHistoryEntry[],
  accion: string,
): { role: string; content: string }[] {
  const historyText = history.length
    ? history.map((h, i) =>
        `Turno ${i + 1}: Pepe hizo "${h.accion}" → ocurrió "${h.escenario_ocurrido}" (impacto ${h.impacto >= 0 ? '+' : ''}${h.impacto}).`
      ).join('\n')
    : '(primera jugada de la partida)'
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `MONITOREO REAL (reportes más recientes por tema):\n${reportsContext}\n\nHISTORIA DE LA PARTIDA:\n${historyText}\n\nACCIÓN DEL JUGADOR:\n"${accion}"`,
    },
  ]
}

// ── Llamada al LLM: /api en prod, OpenRouter directo en dev ──────────────────

async function callViaApi(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch('/api/pepe-simulator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) throw new Error(`api ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  const data = await res.json()
  const text = data?.text
  if (typeof text !== 'string' || !text) throw new Error('api: respuesta vacía')
  return text
}

async function callOpenRouterDirect(messages: { role: string; content: string }[]): Promise<string> {
  const key = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
  if (!key) throw new Error('Sin conexión al oráculo: falta /api/pepe-simulator (prod) o VITE_OPENROUTER_API_KEY (dev local).')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/BrandonBlackwell-ui/Sem-foro',
      'X-Title': 'Blackwell Semaforo - Pepe Quest',
    },
    body: JSON.stringify({
      model: SIM_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 3800,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text) throw new Error('OpenRouter: respuesta vacía')
  return text
}

function parseTurn(raw: string): SimTurn {
  // El modelo a veces envuelve en ```json … ``` o antepone texto: recortamos al primer { … último }.
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first === -1 || last === -1) throw new Error('El oráculo no devolvió JSON: ' + raw.slice(0, 200))
  s = s.slice(first, last + 1)
  let obj: SimTurn
  try {
    obj = JSON.parse(s) as SimTurn
  } catch {
    // Reparaciones típicas de LLM: comas colgantes y saltos de línea crudos dentro de strings.
    const repaired = s
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (m) => m.replace(/\n/g, '\\n').replace(/\t/g, ' '))
    obj = JSON.parse(repaired) as SimTurn
  }
  if (!Array.isArray(obj.escenarios) || obj.escenarios.length === 0) {
    throw new Error('El oráculo no devolvió escenarios.')
  }
  obj.escenarios = obj.escenarios.slice(0, 4).map(e => ({
    ...e,
    probabilidad: Math.max(0, Math.min(100, Math.round(Number(e.probabilidad) || 0))),
    impacto_reputacion: Math.max(-10, Math.min(10, Math.round(Number(e.impacto_reputacion) || 0))),
    senales: Array.isArray(e.senales) ? e.senales.slice(0, 4) : [],
    riesgo: (['bajo', 'medio', 'alto', 'critico'].includes(e.riesgo) ? e.riesgo : 'medio') as SimScenario['riesgo'],
  }))
  // Escena: sanear a los valores soportados por el teatro 8-bits.
  const rawEscena = (obj.escena ?? {}) as Partial<SimEscena>
  obj.escena = {
    personajes: (Array.isArray(rawEscena.personajes) ? rawEscena.personajes : [])
      .filter((p): p is SceneCharacter => (SCENE_CHARACTERS as readonly string[]).includes(String(p)))
      .slice(0, 3),
    animacion: (SCENE_ANIMATIONS as readonly string[]).includes(String(rawEscena.animacion))
      ? rawEscena.animacion as SceneAnimation
      : 'idle',
    ambiente: (SCENE_AMBIENTES as readonly string[]).includes(String(rawEscena.ambiente))
      ? rawEscena.ambiente as SceneAmbiente
      : 'dia',
    dialogos: (Array.isArray(rawEscena.dialogos) ? rawEscena.dialogos : [])
      .filter(d => d && typeof d.texto === 'string' && typeof d.quien === 'string')
      .slice(0, 5)
      .map(d => ({ quien: d.quien.toLowerCase().trim(), texto: d.texto.slice(0, 60) })),
  }
  return obj
}

/** Corre un turno del simulador. `reports` viene de fetchPepeReports() (cacheable por el caller). */
export async function simulateTurn(
  reports: PepeReport[],
  history: SimHistoryEntry[],
  accion: string,
): Promise<SimTurn> {
  const messages = buildMessages(buildReportsContext(reports), history, accion)
  const callOnce = async () => {
    try {
      return await callViaApi(messages)
    } catch {
      return await callOpenRouterDirect(messages)
    }
  }
  try {
    return parseTurn(await callOnce())
  } catch {
    // JSON malformado o truncado: un reintento (el modelo no es determinista).
    return parseTurn(await callOnce())
  }
}

export { fetchPepeReports }
