import type { ClientTask, ComputedAccount, WorkType } from '../types'

// ── Hash estable (djb2 → base36) para ids deterministas de tareas IA ──────────
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h = h & 0xffffffff
  }
  return (h >>> 0).toString(36)
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Clasificador de tipo de trabajo por palabras clave ────────────────────────
const TYPE_RULES: { type: WorkType; kw: string[] }[] = [
  { type: 'crisis', kw: ['crisis', 'playbook', 'riesgo reputacional', 'contencion', 'contingencia', 'narrativa adversa'] },
  { type: 'media_training', kw: ['media training', 'mediatraining', 'voceria', 'vocero', 'entrenamiento', 'briefing', 'q&a', 'q & a'] },
  { type: 'campana', kw: ['campana', 'lanzamiento', 'press junket', 'junket', 'activacion', 'evento', 'gira', 'concierto', 'press trip'] },
  { type: 'reunion', kw: ['reunion', 'junta', 'llamada', 'call', 'sesion', 'touch point', 'kickoff', 'alineacion'] },
  { type: 'reporte', kw: ['reporte', 'informe', 'report', 'entrega escrita', 'documentacion', 'dossier', 'revision formal', 'revision de desempeno'] },
  { type: 'analisis', kw: ['analisis', 'monitoreo', 'sentimiento', 'social listening', 'dashboard', 'metricas', 'metrica', 'baseline', 'medicion', 'kpi'] },
  { type: 'nota_clientes', kw: ['nota a cliente', 'nota al cliente', 'comunicado', 'boletin', 'nota de prensa', 'aclaracion'] },
]

function classifyWorkType(text: string): WorkType {
  const n = normalize(text)
  for (const rule of TYPE_RULES) {
    if (rule.kw.some(k => n.includes(k))) return rule.type
  }
  return 'otro'
}

// ── Extracción de título corto desde un texto largo ───────────────────────────
function toTitle(text: string): string {
  let t = text.trim()
  // Cortar en el primer separador narrativo
  const cuts = [' — ', ' – ', ' - ', ' (', '; ', ': ', ' per ', ' RIESGO', ' (hoy']
  let cutAt = t.length
  for (const c of cuts) {
    const idx = t.indexOf(c)
    if (idx > 12 && idx < cutAt) cutAt = idx
  }
  t = t.slice(0, cutAt).trim()
  if (t.length > 110) t = t.slice(0, 107).trimEnd() + '…'
  return t
}

// ── Parser de fechas en español dentro de un texto ────────────────────────────
const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

function parseDueDate(text: string): string | null {
  const n = normalize(text)
  // "27 junio 2026" | "04 mayo 2026" | "27 de junio de 2026" | "27 junio"
  const re = /(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s*(?:de\s+)?(\d{4}))?/
  const m = n.match(re)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = MONTHS[m[2]]
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear()
  // Si la fecha sin año ya pasó hace mucho, asumimos el año actual igualmente.
  if (!month || day < 1 || day > 31) return null
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  if (year < 2000 || year > 2100) year = new Date().getFullYear()
  return `${year}-${mm}-${dd}`
}

interface Candidate {
  title: string
  detail: string
  responsable?: string | null
  due?: string | null
}

/**
 * Extrae las tareas pendientes/faltantes del análisis IA de una cuenta.
 * Fuentes (en orden de prioridad): urgent_actions, pending, action_plan (no hecho),
 * client_promises (pendiente / en_riesgo).
 */
export function extractTasksFromAccount(
  account: ComputedAccount,
  defaultResponsable?: string | null
): ClientTask[] {
  const s = account.summary
  if (!s) return []

  const candidates: Candidate[] = []
  const seen = new Set<string>()

  const push = (c: Candidate) => {
    const key = normalize(c.title || c.detail).slice(0, 80)
    if (!key || seen.has(key)) return
    seen.add(key)
    candidates.push(c)
  }

  const asArr = <T,>(v: T[] | string | null | undefined): T[] =>
    Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v as unknown as T] : [])

  // 1 · Acciones urgentes (con owner/due explícitos)
  for (const a of asArr(s.urgent_actions)) {
    const action = typeof a === 'string' ? a : a?.action
    if (!action) continue
    const owner = typeof a === 'object' ? a?.owner : null
    const due = typeof a === 'object' ? a?.due : null
    push({
      title: toTitle(String(action)),
      detail: String(action),
      responsable: (owner && owner !== 'null') ? String(owner) : null,
      due: (due && due !== 'null') ? (parseDueDate(String(due)) || null) : parseDueDate(String(action)),
    })
  }

  // 2 · Pendientes (las "faltantes / quejas")
  for (const p of asArr<string>(s.pending)) {
    if (!p) continue
    push({ title: toTitle(String(p)), detail: String(p), due: parseDueDate(String(p)) })
  }

  // 3 · Plan de acción no terminado
  for (const step of asArr(s.action_plan)) {
    const stepObj = typeof step === 'object' && step !== null ? step : { step: String(step) }
    const st = String((stepObj as Record<string, unknown>).status || '').toLowerCase()
    if (st === 'hecho') continue
    const txt = String((stepObj as Record<string, unknown>).step || (stepObj as Record<string, unknown>).action || '')
    if (!txt) continue
    const owner = (stepObj as Record<string, unknown>).owner
    const due = (stepObj as Record<string, unknown>).due
    push({
      title: toTitle(txt),
      detail: txt,
      responsable: (owner && String(owner) !== 'null') ? String(owner) : null,
      due: (due && String(due) !== 'null') ? (parseDueDate(String(due)) || null) : parseDueDate(txt),
    })
  }

  // 4 · Promesas al cliente pendientes / en riesgo
  for (const pr of asArr(s.client_promises)) {
    if (!pr || typeof pr !== 'object') continue
    const status = String(pr.status || '').toLowerCase()
    if (status !== 'pendiente' && status !== 'en_riesgo') continue
    const promise = pr.promise
    if (!promise) continue
    push({ title: toTitle(String(promise)), detail: String(promise), due: parseDueDate(String(promise)) })
  }

  // 5 · immediate_actions / strategic (respaldo si no hubo nada arriba)
  if (candidates.length === 0) {
    for (const a of asArr<string>(s.immediate_actions)) {
      if (!a) continue
      push({ title: toTitle(String(a)), detail: String(a), due: parseDueDate(String(a)) })
    }
  }

  return candidates.map(c => {
    const detail = c.detail
    const id = `ia_${account.id}_${hashString(normalize(detail).slice(0, 120))}`
    return {
      id,
      account_id: account.id,
      account_name: account.name,
      title: c.title || detail.slice(0, 80),
      detail,
      status: 'por_hacer' as const,
      responsable: c.responsable || defaultResponsable || null,
      due_date: c.due || null,
      work_type: classifyWorkType(detail),
      delivery_link: null,
      source: 'ia' as const,
    }
  })
}
