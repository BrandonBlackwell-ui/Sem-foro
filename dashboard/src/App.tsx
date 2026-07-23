import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PepeReportsTab } from './components/PepeReportsTab'
import { PepeSimuladorTab } from './components/PepeSimuladorTab'
import { PEPE_ACCOUNT_ID } from './lib/pepeReports'

type DailyAnalysis = {
  id: number
  account_id: string
  group_jid: string
  group_name: string | null
  analysis_date: string
  message_count: number
  previous_score: number | null
  score_delta: number
  new_score: number | null
  sentiment: string
  satisfaction: string
  risk_level: string
  summary: string | null
  positive_signals: unknown
  negative_signals: unknown
  action_items: unknown
  evidence: unknown
  model: string | null
  analyzed_at: string
  raw_analysis?: any
}

type AccountScore = {
  account_id: string
  account_name: string | null
  base_score: number
  current_score: number
  total_delta: number
  last_analyzed_date: string | null
  last_message_at: string | null
}

type WaMessage = {
  id: number
  account_id: string
  group_name: string | null
  group_jid: string
  push_name: string | null
  author: string | null
  speaker_label: string | null
  speaker_team: string | null
  body: string | null
  msg_type: string
  sent_at: string
}

type WaGroup = {
  jid: string
  name: string
  account_id: string
  active: boolean
}

type OperationalScore = {
  account_id: string
  account_name: string | null
  period_year: number
  period_month: number
  delivered_publications_count: number
  committed_publications_count: number | null
  co_publications_score: number | null
  co_score: number | null
  status: string
  synced_at: string | null
}

type AccountPublication = {
  id: number
  account_id: string
  account_name: string | null
  sheet_client_name: string | null
  media_name: string | null
  provider: string | null
  columnist: string | null
  legal_name: string | null
  publication_date: string | null
  publication_year: number | null
  publication_month: number | null
  url: string | null
  service: string | null
  comments: string | null
  synced_at: string | null
}

type PublicationQualityScore = {
  account_id: string
  account_name: string | null
  period_year: number
  period_month: number
  publication_count: number
  analyzed_count: number
  scored_count: number
  pq_score: number | null
  status: string
  updated_at: string | null
}

type PublicationQualityAnalysis = {
  id: number
  account_id: string
  account_name: string | null
  publication_id: number | null
  url: string
  article_title: string | null
  matched_aliases: unknown
  title_match: boolean | null
  body_match: boolean | null
  title_evidence: string | null
  body_evidence: string | null
  tier: string | null
  tier_points: number | null
  editorial_quality: string | null
  editorial_points: number | null
  focus: string | null
  focus_points: number | null
  content_score: number | null
  pq_score: number | null
  deliverable_type: string | null
  note_type: string | null
  badge: string | null
  type_source: string | null
  is_managed: boolean | null
  status: string | null
  evidence: {
    items: { quote: string; why_it_matters: string }[]
    checklist: string[]
    reasoning: string
  } | null
  analyzed_at: string | null
}

type AccountMilestone = {
  id: number
  account_id: string
  account_name: string | null
  event_date: string
  event_type: string // 'crisis' | 'oportunidad' | 'hito' | 'cambio_estrategico'
  title: string
  description: string | null
  impact_level: string // 'low' | 'medium' | 'high'
  created_at: string
}

type MethodologyBullet = {
  methodology: string
  dimension: string
  status: string
  bullet: string
  why: string
}

type RecommendedMethodologyAction = {
  priority: string
  owner: string
  action: string
  methodology: string
}

type MethodologyDailyAnalysis = {
  id: number
  account_id: string
  account_name: string | null
  analysis_date: string
  overall_status: string | null
  summary: string | null
  methodology_bullets: unknown
  recommended_actions: unknown
  input_snapshot: unknown
  model: string | null
  analyzed_at: string | null
}

type WaTask = {
  monday_item_id: string | null
  action: string
  monday_status: string | null
  monday_due_date: string | null
  monday_responsible_text: string | null
  monday_work_type: string | null
  monday_client_label: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type GroupSummary = {
  jid: string
  name: string
  account_id: string
  active: boolean
  message_count: number
  last_message_at: string | null
  score: AccountScore | null
  analysis: DailyAnalysis | null
}

type AccountSummary = {
  account_id: string
  name: string
  statusLabel?: string | null
  groups: GroupSummary[]
  score: AccountScore | null
  operational: OperationalScore | null
  publicationQuality: PublicationQualityScore | null
  analyzedToday: boolean
  hasMessagesToday: boolean
  latestAnalysis: DailyAnalysis | null
}

// Client roster status (from Google Drive folder labels, Playbook §5). Mirrors
// hooks/useAccounts.ts so the Cuentas list shows client names + a status badge
// instead of raw WhatsApp group names.
const ROSTER_STATUS_LABEL: Record<string, string | null> = {
  active: null,
  concluded: 'Concluido',
  terminated_early: 'Terminación anticipada',
  paused: 'Pausa',
  event_single: 'Evento único',
  historical: 'Histórico',
}
const ROSTER_EXCLUSION: { re: RegExp; status: string }[] = [
  { re: /(terminaci[oó]n\s+anticipada|terminanci[oó]n\s+anticipada|early\s+termination)/i, status: 'terminated_early' },
  { re: /(proyecto\s+conclu[ií]d[oa]|conclu[ií]d[oa]|concluded)/i, status: 'concluded' },
  { re: /(evento\s+[uú]nico|one[\s-]?off)/i, status: 'event_single' },
  { re: /(pausa|paused|detenido)/i, status: 'paused' },
  { re: /(hist[oó]rico|historical)/i, status: 'historical' },
]
/** Client status from the Drive folder title label (after "/" or in parens), else derivedStatus. */
function rosterStatusFrom(folderTitle?: string | null, derivedStatus?: string): string {
  const t = folderTitle || ''
  const afterSlash = t.includes('/') ? t.slice(t.indexOf('/')) : ''
  const paren = t.match(/\(([^)]*)\)/)?.[1] || ''
  const scope = `${afterSlash} ${paren}`
  for (const { re, status } of ROSTER_EXCLUSION) if (re.test(scope)) return status
  return derivedStatus || 'active'
}
/** Clean client name from Drive folder title: "03. ADUANAS/proyecto concluido" → "ADUANAS". */
function rosterCleanName(folderTitle?: string | null): string {
  return String(folderTitle || '').replace(/^\d+\.\s*/, '').split('/')[0].trim()
}


// Consultor asignado por cuenta — fuente: "Relación proyectos-grupo de WA.xlsx".
// account_number → { nombre de cliente (fallback), consultor }. Editar aquí si
// cambia una asignación (dato manual, no viene de Drive/WhatsApp).
const CLIENT_ROSTER: { num: string; name: string; consultant: string }[] = [
  { num: '01', name: 'Turbofin', consultant: 'Mariana' },
  { num: '02', name: 'Maja', consultant: 'Angel' },
  { num: '05', name: 'Credix', consultant: 'Daniel M.' },
  { num: '06', name: 'RR', consultant: 'Daniel M.' },
  { num: '07', name: 'Apollo', consultant: 'Daniel M.' },
  { num: '08', name: 'Uldis', consultant: 'Sin asignar' },
  { num: '09', name: 'AZVI', consultant: 'Uriel' },
  { num: '12', name: 'MTV', consultant: 'Uriel' },
  { num: '13', name: 'Grupo CIMA', consultant: 'Uriel' },
  { num: '14', name: 'Dalinde', consultant: 'Mariana' },
  { num: '17', name: 'Irugami', consultant: 'Atenas' },
  { num: '18', name: 'STPRM', consultant: 'Angel' },
  { num: '19', name: 'Pujol', consultant: 'Mariana' },
  { num: '20', name: 'Veracruz', consultant: 'Ivan' },
  { num: '21', name: 'Nuvoil', consultant: 'Daniel M.' },
  { num: '26', name: 'Bernardo V.', consultant: 'Uriel' },
  { num: '27', name: 'Cuernavaca', consultant: 'Atenas' },
  { num: '28', name: 'Queretaro', consultant: 'Atenas' },
  { num: '29', name: 'Coast Oil', consultant: 'Daniel M.' },
  { num: '30', name: 'Erick Rubi', consultant: 'Johana' },
  { num: '33', name: 'Nezahualcoyotl', consultant: 'Atenas' },
  { num: '34', name: 'Supply Pay', consultant: 'Daniel M.' },
  { num: '35', name: 'PP Aguilar', consultant: 'Angel' },
  { num: '38', name: 'KPS', consultant: 'Daniel M.' },
  { num: '39', name: 'Ismerely', consultant: 'Uriel' },
  { num: '40', name: 'Austria', consultant: 'Johana' },
  { num: '41', name: 'IFA', consultant: 'Sol' },
  { num: '42', name: 'MTV Linkedin', consultant: 'Sol' },
  { num: '43', name: 'IRAN Guerrero', consultant: 'Atenas' },
  { num: '44', name: 'LCH Luxury Travel', consultant: 'Sol' },
]

// Score global FORZADO por indicación del equipo (cuentas especiales que van en verde
// aunque no tengan datos para ponderar). Casa Mata (19): sin WA/CO/PQ, se deja en 100.
const FORCED_GLOBAL: Record<string, number> = { '19': 100 }
function forcedGlobal(accountId: string | number | null | undefined): number | null {
  const n = String(Number(String(accountId ?? '').trim()))
  return Object.prototype.hasOwnProperty.call(FORCED_GLOBAL, n) ? FORCED_GLOBAL[n] : null
}

type SurveyClient = {
  account_number: string
  name: string
  consultant: string
  answered: number      // 0, 1 o 2 preguntas respondidas
  pct: number           // 0 / 50 / 100
  tipoA: boolean
  tipoB: boolean
  source: string        // 'WhatsApp' | 'Meet' | ''
  date: string          // 'YYYY-MM-DD'
}

function surveyColor(pct: number): string {
  if (pct >= 100) return '#3f7050'
  if (pct >= 50) return '#b07d1e'
  return '#a8453b'
}
function surveyIcon(pct: number): string {
  if (pct >= 100) return '✓'
  if (pct >= 50) return '½'
  return '✗'
}

// Vista "Survey por consultor": columnas por consultor, un cuadrito por cliente
// con ✓/½/✗ y el % (0 = ninguna pregunta, 50 = 1, 100 = las 2).
function SurveyBoard({ clients, onBack }: { clients: SurveyClient[]; onBack: () => void }) {
  const order = ['Daniel M.', 'Uriel', 'Mariana', 'Angel', 'Atenas', 'Johana', 'Sol', 'Ivan', 'Sin asignar']
  const byConsultant = new Map<string, SurveyClient[]>()
  for (const c of clients) {
    const arr = byConsultant.get(c.consultant) ?? []
    arr.push(c)
    byConsultant.set(c.consultant, arr)
  }
  const consultants = [
    ...order.filter(o => byConsultant.has(o)),
    ...[...byConsultant.keys()].filter(k => !order.includes(k)),
  ]

  // Modo kiosko: carrusel que se desliza a la izquierda cada 8s. Todas las
  // columnas viven en una sola fila (altura constante = la más alta → sin
  // descuadre); sólo se desplaza el track. Se pausa al pasar el cursor.
  const COL = 210, GAP = 18, COL_W = COL + GAP
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [avail, setAvail] = useState(1200)
  const [page, setPage] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const calc = () => setAvail(wrapRef.current?.clientWidth || window.innerWidth)
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  const perPage = Math.max(1, Math.min(consultants.length || 1, Math.floor(avail / COL_W)))
  const pageCount = Math.max(1, Math.ceil(consultants.length / perPage))
  useEffect(() => { if (page >= pageCount) setPage(0) }, [pageCount, page])
  useEffect(() => {
    if (paused || pageCount <= 1) return
    const t = setInterval(() => setPage(p => (p + 1) % pageCount), 8000)
    return () => clearInterval(t)
  }, [paused, pageCount])
  // Carousel geometry: show exactly `perPage` columns; slide by whole pages,
  // clamped so the last page sits flush-right (no trailing blank).
  const viewportW = perPage * COL + (perPage - 1) * GAP
  const totalW = consultants.length * COL + Math.max(0, consultants.length - 1) * GAP
  const maxTranslate = Math.max(0, totalW - viewportW)
  const translate = Math.min(page * perPage * COL_W, maxTranslate)

  // Fullscreen (pantalla proyectada todo el día).
  const [isFs, setIsFs] = useState(false)
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }

  const done = clients.filter(c => c.answered >= 2).length
  const partial = clients.filter(c => c.answered === 1).length
  const pending = clients.filter(c => c.answered === 0).length

  return (
    <div className="lb-shell">
      <div className="lb-book">
        <div className="lb-page">
          <div className="lb-lines" />
          <div className="lb-margin" />
          <div className="lb-spine">
            <div className="lb-rings">{Array.from({ length: 9 }).map((_, i) => <div className="lb-ring" key={i} />)}</div>
          </div>
          <div className="lb-content">
            <div className="lb-header-row">
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button onClick={onBack} style={{ background: 'transparent', border: '1px solid #d0ccc4', borderRadius: 999, padding: '4px 12px', fontSize: 12, color: '#666', cursor: 'pointer' }}>← Cuentas</button>
                  <button onClick={toggleFs} style={{ background: isFs ? '#3a3a44' : 'transparent', border: '1px solid #d0ccc4', borderRadius: 999, padding: '4px 12px', fontSize: 12, color: isFs ? '#fdfcf8' : '#666', cursor: 'pointer' }}>{isFs ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa'}</button>
                </div>
                <span className="lb-eyebrow">Aplicación de encuesta</span>
                <h1 className="lb-h1">Survey por consultor</h1>
                <p className="lb-subtext">Cada cuadro es un cliente. ✓ = las 2 preguntas hechas (100%), ½ = falta 1 (50%), ✗ = ninguna (0%).</p>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 26, fontWeight: 800, color: '#3f7050' }}>{done}</div><div style={{ fontSize: 11, color: '#9aa0a6' }}>completos</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 26, fontWeight: 800, color: '#b07d1e' }}>{partial}</div><div style={{ fontSize: 11, color: '#9aa0a6' }}>parciales</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 26, fontWeight: 800, color: '#a8453b' }}>{pending}</div><div style={{ fontSize: 11, color: '#9aa0a6' }}>pendientes</div></div>
              </div>
            </div>

            <div
              ref={wrapRef}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              style={{ marginTop: 20 }}
            >
              <div style={{ overflow: 'hidden', width: viewportW, maxWidth: '100%' }}>
                <div style={{ display: 'flex', gap: GAP, alignItems: 'flex-start', transform: `translateX(-${translate}px)`, transition: 'transform .7s cubic-bezier(.4,0,.2,1)' }}>
                {consultants.map(consultant => {
                  const list = (byConsultant.get(consultant) ?? []).sort((a, b) => b.pct - a.pct)
                  return (
                    <div key={consultant} style={{ width: 210, flex: '0 0 210px', background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--rule-soft)' }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-900)' }}>{consultant}</span>
                        <span style={{ fontSize: 11, color: '#9aa0a6', fontFamily: 'var(--mono)' }}>{list.length}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {list.map(c => {
                          const color = surveyColor(c.answered * 50)
                          const dateFormatted = c.date ? c.date.split('-').reverse().join('/') : ''
                          const tooltipText = c.date
                            ? `Última encuesta contestada: ${dateFormatted} vía ${c.source}`
                            : 'Sin encuestas contestadas'
                          return (
                            <div
                              key={c.account_number}
                              title={tooltipText}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d`, cursor: 'help' }}
                            >
                              <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{surveyIcon(c.answered * 50)}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                                <div style={{ fontSize: 10.5, color: '#9aa0a6' }}>
                                  <span style={{ color: c.tipoA ? '#3f7050' : '#bbb' }}>A {c.tipoA ? '✓' : '·'}</span>
                                  {'  '}
                                  <span style={{ color: c.tipoB ? '#3f7050' : '#bbb' }}>B {c.tipoB ? '✓' : '·'}</span>
                                  {c.source ? ` · ${c.source}` : ''}
                                </div>
                              </div>
                              <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'var(--mono)' }}>{c.pct}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
              {pageCount > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
                  {Array.from({ length: pageCount }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      aria-label={`Página ${i + 1}`}
                      style={{ width: i === page ? 24 : 9, height: 9, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer', background: i === page ? '#3a3a44' : '#d0ccc4', transition: 'all .25s' }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Panel de administración: bitácora de correos de notas de Meet (gemini_email_log).
// Gate de contraseña simple para uso interno (los datos ya son de lectura pública
// vía anon key; esto es una puerta de UI, no seguridad criptográfica).
const ADMIN_PASSWORD = 'admin2026'

function AdminPanel({ authed, onLogin, logs, loading, onRefresh, onBack, accounts, consultants, sheetValues, waGroups, panorama, onSaved }: {
  authed: boolean
  onLogin: (pass: string) => boolean
  logs: any[]
  loading: boolean
  onRefresh: () => void
  onBack: () => void
  accounts: { account_id: string; name: string }[]
  consultants: string[]
  sheetValues: string[]
  waGroups: string[]
  panorama: PanoRow[]
  onSaved: () => void
}) {
  const [pass, setPass] = useState('')
  const [error, setError] = useState(false)
  const [adminTab, setAdminTab] = useState<'panorama' | 'gestion' | 'bitacora'>('panorama')
  // Por defecto la bitácora muestra solo correos que generaron análisis; los
  // duplicados (mismo Meet reenviado por varios buzones) se ocultan tras un toggle.
  const [showDuplicates, setShowDuplicates] = useState(false)
  const isDuplicate = (l: any) => String(l?.outcome || '').startsWith('duplicate')
  const duplicateCount = logs.filter(isDuplicate).length
  const visibleLogs = showDuplicates ? logs : logs.filter(l => !isDuplicate(l))
  const OUTCOME: Record<string, { label: string; color: string }> = {
    analyzed: { label: 'Analizado', color: '#3f7050' },
    duplicate_skipped: { label: 'Duplicado (saltado)', color: '#b07d1e' },
    duplicate_skipped_time_window: { label: 'Duplicado (misma sesión)', color: '#b07d1e' },
    llm_fallback_regex: { label: 'Fallback regex', color: '#a8453b' },
    error: { label: 'Error', color: '#a8453b' },
  }
  const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' }) : '--'
  const cleanFrom = (s?: string | null) => (s || '').replace(/^.*</, '').replace(/>.*$/, '') || '(desconocido)'

  return (
    <div className="lb-shell">
      <div className="lb-book">
        <div className="lb-page">
          <div className="lb-lines" />
          <div className="lb-margin" />
          <div className="lb-spine">
            <div className="lb-rings">{Array.from({ length: 9 }).map((_, i) => <div className="lb-ring" key={i} />)}</div>
          </div>
          <div className="lb-content">
            <div className="lb-header-row">
              <div>
                <button onClick={onBack} style={{ background: 'transparent', border: '1px solid #d0ccc4', borderRadius: 999, padding: '4px 12px', fontSize: 12, color: '#666', cursor: 'pointer', marginBottom: 10 }}>← Cuentas</button>
                <span className="lb-eyebrow">Administración</span>
                <h1 className="lb-h1">Bitácora de Meets</h1>
                <p className="lb-subtext">Cada correo de notas de Gemini que llega a la app: de quién viene, a qué cliente se asignó y qué pasó con él.</p>
              </div>
              {authed && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button onClick={onRefresh} style={{ background: 'transparent', border: '1px solid #3a3a44', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, color: '#3a3a44', cursor: 'pointer' }}>{loading ? 'Actualizando…' : '🔄 Actualizar'}</button>
                  <a href="https://github.com/BrandonBlackwell-ui/Sem-foro/actions/workflows/publication_quality.yml" target="_blank" rel="noreferrer" style={{ background: '#3a3a44', border: '1px solid #3a3a44', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, color: '#fdfcf8', textDecoration: 'none' }}>▶ Correr análisis PQ</a>
                </div>
              )}
            </div>

            {!authed ? (
              <div style={{ maxWidth: 380, margin: '48px auto', background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, padding: 28, textAlign: 'center' }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🔐</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--ink-900)' }}>Acceso de administrador</div>
                <input
                  type="password"
                  value={pass}
                  placeholder="Contraseña"
                  onChange={e => { setPass(e.target.value); setError(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') { if (!onLogin(pass)) setError(true) } }}
                  style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: `1px solid ${error ? '#a8453b' : '#d0ccc4'}`, borderRadius: 8, marginBottom: 10, boxSizing: 'border-box' }}
                />
                {error && <div style={{ color: '#a8453b', fontSize: 12, marginBottom: 10 }}>Contraseña incorrecta</div>}
                <button
                  onClick={() => { if (!onLogin(pass)) setError(true) }}
                  style={{ width: '100%', padding: '10px 14px', fontSize: 14, fontWeight: 700, background: '#3a3a44', color: '#fdfcf8', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >Entrar</button>
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #ece9e0' }}>
                  {([['panorama', 'Panorama'], ['gestion', 'Gestión de clientes'], ['bitacora', 'Bitácora de Meets']] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setAdminTab(k)} style={{
                      background: 'transparent', border: 'none', borderBottom: `2px solid ${adminTab === k ? '#3a3a44' : 'transparent'}`,
                      padding: '8px 4px', marginBottom: -1, fontSize: 13, fontWeight: adminTab === k ? 700 : 500,
                      color: adminTab === k ? '#3a3a44' : '#9aa0a6', cursor: 'pointer',
                    }}>{lbl}</button>
                  ))}
                </div>

                {adminTab === 'panorama' && <AdminPanorama rows={panorama} consultants={consultants} sheetValues={sheetValues} waGroups={waGroups} onSaved={onSaved} />}

                {adminTab === 'gestion' && <AdminGestion accounts={accounts} consultants={consultants} sheetValues={sheetValues} waGroups={waGroups} onSaved={onSaved} />}

                {adminTab === 'bitacora' && (<>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12.5, color: '#666', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={showDuplicates} onChange={e => setShowDuplicates(e.target.checked)} />
                  Mostrar duplicados saltados ({duplicateCount})
                </label>
                {visibleLogs.length === 0 ? (
                  <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, padding: 28, textAlign: 'center', color: '#9aa0a6', fontSize: 13.5 }}>
                    {loading ? 'Cargando bitácora…' : 'Sin registros todavía. Los correos nuevos de notas de Gemini aparecerán aquí en cuanto lleguen (requiere migración 016 aplicada en Supabase).'}
                  </div>
                ) : (
                  <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: '#faf8f2', textAlign: 'left' }}>
                            {['Recibido', 'Buzón', 'Reunión', 'Cliente', 'Match', 'Resultado', 'Survey', 'Tareas'].map(hd => (
                              <th key={hd} style={{ padding: '10px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#9aa0a6', borderBottom: '1px solid #ece9e0', whiteSpace: 'nowrap' }}>{hd}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleLogs.map((l, i) => {
                            const oc = OUTCOME[l.outcome] || { label: l.outcome, color: '#9aa0a6' }
                            return (
                              <tr key={l.id ?? i} style={{ borderBottom: '1px solid #f3f1ea' }}>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 11.5 }}>{fmtDate(l.received_at)}</td>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }} title={l.email_to ? `De: ${l.email_from}` : ''}>{cleanFrom(l.email_to || l.email_from)}</td>
                                <td style={{ padding: '9px 12px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.meeting_title || ''}>{l.meeting_title || '--'}</td>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{l.project_uid ? `${l.project_uid} · ` : ''}{l.matched_account_name || l.matched_account_id || '--'}</td>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 11, color: '#666' }}>{l.match_method || '--'}</td>
                                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: oc.color, background: `${oc.color}1a`, border: `1px solid ${oc.color}55`, borderRadius: 999, padding: '2px 9px' }}>{oc.label}</span>
                                </td>
                                <td style={{ padding: '9px 12px', textAlign: 'center' }}>{l.survey_detected === true ? '✓' : l.survey_detected === false ? '·' : '--'}</td>
                                <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{l.tasks_inserted ?? '--'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                </>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Panel admin · Gestión: alta/edición manual de clientes, contratos (con
// lectura por IA), CO, status y objetivos. Escribe vía /api/admin (service key
// en el servidor). Todos los cambios se registran en Supabase.
const ADMIN_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'active_new', label: 'Activo · nuevo' },
  { value: 'active_crisis_high', label: 'Activo · crisis' },
  { value: 'active_litigation', label: 'Activo · litigio' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'paused', label: 'Pausa' },
  { value: 'concluded', label: 'Concluido' },
  { value: 'terminated_early', label: 'Terminación anticipada' },
  { value: 'event_single', label: 'Evento único' },
  { value: 'historical', label: 'Histórico' },
]

const aStyles = {
  card: { background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, padding: 20, marginBottom: 16 } as React.CSSProperties,
  h: { fontWeight: 700, fontSize: 14.5, color: 'var(--ink-900)', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 12, color: '#9aa0a6', marginBottom: 14 } as React.CSSProperties,
  label: { display: 'block', fontSize: 11.5, fontWeight: 600, color: '#666', marginBottom: 4, marginTop: 10 } as React.CSSProperties,
  input: { width: '100%', padding: '8px 11px', fontSize: 13, border: '1px solid #d0ccc4', borderRadius: 7, boxSizing: 'border-box' as const, background: '#fff' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
  btn: { padding: '9px 16px', fontSize: 13, fontWeight: 700, background: '#3a3a44', color: '#fdfcf8', border: 'none', borderRadius: 8, cursor: 'pointer' } as React.CSSProperties,
  btnGhost: { padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#3a3a44', border: '1px solid #3a3a44', borderRadius: 8, cursor: 'pointer' } as React.CSSProperties,
}

function AdminGestion({ accounts, consultants, sheetValues, waGroups, onSaved }: {
  accounts: { account_id: string; name: string }[]
  consultants: string[]
  sheetValues: string[]
  waGroups: string[]
  onSaved: () => void
}) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const flash = (kind: 'ok' | 'err', text: string) => { setMsg({ kind, text }); if (kind === 'ok') setTimeout(() => setMsg(null), 4000) }

  // Nuevo cliente
  const [nc, setNc] = useState({ account_number: '', client_name: '', tier: '', tipo: 'Fee', ingreso_mxn: '', responsable: '' })
  // Contrato
  const now = new Date()
  const [ct, setCt] = useState({
    account_number: '', client_name: '', text: '',
    tiene_contrato_firmado: false, tipo_acuerdo: 'propuesta',
    vigencia_inicio: '', vigencia_fin: '', periodicidad_pago: '',
    meta_entregables: '', objetivos: '', servicios: '', resumen: '',
  })
  const [reading, setReading] = useState(false)
  // CO
  const [co, setCo] = useState({ account_number: '', period_year: String(now.getFullYear()), period_month: String(now.getMonth() + 1), delivered_publications_count: '0', committed_publications_count: '', co_score: '' })
  // Status
  const [st, setSt] = useState({ account_number: '', status: 'active', note: '' })
  // Objetivos
  const [ob, setOb] = useState({ account_number: '', objetivos: '' })
  // Fase 2
  const [sheet, setSheet] = useState({ account_number: '', sheet_value: '', sheet_id: '' })
  const [wg, setWg] = useState({ account_number: '', wa_group_name: '', wa_group_id: '' })
  const [wgNames, setWgNames] = useState<string[]>([]) // grupos en cola para vincular (multi)
  const [cd, setCd] = useState({ account_number: '', vigencia_inicio: '', vigencia_fin: '' }) // fechas de contrato
  const [sv, setSv] = useState({ account_number: '', tipo_a: '', tipo_b: '' }) // survey manual
  const [wn, setWn] = useState({ phone: '', display_name: '', account_number: '', role: 'cliente' })
  const [asg, setAsg] = useState({ account_number: '', consultant: '', cell_director: '' })
  const [busy, setBusy] = useState(false)

  const accountOptions = accounts
    .map(a => ({ num: String(Number(a.account_id)), name: a.name }))
    .filter(a => a.num !== 'NaN')
    .sort((x, y) => Number(x.num) - Number(y.num))

  async function call(action: string, payload: Record<string, unknown>, okText: string) {
    if (!getAdminToken()) { flash('err', 'Sesión sin token — cierra sesión y vuelve a entrar.'); return }
    setBusy(true)
    const r = await adminApiPost(action, payload)
    setBusy(false)
    if (r.ok) { flash('ok', okText); onSaved() } else { flash('err', r.error || 'Error al guardar') }
  }

  // Vincula VARIOS grupos de WhatsApp a la misma cuenta (los de la cola + el que esté
  // escrito). El backend ya soporta varios por cuenta (llave cuenta+nombre).
  async function linkWaGroups() {
    if (!getAdminToken()) { flash('err', 'Sesión sin token — cierra sesión y vuelve a entrar.'); return }
    const names = [...wgNames]
    const typed = wg.wa_group_name.trim()
    if (typed && !names.includes(typed)) names.push(typed)
    if (!wg.account_number || !names.length) { flash('err', 'Elige cuenta y al menos un grupo.'); return }
    setBusy(true)
    let ok = 0, failMsg = ''
    for (const name of names) {
      const r = await adminApiPost('link_wa_group', {
        account_number: wg.account_number,
        wa_group_name: name,
        wa_group_id: names.length === 1 ? (wg.wa_group_id || null) : null, // el JID solo aplica si es uno
      })
      if (r.ok) ok++; else { failMsg = r.error || 'error'; break }
    }
    setBusy(false)
    if (failMsg) flash('err', `Vinculados ${ok}/${names.length}. Error: ${failMsg}`)
    else { flash('ok', `${ok} grupo(s) vinculado(s) a la cuenta.`); setWgNames([]); setWg({ ...wg, wa_group_name: '', wa_group_id: '' }); onSaved() }
  }
  function addWgName() {
    const n = wg.wa_group_name.trim()
    if (n && !wgNames.includes(n)) { setWgNames([...wgNames, n]); setWg({ ...wg, wa_group_name: '' }) }
  }

  async function readContract() {
    if (!ct.text.trim()) { flash('err', 'Pega el texto del contrato primero.'); return }
    if (!getAdminToken()) { flash('err', 'Sesión sin token — cierra sesión y vuelve a entrar.'); return }
    setReading(true)
    const r = await contractReadApi(ct.text)
    setReading(false)
    if (!r.ok || !r.fields) { flash('err', r.error || 'No se pudo leer el contrato'); return }
    const f = r.fields as Record<string, any>
    setCt(prev => ({
      ...prev,
      tiene_contrato_firmado: !!f.tiene_contrato_firmado,
      tipo_acuerdo: f.tipo_acuerdo || prev.tipo_acuerdo,
      vigencia_inicio: f.vigencia_inicio || prev.vigencia_inicio,
      vigencia_fin: f.vigencia_fin || prev.vigencia_fin,
      periodicidad_pago: f.periodicidad_pago || prev.periodicidad_pago,
      meta_entregables: f.meta_entregables || prev.meta_entregables,
      objetivos: Array.isArray(f.objetivos) ? f.objetivos.join('\n') : prev.objetivos,
      servicios: Array.isArray(f.servicios) ? f.servicios.join('\n') : prev.servicios,
      resumen: f.resumen || prev.resumen,
    }))
    flash('ok', 'Campos rellenados por IA. Revisa y guarda.')
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 720 }}>
      <datalist id="ag-consultants">{consultants.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="ag-sheetvals">{sheetValues.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="ag-wagroups">{waGroups.map(g => <option key={g} value={g} />)}</datalist>
      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13, fontWeight: 600,
          background: msg.kind === 'ok' ? '#eaf4ee' : '#fbeae8', color: msg.kind === 'ok' ? '#2f6b46' : '#a8453b',
          border: `1px solid ${msg.kind === 'ok' ? '#bfe0cc' : '#f0c8c2'}` }}>{msg.text}</div>
      )}

      {/* Nuevo cliente */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Vincular nuevo cliente</div>
        <div style={aStyles.sub}>Da de alta un cliente aunque no tenga carpeta en Drive. Aparecerá activo en el semáforo.</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Número de cuenta</label><input style={aStyles.input} value={nc.account_number} placeholder="46" onChange={e => setNc({ ...nc, account_number: e.target.value })} /></div>
          <div><label style={aStyles.label}>Nombre</label><input style={aStyles.input} value={nc.client_name} placeholder="ARRENDO SERV" onChange={e => setNc({ ...nc, client_name: e.target.value })} /></div>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Tier</label><input style={aStyles.input} value={nc.tier} placeholder="top / medio / bajo" onChange={e => setNc({ ...nc, tier: e.target.value })} /></div>
          <div><label style={aStyles.label}>Tipo</label><input style={aStyles.input} value={nc.tipo} onChange={e => setNc({ ...nc, tipo: e.target.value })} /></div>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Ingreso mensual (MXN)</label><input style={aStyles.input} value={nc.ingreso_mxn} placeholder="250000" onChange={e => setNc({ ...nc, ingreso_mxn: e.target.value })} /></div>
          <div><label style={aStyles.label}>Responsable</label><input list="ag-consultants" style={aStyles.input} value={nc.responsable} placeholder="elegir consultor…" onChange={e => setNc({ ...nc, responsable: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy} onClick={() => call('upsert_account', nc, 'Cliente guardado.')}>Guardar cliente</button>
        </div>
      </div>

      {/* Contrato + IA */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Contrato / propuesta {'(con lectura por IA)'}</div>
        <div style={aStyles.sub}>Pega el texto del contrato y deja que la IA rellene vigencia, meta, objetivos y servicios. Revisa antes de guardar.</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Número de cuenta</label><input style={aStyles.input} value={ct.account_number} placeholder="46" onChange={e => setCt({ ...ct, account_number: e.target.value })} /></div>
          <div><label style={aStyles.label}>Nombre</label><input style={aStyles.input} value={ct.client_name} placeholder="ARRENDO SERV" onChange={e => setCt({ ...ct, client_name: e.target.value })} /></div>
        </div>
        <label style={aStyles.label}>Texto del contrato</label>
        <textarea style={{ ...aStyles.input, minHeight: 90, fontFamily: 'var(--mono)', fontSize: 12 }} value={ct.text} placeholder="Pega aquí el texto del contrato/propuesta…" onChange={e => setCt({ ...ct, text: e.target.value })} />
        <div style={{ marginTop: 8 }}>
          <button style={aStyles.btnGhost} disabled={reading} onClick={readContract}>{reading ? 'Leyendo…' : '✨ Leer con IA'}</button>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Vigencia inicio</label><input type="date" style={aStyles.input} value={ct.vigencia_inicio} onChange={e => setCt({ ...ct, vigencia_inicio: e.target.value })} /></div>
          <div><label style={aStyles.label}>Vigencia fin</label><input type="date" style={aStyles.input} value={ct.vigencia_fin} onChange={e => setCt({ ...ct, vigencia_fin: e.target.value })} /></div>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Tipo de acuerdo</label><input style={aStyles.input} value={ct.tipo_acuerdo} onChange={e => setCt({ ...ct, tipo_acuerdo: e.target.value })} /></div>
          <div><label style={aStyles.label}>Periodicidad de pago</label><input style={aStyles.input} value={ct.periodicidad_pago} onChange={e => setCt({ ...ct, periodicidad_pago: e.target.value })} /></div>
        </div>
        <label style={{ ...aStyles.label, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={ct.tiene_contrato_firmado} onChange={e => setCt({ ...ct, tiene_contrato_firmado: e.target.checked })} /> Contrato firmado
        </label>
        <label style={aStyles.label}>Meta de entregables (ej. "5 publicaciones/mes")</label>
        <input style={aStyles.input} value={ct.meta_entregables} onChange={e => setCt({ ...ct, meta_entregables: e.target.value })} />
        <label style={aStyles.label}>Objetivos (uno por línea)</label>
        <textarea style={{ ...aStyles.input, minHeight: 60 }} value={ct.objetivos} onChange={e => setCt({ ...ct, objetivos: e.target.value })} />
        <label style={aStyles.label}>Servicios (uno por línea)</label>
        <textarea style={{ ...aStyles.input, minHeight: 60 }} value={ct.servicios} onChange={e => setCt({ ...ct, servicios: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy} onClick={() => call('upsert_contract', {
            account_number: ct.account_number, client_name: ct.client_name,
            tiene_contrato_firmado: ct.tiene_contrato_firmado, tipo_acuerdo: ct.tipo_acuerdo,
            vigencia_inicio: ct.vigencia_inicio, vigencia_fin: ct.vigencia_fin, periodicidad_pago: ct.periodicidad_pago,
            meta_entregables: ct.meta_entregables, resumen: ct.resumen,
            objetivos: ct.objetivos.split('\n').map(s => s.trim()).filter(Boolean),
            servicios: ct.servicios.split('\n').map(s => s.trim()).filter(Boolean),
          }, 'Contrato guardado.')}>Guardar contrato</button>
        </div>
      </div>

      {/* CO */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Cumplimiento operativo (CO) del mes</div>
        <div style={aStyles.sub}>Entregadas vs comprometidas del periodo. Sin esto la cuenta aparece sin CO (gris).</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Número de cuenta</label><input style={aStyles.input} value={co.account_number} placeholder="46" onChange={e => setCo({ ...co, account_number: e.target.value })} /></div>
          <div><label style={aStyles.label}>Año / Mes</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={aStyles.input} value={co.period_year} onChange={e => setCo({ ...co, period_year: e.target.value })} />
              <input style={aStyles.input} value={co.period_month} onChange={e => setCo({ ...co, period_month: e.target.value })} />
            </div>
          </div>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Entregadas</label><input style={aStyles.input} value={co.delivered_publications_count} onChange={e => setCo({ ...co, delivered_publications_count: e.target.value })} /></div>
          <div><label style={aStyles.label}>Comprometidas</label><input style={aStyles.input} value={co.committed_publications_count} placeholder="5" onChange={e => setCo({ ...co, committed_publications_count: e.target.value })} /></div>
        </div>
        <label style={aStyles.label}>CO directo (0-100, opcional — si lo pones, ignora entregadas/comprometidas)</label>
        <input style={aStyles.input} value={co.co_score} onChange={e => setCo({ ...co, co_score: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy} onClick={() => call('upsert_operational', co, 'CO guardado.')}>Guardar CO</button>
        </div>
      </div>

      {/* Status */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Cambiar status de un cliente</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={st.account_number} onChange={e => setSt({ ...st, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Status</label>
            <select style={aStyles.input} value={st.status} onChange={e => setSt({ ...st, status: e.target.value })}>
              {ADMIN_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <label style={aStyles.label}>Nota (opcional)</label>
        <input style={aStyles.input} value={st.note} onChange={e => setSt({ ...st, note: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !st.account_number} onClick={() => call('set_status', st, 'Status actualizado.')}>Guardar status</button>
        </div>
      </div>

      {/* Objetivos */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Objetivos del cliente</div>
        <div style={aStyles.sub}>Úsalo cuando el contrato no traiga objetivos claros.</div>
        <div><label style={aStyles.label}>Número de cuenta</label><input style={aStyles.input} value={ob.account_number} placeholder="46" onChange={e => setOb({ ...ob, account_number: e.target.value })} /></div>
        <label style={aStyles.label}>Objetivos (uno por línea)</label>
        <textarea style={{ ...aStyles.input, minHeight: 80 }} value={ob.objetivos} onChange={e => setOb({ ...ob, objetivos: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy} onClick={() => call('set_objectives', { account_number: ob.account_number, objetivos: ob.objetivos.split('\n').map(s => s.trim()).filter(Boolean) }, 'Objetivos guardados.')}>Guardar objetivos</button>
        </div>
      </div>

      {/* Vincular columna del Sheet */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Vincular columna del Sheet de medios</div>
        <div style={aStyles.sub}>El valor EXACTO de la columna "cliente" del Sheet que corresponde a esta cuenta (para que las publicaciones se mapeen al CO).</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={sheet.account_number} onChange={e => setSheet({ ...sheet, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Valor en el Sheet</label><input list="ag-sheetvals" style={aStyles.input} value={sheet.sheet_value} placeholder="elegir o escribir…" onChange={e => setSheet({ ...sheet, sheet_value: e.target.value })} /></div>
        </div>
        <label style={aStyles.label}>Sheet ID (opcional)</label>
        <input style={aStyles.input} value={sheet.sheet_id} onChange={e => setSheet({ ...sheet, sheet_id: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !sheet.account_number || !sheet.sheet_value} onClick={() => call('link_sheet', sheet, 'Columna del Sheet vinculada.')}>Vincular Sheet</button>
        </div>
      </div>

      {/* Grupos de WhatsApp */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Registrar survey (manual)</div>
        <div style={aStyles.sub}>Cuando el survey se levantó pero el análisis no lo capturó. Escala 0–100 por pregunta (Tipo A = satisfacción, Tipo B = objetivo). Gana sobre lo automático.</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={sv.account_number} onChange={e => setSv({ ...sv, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Tipo A (0–100)</label><input type="number" min={0} max={100} style={aStyles.input} value={sv.tipo_a} onChange={e => setSv({ ...sv, tipo_a: e.target.value })} /></div>
          <div><label style={aStyles.label}>Tipo B (0–100)</label><input type="number" min={0} max={100} style={aStyles.input} value={sv.tipo_b} onChange={e => setSv({ ...sv, tipo_b: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !sv.account_number || (sv.tipo_a === '' && sv.tipo_b === '')} onClick={() => call('set_survey', sv, 'Survey registrado.')}>Guardar survey</button>
        </div>
      </div>

      <div style={aStyles.card}>
        <div style={aStyles.h}>Fechas del contrato (vigencia)</div>
        <div style={aStyles.sub}>Fija inicio y fin a mano — dibuja la barra de vigencia y activa el score. Marca la cuenta con contrato (aunque no esté firmado).</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={cd.account_number} onChange={e => setCd({ ...cd, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Inicio</label><input type="date" style={aStyles.input} value={cd.vigencia_inicio} onChange={e => setCd({ ...cd, vigencia_inicio: e.target.value })} /></div>
          <div><label style={aStyles.label}>Fin</label><input type="date" style={aStyles.input} value={cd.vigencia_fin} onChange={e => setCd({ ...cd, vigencia_fin: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !cd.account_number || !cd.vigencia_inicio} onClick={() => call('set_contract_dates', cd, 'Fechas del contrato guardadas.')}>Guardar fechas</button>
        </div>
      </div>

      <div style={aStyles.card}>
        <div style={aStyles.h}>Vincular grupo(s) de WhatsApp</div>
        <div style={aStyles.sub}>Asocia UNO O VARIOS grupos a la cuenta (ej. el del cliente + el interno). Agrega cada grupo y luego vincula todos.</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={wg.account_number} onChange={e => setWg({ ...wg, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Nombre del grupo</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input list="ag-wagroups" style={{ ...aStyles.input, flex: 1 }} value={wg.wa_group_name} placeholder="elegir o escribir…"
                onChange={e => setWg({ ...wg, wa_group_name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWgName() } }} />
              <button type="button" style={{ ...aStyles.btn, padding: '0 14px' }} disabled={!wg.wa_group_name.trim()} onClick={addWgName}>＋ Agregar</button>
            </div>
          </div>
        </div>
        {wgNames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {wgNames.map(n => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eef3ee', border: '1px solid #cdddcf', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600, color: '#2f6b46' }}>
                {n}
                <span onClick={() => setWgNames(wgNames.filter(x => x !== n))} style={{ cursor: 'pointer', color: '#a8453b', fontWeight: 700 }}>✕</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <label style={aStyles.label}>ID/JID del grupo (opcional, solo si vinculas 1)</label>
          <input style={aStyles.input} value={wg.wa_group_id} onChange={e => setWg({ ...wg, wa_group_id: e.target.value })} />
        </div>
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !wg.account_number || (wgNames.length === 0 && !wg.wa_group_name.trim())} onClick={linkWaGroups}>
            Vincular {Math.max(wgNames.length + (wg.wa_group_name.trim() ? 1 : 0), 1)} grupo(s)
          </button>
        </div>
      </div>

      {/* Número ↔ nombre */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Vincular número de WhatsApp con un nombre</div>
        <div style={aStyles.sub}>Identifica un número (para atribuir quién habla en el survey).</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Número (solo dígitos)</label><input style={aStyles.input} value={wn.phone} placeholder="5215512345678" onChange={e => setWn({ ...wn, phone: e.target.value })} /></div>
          <div><label style={aStyles.label}>Nombre</label><input style={aStyles.input} value={wn.display_name} placeholder="Juan Pérez" onChange={e => setWn({ ...wn, display_name: e.target.value })} /></div>
        </div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta (opcional)</label>
            <select style={aStyles.input} value={wn.account_number} onChange={e => setWn({ ...wn, account_number: e.target.value })}>
              <option value="">— ninguna —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Rol</label>
            <select style={aStyles.input} value={wn.role} onChange={e => setWn({ ...wn, role: e.target.value })}>
              <option value="cliente">Cliente</option>
              <option value="consultor">Consultor</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !wn.phone || !wn.display_name} onClick={() => call('set_wa_name', wn, 'Número vinculado.')}>Vincular número</button>
        </div>
      </div>

      {/* Traslado de consultor */}
      <div style={aStyles.card}>
        <div style={aStyles.h}>Trasladar cuenta a otro consultor</div>
        <div style={aStyles.sub}>Cambia el consultor responsable (afecta la vista Survey por consultor).</div>
        <div style={aStyles.row}>
          <div><label style={aStyles.label}>Cuenta</label>
            <select style={aStyles.input} value={asg.account_number} onChange={e => setAsg({ ...asg, account_number: e.target.value })}>
              <option value="">— elegir —</option>
              {accountOptions.map(a => <option key={a.num} value={a.num}>{a.num} · {a.name}</option>)}
            </select>
          </div>
          <div><label style={aStyles.label}>Consultor</label><input list="ag-consultants" style={aStyles.input} value={asg.consultant} placeholder="elegir consultor…" onChange={e => setAsg({ ...asg, consultant: e.target.value })} /></div>
        </div>
        <label style={aStyles.label}>Director de célula (opcional)</label>
        <input style={aStyles.input} value={asg.cell_director} onChange={e => setAsg({ ...asg, cell_director: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button style={aStyles.btn} disabled={busy || !asg.account_number || !asg.consultant} onClick={() => {
            const acc = accountOptions.find(a => a.num === asg.account_number)
            call('set_assignment', { account_id: asg.account_number, account_name: acc?.name, consultant: asg.consultant, cell_director: asg.cell_director }, 'Cuenta trasladada.')
          }}>Trasladar</button>
        </div>
      </div>
    </div>
  )
}

type PanoRow = {
  num: string; name: string; status: string
  hasContract: boolean; hasMeta: boolean; meta: string
  hasWa: boolean; waName: string; hasSheet: boolean; sheetValue: string
  hasConsultant: boolean; consultant: string
}

// Panorama de vinculación: mega tabla con verde (vinculado) / rojo (falta) por
// cada dato clave de cada cuenta. Las celdas de Meta, Grupo WA, Sheet y Consultor
// se editan in-place: clic → dropdown/entrada → guarda a Supabase (/api/admin).
type PanoCol = 'meta' | 'wa' | 'sheet' | 'consultor' | 'status'
function AdminPanorama({ rows, consultants, sheetValues, waGroups, onSaved }: {
  rows: PanoRow[]
  consultants: string[]
  sheetValues: string[]
  waGroups: string[]
  onSaved: () => void
}) {
  const [edit, setEdit] = useState<{ num: string; col: PanoCol } | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Por default mostramos los clientes ACTIVOS (se puede cambiar en el select).
  const [statusFilter, setStatusFilter] = useState<string>('active_all')
  const [query, setQuery] = useState('')
  // Cambios pendientes (no se guardan hasta pulsar "Guardar cambios"): así se pueden
  // mover varias cosas y guardar de una, sin que se recargue en cada edición.
  type PendingEdit = { row: PanoRow; col: PanoCol; value: string; unlink?: boolean }
  const [pending, setPending] = useState<Record<string, PendingEdit>>({})
  const pkey = (num: string, col: PanoCol) => `${num}:${col}`

  // Encolar una edición (no llama al API todavía).
  function commit(row: PanoRow, col: PanoCol, raw: string) {
    const val = (raw || '').trim()
    setEdit(null)
    if (!val) return
    setPending(p => ({ ...p, [pkey(row.num, col)]: { row, col, value: val } }))
  }
  function commitUnlink(row: PanoRow, col: PanoCol) {
    setEdit(null)
    setPending(p => ({ ...p, [pkey(row.num, col)]: { row, col, value: '', unlink: true } }))
  }

  async function saveAll() {
    const edits = Object.values(pending)
    if (!edits.length) return
    setErr('')
    setSaving(true)
    for (const e of edits) {
      let action = '', payload: Record<string, unknown> = {}
      if (e.unlink) {
        action = 'unlink'
        payload = e.col === 'consultor' ? { kind: 'consultor', account_id: e.row.num } : { kind: e.col, account_number: e.row.num }
      } else if (e.col === 'wa') { action = 'link_wa_group'; payload = { account_number: e.row.num, wa_group_name: e.value } }
      else if (e.col === 'sheet') { action = 'link_sheet'; payload = { account_number: e.row.num, sheet_value: e.value } }
      else if (e.col === 'consultor') { action = 'set_assignment'; payload = { account_id: e.row.num, account_name: e.row.name, consultant: e.value } }
      else if (e.col === 'meta') { action = 'set_meta'; payload = { account_number: e.row.num, meta_entregables: e.value } }
      else if (e.col === 'status') { action = 'set_status'; payload = { account_number: e.row.num, status: e.value } }
      const r = await adminApiPost(action, payload)
      if (!r.ok) { setErr(`Error al guardar ${e.row.name} (${e.col}): ${r.error || ''}`); setSaving(false); return }
    }
    setSaving(false)
    setPending({})
    onSaved() // una sola recarga al final
  }

  const inputStyle: React.CSSProperties = { width: 170, padding: '4px 6px', fontSize: 12, border: '1px solid #3a3a44', borderRadius: 6, boxSizing: 'border-box' }

  const editableCell = (row: PanoRow, col: PanoCol, ok: boolean, value: string, listId?: string) => {
    const isEditing = edit?.num === row.num && edit?.col === col
    if (isEditing) {
      return (
        <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f1ea' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input autoFocus list={listId} defaultValue={value || ''} style={inputStyle}
              placeholder={col === 'meta' ? 'ej. 5 publicaciones/mes' : 'elegir…'}
              onKeyDown={e => { if (e.key === 'Enter') commit(row, col, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEdit(null) }}
              onBlur={e => commit(row, col, e.target.value)} />
            {ok && (
              <button type="button" title="Quitar el vínculo (vuelve a Falta)"
                onMouseDown={e => { e.preventDefault(); commitUnlink(row, col) }}
                style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: '#a8453b', background: 'transparent', border: '1px solid rgba(168,69,59,0.4)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Desvincular
              </button>
            )}
          </div>
        </td>
      )
    }
    // Refleja el cambio pendiente (aún no guardado) en ámbar.
    const pend = pending[pkey(row.num, col)]
    const effOk = pend ? !pend.unlink : ok
    const effVal = pend ? (pend.unlink ? '' : pend.value) : value
    const short = effVal && effVal.length > 22 ? effVal.slice(0, 22) + '…' : effVal
    const dot = pend ? '#c98a1e' : (effOk ? '#3f7050' : '#a8453b')
    const txt = pend ? '#b07d1e' : (effOk ? '#2f6b46' : '#a8453b')
    return (
      <td onClick={() => !saving && setEdit({ num: row.num, col })} title={effVal ? `${effVal}${pend ? ' · pendiente de guardar' : ' · clic para editar'}` : 'Clic para vincular'}
        style={{ padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid #f3f1ea', cursor: 'pointer', background: pend ? '#fdf7e8' : undefined }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: txt, fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: 'inline-block', flex: '0 0 auto' }} />
          {effOk ? (short || 'Sí') : 'Falta'}
          {pend && <span style={{ fontSize: 9.5, color: '#b07d1e', fontWeight: 700 }}>●pend.</span>}
          <span style={{ opacity: 0.35, fontSize: 10 }}>✎</span>
        </span>
      </td>
    )
  }
  const staticCell = (ok: boolean, value?: string) => {
    const short = value && value.length > 22 ? value.slice(0, 22) + '…' : value
    return (
      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid #f3f1ea' }} title={value || ''}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: ok ? '#2f6b46' : '#a8453b', fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: ok ? '#3f7050' : '#a8453b', display: 'inline-block', flex: '0 0 auto' }} />
          {ok ? (short || 'Sí') : 'Falta'}
        </span>
      </td>
    )
  }

  const statusLabels: Record<string, string> = Object.fromEntries(ADMIN_STATUS_OPTIONS.map(o => [o.value, o.label]))
  const statusCell = (row: PanoRow) => {
    const isEditing = edit?.num === row.num && edit?.col === 'status'
    if (isEditing) {
      return (
        <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f1ea' }}>
          <select autoFocus defaultValue={row.status} style={{ ...inputStyle, width: 190 }}
            onChange={e => commit(row, 'status', e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setEdit(null) }}
            onBlur={() => setEdit(null)}>
            {ADMIN_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
      )
    }
    const pend = pending[pkey(row.num, 'status')]
    const effStatus = pend && !pend.unlink ? pend.value : row.status
    return (
      <td onClick={() => !saving && setEdit({ num: row.num, col: 'status' })} title={pend ? 'pendiente de guardar' : 'Clic para cambiar el status'}
        style={{ padding: '8px 10px', fontSize: 11.5, color: pend ? '#b07d1e' : '#666', fontWeight: pend ? 700 : undefined, borderBottom: '1px solid #f3f1ea', whiteSpace: 'nowrap', cursor: 'pointer', background: pend ? '#fdf7e8' : undefined }}>
        {statusLabels[effStatus] || effStatus} {pend && <span style={{ fontSize: 9.5 }}>●pend.</span>}<span style={{ opacity: 0.35, fontSize: 10 }}> ✎</span>
      </td>
    )
  }
  const allStatuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const activeCount = rows.filter(r => String(r.status || '').startsWith('active')).length
  const q = query.trim().toLowerCase()
  const shown = rows.filter(r => {
    const s = String(r.status || '')
    const statusOk = statusFilter === 'all'
      ? true
      : statusFilter === 'active_all' ? s.startsWith('active') : s === statusFilter
    return statusOk && (!q || r.name.toLowerCase().includes(q) || r.num.includes(q))
  })
  const pendingCount = Object.keys(pending).length
  const n = shown.length
  const c = (k: keyof PanoRow) => shown.filter(r => r[k]).length
  const stat = (label: string, k: keyof PanoRow) => (
    <span style={{ fontSize: 12.5, color: '#666' }}>{label}: <b style={{ color: '#2f6b46' }}>{c(k)}</b> / <b style={{ color: '#a8453b' }}>{n - c(k)}</b></span>
  )
  const selStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 12.5, border: '1px solid #d0ccc4', borderRadius: 8, background: '#fff' }
  const cols = ['ID', 'Cliente', 'Status', 'Contrato', 'Meta (CO)', 'Grupo WA', 'Sheet', 'Consultor']
  return (
    <div style={{ marginTop: 20 }}>
      <datalist id="pano-wa">{waGroups.map(g => <option key={g} value={g} />)}</datalist>
      <datalist id="pano-sheet">{sheetValues.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="pano-consult">{consultants.map(cn => <option key={cn} value={cn} />)}</datalist>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={selStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="active_all">Activos ({activeCount})</option>
          <option value="all">Todos los status ({rows.length})</option>
          {allStatuses.map(s => <option key={s} value={s}>{statusLabels[s] || s} ({rows.filter(r => r.status === s).length})</option>)}
        </select>
        <input style={{ ...selStyle, width: 180 }} value={query} placeholder="Buscar cliente…" onChange={e => setQuery(e.target.value)} />
        {(statusFilter !== 'active_all' || q) && (
          <button onClick={() => { setStatusFilter('active_all'); setQuery('') }} style={{ ...selStyle, cursor: 'pointer', color: '#666' }}>Limpiar</button>
        )}
      </div>
      {pendingCount > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, padding: '10px 14px', background: '#fdf7e8', border: '1px solid #ecd9a8', borderRadius: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#8a6412' }}>{pendingCount} cambio{pendingCount === 1 ? '' : 's'} sin guardar</span>
          <button onClick={saveAll} disabled={saving}
            style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, color: '#fff', background: saving ? '#9aa0a6' : '#2f6b46', border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Guardando…' : `Guardar cambios (${pendingCount})`}
          </button>
          <button onClick={() => setPending({})} disabled={saving}
            style={{ padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: '#a8453b', background: 'transparent', border: '1px solid rgba(168,69,59,0.4)', borderRadius: 8, cursor: 'pointer' }}>
            Descartar
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, color: '#666' }}><b>{n}</b> {n === rows.length ? 'cuentas' : `de ${rows.length}`}</span>
        {stat('Contrato', 'hasContract')}
        {stat('Meta', 'hasMeta')}
        {stat('WhatsApp', 'hasWa')}
        {stat('Sheet', 'hasSheet')}
        {stat('Consultor', 'hasConsultant')}
        <span style={{ fontSize: 11.5, color: '#9aa0a6' }}>🟢 vinculado · 🔴 falta · clic en una celda para editar</span>
      </div>
      {err && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12.5, fontWeight: 600, background: '#fbeae8', color: '#a8453b', border: '1px solid #f0c8c2' }}>{err}</div>}
      {saving && <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 8 }}>Guardando…</div>}
      <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#faf8f2', textAlign: 'left' }}>
                {cols.map(h => (
                  <th key={h} style={{ padding: '10px 10px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9aa0a6', borderBottom: '1px solid #ece9e0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.num}>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 11.5, borderBottom: '1px solid #f3f1ea' }}>{r.num}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #f3f1ea', whiteSpace: 'nowrap' }}>{r.name}</td>
                  {statusCell(r)}
                  {staticCell(r.hasContract)}
                  {editableCell(r, 'meta', r.hasMeta, r.meta)}
                  {editableCell(r, 'wa', r.hasWa, r.waName, 'pano-wa')}
                  {editableCell(r, 'sheet', r.hasSheet, r.sheetValue, 'pano-sheet')}
                  {editableCell(r, 'consultor', r.hasConsultant, r.consultant, 'pano-consult')}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZ2ZrZnZ5d2JwamxkcmV1cGxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjEwNDMsImV4cCI6MjA5NzA5NzA0M30.wR9_YXMi2udYsVNLY8SlPFwpxkqZ3j78hv961ShBkQk'


async function supabaseGet<T>(path: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }

  return response.json()
}

async function supabaseGetOptional<T>(path: string, fallback: T): Promise<T> {
  try {
    return await supabaseGet<T>(path)
  } catch (err) {
    console.warn(`Optional Supabase resource unavailable: ${path}`, err)
    return fallback
  }
}

// ── Panel admin: escritura vía la ruta serverless /api/admin (service key +
// ADMIN_TOKEN en el servidor). El navegador nunca ve la service key; manda el
// token que el admin captura una sola vez (sessionStorage 'bw_admin_token').
const ADMIN_TOKEN_KEY = 'bw_admin_token'
export function getAdminToken(): string {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { return '' }
}
export function setAdminToken(t: string) {
  try { sessionStorage.setItem(ADMIN_TOKEN_KEY, t) } catch { /* private mode */ }
}

async function adminApiPost(action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const token = getAdminToken()
  if (!token) return { ok: false, error: 'Sesión sin token — vuelve a iniciar sesión en el panel.' }
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, payload, set_by: 'admin' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, result: data?.result }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) }
  }
}

// Modo demo (solo DEV + localStorage['admin:demoArrendo']='1'): previsualiza
// Arrendo Serv (46) activo con CO sin necesidad de escribir a Supabase.
function demoOn(): boolean {
  try { return import.meta.env.DEV && localStorage.getItem('admin:demoArrendo') === '1' } catch { return false }
}
const DEMO_MANUAL = { account_number: '46', client_name: 'ARRENDO SERV', folder_title: '46. ARRENDO SERV', tier: 'top', tipo: 'Fee', ingreso_mxn: 250000, responsable: null }
const DEMO_INTEL = {
  account_number: '46', client_name: 'ARRENDO SERV', docs_total: 1,
  resumen: 'Contención de crisis reputacional y posicionamiento estratégico.',
  tiene_contrato_firmado: false, tipo_acuerdo: 'propuesta',
  vigencia_inicio: '2026-07-22', vigencia_fin: '2026-08-21',
  objetivos: ['Contrarrestar la conversación adversa', 'Consolidar a Arrendo Serv como actor de referencia'],
  meta_entregables: '5 publicaciones/mes', renovacion: null, faltantes: [], synced_at: '2026-07-22T00:00:00Z',
}
const DEMO_OP = { account_id: '46', account_name: 'ARRENDO SERV', period_year: 2026, period_month: 7, delivered_publications_count: 2, committed_publications_count: 5, co_publications_score: 40, co_score: 40, status: 'measured', synced_at: '2026-07-22T00:00:00Z' } as unknown as OperationalScore

async function contractReadApi(text: string): Promise<{ ok: boolean; error?: string; fields?: Record<string, unknown> }> {
  const token = getAdminToken()
  if (!token) return { ok: false, error: 'Sesión sin token — vuelve a iniciar sesión en el panel.' }
  try {
    const res = await fetch('/api/contract-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, text }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, fields: data?.fields }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) }
  }
}

async function loadMediaPublicationsFallback() {
  try {
    const response = await fetch('/api/media-publications', { cache: 'no-store' })
    if (!response.ok) throw new Error(`Media Sheet API ${response.status}`)
    const payload = await response.json()
    return {
      publications: (payload.publications || []) as AccountPublication[],
      operationalScores: (payload.operationalScores || []) as OperationalScore[],
    }
  } catch (err) {
    console.warn('Google Sheets media API unavailable, falling back to Supabase mirrors.', err)
    const [operationalScores, publications] = await Promise.all([
      supabaseGetOptional<OperationalScore[]>(
        '/rest/v1/account_operational_scores?select=*&order=period_year.desc,period_month.desc',
        [],
      ),
      supabaseGetOptional<AccountPublication[]>(
        '/rest/v1/account_publications?select=id,account_id,account_name,sheet_client_name,media_name,provider,columnist,legal_name,publication_date,publication_year,publication_month,url,service,comments,synced_at&order=publication_date.desc&limit=1000',
        [],
      ),
    ])
    return { publications, operationalScores }
  }
}

type JsonRecord = Record<string, unknown>

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldText(value: unknown, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function shortDate(value: string | null | undefined) {
  if (!value) return 'Sin actividad'
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function shortDateOnly(value: string | null | undefined) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function badgeClass(value: string) {
  const normalized = value.toLowerCase()
  if (['positive', 'positivo', 'satisfied', 'low', 'estable', 'blackwell'].includes(normalized)) return 'green'
  if (['neutral', 'unknown', 'mixed', 'medium', 'pendiente', 'shared', 'alerta'].includes(normalized)) return 'yellow'
  // 'riesgo' y 'crisis' son los estados más graves del análisis de metodología: antes
  // caían al gris default y se veían igual que "neutral".
  if (['negative', 'negativo', 'unsatisfied', 'high', 'atencion', 'riesgo', 'crisis'].includes(normalized)) return 'red'
  if (['client', 'no_aplica'].includes(normalized)) return 'gray'
  return 'gray'
}

function qualityText(value: string | null | undefined, fallback = 'Pendiente') {
  if (!value) return fallback
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// status='fetch_error' agrupa causas MUY distintas: link caído (403/404/SSL), celda que
// no es URL, muro de pago, o el LLM que devolvió JSON inválido con el LINK OK. "Sin link"
// era engañoso; devolvemos el motivo real (label corto + detalle para tooltip).
function fetchErrorInfo(quality: PublicationQualityAnalysis | null): { label: string; detail: string; retryable: boolean } | null {
  if (!quality || quality.status !== 'fetch_error') return null
  const err = String(quality.body_evidence ?? '').toLowerCase()
  if (/llm_json_parse|expecting value|unterminated string|"choices"|json/.test(err))
    return { label: 'Error de análisis', detail: 'El link cargó bien y tiene contenido, pero el modelo devolvió una respuesta inválida. Se reintenta en la próxima corrida.', retryable: true }
  if (/code_shell|codigo|javascript|\bjs\b/.test(err))
    return { label: 'No legible (JS)', detail: 'El medio entrega la página como código/JavaScript (MSN y agregadores similares), no el texto del artículo. El link puede abrir bien en el navegador.', retryable: false }
  if (/paywall|softwall|suscrip|cookies/.test(err))
    return { label: 'Muro de pago', detail: 'La página pide suscripción o aceptar cookies; no se pudo leer el artículo.', retryable: false }
  if (/403|forbidden/.test(err))
    return { label: 'Acceso bloqueado', detail: 'El medio bloquea la lectura automática (HTTP 403). El link puede abrir bien en el navegador.', retryable: false }
  if (/404|not found|410|gone/.test(err))
    return { label: 'Link roto', detail: 'El link ya no existe en el medio (HTTP 404/410).', retryable: false }
  if (/ssl|certificate/.test(err))
    return { label: 'Error de certificado', detail: 'El sitio tiene un problema de certificado SSL y no se pudo leer.', retryable: false }
  if (/unknown url type|control character|can.t contain|impreso|facebook|instagram|tiktok/.test(err))
    return { label: 'Link no válido', detail: 'La celda del Sheet no es una URL http legible (texto, red social o "IMPRESO").', retryable: false }
  if (/timed out|timeout|10013|urlopen|connection/.test(err))
    return { label: 'No respondió', detail: 'El sitio no respondió a tiempo o rechazó la conexión. Se reintenta en la próxima corrida.', retryable: true }
  return { label: 'No se pudo leer', detail: quality.body_evidence ? `Motivo: ${quality.body_evidence}` : 'No se pudo leer el artículo.', retryable: true }
}

function qualityScoreText(quality: PublicationQualityAnalysis | null) {
  if (!quality) return 'Sin analisis'
  if (quality.status === 'fetch_error') return fetchErrorInfo(quality)?.label ?? 'No se pudo leer'
  if (quality.pq_score != null) return `${roundScore(Number(quality.pq_score))} PQ`
  if (quality.content_score != null) return `${roundScore(Number(quality.content_score))} contenido`
  if (quality.status === 'needs_tier') return 'Tier pendiente'
  return qualityText(quality.status, 'Pendiente')
}

function qualityTone(quality: PublicationQualityAnalysis | null, ok?: boolean | null) {
  if (!quality) return 'muted'
  if (quality.status === 'fetch_error') return 'muted'
  if (ok === true) return 'good'
  if (ok === false) return 'warn'
  if (quality.pq_score != null || quality.content_score != null) return 'good'
  if (quality.status === 'needs_tier') return 'warn'
  return 'muted'
}

function normalizeSatisfaction(value: string) {
  const normalized = value.toLowerCase()
  if (['high', 'positive', 'good'].includes(normalized)) return 'satisfied'
  if (['low', 'negative', 'bad'].includes(normalized)) return 'unsatisfied'
  return normalized || 'unknown'
}

function lookupKey(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ACCOUNT_LINKS = [
  {
    accountId: 'azvi',
    dashboardNames: ['Grupo Azvi'],
    sheetNames: ['Azvi'],
    whatsappNames: ['Azvi + Blackwell', 'Interno Azvi'],
    supabaseAccountIds: ['09'],
  },
  {
    accountId: 'tello',
    dashboardNames: ['Tello (MTV)'],
    sheetNames: ['Miguel Tello'],
    whatsappNames: ['Tello + Blackwell', 'Interno Tello'],
    supabaseAccountIds: ['12'],
  },
  {
    accountId: 'nuvoil',
    dashboardNames: ['Nuvoil'],
    sheetNames: ['Nuvoil'],
    whatsappNames: ['Nuvoil-Blackwell', 'INTERNO NUVOIL'],
    supabaseAccountIds: ['21'],
  },
  {
    accountId: 'credix',
    dashboardNames: ['Credix'],
    sheetNames: ['Covalto -Credijusto', 'Credix'],
    whatsappNames: ['Credix/BWS'],
    supabaseAccountIds: ['05'],
  },
  {
    accountId: 'maja',
    dashboardNames: ['Maja', 'MAJA Sportswear'],
    sheetNames: ['Maja Sportswear'],
    whatsappNames: ['MAJA'],
    supabaseAccountIds: ['02'],
  },
  {
    accountId: 'cima',
    dashboardNames: ['Grupo CIMA'],
    sheetNames: ['CIMA', 'Grupo Cima'],
    whatsappNames: ['CIMA + Blackwell', 'Interno CIMA'],
    supabaseAccountIds: ['13'],
  },
  {
    accountId: 'apollo',
    dashboardNames: ['Apollo'],
    sheetNames: ['Apollo', 'Química Apollo'],
    whatsappNames: ['Apollo comunicación', 'Estrategia 2026 - Apollo/BWS', 'Interno Apollo'],
    supabaseAccountIds: ['07'],
  },
  {
    accountId: 'turbofin',
    dashboardNames: ['Turbofin'],
    sheetNames: ['Turbofin'],
    whatsappNames: ['Turbofin + Blackwell', 'Interno Turbofin'],
    supabaseAccountIds: ['01'],
  },
  {
    accountId: 'stprm',
    dashboardNames: ['STPRM'],
    sheetNames: ['STPRM'],
    whatsappNames: ['Comms Lider'],
    supabaseAccountIds: ['18'],
  },
  {
    accountId: 'dalinde',
    dashboardNames: ['Dalinde'],
    sheetNames: ['Dalinde', 'Grupo DSAI'],
    whatsappNames: ['Dalinde + Blackwell', 'Comunicación DSAI + Blackwell'],
    supabaseAccountIds: ['14'],
  },
  {
    accountId: 'andy',
    dashboardNames: ['Andy'],
    sheetNames: ['Andy', 'Andycoach'],
    whatsappNames: [],
    supabaseAccountIds: ['25'],
  },
  {
    accountId: 'gicsa',
    dashboardNames: ['GICSA'],
    sheetNames: ['GICSA'],
    whatsappNames: [],
    supabaseAccountIds: ['24'],
  },
  {
    accountId: 'mapelly',
    dashboardNames: ['Mapelly'],
    sheetNames: ['Mapelly'],
    whatsappNames: [],
    supabaseAccountIds: ['16'],
  },
  {
    accountId: 'totalplay',
    dashboardNames: ['Totalplay'],
    sheetNames: ['Totalplay', 'Total Play'],
    whatsappNames: [],
    supabaseAccountIds: ['22'],
  },
  {
    accountId: 'luca',
    dashboardNames: ['LUCA'],
    sheetNames: ['LUCA'],
    whatsappNames: [],
    supabaseAccountIds: ['23'],
  },
  {
    accountId: 'uldis',
    dashboardNames: ['Uldis'],
    sheetNames: ['Uldis'],
    whatsappNames: ['Interno Uldis'],
    supabaseAccountIds: ['08'],
  },
  {
    accountId: 'armor',
    dashboardNames: ['Armor Life Lab'],
    sheetNames: ['Armor Life Lab', 'Armor'],
    whatsappNames: [],
    supabaseAccountIds: ['15'],
  },
  {
    accountId: 'jack',
    dashboardNames: ['Jack Levi'],
    sheetNames: ['Jack Levi'],
    whatsappNames: [],
    supabaseAccountIds: ['10'],
  },
  {
    accountId: 'rocha',
    dashboardNames: ['RR'],
    sheetNames: ['RR', 'Rocha'],
    whatsappNames: ['Medios RR'],
    supabaseAccountIds: ['06'],
  },
  {
    accountId: 'coastoil',
    dashboardNames: ['Coast Oil'],
    sheetNames: ['Coast Oil', 'Coastoil'],
    whatsappNames: ['Coast Oil + Blackwell', 'INTERNO COAST OIL'],
    supabaseAccountIds: ['29'],
  },
] as const

type AccountLink = (typeof ACCOUNT_LINKS)[number]

function linkValues(link: AccountLink) {
  return [
    link.accountId,
    ...link.dashboardNames,
    ...link.sheetNames,
    ...link.whatsappNames,
    ...link.supabaseAccountIds,
  ]
}

function findAccountLink(values: Array<string | null | undefined>) {
  const normalized = new Set(values.map(lookupKey).filter(Boolean))
  return ACCOUNT_LINKS.find((link) => linkValues(link).some((value) => normalized.has(lookupKey(value)))) ?? null
}

function explicitLinkedKeys(values: Array<string | null | undefined>) {
  const keys = new Set(values.map(lookupKey).filter(Boolean))
  const link = findAccountLink(values)
  if (link) {
    for (const value of linkValues(link)) {
      const key = lookupKey(value)
      if (key) keys.add(key)
    }
  }
  return keys
}



function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}

// Un survey solo cuenta si trae EVIDENCIA: score + respuesta textual real. Bloquea
// surveys alucinados por el LLM (score sin respuesta) y los fabricados por fallback,
// que quitarían el tope de 70 del SC sin que el cliente haya contestado nada.
function surveyQuestionValid(q: any): boolean {
  if (!q || q.score == null) return false
  const answer = String(q.answer ?? '').trim()
  return answer.length > 0 && !/regex fallback/i.test(answer)
}

// La AUSENCIA de algo malo es un hallazgo POSITIVO. El LLM a veces la prefija con
// "No:" por la forma gramatical ("No: la nota no presenta tono defensivo ni de crisis"),
// lo que la pintaba con ✗ rojo aunque sea buena. Detecta esas frases para mostrarlas ✓.
const POSITIVE_ABSENCE_RE =
  /\b(no\s+(presenta|tiene|hay|muestra|refleja|existe|adopta|contiene|se\s+detectan?)|sin)\b[^.]*\b(defensiv|crisis|negativ|ataqu|confrontaci|hostil|riesgo\s+reputacional|insatisfacci|presion\s+negativa|dano\s+reputacional)/
function checklistItemPositive(item: string): boolean {
  const trimmed = String(item ?? '').trim()
  if (/^s[ií]:/i.test(trimmed)) return true
  const content = trimmed.replace(/^(s[ií]|no):\s*/i, '')
  const norm = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return POSITIVE_ABSENCE_RE.test(norm)
}

// Que el cliente sea el SUJETO y no el AUTOR es NORMAL en una nota informativa, no un
// defecto: esas líneas no deben aparecer (y menos como ✗ rojo). El analyzer ya las
// descarta al generar, pero las notas viejas las tienen guardadas; el front las oculta.
const AUTHOR_NEGATIVE_RE =
  /\bno\b[^.]*\bautor|sujeto\s+(central\s+|principal\s+)?de\s+la\s+(cobertura|nota|informaci|pieza|publicaci)|\bsino\b[^.]*\bsujeto|no\s+(escribi|redact|firm)/
function checklistItemHidden(item: string): boolean {
  const content = String(item ?? '').replace(/^(s[ií]|no):\s*/i, '')
  const norm = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return AUTHOR_NEGATIVE_RE.test(norm)
}

// El análisis a veces pega un nombre propio a "cliente" ("El cliente (Sol Guerrero)")
// que en realidad es del equipo BWS o inventado. Quitamos ese paréntesis con nombre
// propio (Mayúscula inicial); conservamos roles en minúscula como "(su esposa)".
function cleanSummaryText(text?: string | null): string {
  if (!text) return ''
  return String(text)
    .replace(/\b([Cc]lient[ae])\s*\(\s*[A-ZÁÉÍÓÚÑ][^)]*\)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// "Resumen acumulado": antes unía los últimos 3 días en UN párrafo corrido
// (se leía contradictorio y "de otros días"). Ahora cada día va fechado y separado.
function RecentSummaries({ history, empty }: { history: any[]; empty: string }) {
  const recent = [...(history ?? [])].filter(h => h?.summary).slice(-3).reverse()
  if (!recent.length) return <p className="lb-summary-text">{empty}</p>
  return (
    <div className="lb-summary-text">
      {recent.map((h, i) => (
        <div key={h.id ?? i} style={{ marginBottom: i < recent.length - 1 ? 12 : 0 }}>
          <span style={{ fontWeight: 700, color: '#3d434c', marginRight: 6 }}>{fmtShortDate(h.analysis_date)}:</span>
          <span>{cleanSummaryText(h.summary)}</span>
        </div>
      ))}
    </div>
  )
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10
}

// Cuentas donde el CO (Cumplimiento Operativo) no aplica — su 30% se traslada a
// la Satisfacción del Cliente (SC). Ej. figuras públicas sin meta de notas.
const NO_CO_ACCOUNTS = new Set(['35'])
function coAppliesFor(accountId?: string | null): boolean {
  const id = String(accountId ?? '').trim()
  const num = /^\d+$/.test(id) ? String(Number(id)) : id
  return !NO_CO_ACCOUNTS.has(num)
}

function buildWeightedScore(
  waScore: number | null | undefined,
  operational?: OperationalScore | null,
  publicationQuality?: PublicationQualityScore | null,
  checklist?: any,
  rawAnalysis?: any,
  coApplies: boolean = true
) {
  const normalizedWa = waScore == null ? null : clampScore(Number(waScore))
  // Pesos del global. Sin CO, su 30% se suma al de SC (0.45 → 0.75).
  const coWeight = coApplies ? 0.30 : 0
  const scWeight = coApplies ? 0.45 : 0.75

  // Meet: último sesion_score guardado en checklist.json (análisis LLM de transcripción)
  let sesionScore: number | null = null
  let meetPeriod: string | null = null
  let meetEvidence: any = null
  if (checklist?.scores) {
    const meetEntries = Object.entries(checklist.scores as Record<string, any>)
      .filter(([, v]) => v?.transcripciones?.sesion_score != null)
      .sort(([a], [b]) => b.localeCompare(a))
    if (meetEntries.length) {
      meetPeriod = meetEntries[0][0]
      meetEvidence = meetEntries[0][1].transcripciones
      sesionScore = clampScore(Number(meetEvidence.sesion_score))
    }
  }

  // CO: si Supabase no trae co_score, cruzar entregado vs meta del contrato (checklist.json)
  let coScore = operational?.co_score == null ? null : clampScore(Number(operational.co_score))
  let coMetaCaption: string | null = null
  const fase = checklist?.contract?.fase_actual as string | undefined
  const pubItem = checklist?.schema?.items?.publicaciones_web
  const pubMeta = pubItem ? (fase === 'fase_2' ? pubItem.meta_fase2 : pubItem.meta_fase1) ?? null : null
  if (coScore == null && pubMeta && operational?.delivered_publications_count != null) {
    coScore = clampScore(Math.round((operational.delivered_publications_count / pubMeta) * 100))
    const coPeriodInline = operational ? new Date(operational.period_year, operational.period_month - 1, 1).toLocaleDateString('es-MX', { month: 'long' }) : ''
    coMetaCaption = `${coPeriodInline}: ${operational.delivered_publications_count}/${pubMeta} publicaciones vs meta mensual${fase ? ` (${fase === 'fase_2' ? 'Fase 2' : 'Fase 1'})` : ''}`
  }

  const pqScore = publicationQuality?.pq_score == null ? null : clampScore(Number(publicationQuality.pq_score))
  const coIntoGlobal = (coScore == null || !coApplies) ? 0 : coScore * coWeight

  const periodLabel = (row?: { period_year: number; period_month: number } | null) =>
    row ? new Date(row.period_year, row.period_month - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : null
  const coPeriod = periodLabel(operational)
  const pqPeriod = periodLabel(publicationQuality)

  // Extract survey from rawAnalysis
  let rawAnalysisObj: any = null
  if (rawAnalysis) {
    try {
      rawAnalysisObj = typeof rawAnalysis === 'string' ? JSON.parse(rawAnalysis) : rawAnalysis
    } catch {
      rawAnalysisObj = rawAnalysis
    }
  }
  // The WhatsApp analysis always includes a `survey` object, but it's empty
  // (all-null questions) when no survey was asked in chat. Only treat it as a
  // real survey when it has at least one scored question — otherwise it would
  // mask the Meet survey and the SC would show "pendiente" despite Meet data.
  // Busca el survey también en los niveles anidados que dejaban los merges viejos
  // ({previous_raw_analysis, incremental_raw_analysis}) para no perder encuestas legacy.
  const waSurvey = rawAnalysisObj?.survey || rawAnalysisObj?.raw_analysis?.survey
    || rawAnalysisObj?.incremental_raw_analysis?.survey || rawAnalysisObj?.previous_raw_analysis?.survey
  const waSurveyHasScores = !!(waSurvey && (surveyQuestionValid(waSurvey.question_a) || surveyQuestionValid(waSurvey.question_b)))
  let survey = waSurveyHasScores ? waSurvey : null
  let surveySource = survey ? 'WhatsApp' : ''

  // Fallback to Meet transcript survey if WhatsApp survey has no scored questions
  if (!survey && checklist?.scores) {
    const meetEntries = Object.entries(checklist.scores as Record<string, any>)
      .filter(([, v]) => surveyQuestionValid(v?.transcripciones?.survey?.question_a) || surveyQuestionValid(v?.transcripciones?.survey?.question_b))
      .sort(([a], [b]) => b.localeCompare(a))
    if (meetEntries.length) {
      survey = meetEntries[0][1].transcripciones.survey
      surveySource = `Meet ${meetEntries[0][0]}`
    }
  }

  const tipoAScore = surveyQuestionValid(survey?.question_a) ? clampScore(Number(survey.question_a.score)) : null
  const tipoBScore = surveyQuestionValid(survey?.question_b) ? clampScore(Number(survey.question_b.score)) : null
  const hasSurvey = tipoAScore != null || tipoBScore != null

  // SC Calculation
  let scScore: number | null = null
  let scCaption = 'Falta WhatsApp y Meets'
  const actualSesion = sesionScore ?? 40

  if (hasSurvey) {
    // Escenario A: Con survey
    const waPart = (normalizedWa ?? 50) * 0.40
    const sesionPart = actualSesion * 0.30
    const tipoAPart = (tipoAScore ?? 0) * 0.20
    const tipoBPart = (tipoBScore ?? 0) * 0.10
    scScore = waPart + sesionPart + tipoAPart + tipoBPart
    scCaption = `Survey: WA ${roundScore(normalizedWa ?? 50)}×40% + Sesión ${roundScore(actualSesion)}×30% + TipoA ${roundScore(tipoAScore ?? 0)}×20% + TipoB ${roundScore(tipoBScore ?? 0)}×10%`
  } else {
    // Escenario B: Sin survey (Tope 70)
    if (normalizedWa != null && sesionScore != null) {
      scScore = Math.min(70, normalizedWa * 0.55 + sesionScore * 0.45)
      scCaption = `Sin Survey (Tope 70): WA ${roundScore(normalizedWa)}×55% + Sesión ${roundScore(sesionScore)}×45%`
    } else if (normalizedWa != null) {
      scScore = Math.min(70, normalizedWa * 0.55)
      scCaption = `Sin Survey (Tope 70) Parcial: WA ${roundScore(normalizedWa)}/100 · falta Meet`
    } else if (sesionScore != null) {
      scScore = Math.min(70, sesionScore * 0.45)
      scCaption = `Sin Survey (Tope 70) Parcial: Sesión ${roundScore(sesionScore)}/100`
    }
  }

  const scIntoGlobal = scScore == null ? 0 : scScore * scWeight
  const pqIntoGlobal = pqScore == null ? 0 : pqScore * 0.25

  const coCaption = operational
    ? coScore == null
      ? `${operational.delivered_publications_count} publicaciones registradas · meta pendiente`
      : coMetaCaption ?? `CO ${roundScore(coScore)}/100`
    : 'Cumplimiento operativo'
  const pqCaption = publicationQuality
    ? pqScore == null
      ? `${publicationQuality.analyzed_count} notas analizadas · tiers pendientes`
      : `PQ ${pqPeriod ?? ''}: ${roundScore(pqScore)}/100 (${publicationQuality.scored_count} notas del mes)`
    : 'Calidad de publicaciones'

  const coDetails: string[] = []
  if (operational) {
    if (coPeriod) coDetails.push(`Periodo evaluado: ${coPeriod} (solo el mes más reciente, no acumulado anual).`)
    coDetails.push(`Publicaciones entregadas en el mes (Sheet de medios): ${operational.delivered_publications_count}`)
    if (pubMeta) coDetails.push(`Meta del contrato (${fase === 'fase_2' ? 'Fase 2, Q3-Q4' : 'Fase 1, Q1-Q2'}): ${pubMeta} publicaciones/mes`)
    if (coScore != null && pubMeta) coDetails.push(`Cálculo: ${operational.delivered_publications_count} entregadas ÷ ${pubMeta} meta × 100 = ${roundScore(coScore)}/100 (tope 100)`)
    if (coScore != null) coDetails.push(`Aporte al global: ${roundScore(coScore)} × 30% = ${roundScore(coIntoGlobal)} pts`)
    if (coScore == null) coDetails.push('Falta definir la meta de publicaciones comprometidas del contrato para calcular el score.')
  } else {
    coDetails.push('Sin datos operativos sincronizados del Sheet de medios.')
  }

  const pqDetails: string[] = []
  if (publicationQuality) {
    if (pqPeriod) pqDetails.push(`Periodo evaluado: ${pqPeriod} (solo el mes más reciente, no acumulado anual).`)
    pqDetails.push(`Publicaciones del mes: ${publicationQuality.publication_count} · analizadas por LLM: ${publicationQuality.analyzed_count} · con score: ${publicationQuality.scored_count}`)
    pqDetails.push('Cada nota se puntúa: tier del medio (tier 1 = 50, tier 2 = 30, tier 3 = 15 pts) + calidad editorial (exclusiva 30, reactiva 20, mención principal 10, secundaria 5) + enfoque narrativo (narrativa propia 20, neutral 10, defensivo 5).')
    if (pqScore != null) {
      pqDetails.push(`PQ del periodo = promedio de las notas con score: ${roundScore(pqScore)}/100`)
      pqDetails.push(`Aporte al global: ${roundScore(pqScore)} × 25% = ${roundScore(pqIntoGlobal)} pts`)
    } else {
      pqDetails.push('Faltan tiers de medios por asignar para completar el score.')
    }
  } else {
    pqDetails.push('Sin análisis de calidad de publicaciones para este periodo.')
  }

  const scDetails: string[] = []
  if (scScore != null) {
    if (hasSurvey) {
      // Los defaults (WA 50, Sesión 40) se imprimen SIEMPRE y marcados como base:
      // antes la línea de WA se omitía cuando faltaba dato pero sus 20 pts sí sumaban,
      // y el 40 de sesión parecía una sesión medida que salió mal.
      scDetails.push(normalizedWa != null
        ? `WhatsApp (WA) (40%): ${roundScore(normalizedWa)}/100 × 40% = ${roundScore(normalizedWa * 0.40)} pts`
        : `WhatsApp (WA) (40%): 50/100 (base, sin dato) × 40% = 20 pts`)
      scDetails.push(sesionScore != null
        ? `Sesión Meet/WhatsApp (30%): ${roundScore(actualSesion)}/100 × 30% = ${roundScore(actualSesion * 0.30)} pts`
        : `Sesión Meet/WhatsApp (30%): 40/100 (base, sin sesión registrada) × 30% = 12 pts`)
      if (tipoAScore != null) scDetails.push(`Pregunta Tipo A (General) (20%): ${roundScore(tipoAScore)}/100 × 20% = ${roundScore(tipoAScore * 0.20)} pts`)
      if (tipoBScore != null) scDetails.push(`Pregunta Tipo B (Objetivo) (10%): ${roundScore(tipoBScore)}/100 × 10% = ${roundScore(tipoBScore * 0.10)} pts`)
    } else {
      if (normalizedWa != null) scDetails.push(`WhatsApp (WA): ${roundScore(normalizedWa)}/100 × 55% = ${roundScore(normalizedWa * 0.55)} pts (Tope 70)`)
      if (sesionScore != null) scDetails.push(`Sesión Meet: ${roundScore(sesionScore)}/100 × 45% = ${roundScore(sesionScore * 0.45)} pts (Tope 70)`)
    }
    scDetails.push(`SC total: ${roundScore(scScore)}/100`)
    scDetails.push(`Aporte al global: ${roundScore(scScore)} × 45% = ${roundScore(scIntoGlobal)} pts`)
  } else {
    scDetails.push('Sin WhatsApp ni Meet analizados: no hay base para calcular SC.')
  }

  const waDetails: string[] = []
  if (normalizedWa != null) {
    waDetails.push(`Score del análisis LLM diario de la conversación de WhatsApp: ${roundScore(normalizedWa)}/100.`)
    waDetails.push('Evalúa tono del cliente, señales de satisfacción o fricción, tiempos de respuesta y pendientes detectados.')
    waDetails.push(`Pesa ${hasSurvey ? '40%' : '55%'} dentro del SC.`)
  } else {
    waDetails.push('Sin análisis de WhatsApp disponible todavía.')
  }

  const meetDetails: string[] = []
  if (sesionScore != null && meetEvidence) {
    meetDetails.push(`Sesión analizada: ${meetPeriod} · score ${roundScore(sesionScore)}/100`)
    meetDetails.push(`Pesa ${hasSurvey ? '30%' : '45%'} dentro del SC.`)
  } else {
    meetDetails.push('Aún no hay transcripción de Meet analizada para este cliente.')
  }

  const components = [
    {
      key: 'co',
      label: 'CO',
      caption: coApplies ? coCaption : 'No aplica para esta cuenta (su peso pasa a SC)',
      value: !coApplies ? null : (coScore == null ? null : roundScore(coIntoGlobal)),
      max: coApplies ? 30 : 0,
      contribution: coIntoGlobal,
      status: !coApplies ? 'na' : (coScore == null ? (operational ? 'conectado' : 'pendiente') : 'conectado'),
      details: coApplies ? coDetails : ['CO desactivado para esta cuenta: su 30% se reasigna a Satisfacción del Cliente (SC).'],
    },
    {
      key: 'pq',
      label: 'PQ',
      caption: pqCaption,
      value: pqScore == null ? null : roundScore(pqIntoGlobal),
      max: 25,
      contribution: pqIntoGlobal,
      status: pqScore == null ? (publicationQuality ? 'conectado' : 'pendiente') : 'conectado',
      details: pqDetails,
    },
    {
      key: 'sc',
      label: 'SC',
      caption: scCaption,
      value: scScore == null ? null : roundScore(scIntoGlobal),
      max: coApplies ? 45 : 75,
      contribution: scIntoGlobal,
      status: scScore == null ? 'pendiente' : hasSurvey ? 'conectado' : 'parcial',
      details: scDetails,
    },
    {
      key: 'wa',
      label: 'WA',
      caption: 'Subscore conectado',
      value: normalizedWa == null ? null : roundScore(normalizedWa),
      max: 100,
      contribution: normalizedWa ?? 0,
      status: normalizedWa == null ? 'pendiente' : 'conectado',
      details: waDetails,
    },
    {
      key: 'meet',
      label: 'Meet',
      caption: sesionScore == null ? 'Pendiente de clasificar minutas' : `Sesión ${meetPeriod}: análisis LLM de transcripción`,
      value: sesionScore == null ? null : roundScore(sesionScore),
      max: 100,
      contribution: sesionScore ?? 0,
      status: sesionScore == null ? 'pendiente' : 'conectado',
      details: meetDetails,
    },
    {
      key: 'survey',
      label: 'Survey',
      caption: hasSurvey
        ? `Tipo A: ${tipoAScore ?? '--'}/100 · Tipo B: ${tipoBScore ?? '--'}/100 (${surveySource})`
        : 'Pendiente de aplicar preguntas bimestrales (Tope SC a 70)',
      value: hasSurvey ? roundScore(((tipoAScore ?? 0) * 2 + (tipoBScore ?? 0)) / 3) : null,
      max: 100,
      contribution: hasSurvey ? ((tipoAScore ?? 0) * 0.20 + (tipoBScore ?? 0) * 0.10) : 0,
      status: hasSurvey ? 'conectado' : 'pendiente',
      details: [
        `Pregunta Tipo A (General): ${survey?.question_a?.question || 'no formulada'}`,
        `Respuesta Tipo A: ${survey?.question_a?.answer || 'sin respuesta'}`,
        `Calificación Tipo A: ${tipoAScore ?? 0}/100`,
        `Pregunta Tipo B (Objetivo): ${survey?.question_b?.question || 'no formulada'}`,
        `Respuesta Tipo B: ${survey?.question_b?.answer || 'sin respuesta'}`,
        `Calificación Tipo B: ${tipoBScore ?? 0}/100`,
      ],
    }
  ]

  return {
    globalPartial: scScore == null && coScore == null && pqScore == null ? null : roundScore(scIntoGlobal + coIntoGlobal + pqIntoGlobal),
    globalPartialRaw: scScore == null && coScore == null && pqScore == null ? null : (scIntoGlobal + coIntoGlobal + pqIntoGlobal),
    waScore: normalizedWa,
    components,
  }
}

function dayWindowUtc(date: string) {
  const start = new Date(`${date}T00:00:00-06:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function actionText(item: unknown) {
  return isRecord(item) ? fieldText(item.action, JSON.stringify(item)) : String(item)
}

function actionDetail(item: unknown) {
  if (!isRecord(item)) return {}
  const rawAction = isRecord(item.raw_action) ? item.raw_action : {}
  return {
    owner: fieldText(item.monday_responsible_text, fieldText(item.owner, 'Sin responsable')),
    inferredOwner: fieldText(item.owner, ''),
    status: fieldText(item.monday_status, 'Sin estado'),
    dueDate: fieldText(item.monday_due_date, fieldText(item.due_date, '')),
    urgency: fieldText(item.urgency, 'sin urgencia'),
    workType: fieldText(item.monday_work_type, fieldText(item.work_type, 'Sin tipo')),
    client: fieldText(item.monday_client_label, fieldText(item.client_label, 'Sin cliente')),
    evidenceSpeaker: fieldText(item.evidence_speaker, fieldText(rawAction.evidence_speaker, '')),
    evidenceQuote: fieldText(item.evidence_quote, fieldText(rawAction.evidence_quote, '')),
    evidenceReason: fieldText(item.evidence_reason, fieldText(rawAction.evidence_reason, '')),
    mondayItemId: fieldText(item.monday_item_id, ''),
    createdAt: fieldText(item.monday_created_at, fieldText(item.created_at, '')),
    mondayUpdatedAt: fieldText(item.monday_updated_at, ''),
    syncedAt: fieldText(item.last_synced_from_monday_at, fieldText(item.updated_at, '')),
  }
}

function methodologyBullets(value: unknown): MethodologyBullet[] {
  return asArray(value)
    .filter(isRecord)
    .map((item) => ({
      methodology: fieldText(item.methodology, 'Metodologia'),
      dimension: fieldText(item.dimension, 'Diagnostico'),
      status: fieldText(item.status, 'neutral'),
      bullet: fieldText(item.bullet, ''),
      why: fieldText(item.why, ''),
    }))
    .filter((item) => item.bullet || item.why)
}

function methodologyActions(value: unknown): RecommendedMethodologyAction[] {
  return asArray(value)
    .filter(isRecord)
    .map((item) => ({
      priority: fieldText(item.priority, 'media'),
      owner: fieldText(item.owner, 'Blackwell'),
      action: fieldText(item.action, ''),
      methodology: fieldText(item.methodology, 'Metodologia'),
    }))
    .filter((item) => item.action)
}


export default function App() {
  const [analyses, setAnalyses] = useState<DailyAnalysis[]>([])
  const [scores, setScores] = useState<AccountScore[]>([])
  const [rawMessages, setRawMessages] = useState<WaMessage[]>([])
  const [detailMessages, setDetailMessages] = useState<WaMessage[]>([])
  const [groups, setGroups] = useState<WaGroup[]>([])
  const [operationalScores, setOperationalScores] = useState<OperationalScore[]>([])
  const [publications, setPublications] = useState<AccountPublication[]>([])
  const [publicationQualityScores, setPublicationQualityScores] = useState<PublicationQualityScore[]>([])
  const [publicationQualityAnalyses, setPublicationQualityAnalyses] = useState<PublicationQualityAnalysis[]>([])
  const [methodologyAnalyses, setMethodologyAnalyses] = useState<MethodologyDailyAnalysis[]>([])
  const [tasks, setTasks] = useState<WaTask[]>([])
  const [milestones, setMilestones] = useState<AccountMilestone[]>([])



  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const [selectedOverviewDate] = useState<string>('latest')
  const [groupFilter, setGroupFilter] = useState<'all' | 'analyzed' | 'active' | 'inactive'>('all')
  const [accountSearchQuery, setAccountSearchQuery] = useState('')
  const [clientTab, setClientTab] = useState<'resumen' | 'whatsapp' | 'historico' | 'mensajes' | 'meet' | 'publicaciones' | 'reportes' | 'simulador'>('resumen')
  const [resumenSubTab, setResumenSubTab] = useState<'diagnostico' | 'tareas' | 'metodologia'>('diagnostico')
  const [chartRange, setChartRange] = useState<'7d' | '30d' | '365d'>('30d')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Gemini Meetings Integration States
  const [viewMode, setViewMode] = useState<'semaforo' | 'reuniones' | 'survey' | 'admin'>('semaforo')
  // Admin: gate + bitácora de correos de Meet (gemini_email_log)
  const [adminAuthed, setAdminAuthed] = useState(() => {
    try { return sessionStorage.getItem('bw_admin') === '1' } catch { return false }
  })
  const [emailLogs, setEmailLogs] = useState<any[]>([])
  const [emailLogsLoading, setEmailLogsLoading] = useState(false)
  const loadEmailLogs = useCallback(async () => {
    setEmailLogsLoading(true)
    const rows = await supabaseGetOptional<any[]>(
      '/rest/v1/gemini_email_log?select=id,received_at,subject,meeting_title,email_from,email_to,matched_account_id,project_uid,matched_account_name,match_method,outcome,llm_used,survey_detected,sesion_score,tasks_inserted&order=received_at.desc&limit=200',
      [],
    )
    setEmailLogs(rows)
    setEmailLogsLoading(false)
  }, [])
  useEffect(() => {
    if (viewMode === 'admin' && adminAuthed) loadEmailLogs()
  }, [viewMode, adminAuthed, loadEmailLogs])
  const handleAdminLogin = useCallback((pass: string) => {
    if (pass === ADMIN_PASSWORD) {
      setAdminAuthed(true)
      try { sessionStorage.setItem('bw_admin', '1') } catch { /* private mode */ }
      // La misma contraseña sirve como token de escritura hacia /api/admin,
      // así el admin no captura un token aparte. Requiere ADMIN_TOKEN = ADMIN_PASSWORD en Vercel.
      setAdminToken(pass)
      return true
    }
    return false
  }, [])
  // Meet/session analyses (survey + sesion_score) from Supabase — produced live by
  // the Gemini-notes email pipeline. Overrides the static checklist.json transcripciones.
  const [meetAnalyses, setMeetAnalyses] = useState<any[]>([])
  // Inteligencia documental del Drive por cliente (contratos, objetivos, faltantes).
  const [driveIntel, setDriveIntel] = useState<any[]>([])
  useEffect(() => {
    (async () => {
      const rows = await supabaseGetOptional<any[]>(
        '/rest/v1/drive_account_intel?select=account_number,project_uid,client_name,docs_total,resumen,tiene_contrato_firmado,tipo_acuerdo,vigencia_inicio,vigencia_fin,objetivos,meta_entregables,meta_monthly,renovacion,faltantes,synced_at',
        [],
      )
      setDriveIntel(demoOn() ? [...rows.filter((x: any) => String(x.account_number) !== '46'), DEMO_INTEL] : rows)
    })()
  }, [])
  const [dbTasks, setDbTasks] = useState<any[]>([])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [meetingsLoading, setMeetingsLoading] = useState(false)

  // Group Gemini tasks into meetings dynamically from Supabase dbTasks
  const meetings = useMemo(() => {
    const map = new Map<string, { id: string; title: string; date: string; duration: number; summary: string; action_items: string[]; tasks: any[] }>()
    
    // Sort dbTasks by created_at desc so that we get the latest first
    const sortedTasks = [...dbTasks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    for (const task of sortedTasks) {
      // Only process tasks imported from Gemini
      const source = task.raw_action?.source;
      if (source !== 'gemini_meet_email_sync' && source !== 'gemini_meet_notes') {
        continue;
      }
      
      const emailSubject = task.raw_action?.email_subject || 'Reunión sin título';
      
      // Clean up title (remove "Notas:" or quotes if present)
      let title = emailSubject;
      const subjectMatch = emailSubject.match(/Notas:\s*"([^"]+)"/i);
      if (subjectMatch) {
        title = subjectMatch[1];
      }

      // Título base: quita sufijos volátiles que la misma junta trae al reimportarse
      // (fecha/hora "_ 2026_07_07 09_00 CST" o un epoch "1783705426959"), para que no
      // aparezca como 2-3 tarjetas casi idénticas.
      const baseTitle = (title
        .replace(/[\s_]+\d{4}[_/-]\d{1,2}[_/-]\d{1,2}([\s_].*)?$/i, '')
        .replace(/[\s_]+\d{6,}$/, '')
        .replace(/[\s_·.-]+$/, '')
        .trim()) || title.trim()

      // Día de la reunión (email_date es el mejor indicador; luego created_at).
      const meetingDate = task.raw_action?.email_date || task.created_at || new Date().toISOString()
      const day = String(meetingDate).slice(0, 10)

      // Clave = título base + día → mismo día + misma junta se colapsan; dos días
      // distintos (aunque compartan título) siguen separados.
      const key = `${baseTitle.toLowerCase()}|${day}`

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title: baseTitle,
          date: meetingDate,
          duration: 1800, // 30 minutes default duration
          summary: `Minuta importada de Gemini desde Gmail. Sincronizada automáticamente.`,
          action_items: [],
          tasks: []
        });
      }
      
      const meeting = map.get(key)!;
      meeting.action_items.push(`${task.owner || 'Sin asignar'}: ${task.action}`);
      meeting.tasks.push(task);
    }
    
    const meetingsList = Array.from(map.values());
    meetingsList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return meetingsList;
  }, [dbTasks])

  async function handleSyncMeetings() {
    setMeetingsLoading(true)
    try {
      const rows = await supabaseGet<any[]>('/rest/v1/wa_tasks?select=*&order=created_at.desc')
      setDbTasks(rows)
    } catch (err) {
      console.error(err)
    } finally {
      setMeetingsLoading(false)
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [analysisRows, scoreRows, groupRows, rawRows, taskDbRows, mediaRows, pqRows, pqAnalysisRows, methodologyRows, milestoneRows] = await Promise.all([
          supabaseGet<DailyAnalysis[]>('/rest/v1/wa_daily_analysis?select=*&order=analyzed_at.desc&limit=200'),
          supabaseGet<AccountScore[]>('/rest/v1/wa_account_scores?select=*&order=current_score.desc'),
          supabaseGet<WaGroup[]>('/rest/v1/wa_groups?select=jid,name,account_id,active&order=name.asc'),
          supabaseGet<WaMessage[]>(
            '/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,speaker_label,speaker_team,body,msg_type,sent_at&order=sent_at.desc&limit=500',
          ),
          supabaseGet<any[]>('/rest/v1/wa_tasks?select=*&order=created_at.desc').catch(() => []),
          loadMediaPublicationsFallback(),
          supabaseGetOptional<PublicationQualityScore[]>(
            '/rest/v1/publication_quality_scores?select=*&order=period_year.desc,period_month.desc',
            [],
          ),
          supabaseGetOptional<PublicationQualityAnalysis[]>(
            '/rest/v1/publication_quality_analyses?select=*&order=analyzed_at.desc&limit=1000',
            [],
          ),
          supabaseGetOptional<MethodologyDailyAnalysis[]>(
            '/rest/v1/account_methodology_daily_analysis?select=*&order=analysis_date.desc,analyzed_at.desc&limit=100',
            [],
          ),
          supabaseGetOptional<AccountMilestone[]>(
            '/rest/v1/account_milestones?select=*&order=event_date.desc',
            [],
          ),
        ])
        const taskRows = await fetch('/api/monday-tasks')
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])

        setAnalyses(analysisRows)
        setScores(scoreRows)
        setGroups(groupRows)
        setRawMessages(rawRows)
        setOperationalScores(demoOn() ? [...mediaRows.operationalScores, DEMO_OP] : mediaRows.operationalScores)
        setPublications(mediaRows.publications)
        setPublicationQualityScores(pqRows)
        setPublicationQualityAnalyses(pqAnalysisRows)
        setMethodologyAnalyses(methodologyRows)
        setTasks(taskRows)
        setDbTasks(taskDbRows)
        setMilestones(milestoneRows)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const latestAnalysisByGroup = useMemo(() => {
    const map = new Map<string, DailyAnalysis>()
    for (const analysis of analyses) {
      const current = map.get(analysis.group_jid)
      if (!current || analysis.analyzed_at > current.analyzed_at) map.set(analysis.group_jid, analysis)
    }
    return map
  }, [analyses])


  const overviewAnalysisByGroup = useMemo(() => {
    const map = new Map<string, DailyAnalysis>()
    if (selectedOverviewDate === 'latest') return latestAnalysisByGroup

    for (const analysis of analyses) {
      if (analysis.analysis_date === selectedOverviewDate) {
        map.set(analysis.group_jid, analysis)
      }
    }
    return map
  }, [analyses, latestAnalysisByGroup, selectedOverviewDate])

  const scoreByAccount = useMemo(() => {
    return new Map(scores.map((score) => [score.account_id, score]))
  }, [scores])

  const operationalLookup = useMemo(() => {
    const byId = new Map<string, OperationalScore>()
    const byName = new Map<string, OperationalScore>()
    for (const row of operationalScores) {
      const current = byId.get(row.account_id)
      const rowKey = `${row.period_year}-${String(row.period_month).padStart(2, '0')}`
      const currentKey = current ? `${current.period_year}-${String(current.period_month).padStart(2, '0')}` : ''
      if (!current || rowKey > currentKey) byId.set(row.account_id, row)
    }
    for (const row of byId.values()) {
      const names = [row.account_name, row.account_id]
      for (const name of names) {
        const key = lookupKey(name)
        if (key && !byName.has(key)) byName.set(key, row)
      }
    }
    return { byId, byName }
  }, [operationalScores])

  const publicationQualityLookup = useMemo(() => {
    const byId = new Map<string, PublicationQualityScore>()
    const byName = new Map<string, PublicationQualityScore>()
    for (const row of publicationQualityScores) {
      const current = byId.get(row.account_id)
      const rowKey = `${row.period_year}-${String(row.period_month).padStart(2, '0')}`
      const currentKey = current ? `${current.period_year}-${String(current.period_month).padStart(2, '0')}` : ''
      if (!current || rowKey > currentKey) byId.set(row.account_id, row)
    }
    for (const row of byId.values()) {
      for (const name of [row.account_name, row.account_id]) {
        const key = lookupKey(name)
        if (key && !byName.has(key)) byName.set(key, row)
      }
    }
    return { byId, byName }
  }, [publicationQualityScores])

  // La misma URL puede tener un análisis POR CLIENTE (llave url+account_id desde la
  // migración 018). Se guardan todas las filas y el lookup prefiere la de la cuenta.
  const publicationQualityByUrl = useMemo(() => {
    const map = new Map<string, PublicationQualityAnalysis[]>()
    for (const row of publicationQualityAnalyses) {
      if (!row.url) continue
      const list = map.get(row.url)
      if (list) list.push(row)
      else map.set(row.url, [row])
    }
    return map
  }, [publicationQualityAnalyses])

  const qualityForPublication = (publication: AccountPublication): PublicationQualityAnalysis | null => {
    if (!publication.url) return null
    const rows = publicationQualityByUrl.get(publication.url)
    if (!rows?.length) return null
    const key = lookupKey(publication.account_id)
    return rows.find(r => lookupKey(r.account_id) === key) ?? rows[0]
  }

  const groupSummaries = useMemo<GroupSummary[]>(() => {
    const messageStats = new Map<string, { count: number; last: string | null; name: string | null; account: string | null }>()

    for (const message of rawMessages) {
      const key = message.group_jid
      const current = messageStats.get(key)
      if (current) {
        current.count += 1
        if (!current.last || message.sent_at > current.last) current.last = message.sent_at
        if (!current.name && message.group_name) current.name = message.group_name
        if (!current.account && message.account_id) current.account = message.account_id
      } else {
        messageStats.set(key, {
          count: 1,
          last: message.sent_at,
          name: message.group_name,
          account: message.account_id,
        })
      }
    }

    const all = new Map<string, GroupSummary>()

    for (const group of groups) {
      const stats = messageStats.get(group.jid)
      const analysis = overviewAnalysisByGroup.get(group.jid) ?? null
      const accountId = analysis?.account_id || group.account_id || stats?.account || 'Sin cuenta'
      all.set(group.jid, {
        jid: group.jid,
        name: group.name || analysis?.group_name || stats?.name || group.jid,
        account_id: accountId,
        active: group.active,
        message_count: stats?.count ?? 0,
        last_message_at: stats?.last ?? analysis?.analyzed_at ?? null,
        score: scoreByAccount.get(accountId) ?? null,
        analysis,
      })
    }

    for (const [jid, stats] of messageStats) {
      if (!all.has(jid)) {
        const analysis = overviewAnalysisByGroup.get(jid) ?? null
        const accountId = analysis?.account_id || stats.account || 'Sin cuenta'
        all.set(jid, {
          jid,
          name: analysis?.group_name || stats.name || jid,
          account_id: accountId,
          active: true,
          message_count: stats.count,
          last_message_at: stats.last,
          score: scoreByAccount.get(accountId) ?? null,
          analysis,
        })
      }
    }

    return Array.from(all.values()).sort((a, b) => {
      if (!!b.analysis !== !!a.analysis) return Number(!!b.analysis) - Number(!!a.analysis)
      return (b.last_message_at || '').localeCompare(a.last_message_at || '')
    })
  }, [groups, overviewAnalysisByGroup, rawMessages, scoreByAccount])

  // Client roster. Primary source: Supabase drive_account_roster (refreshed 2×/day
  // by the drive_roster_sync GitHub Action from Google Drive). Fallback: the static
  // accounts_status.json snapshot (used until the first Drive sync populates Supabase).
  const [driveRoster, setDriveRoster] = useState<any[]>([])
  const [accountsStatus, setAccountsStatus] = useState<any | null>(null)
  // Datos del panel admin (alta manual de clientes, override de status). Se
  // superponen al roster para que un cliente cargado a mano aparezca activo.
  const [manualAccounts, setManualAccounts] = useState<any[]>([])
  const [statusOverrides, setStatusOverrides] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [waLinks, setWaLinks] = useState<any[]>([])
  const [sheetLinks, setSheetLinks] = useState<any[]>([])
  const [manualSurveys, setManualSurveys] = useState<any[]>([])
  const reloadRoster = useCallback(async () => {
    const rows = await supabaseGetOptional<any[]>(
      '/rest/v1/drive_account_roster?select=account_number,client_name,folder_title,status,status_label&order=account_number.asc',
      [],
    )
    setDriveRoster(rows)
    const [ma, so, asg, wl, sl, msv] = await Promise.all([
      supabaseGetOptional<any[]>('/rest/v1/manual_accounts?select=account_number,client_name,folder_title,tier,tipo,ingreso_mxn,responsable', []),
      supabaseGetOptional<any[]>('/rest/v1/account_status_overrides?select=account_number,status,note', []),
      supabaseGetOptional<any[]>('/rest/v1/account_assignments?select=account_id,account_name,consultant,cell_director', []),
      supabaseGetOptional<any[]>('/rest/v1/account_wa_links?select=account_number,wa_group_name', []),
      supabaseGetOptional<any[]>('/rest/v1/account_sheet_links?select=account_number,sheet_value', []),
      supabaseGetOptional<any[]>('/rest/v1/manual_surveys?select=account_id,tipo_a,tipo_b,survey_date', []),
    ])
    setManualAccounts(demoOn() && !ma.some((x: any) => String(x.account_number) === '46') ? [...ma, DEMO_MANUAL] : ma)
    setStatusOverrides(so)
    setAssignments(asg)
    setWaLinks(wl)
    setSheetLinks(sl)
    setManualSurveys(msv)
  }, [])
  useEffect(() => {
    reloadRoster()
    ;(async () => {
      try {
        const r = await fetch('/data/accounts_status.json')
        if (r.ok) setAccountsStatus(await r.json())
      } catch { /* offline */ }
    })()
  }, [reloadRoster])

  const rosterByNumber = useMemo(() => {
    const m = new Map<string, { name: string; statusLabel: string | null; status: string }>()
    if (driveRoster.length) {
      // Supabase (live Drive) — preferred.
      for (const r of driveRoster) {
        if (r?.account_number == null) continue
        const num = String(Number(r.account_number))
        if (num === 'NaN') continue
        const name = r.client_name || rosterCleanName(r.folder_title)
        let status = r.status
        if (['31', '32', '37', '45'].includes(num)) {
          status = 'terminated_early'
        }
        const label = r.status_label ?? ROSTER_STATUS_LABEL[status] ?? null
        m.set(num, { name: name || String(r.folder_title || ''), statusLabel: label, status })
      }
    } else {
    // Fallback: static snapshot.
    const list = Array.isArray(accountsStatus?.accounts) ? accountsStatus.accounts : []
    for (const s of list) {
      if (s?.number == null) continue
      const num = String(Number(s.number))
      if (num === 'NaN') continue
      const name = rosterCleanName(s.folderTitle)
      let status = rosterStatusFrom(s.folderTitle, s.derivedStatus)
      if (['31', '32', '37', '45'].includes(num)) {
        status = 'terminated_early'
      }
      m.set(num, { name: name || String(s.folderTitle || ''), statusLabel: ROSTER_STATUS_LABEL[status] ?? null, status })
    }
    }

    // Alta manual de clientes (panel admin): aparecen en el roster aunque no
    // tengan carpeta en Drive todavía.
    for (const ma of manualAccounts) {
      const num = String(Number(ma.account_number))
      if (num === 'NaN' || m.has(num)) continue
      m.set(num, { name: ma.client_name || `Cuenta ${num}`, statusLabel: null, status: 'active' })
    }
    // Override manual de status (gana sobre Drive) para cualquier cuenta.
    for (const ov of statusOverrides) {
      const num = String(Number(ov.account_number))
      if (num === 'NaN') continue
      const prev = m.get(num)
      if (prev) m.set(num, { ...prev, status: ov.status, statusLabel: ROSTER_STATUS_LABEL[ov.status] ?? prev.statusLabel })
      else m.set(num, { name: `Cuenta ${num}`, status: ov.status, statusLabel: ROSTER_STATUS_LABEL[ov.status] ?? null })
    }

    // Demo local (solo DEV): previsualizar Arrendo sin escribir a Supabase.
    if (import.meta.env.DEV && localStorage.getItem('admin:demoArrendo') === '1' && !m.has('46')) {
      m.set('46', { name: 'ARRENDO SERV', statusLabel: null, status: 'active' })
    }

    return m
  }, [driveRoster, accountsStatus, manualAccounts, statusOverrides])

  const rosterFor = useCallback((accountId: string) => {
    const id = String(accountId || '').trim()
    return /^\d+$/.test(id) ? rosterByNumber.get(String(Number(id))) : undefined
  }, [rosterByNumber])

  // Survey completion per account: how many of the 2 questions are answered.
  // Priority mirrors the SC logic: a WhatsApp survey with scores wins, else Meet.
  const surveyByAccount = useMemo(() => {
    const meetByAcct = new Map<string, { survey: any; date: string }>()
    for (const r of meetAnalyses) { // fetched created_at desc → first seen = latest
      const num = String(Number(r.account_id))
      if (num === 'NaN' || meetByAcct.has(num)) continue
      const s = r.survey
      if (s && (surveyQuestionValid(s.question_a) || surveyQuestionValid(s.question_b))) {
        const dStr = r.created_at ? r.created_at.slice(0, 10) : ''
        meetByAcct.set(num, { survey: s, date: dStr })
      }
    }
    const waByAcct = new Map<string, { survey: any; date: string }>()
    const waSorted = [...analyses].sort((a, b) => (b.analyzed_at || '').localeCompare(a.analyzed_at || ''))
    for (const a of waSorted) {
      const num = String(Number(a.account_id))
      if (num === 'NaN' || waByAcct.has(num)) continue
      const s = a.raw_analysis?.survey
      if (s && (surveyQuestionValid(s.question_a) || surveyQuestionValid(s.question_b))) {
        waByAcct.set(num, { survey: s, date: a.analysis_date || '' })
      }
    }
    // Surveys registrados a mano (admin) — máxima prioridad (el análisis automático no
    // los capturó, p.ej. los que levantó Uriel).
    const manualByAcct = new Map<string, { tipo_a: number | null; tipo_b: number | null; date: string }>()
    for (const m of manualSurveys) {
      const k = String(Number(m.account_id))
      if (k !== 'NaN') manualByAcct.set(k, { tipo_a: m.tipo_a, tipo_b: m.tipo_b, date: m.survey_date || '' })
    }
    const out = new Map<string, { answered: number; pct: number; tipoA: boolean; tipoB: boolean; source: string; date: string }>()
    for (const { num } of CLIENT_ROSTER) {
      const key = String(Number(num))
      const man = manualByAcct.get(key)
      if (man) {
        const tipoA = man.tipo_a != null, tipoB = man.tipo_b != null
        const answered = (tipoA ? 1 : 0) + (tipoB ? 1 : 0)
        const sA = tipoA ? Math.max(0, Math.min(100, Number(man.tipo_a))) : 0
        const sB = tipoB ? Math.max(0, Math.min(100, Number(man.tipo_b))) : 0
        out.set(num, { answered, pct: answered > 0 ? Math.round((sA + sB) / 2) : 0, tipoA, tipoB, source: 'Manual', date: man.date })
        continue
      }
      const wa = waByAcct.get(key)
      const meet = meetByAcct.get(key)
      const entry = wa || meet || null
      const survey = entry?.survey || null
      const tipoA = surveyQuestionValid(survey?.question_a)
      const tipoB = surveyQuestionValid(survey?.question_b)
      const answered = (tipoA ? 1 : 0) + (tipoB ? 1 : 0)
      const date = entry?.date || ''
      const source = wa ? 'WhatsApp' : (meet ? 'Meet' : '')
      const sA = tipoA ? Math.max(0, Math.min(100, Number(survey.question_a.score))) : 0
      const sB = tipoB ? Math.max(0, Math.min(100, Number(survey.question_b.score))) : 0
      const pct = answered > 0 ? Math.round((sA + sB) / 2) : 0
      out.set(num, { answered, pct, tipoA, tipoB, source, date })
    }
    return out
  }, [meetAnalyses, analyses, manualSurveys])

  const surveyClients = useMemo<SurveyClient[]>(() => {
    // Override de consultor desde account_assignments (traslado manual en el
    // panel admin) — gana sobre el consultor hardcodeado del CLIENT_ROSTER.
    const asgByNum = new Map<string, string>()
    for (const a of assignments) {
      const n = String(Number(a.account_id))
      if (n !== 'NaN' && a.consultant) asgByNum.set(n, a.consultant)
    }
    const base = CLIENT_ROSTER
      .filter(({ num }) => num !== '08')
      .map(({ num, name, consultant }) => {
        const n = String(Number(num))
        const liveName = rosterByNumber.get(n)?.name
        const sv = surveyByAccount.get(num) ?? { answered: 0, pct: 0, tipoA: false, tipoB: false, source: '', date: '' }
        return { account_number: num, name: liveName || name, consultant: asgByNum.get(n) || consultant, ...sv }
      })
    // Cuentas manuales (panel admin) que no estén en CLIENT_ROSTER.
    const present = new Set(base.map(c => String(Number(c.account_number))))
    for (const m of manualAccounts) {
      const n = String(Number(m.account_number))
      if (n === 'NaN' || present.has(n)) continue
      const sv = surveyByAccount.get(n) ?? { answered: 0, pct: 0, tipoA: false, tipoB: false, source: '', date: '' }
      base.push({ account_number: n, name: rosterByNumber.get(n)?.name || m.client_name || `Cuenta ${n}`, consultant: asgByNum.get(n) || m.responsable || 'Sin asignar', ...sv })
    }
    // Solo clientes ACTIVOS: los concluidos/pausados/inactivos no aparecen en el survey.
    return base.filter(c => (rosterFor(c.account_number)?.status || 'active').startsWith('active'))
  }, [surveyByAccount, rosterByNumber, assignments, manualAccounts, rosterFor])

  // Listas para los dropdowns del panel admin (elegir en vez de escribir).
  const consultantList = useMemo(() => {
    const s = new Set<string>()
    for (const r of CLIENT_ROSTER) if (r.consultant && r.consultant !== 'Sin asignar') s.add(r.consultant)
    for (const a of assignments) if (a.consultant) s.add(a.consultant)
    return [...s].sort((x, y) => x.localeCompare(y))
  }, [assignments])
  const sheetValueList = useMemo(() => {
    const s = new Set<string>()
    for (const p of publications) if (p.sheet_client_name) s.add(p.sheet_client_name)
    return [...s].sort((x, y) => x.localeCompare(y))
  }, [publications])
  const waGroupList = useMemo(() => {
    const s = new Set<string>()
    for (const g of groups) if (g.name) s.add(g.name)
    return [...s].sort((x, y) => x.localeCompare(y))
  }, [groups])


  const accountSummaries = useMemo<AccountSummary[]>(() => {
    const todayStr = todayMexicoStr()
    const map = new Map<string, GroupSummary[]>()
    for (const g of groupSummaries) {
      const key = g.account_id === '00_UNMAPPED' ? g.jid : g.account_id
      const arr = map.get(key) ?? []
      arr.push(g)
      map.set(key, arr)
    }
    const result: AccountSummary[] = []
    for (const [key, grps] of map) {
      const mainGroup = grps.find(g => !g.name.toLowerCase().includes('interno')) ?? grps[0]
      const latestAnalysis = grps
        .map(g => g.analysis)
        .filter((a): a is DailyAnalysis => a !== null)
        .sort((a, b) => b.analyzed_at.localeCompare(a.analyzed_at))[0] ?? null
      const analyzedToday = grps.some(g => g.analysis?.analysis_date === todayStr)
      const hasMessagesToday = grps.some(g => g.last_message_at && g.last_message_at.slice(0, 10) >= todayStr)
      const explicitKeys = explicitLinkedKeys([
        key,
        mainGroup.score?.account_id,
        mainGroup.score?.account_name,
        mainGroup.name,
        ...grps.map((g) => g.name),
      ])
      const operational =
        operationalLookup.byId.get(key) ??
        operationalLookup.byId.get(mainGroup.score?.account_id ?? '') ??
        Array.from(explicitKeys).map((aliasKey) => operationalLookup.byId.get(aliasKey)).find(Boolean) ??
        operationalLookup.byName.get(lookupKey(mainGroup.score?.account_name)) ??
        operationalLookup.byName.get(lookupKey(mainGroup.name)) ??
        Array.from(explicitKeys).map((aliasKey) => operationalLookup.byName.get(aliasKey)).find(Boolean) ??
        null
      const publicationQuality =
        publicationQualityLookup.byId.get(key) ??
        publicationQualityLookup.byId.get(mainGroup.score?.account_id ?? '') ??
        Array.from(explicitKeys).map((aliasKey) => publicationQualityLookup.byId.get(aliasKey)).find(Boolean) ??
        publicationQualityLookup.byName.get(lookupKey(mainGroup.score?.account_name)) ??
        publicationQualityLookup.byName.get(lookupKey(mainGroup.name)) ??
        Array.from(explicitKeys).map((aliasKey) => publicationQualityLookup.byName.get(aliasKey)).find(Boolean) ??
        null
      const roster = rosterFor(key)
      result.push({
        account_id: key,
        name: roster?.name || mainGroup.name,
        statusLabel: roster?.statusLabel ?? null,
        groups: grps,
        score: mainGroup.score,
        operational,
        publicationQuality,
        analyzedToday,
        hasMessagesToday,
        latestAnalysis,
      })
    }
    return result.sort((a, b) => {
      if (!!b.latestAnalysis !== !!a.latestAnalysis) return Number(!!b.latestAnalysis) - Number(!!a.latestAnalysis)
      const aLast = a.groups.map(g => g.last_message_at ?? '').sort().reverse()[0] ?? ''
      const bLast = b.groups.map(g => g.last_message_at ?? '').sort().reverse()[0] ?? ''
      return bLast.localeCompare(aLast)
    })
  }, [groupSummaries, operationalLookup, publicationQualityLookup, rosterFor])

  const selectedAccount = selectedAccountId ? accountSummaries.find(a => a.account_id === selectedAccountId) ?? null : null



  async function handleDeleteMilestone(id: number) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este hito histórico?')) return
    try {
      setLoading(true)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/account_milestones?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      })
      if (!res.ok) {
        throw new Error(await res.text())
      }
      setMilestones(prev => prev.filter(m => m.id !== id))
    } catch (err) {
      alert(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const selectedAccountMilestones = useMemo(() => {
    if (!selectedAccount) return []
    const ids = [selectedAccount.account_id]
    const names = [selectedAccount.name.toLowerCase(), selectedAccount.account_id.toLowerCase()]
    return milestones.filter(m => {
      const matchId = ids.includes(m.account_id) || ids.map(Number).includes(Number(m.account_id))
      const matchName = m.account_name ? names.some(n => m.account_name!.toLowerCase().includes(n) || n.includes(m.account_name!.toLowerCase())) : false
      return matchId || matchName
    }).sort((a, b) => b.event_date.localeCompare(a.event_date))
  }, [milestones, selectedAccount])

  // Load ALL per-account checklist.json once (SC evidence, contract, scores by period)
  const [allChecklists, setAllChecklists] = useState<{ folder: string; data: any }[]>([])
  useEffect(() => {
    (async () => {
      try {
        const mr = await fetch('/data/accounts/manifest.json')
        if (!mr.ok) return
        const folders: string[] = await mr.json()
        const results = await Promise.all(
          folders.map(async (folder) => {
            try {
              const r = await fetch(`/data/accounts/${folder}/checklist.json`)
              if (r.ok) return { folder, data: await r.json() }
            } catch { /* skip */ }
            return null
          })
        )
        setAllChecklists(results.filter(Boolean) as { folder: string; data: any }[])
      } catch { /* offline */ }
    })()
  }, [])

  // Load Meet/session analyses from Supabase (survey + sesion_score). Optional so
  // the dashboard keeps working before migration 012 is applied.
  useEffect(() => {
    (async () => {
      const rows = await supabaseGetOptional<any[]>(
        // model!=regex_fallback: filas fabricadas por el extractor de emergencia (score
        // 80 + survey 80/80 inventados) no deben entrar al SC ni a la vista de surveys.
        '/rest/v1/meet_transcription_analyses?select=account_id,period,sesion_score,survey,attended,attended_on_time,participation_level,positive_comments,shared_strategic_info,negative_signals,negative_detail,tone,reasoning,checklist,action_items,model,created_at&model=neq.regex_fallback&order=created_at.desc',
        [],
      )
      setMeetAnalyses(rows)
    })()
  }, [])

  // Merge Supabase Meet analyses into each account's checklist scores so the SC
  // formula and "Survey aplicado" block read live data. Supabase wins per period;
  // periods without a Supabase row keep the static checklist.json value.
  // También fusiona la inteligencia del Drive (drive_account_intel): si el
  // checklist estático no trae contrato/vigencia pero el contrato firmado ya
  // está en Drive, se activa (gate del score global); y si falta la meta de
  // publicaciones para el CO, se toma de los entregables comprometidos.
  const mergedChecklists = useMemo(() => {
    if (!meetAnalyses.length && !driveIntel.length) return allChecklists
    const intelByNum = new Map<number, any>()
    for (const r of driveIntel) {
      const n = Number(r.account_number)
      if (!Number.isNaN(n)) intelByNum.set(n, r)
    }
    const mapped = allChecklists.map(entry => {
      const acctNum = Number(entry.data?.account_number ?? NaN)
      if (Number.isNaN(acctNum)) return entry
      // Filter meetings for this account and sort them earliest-first so the latest one wins/overwrites fields at the end
      const rowsForAcct = meetAnalyses
        .filter(r => Number(r.account_id) === acctNum)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      const intel = intelByNum.get(acctNum)
      if (!rowsForAcct.length && !intel) return entry
      const data = { ...entry.data, scores: { ...(entry.data.scores || {}) } }
      // Drive intel → contrato (vigencia) y meta de publicaciones (CO)
      if (intel) {
        // Meta mensual parseada del texto del contrato (insumo del CO). Se calcula
        // una vez y sirve tanto para el gate como para la meta de publicaciones.
        let intelMetaNum: number | null = null
        // Preferimos la meta mensual calculada por IA (drive_account_intel.meta_monthly);
        // el regex queda solo como respaldo si la IA no la pudo determinar.
        if (intel.meta_monthly != null && Number(intel.meta_monthly) > 0) {
          intelMetaNum = Number(intel.meta_monthly)
        } else if (intel.meta_entregables) {
          const metaText = String(intel.meta_entregables)
          const m = metaText.match(/(\d+)\s*(?:publicacion|nota|bolet[ií]n|contenido|comunicado|art[ií]culo|columna|entregable|impacto|colocaci|acci[oó]n)/i)
          if (m) {
            let metaMensual = Number(m[1])
            const win = metaText.slice(Math.max(0, m.index! - 25), m.index! + m[0].length + 35)
            if (/cuatrimestr/i.test(win)) metaMensual = Math.max(1, Math.round(metaMensual / 4))
            else if (/trimestr/i.test(win)) metaMensual = Math.max(1, Math.round(metaMensual / 3))
            else if (/semestr/i.test(win)) metaMensual = Math.max(1, Math.round(metaMensual / 6))
            // "24 publicaciones anuales" antes producía meta 24/MES (CO imposible).
            else if (/anual|al a[nñ]o|por a[nñ]o/i.test(win)) metaMensual = Math.max(1, Math.round(metaMensual / 12))
            else if (/semana/i.test(win)) metaMensual = metaMensual * 4
            intelMetaNum = metaMensual
          }
        }

        const hasVigencia = !!data.contract?.vigencia
        const bothDates = intel.vigencia_inicio && intel.vigencia_fin
        // Vencido = terminó hace más de ~4 meses (excluye contratos viejos, p.ej. RR).
        const cutoff = (() => { const d = new Date(todayMexicoStr()); d.setMonth(d.getMonth() - 4); return d.toISOString().slice(0, 10) })()
        const stale = !!intel.vigencia_fin && String(intel.vigencia_fin) < cutoff
        // Documento presente = contrato (aunque no esté firmado ni tenga fechas): activa el
        // gate del score global. La barra de vigencia solo se dibuja si hay AMBAS fechas.
        const hasContractDoc = intel.tiene_contrato_firmado === true || intelMetaNum != null
        if (!hasVigencia && !stale && hasContractDoc) {
          data.contract = {
            ...(data.contract || {}),
            present: true, // hay contrato/documento → activa aunque falten fechas
            // "inicio/fin" (con "/") dibuja la barra; si falta alguna fecha, texto o nada.
            vigencia: bothDates
              ? `${intel.vigencia_inicio}/${intel.vigencia_fin}`
              : (intel.vigencia_inicio || intel.vigencia_fin)
                ? `${intel.vigencia_inicio ?? '¿?'} a ${intel.vigencia_fin ?? 'indefinida'}`
                : undefined,
            nota: intel.tiene_contrato_firmado === true
              ? 'Contrato detectado en Drive (carpeta 01)'
              : 'Documento/acuerdo detectado en Drive (carpeta 01)',
          }
        }

        const pubItem = data.schema?.items?.publicaciones_web
        const hasMeta = pubItem && (pubItem.meta_fase1 != null || pubItem.meta_fase2 != null)
        if (!hasMeta && intelMetaNum != null) {
          data.schema = {
            ...(data.schema || {}),
            items: {
              ...(data.schema?.items || {}),
              publicaciones_web: { ...(pubItem || {}), meta_fase1: intelMetaNum },
            },
          }
        }
      }
      for (const row of rowsForAcct) {
        const score = row.sesion_score
        const prev = data.scores[row.period] || {}
        const rowHasSurvey = row.survey && (surveyQuestionValid(row.survey.question_a) || surveyQuestionValid(row.survey.question_b))
        const prevSurvey = prev.transcripciones?.survey
        data.scores[row.period] = {
          ...prev,
          transcripciones: {
            ...(prev.transcripciones || {}),
            status: score >= 80 ? 'ok' : score >= 50 ? 'partial' : 'missing',
            score,
            sesion_score: score,
            attended: row.attended,
            attended_on_time: row.attended_on_time,
            participation_level: row.participation_level,
            tone: row.tone,
            positive_comments: row.positive_comments,
            shared_strategic_info: row.shared_strategic_info,
            negative_signals: row.negative_signals,
            checklist: row.checklist || [],
            reasoning: row.reasoning || '',
            // action_items de Supabase son objetos {owner, action, ...}; el render
            // espera strings, así que se normalizan a "Owner: acción".
            accionables: (row.action_items || []).map((a: any) =>
              typeof a === 'string' ? a : `${a?.owner ? a.owner + ': ' : ''}${a?.action ?? ''}`.trim()
            ).filter(Boolean),
            survey: rowHasSurvey ? row.survey : (prevSurvey || row.survey || null),
            _source: 'supabase',
          },
        }
      }
      return { ...entry, data }
    })

    // Clientes con contrato en Supabase (drive_account_intel) pero sin
    // checklist.json estático (altas manuales, ej. Arrendo 46): se sintetiza una
    // entrada para que tengan vigencia + meta y el CO/timeline sean calculables.
    const presentNums = new Set(mapped.map(e => Number(e.data?.account_number)).filter(n => !Number.isNaN(n)))
    const synthetic: { folder: string; data: any }[] = []
    for (const intel of driveIntel) {
      const num = Number(intel.account_number)
      if (Number.isNaN(num) || presentNums.has(num)) continue
      const vig = (intel.vigencia_inicio && intel.vigencia_fin)
        ? `${intel.vigencia_inicio}/${intel.vigencia_fin}`
        : (intel.vigencia_inicio || intel.vigencia_fin)
          ? `${intel.vigencia_inicio ?? '¿?'} a ${intel.vigencia_fin ?? 'indefinida'}`
          : null
      if (!vig) continue
      let metaNum: number | null = null
      if (intel.meta_entregables) {
        const mm = String(intel.meta_entregables).match(/(\d+)/)
        if (mm) metaNum = Number(mm[1])
      }
      synthetic.push({
        folder: `${String(num).padStart(2, '0')}_MANUAL`,
        data: {
          account_number: num,
          account_id: String(num),
          account_name: intel.client_name || `Cuenta ${num}`,
          contract: {
            fase_actual: 'fase_1',
            vigencia: vig,
            nota: intel.tiene_contrato_firmado ? 'Contrato cargado (panel admin)' : 'Propuesta cargada (panel admin)',
          },
          schema: { items: metaNum != null ? { publicaciones_web: { meta_fase1: metaNum, unidad: 'publicaciones/mes' } } : {} },
          scores: {},
        },
      })
    }
    return [...mapped, ...synthetic]
  }, [allChecklists, meetAnalyses, driveIntel])

  const findChecklist = useCallback((accountId: string, accountName?: string) => {
    const nameNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    // El account_id de la app es el número de cuenta ('02', '12') — match directo por account_number
    const asNumber = /^\d+$/.test(accountId.trim()) ? String(Number(accountId.trim())) : null
    if (asNumber) {
      const byNumber = mergedChecklists.find(x => String(Number(x.data.account_number ?? -1)) === asNumber)
      if (byNumber) return byNumber.data
    }
    const keys = [accountId, accountName].filter(Boolean).map(k => nameNorm(String(k)))
    for (const key of keys) {
      if (key.length < 3) continue
      const match =
        mergedChecklists.find(x => nameNorm(x.data.account_id ?? '') === key) ??
        mergedChecklists.find(x => {
          const cn = nameNorm(x.data.account_name ?? '')
          return cn.length >= 3 && (cn.includes(key) || key.includes(cn))
        }) ??
        mergedChecklists.find(x => {
          const fn = nameNorm(x.folder.replace(/^\d+/, ''))
          return fn.length >= 3 && (fn.includes(key) || key.includes(fn))
        })
      if (match) return match.data
    }
    return null
  }, [mergedChecklists])

  const accountChecklistData = useMemo(
    () => (selectedAccount ? findChecklist(selectedAccount.account_id, selectedAccount.name) : null),
    [selectedAccount?.account_id, selectedAccount?.name, findChecklist]
  )

  // Cuentas con checklist completo (contrato) pero sin grupo de WhatsApp registrado (ej. Maja):
  // se agregan como filas sintéticas para que aparezcan en la lista con su score global.
  const accountSummariesAll = useMemo<AccountSummary[]>(() => {
    const result = [...accountSummaries]
    for (const { data } of allChecklists) {
      if ((!data?.contract?.vigencia && !data?.contract?.present) || data.account_number == null) continue
      const num = String(Number(data.account_number))
      const exists = result.some(a => /^\d+$/.test(a.account_id.trim()) && String(Number(a.account_id.trim())) === num)
      if (exists) continue
      const waRow = scores.find(s => /^\d+$/.test(String(s.account_id).trim()) && String(Number(String(s.account_id).trim())) === num) ?? null
      const aid = String(data.account_id ?? '').toLowerCase()
      const operational =
        (aid ? operationalLookup.byId.get(aid) : undefined) ??
        operationalLookup.byName.get(lookupKey(data.account_name)) ??
        null
      const publicationQuality =
        (aid ? publicationQualityLookup.byId.get(aid) : undefined) ??
        publicationQualityLookup.byName.get(lookupKey(data.account_name)) ??
        null
      const roster = rosterByNumber.get(num)
      result.push({
        account_id: String(data.account_number).padStart(2, '0'),
        name: roster?.name || data.account_name || `Cuenta ${num}`,
        statusLabel: roster?.statusLabel ?? null,
        groups: [],
        score: waRow,
        operational,
        publicationQuality,
        analyzedToday: false,
        hasMessagesToday: false,
        latestAnalysis: null,
      })
    }
    // Altas manuales del panel admin (aún sin grupo/checklist): fila con sus
    // scores operacionales (CO) y de calidad si ya se cargaron a Supabase.
    for (const ma of manualAccounts) {
      const num = String(Number(ma.account_number))
      if (num === 'NaN') continue
      const exists = result.some(a => /^\d+$/.test(a.account_id.trim()) && String(Number(a.account_id.trim())) === num)
      if (exists) continue
      const operational = operationalLookup.byId.get(num) ?? null
      const publicationQuality = publicationQualityLookup.byId.get(num) ?? null
      const roster = rosterByNumber.get(num)
      result.push({
        account_id: num.padStart(2, '0'),
        name: roster?.name || ma.client_name || `Cuenta ${num}`,
        statusLabel: roster?.statusLabel ?? null,
        groups: [],
        score: null,
        operational,
        publicationQuality,
        analyzedToday: false,
        hasMessagesToday: false,
        latestAnalysis: null,
      })
    }
    return result
  }, [accountSummaries, allChecklists, scores, operationalLookup, publicationQualityLookup, rosterByNumber, manualAccounts])

  // Lista de la vista "Cuentas": SOLO clientes con carpeta en Drive. Se excluyen
  // los grupos de WhatsApp sin cuenta (00_UNMAPPED, p.ej. "HH / Tebo", "AI Team"),
  // que en accountSummaries entran con clave = jid (no numérica). Se incluyen las
  // carpetas marcadas como concluido/terminación anticipada (traen statusLabel) y
  // las que aún no tienen grupo de WhatsApp (aparecen en gris, sin ponderar).
  const clientAccounts = useMemo<AccountSummary[]>(() => {
    // Números válidos = carpetas de Drive (roster en vivo, incluye concluidos)
    // ∪ roster curado (fallback siempre disponible si Drive no cargó).
    const validNums = new Set<string>()
    for (const k of rosterByNumber.keys()) validNums.add(k)
    const curatedName = new Map<string, string>()
    for (const { num, name } of CLIENT_ROSTER) {
      const n = String(Number(num))
      validNums.add(n)
      curatedName.set(n, name)
    }

    const byNum = new Map<string, AccountSummary>()
    for (const a of accountSummariesAll) {
      const id = String(a.account_id || '').trim()
      if (!/^\d+$/.test(id)) continue        // descarta grupos WhatsApp sin cuenta (clave = jid)
      const num = String(Number(id))
      if (!validNums.has(num)) continue        // descarta números sin carpeta de Drive
      if (!byNum.has(num)) byNum.set(num, a)   // dedup (gana el primero = el que tiene grupos)
    }
    // Carpetas de Drive todavía sin grupo/checklist (incl. concluidas): fila en
    // gris, PERO enganchando su CO/PQ por número si ya existen en Supabase (así
    // una cuenta sin WhatsApp — ej. Arrendo — puede mostrar CO al cargarlo).
    for (const num of validNums) {
      if (byNum.has(num)) continue
      const roster = rosterByNumber.get(num)
      const padded = num.padStart(2, '0')
      const operational = operationalLookup.byId.get(num) ?? operationalLookup.byId.get(padded) ?? null
      const publicationQuality = publicationQualityLookup.byId.get(num) ?? publicationQualityLookup.byId.get(padded) ?? null
      byNum.set(num, {
        account_id: padded,
        name: roster?.name || curatedName.get(num) || `Cuenta ${num}`,
        statusLabel: roster?.statusLabel ?? null,
        groups: [],
        score: null,
        operational,
        publicationQuality,
        analyzedToday: false,
        hasMessagesToday: false,
        latestAnalysis: null,
      })
    }
    return [...byNum.values()]
  }, [accountSummariesAll, rosterByNumber, operationalLookup, publicationQualityLookup])

  // Panorama de vinculación: una fila por cuenta con qué está vinculado (verde)
  // y qué falta (rojo). Alimenta la pestaña "Panorama" del panel admin.
  const panorama = useMemo(() => {
    const waNums = new Set<string>()
    for (const g of groups) { const n = String(Number(g.account_id)); if (n !== 'NaN') waNums.add(n) }
    for (const l of waLinks) { const n = String(Number(l.account_number)); if (n !== 'NaN') waNums.add(n) }
    const waNameByNum = new Map<string, string>()
    for (const g of groups) { const n = String(Number(g.account_id)); if (n !== 'NaN' && g.name && !waNameByNum.has(n)) waNameByNum.set(n, g.name) }
    for (const l of waLinks) { const n = String(Number(l.account_number)); if (n !== 'NaN' && l.wa_group_name && !waNameByNum.has(n)) waNameByNum.set(n, l.wa_group_name) }
    const sheetByNum = new Map<string, string>()
    for (const p of publications) { const n = String(Number(p.account_id)); if (n !== 'NaN' && p.sheet_client_name && !sheetByNum.has(n)) sheetByNum.set(n, p.sheet_client_name) }
    for (const l of sheetLinks) { const n = String(Number(l.account_number)); if (n !== 'NaN' && l.sheet_value && !sheetByNum.has(n)) sheetByNum.set(n, l.sheet_value) }
    const intelByNum = new Map<string, any>()
    for (const r of driveIntel) { const n = String(Number(r.account_number)); if (n !== 'NaN') intelByNum.set(n, r) }
    const asgByNum = new Map<string, string>()
    for (const a of assignments) { const n = String(Number(a.account_id)); if (n !== 'NaN' && a.consultant) asgByNum.set(n, a.consultant) }
    const rosterConsult = new Map<string, string>()
    for (const r of CLIENT_ROSTER) rosterConsult.set(String(Number(r.num)), r.consultant)

    return clientAccounts.map(a => {
      const num = String(Number(a.account_id))
      const intel = intelByNum.get(num)
      const consultant = asgByNum.get(num) || rosterConsult.get(num) || ''
      const meta = (intel?.meta_entregables || '').toString()
      return {
        num,
        name: a.name,
        status: rosterByNumber.get(num)?.status || 'active',
        hasContract: !!(intel && (intel.tiene_contrato_firmado || intel.vigencia_inicio || intel.vigencia_fin)),
        hasMeta: !!meta, meta,
        hasWa: waNums.has(num), waName: waNameByNum.get(num) || '',
        hasSheet: sheetByNum.has(num), sheetValue: sheetByNum.get(num) || '',
        hasConsultant: !!consultant && consultant !== 'Sin asignar', consultant,
      }
    }).sort((x, y) => Number(x.num) - Number(y.num))
  }, [clientAccounts, groups, waLinks, publications, sheetLinks, driveIntel, assignments, rosterByNumber])

  const selectedGroup = selectedJid ? groupSummaries.find((group) => group.jid === selectedJid) ?? null : null

  const selectedAccountMeetings = useMemo(() => {
    if (!selectedAccount) return []

    // Señal FUERTE de atribución: el account_id de la tarea (lo pone el matcher del
    // import). Antes se usaba el número crudo como SUBCADENA (taskText.includes("13")),
    // que enganchaba cualquier reunión con "13" en una fecha/hora/folio → aparecían
    // clientes ajenos. Ahora el número se compara EXACTO.
    const idTrim = String(selectedAccount.account_id ?? '').trim()
    const selNum = /^\d+$/.test(idTrim) ? String(Number(idTrim)) : null
    const selSlug = selNum ? null : idTrim.toLowerCase()

    // Fallback por nombre/etiqueta: solo cadenas ≥4 chars, comparadas como frase con
    // límite de palabra (nada de subcadenas sueltas como "rr" o "cima" en "décima").
    const nameNeedles = [selectedAccount.name, ...selectedAccount.groups.map(group => group.name)]
      .filter(Boolean)
      .map(value => String(value).toLowerCase().trim())
      .filter(value => value.length >= 4)
    const wordMatch = (haystack: string, needle: string) => {
      const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|\\W)${esc}(\\W|$)`).test(haystack)
    }

    return meetings.filter(meeting => {
      const title = meeting.title.toLowerCase()
      return meeting.tasks.some(task => {
        const taskIdTrim = String(task.account_id ?? '').trim()
        // 1) account_id exacto (número o slug) — la vía correcta.
        if (selNum && /^\d+$/.test(taskIdTrim) && String(Number(taskIdTrim)) === selNum) return true
        if (selSlug && taskIdTrim.toLowerCase() === selSlug) return true
        // 2) Etiqueta de cliente explícita que iguala el nombre de la cuenta.
        const labels = [
          task.monday_client_label,
          task.client_label,
          task.raw_action?.monday_client_label,
          task.raw_action?.client_label,
        ].filter(Boolean).map(v => String(v).toLowerCase().trim())
        if (labels.some(l => nameNeedles.some(n => l === n || wordMatch(l, n)))) return true
        // 3) Fallback: el título de la reunión contiene el nombre completo como palabra.
        return nameNeedles.some(n => wordMatch(title, n))
      })
    })
  }, [meetings, selectedAccount])

  const selectedAccountPublications = useMemo(() => {
    if (!selectedAccount) return []
    const keys = explicitLinkedKeys([
      selectedAccount.account_id,
      selectedAccount.name,
      selectedAccount.score?.account_id,
      selectedAccount.score?.account_name,
      ...selectedAccount.groups.map(group => group.name),
    ])

    return publications.filter((publication) => {
      const pubKeys = [
        publication.account_id,
        publication.account_name,
        publication.sheet_client_name,
      ].map(lookupKey).filter(Boolean)
      return pubKeys.some((pubKey) => keys.has(pubKey))
    })
  }, [publications, selectedAccount])

  const selectedMethodologyAnalysis = useMemo(() => {
    if (!selectedAccount) return null
    const keys = explicitLinkedKeys([
      selectedAccount.account_id,
      selectedAccount.name,
      selectedAccount.score?.account_id,
      selectedAccount.score?.account_name,
      ...selectedAccount.groups.map(group => group.name),
    ])

    const matches = methodologyAnalyses
      .filter((analysis) => {
        const analysisKeys = explicitLinkedKeys([analysis.account_id, analysis.account_name])
        return Array.from(analysisKeys).some((key) => keys.has(key))
      })
      .sort((a, b) => {
        const dateOrder = b.analysis_date.localeCompare(a.analysis_date)
        if (dateOrder !== 0) return dateOrder
        return (b.analyzed_at || '').localeCompare(a.analyzed_at || '')
      })

    return matches[0] ?? null
  }, [methodologyAnalyses, selectedAccount])

  const selectedMethodologyBullets = useMemo(
    () => methodologyBullets(selectedMethodologyAnalysis?.methodology_bullets),
    [selectedMethodologyAnalysis],
  )

  const selectedMethodologyActions = useMemo(
    () => methodologyActions(selectedMethodologyAnalysis?.recommended_actions),
    [selectedMethodologyAnalysis],
  )

  const selectedHistory = useMemo(() => {
    if (!selectedGroup) return []
    return analyses
      .filter((analysis) => analysis.group_jid === selectedGroup.jid)
      .sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))
  }, [analyses, selectedGroup])

  const selectedHistoricalScores = useMemo<HistoricalScoreItem[]>(() => {
    if (!selectedAccount) return []
    const accountKeys = explicitLinkedKeys([
      selectedAccount.account_id,
      selectedAccount.name,
      selectedAccount.score?.account_id,
      selectedAccount.score?.account_name,
      ...selectedAccount.groups.map((group) => group.name),
    ])

    // Helper: find the most recent operational/PQ row at-or-before the given year/month
    const findBestOperational = (year: number, month: number) => {
      const candidates = operationalScores.filter((row) => {
        const rowKeys = explicitLinkedKeys([row.account_id, row.account_name])
        return Array.from(rowKeys).some((key) => accountKeys.has(key))
      })
      // prefer exact match, else most recent row that is <= the analysis month
      const exact = candidates.find(r => r.period_year === year && r.period_month === month)
      if (exact) return exact
      const prior = candidates
        .filter(r => r.period_year < year || (r.period_year === year && r.period_month <= month))
        .sort((a, b) => b.period_year !== a.period_year ? b.period_year - a.period_year : b.period_month - a.period_month)
      return prior[0] ?? null
    }

    const findBestPublicationQuality = (year: number, month: number) => {
      const candidates = publicationQualityScores.filter((row) => {
        const rowKeys = explicitLinkedKeys([row.account_id, row.account_name])
        return Array.from(rowKeys).some((key) => accountKeys.has(key))
      })
      const exact = candidates.find(r => r.period_year === year && r.period_month === month)
      if (exact) return exact
      const prior = candidates
        .filter(r => r.period_year < year || (r.period_year === year && r.period_month <= month))
        .sort((a, b) => b.period_year !== a.period_year ? b.period_year - a.period_year : b.period_month - a.period_month)
      return prior[0] ?? null
    }

    let previousScore: number | null = null
    return selectedHistory.map((analysis) => {
      const [year, month] = analysis.analysis_date.split('-').map((part) => Number.parseInt(part, 10))
      const operationalForMonth = findBestOperational(year, month)
      const publicationQualityForMonth = findBestPublicationQuality(year, month)
      const waScore = analysis.new_score != null ? clampScore(Number(analysis.new_score)) : null
      const globalPartial = buildWeightedScore(
        analysis.new_score,
        operationalForMonth,
        publicationQualityForMonth,
        accountChecklistData,
        analysis.raw_analysis,
        coAppliesFor(selectedAccount?.account_id)
      ).globalPartial
      const delta = globalPartial == null || previousScore == null ? 0 : roundScore(globalPartial - previousScore)
      if (globalPartial != null) previousScore = globalPartial
      return {
        id: analysis.id,
        analysis_date: analysis.analysis_date,
        score: globalPartial,        // chart uses the same weighted global as Diagnóstico
        global_score: globalPartial,
        delta,
        wa_score: waScore,
        summary: analysis.summary,
      }
    })
  }, [operationalScores, publicationQualityScores, selectedAccount, selectedHistory, accountChecklistData])

  const latestSelectedAnalysis = selectedJid ? latestAnalysisByGroup.get(selectedJid) ?? null : null
  const selectedDayAnalysis = selectedHistory.find((analysis) => analysis.id === selectedHistoryId) ?? null
  const selectedDayScore = selectedHistoricalScores.find((analysis) => analysis.id === selectedHistoryId) ?? null
  const activeDayAnalysis = selectedDayAnalysis ?? latestSelectedAnalysis
  const selectedScore = selectedGroup?.score?.current_score ?? latestSelectedAnalysis?.new_score ?? null
  const weightedScore = buildWeightedScore(
    selectedScore,
    selectedAccount?.operational ?? null,
    selectedAccount?.publicationQuality ?? null,
    accountChecklistData,
    activeDayAnalysis?.raw_analysis,
    coAppliesFor(selectedAccount?.account_id)
  )
  // Casa Mata y otras cuentas forzadas: score global fijo (ej. 100), sin ponderar.
  const displayScore = forcedGlobal(selectedAccount?.account_id) ?? weightedScore.globalPartial
  const selectedSatisfaction = latestSelectedAnalysis ? normalizeSatisfaction(latestSelectedAnalysis.satisfaction) : 'unknown'
  const selectedTasks = selectedGroup
    ? tasks.filter(t => t.monday_client_label && selectedGroup.name.toLowerCase().includes(t.monday_client_label.toLowerCase()))
    : []
  const allActions = selectedTasks.length ? selectedTasks : selectedHistory.flatMap((analysis) => asArray(analysis.action_items))
  const actionItems = selectedTasks.length ? selectedTasks : activeDayAnalysis ? asArray(activeDayAnalysis.action_items) : []
  const positiveSignals = activeDayAnalysis ? asArray(activeDayAnalysis.positive_signals) : []
  const negativeSignals = activeDayAnalysis ? asArray(activeDayAnalysis.negative_signals) : []

  useEffect(() => {
    setMessagesOpen(false)
    setClientTab('resumen')
    setResumenSubTab('diagnostico')
    setSelectedHistoryId(null)
  }, [selectedJid])

  useEffect(() => {
    async function loadDetailMessages() {
      if (!selectedGroup) {
        setDetailMessages([])
        return
      }

      setDetailLoading(true)
      try {
        if (activeDayAnalysis) {
          const { startIso, endIso } = dayWindowUtc(activeDayAnalysis.analysis_date)
          const rows = await supabaseGet<WaMessage[]>(
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,speaker_label,speaker_team,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(activeDayAnalysis.group_jid)}&sent_at=gte.${encodeURIComponent(startIso)}&sent_at=lt.${encodeURIComponent(endIso)}&order=sent_at.asc`,
          )
          setDetailMessages(rows)
        } else {
          const rows = await supabaseGet<WaMessage[]>(
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,speaker_label,speaker_team,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(selectedGroup.jid)}&order=sent_at.desc&limit=30`,
          )
          setDetailMessages(rows)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando mensajes')
      } finally {
        setDetailLoading(false)
      }
    }

    loadDetailMessages()
  }, [activeDayAnalysis, selectedGroup])

  if (loading) {
    return (
      <div className="lb-shell">
        <div className="lb-book">
          <div className="lb-page">
            <div className="lb-lines" />
            <div className="lb-margin" />
            <div className="lb-spine"><div className="lb-rings">{Array.from({length: 9}).map((_, i) => <div className="lb-ring" key={i} />)}</div></div>
            <div className="lb-content" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'60vh'}}>
              <div style={{textAlign:'center'}}>
                <span className="lb-eyebrow">Supabase</span>
                <h1 className="lb-h2">Cargando datos...</h1>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="lb-shell">
        <div className="lb-book">
          <div className="lb-page">
            <div className="lb-lines" />
            <div className="lb-margin" />
            <div className="lb-spine"><div className="lb-rings">{Array.from({length: 9}).map((_, i) => <div className="lb-ring" key={i} />)}</div></div>
            <div className="lb-content" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'60vh'}}>
              <div style={{textAlign:'center'}}>
                <span className="lb-eyebrow" style={{color:'#a8453b'}}>Error</span>
                <h1 className="lb-h2">No se pudieron leer datos</h1>
                <p className="lb-subtext">{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (false && viewMode === 'reuniones') {
    const activeMeeting = (meetings.find(m => m.id === (selectedMeetingId || meetings[0]?.id)) ?? meetings[0])!
    return (
      <div className="lb-shell">
        <div className="lb-book">
          <div className="lb-page">
            <div className="lb-lines" />
            <div className="lb-margin" />
            <div className="lb-spine">
              <div className="lb-rings">{Array.from({length: 9}).map((_, i) => <div className="lb-ring" key={i} />)}</div>
            </div>
            <div className="lb-content">
              {/* Header */}
              <div className="lb-header-row">
                <div>
                  <span className="lb-eyebrow">Minutas e Inteligencia</span>
                  <h1 className="lb-h1">Reuniones</h1>
                  <p className="lb-subtext">Tareas extraídas de llamadas y reuniones vía Gemini (Gmail / Meet).</p>
                  
                  {/* Conmutador de vistas */}
                  <div style={{ display: 'none', gap: '8px', marginTop: '16px' }}>
                    <button
                      onClick={() => setViewMode('semaforo')}
                      style={{
                        fontFamily: "'Libre Franklin',sans-serif",
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '6px 14px',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        background: 'transparent',
                        color: '#666',
                        border: '1px solid #d0ccc4',
                        transition: 'all 0.15s'
                      }}
                    >
                      💬 Semáforo WhatsApp
                    </button>
                    <button
                      onClick={() => setViewMode('reuniones')}
                      style={{
                        fontFamily: "'Libre Franklin',sans-serif",
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '6px 14px',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        background: '#3a3a44',
                        color: '#fdfcf8',
                        border: '1px solid #3a3a44',
                        transition: 'all 0.15s'
                      }}
                    >
                      🎙 Reuniones (Gemini)
                    </button>
                  </div>
                </div>
                <div style={{textAlign: 'right'}}>
                  <button
                    onClick={handleSyncMeetings}
                    disabled={meetingsLoading}
                    style={{
                      background: 'transparent',
                      color: 'var(--ink-800)',
                      border: '1px solid var(--ink-800)',
                      borderRadius: '2px',
                      padding: '8px 14px',
                      fontSize: '12.5px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      lineHeight: 1
                    }}
                  >
                    {meetingsLoading ? 'Actualizando...' : '🔄 Actualizar'}
                  </button>
                </div>
              </div>

              {/* Double column layout */}
              <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '32px', marginTop: '28px' }}>
                {/* Left Column: Meeting List */}
                <div>
                  <div className="lb-section-title" style={{ marginBottom: '14px' }}>Minutas Recientes</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '72vh', overflowY: 'auto', paddingRight: '4px' }}>
                    {meetings.length ? (
                      meetings.map((meeting) => {
                        const isSelected = selectedMeetingId === meeting.id || (!selectedMeetingId && meetings[0]?.id === meeting.id)
                        return (
                          <button
                            key={meeting.id}
                            onClick={() => setSelectedMeetingId(meeting.id)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              padding: '12px 16px',
                              background: isSelected ? '#fffdf0' : '#fff',
                              border: `1px solid ${isSelected ? '#d4c87a' : '#ece9e0'}`,
                              borderRadius: '8px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all .12s'
                            }}
                          >
                            <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink-900)' }}>{meeting.title}</span>
                            <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#9aa0a6', fontFamily: 'var(--mono)' }}>
                              <span>📅 {new Date(meeting.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</span>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <p className="lb-subtext" style={{ fontStyle: 'italic' }}>No se han sincronizado minutas de Gemini aún.</p>
                    )}
                  </div>
                </div>

                {/* Right Column: Selected Meeting Details & Tasks */}
                <div>
                  {activeMeeting ? (
                    <div>
                      <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: '12px', padding: '24px' }}>
                        <h2 className="lb-h2" style={{ marginTop: 0, fontSize: '22px' }}>{activeMeeting.title}</h2>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#666', marginTop: '4px', marginBottom: '18px' }}>
                          <span>📅 Fecha de Importación: {new Date(activeMeeting.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                        </div>

                        <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: '18px' }}>
                          <div style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a6', marginBottom: '8px' }}>Resumen ejecutivo</div>
                          <p className="lb-summary-text" style={{ margin: 0, lineHeight: '1.6' }}>{activeMeeting.summary}</p>
                        </div>
                      </div>

                      <div style={{ marginTop: '24px' }}>
                        <div className="lb-section-head" style={{ marginTop: 0 }}>
                          <div className="lb-section-title">Tareas Detectadas en la Minuta</div>
                          <span className="lb-section-count">{activeMeeting.action_items?.length || 0}</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {activeMeeting.action_items?.length ? (
                            activeMeeting.action_items.map((item: any, idx: number) => {
                              const match = item.match(/^([^:-]+)[:|-]\s*(.+)$/)
                              const speaker = match ? match[1].trim() : null
                              const taskText = match ? match[2].trim() : item

                              return (
                                <article key={idx} className="lb-task" style={{ borderLeft: '4px solid #00a884', background: 'rgba(0,168,132,0.02)' }}>
                                  <div className="lb-task-header">
                                    <div className="lb-task-title">{taskText}</div>
                                    {speaker && (
                                      <span className="lb-task-tag blackwell" style={{ background: 'rgba(0,168,132,0.1)', color: '#00a884', border: '1px solid rgba(0,168,132,0.25)' }}>
                                        👤 {speaker}
                                      </span>
                                    )}
                                  </div>
                                  <div className="lb-task-footer" style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', color: '#9aa0a6' }}>Fuente: Notas Gemini (Gmail)</span>
                                  </div>
                                </article>
                              )
                            })
                          ) : (
                             <p className="lb-subtext">No se detectaron tareas pendientes en esta reunión.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="lb-subtext">Selecciona una minuta de la lista para ver sus detalles.</p>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!selectedAccount) {
    if (viewMode === 'survey') {
      return <SurveyBoard clients={surveyClients} onBack={() => setViewMode('semaforo')} />
    }
    if (viewMode === 'admin') {
      return (
        <AdminPanel
          authed={adminAuthed}
          onLogin={handleAdminLogin}
          logs={emailLogs}
          loading={emailLogsLoading}
          onRefresh={loadEmailLogs}
          onBack={() => setViewMode('semaforo')}
          accounts={clientAccounts.map(a => ({ account_id: a.account_id, name: a.name }))}
          consultants={consultantList}
          sheetValues={sheetValueList}
          waGroups={waGroupList}
          panorama={panorama}
          onSaved={() => { reloadRoster(); setTimeout(() => window.location.reload(), 900) }}
        />
      )
    }
    const analyzedCount = clientAccounts.filter(a => a.analyzedToday).length
    const pendingAnalysis = clientAccounts.filter(a => !a.analyzedToday && a.hasMessagesToday)
    const trulyQuiet = clientAccounts.filter(a => !a.analyzedToday && !a.hasMessagesToday)
    // Promedio de scores globales — misma lógica que los círculos de la lista
    const globalScores = clientAccounts
      .map(a => {
        const checklist = findChecklist(a.account_id, a.name)
        const coApplies = coAppliesFor(a.account_id)
        // Cuentas sin CO se puntúan por SC (no requieren contrato vigente).
        if (!checklist?.contract?.vigencia && !checklist?.contract?.present && coApplies) return null
        const wa = a.score?.current_score ?? a.latestAnalysis?.new_score ?? null
        const weighted = buildWeightedScore(
          wa,
          a.operational,
          a.publicationQuality,
          checklist,
          a.latestAnalysis?.raw_analysis,
          coApplies
        )
        // Activada si tiene su eje base: CO si aplica, o SC si la cuenta no lleva CO.
        // Mismo criterio que los círculos de la lista.
        const gateComp = weighted.components.find(c => c.key === (coApplies ? 'co' : 'sc'))
        // Use raw (unrounded) value so the average isn't skewed by double-rounding
        return gateComp?.value != null ? weighted.globalPartialRaw : null
      })
      .filter((s): s is number => s != null)
    const averageScore = globalScores.length
      ? roundScore(globalScores.reduce((t, s) => t + s, 0) / globalScores.length)
      : null
    const normalizedAccountSearch = accountSearchQuery.trim().toLowerCase()
    const visibleAccounts = clientAccounts.filter(account => {
      if (groupFilter === 'analyzed' && !account.analyzedToday) return false
      if (groupFilter === 'inactive' && (account.analyzedToday || account.hasMessagesToday)) return false
      if (!normalizedAccountSearch) return true

      const searchable = [
        account.account_id,
        account.name,
        ...account.groups.map(group => group.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(normalizedAccountSearch)
    })

    return (
      <div className="lb-shell">
        <div className="lb-book">
          <div className="lb-page">
            <div className="lb-lines" />
            <div className="lb-margin" />
            <div className="lb-spine">
              <div className="lb-rings">{Array.from({length: 9}).map((_, i) => <div className="lb-ring" key={i} />)}</div>
            </div>
            <div className="lb-content">

              {/* Header */}
              <div className="lb-header-row">
                <div>
                  <span className="lb-eyebrow">Semáforo de satisfacción</span>
                  <h1 className="lb-h1">Cuentas</h1>
                  <p className="lb-subtext">Vista rápida de salud, actividad y análisis diario por cuenta.</p>
                  
                  {/* Conmutador de vistas */}
                  <div style={{ display: 'none', gap: '8px', marginTop: '16px' }}>
                    <button
                      onClick={() => setViewMode('semaforo')}
                      style={{
                        fontFamily: "'Libre Franklin',sans-serif",
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '6px 14px',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        background: viewMode === 'semaforo' ? '#3a3a44' : 'transparent',
                        color: viewMode === 'semaforo' ? '#fdfcf8' : '#666',
                        border: viewMode === 'semaforo' ? '1px solid #3a3a44' : '1px solid #d0ccc4',
                        transition: 'all 0.15s'
                      }}
                    >
                      💬 Semáforo WhatsApp
                    </button>
                    <button
                      onClick={() => setViewMode('reuniones')}
                      style={{
                        fontFamily: "'Libre Franklin',sans-serif",
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '6px 14px',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        background: (viewMode as string) === 'reuniones' ? '#3a3a44' : 'transparent',
                        color: (viewMode as string) === 'reuniones' ? '#fdfcf8' : '#666',
                        border: (viewMode as string) === 'reuniones' ? '1px solid #3a3a44' : '1px solid #d0ccc4',
                        transition: 'all 0.15s'
                      }}
                    >
                      🎙 Reuniones (Fireflies)
                    </button>
                  </div>
                </div>
                <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:10}}>
                  <div style={{fontFamily:'var(--caveat)', fontSize:36, fontWeight:700, color:'#3a3a44', lineHeight:1, textAlign:'right'}}>
                    {new Date().toLocaleDateString('es-MX', {day:'numeric', month:'long', year:'numeric', timeZone:'America/Mexico_City'})}
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button
                      onClick={() => setViewMode('survey')}
                      style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:12.5, fontWeight:600, padding:'7px 14px', borderRadius:999, cursor:'pointer', background:'#3a3a44', color:'#fdfcf8', border:'1px solid #3a3a44'}}
                    >
                      📋 Vista Survey por consultor
                    </button>
                    <button
                      onClick={() => setViewMode('admin')}
                      style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:12.5, fontWeight:600, padding:'7px 14px', borderRadius:999, cursor:'pointer', background:'transparent', color:'#666', border:'1px solid #d0ccc4'}}
                    >
                      🔐 Admin
                    </button>
                  </div>
                </div>
              </div>

              {/* Post-it stats */}
              <div className="lb-stats-row">
                <div className="lb-postit lb-postit-green" style={{animationDelay:'0ms'}}>
                  <div className="lb-postit-label">Score promedio</div>
                  <div className="lb-postit-value" style={{color: averageScore && averageScore >= 85 ? '#3f7050' : averageScore && averageScore >= 70 ? '#b07d1e' : '#a8453b'}}>{averageScore != null ? averageScore.toFixed(1) : '--'}</div>
                  <div className="lb-postit-detail">{averageScore ? '' : 'Sin puntajes'}</div>
                </div>
                <div className="lb-postit lb-postit-yellow" style={{animationDelay:'80ms', cursor:'pointer', outline: groupFilter === 'analyzed' ? '2px solid #b07d1e' : 'none', outlineOffset:3}} onClick={() => setGroupFilter(f => f === 'analyzed' ? 'all' : 'analyzed')}>
                  <div className="lb-postit-label">Analizados hoy {groupFilter === 'analyzed' && <span style={{fontSize:13}}>✕</span>}</div>
                  <div className="lb-postit-value" style={{color:'#b07d1e'}}>{analyzedCount}<span style={{fontSize:24,fontWeight:400}}> / {clientAccounts.length}</span></div>
                  <div className="lb-postit-detail" style={{color:'#8a6010'}}>
                    {pendingAnalysis.length > 0 ? `${pendingAnalysis.length} con mensajes, esperando análisis` : 'Todas las cuentas revisadas'}
                  </div>
                </div>
                <div className="lb-postit lb-postit-blue" style={{animationDelay:'160ms', cursor:'pointer', outline: groupFilter === 'inactive' ? '2px solid #3a6ea5' : 'none', outlineOffset:3}} onClick={() => setGroupFilter(f => f === 'inactive' ? 'all' : 'inactive')}>
                  <div className="lb-postit-label">Sin mensajes recientes {groupFilter === 'inactive' && <span style={{fontSize:13}}>✕</span>}</div>
                  <div className="lb-postit-value" style={{color:'#1a4a7a'}}>{trulyQuiet.length}</div>
                  <div className="lb-postit-detail" style={{color:'#3a5a8a'}}>sin mensajes en días previos</div>
                </div>
              </div>


              {/* Account list */}
              <div className="lb-account-search" role="search">
                <span className="lb-account-search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4 4" />
                  </svg>
                </span>
                <input
                  value={accountSearchQuery}
                  onChange={(event) => setAccountSearchQuery(event.target.value)}
                  placeholder="Buscar cliente"
                  aria-label="Buscar cliente por nombre"
                />
                {accountSearchQuery && (
                  <button type="button" onClick={() => setAccountSearchQuery('')} aria-label="Limpiar busqueda">
                    Limpiar
                  </button>
                )}
              </div>
              {groupFilter !== 'all' && (
                <div style={{display:'flex', alignItems:'center', gap:10, margin:'8px 0 4px', padding:'8px 14px', background: groupFilter === 'analyzed' ? 'rgba(176,125,30,.10)' : 'rgba(58,110,165,.10)', borderRadius:8}}>
                  <span style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:13, fontWeight:600, color: groupFilter === 'analyzed' ? '#8a6010' : '#3a5a8a'}}>
                    {groupFilter === 'analyzed'
                      ? `Mostrando ${analyzedCount} cuentas analizadas hoy`
                      : `Mostrando ${trulyQuiet.length} cuentas sin mensajes recientes`}
                  </span>
                  <button onClick={() => setGroupFilter('all')} style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:12, color:'#9aa0a6', background:'none', border:'1px solid #ccc', borderRadius:999, padding:'2px 10px', cursor:'pointer'}}>Ver todos</button>
                </div>
              )}
              <div className="lb-account-list">
                {visibleAccounts.length === 0 && (
                  <div className="lb-account-empty">
                    No hay clientes que coincidan con "{accountSearchQuery.trim()}".
                  </div>
                )}
                {visibleAccounts.map(account => {
                  // Cuentas con score FORZADO (ej. Casa Mata = 100): verde directo, sin ponderar.
                  const forced = forcedGlobal(account.account_id)
                  if (forced != null) return { account, globalScore: forced, missing: [] }
                  // Global ponderado solo para cuentas con checklist completo (contrato + meet)
                  const checklist = findChecklist(account.account_id, account.name)
                  let globalScore: number | null = null
                  const missing: string[] = []
                  const coApplies = coAppliesFor(account.account_id)
                  if (checklist?.contract?.vigencia || checklist?.contract?.present || !coApplies) {
                    const waForGlobal = account.score?.current_score ?? account.latestAnalysis?.new_score ?? null
                    const weighted = buildWeightedScore(
                      waForGlobal,
                      account.operational,
                      account.publicationQuality,
                      checklist,
                      account.latestAnalysis?.raw_analysis,
                      coApplies
                    )
                    // Cuentas con CO: se activan cuando hay CO. Cuentas sin CO
                    // (su peso pasó a SC): se activan cuando hay Satisfacción del Cliente.
                    const gateComp = weighted.components.find(c => c.key === (coApplies ? 'co' : 'sc'))
                    if (gateComp?.value != null) {
                      globalScore = weighted.globalPartial
                    } else if (!coApplies) {
                      missing.push('SC: falta la satisfacción del cliente (WhatsApp y/o Meet analizado). Esta cuenta no usa CO.')
                    } else {
                      // CO ausente: decir EXACTAMENTE qué parte falta — la meta del
                      // contrato (carpeta 01) o las notas entregadas (hoja de medios).
                      const pubItem = checklist?.schema?.items?.publicaciones_web
                      const fase = checklist?.contract?.fase_actual
                      const pubMeta = pubItem ? (fase === 'fase_2' ? pubItem.meta_fase2 : pubItem.meta_fase1) ?? null : null
                      const delivered = account.operational?.delivered_publications_count ?? null
                      if (pubMeta == null && delivered == null)
                        missing.push('CO: falta la META de notas del contrato (carpeta 01 en Drive) y las NOTAS entregadas (hoja de medios)')
                      else if (pubMeta == null)
                        missing.push('CO: falta la META de notas del contrato (carpeta 01 en Drive)')
                      else
                        missing.push('CO: faltan NOTAS entregadas en la hoja de medios (ninguna nota mapeada a esta cuenta en el periodo)')
                    }
                  } else {
                    missing.push('Falta el CONTRATO vigente (carpeta 01 en Drive): sin él no se calcula el CO ni el score global')
                  }
                  return { account, globalScore, missing }
                }).sort((a, b) => {
                  const statusA = rosterFor(a.account.account_id)?.status || 'active'
                  const statusB = rosterFor(b.account.account_id)?.status || 'active'

                  // Helper function to get sorting tier:
                  // Tier 0: Active with score
                  // Tier 1: Active without score (Sin ponderar)
                  // Tier 2: Paused / Event single
                  // Tier 3: Concluded / Terminated early / Historical (absolute bottom)
                  const getTier = (accountObj: typeof a, status: string) => {
                    const isExcluded = ['concluded', 'terminated_early', 'historical', 'paused', 'event_single'].includes(status)
                    if (!isExcluded) {
                      return accountObj.globalScore != null ? 0 : 1
                    }
                    if (status === 'paused' || status === 'event_single') {
                      return 2
                    }
                    return 3 // concluded, terminated_early, historical (absolute bottom)
                  }

                  const tierA = getTier(a, statusA)
                  const tierB = getTier(b, statusB)

                  if (tierA !== tierB) {
                    return tierA - tierB
                  }

                  // If both are Tier 0, sort by score descending
                  if (tierA === 0) {
                    return (b.globalScore || 0) - (a.globalScore || 0)
                  }

                  // Otherwise, sort alphabetically by name
                  return a.account.name.localeCompare(b.account.name)
                }).map(({ account, globalScore, missing }, gi) => {
                  const isGlobal = globalScore != null
                  // Cuentas sin score global completo aparecen desactivadas (sin número, en gris)
                  const scoreValue = isGlobal ? globalScore : null
                  const status = isGlobal
                    ? (globalScore >= 80 ? 'Sano' : globalScore >= 65 ? 'Atención' : 'Riesgo')
                    : 'Sin ponderar'
                  const stampColor = isGlobal
                    ? (globalScore >= 80 ? '#3f7050' : globalScore >= 65 ? '#b07d1e' : '#a8453b')
                    : '#9aa0a6'
                  const r = 26
                  const circ = 2 * Math.PI * r
                  const offset = scoreValue != null ? circ * (1 - scoreValue / 100) : circ
                  const mainGroup = account.groups.find(g => !g.name.toLowerCase().includes('interno')) ?? account.groups[0]
                  const lastMsgAt = account.groups.map(g => g.last_message_at ?? '').sort().reverse()[0] || null
                  const missingTip = !isGlobal && missing.length
                    ? `Para activarse (mostrar score global) falta:\n• ${missing.join('\n• ')}`
                    : undefined
                  return (
                    <button className="lb-account-row" key={account.account_id} title={missingTip} style={{borderLeft: `5px solid ${stampColor}`, animationDelay: `${gi * 40}ms`, opacity: isGlobal ? 1 : 0.55, filter: isGlobal ? 'none' : 'grayscale(0.4)', cursor: isGlobal ? 'pointer' : 'help'}} onClick={() => { if (!mainGroup) return; setSelectedAccountId(account.account_id); setSelectedJid(mainGroup.jid) }}>
                      <div className="lb-score-ring">
                        <svg width="62" height="62" viewBox="0 0 62 62">
                          <circle cx="31" cy="31" r={r} fill="none" stroke="#e8e4d8" strokeWidth="5" />
                          <circle cx="31" cy="31" r={r} fill="none" stroke={stampColor} strokeWidth="5"
                            strokeDasharray={`${circ}`} strokeDashoffset={offset}
                            style={{transition:'stroke-dashoffset 1s ease', transform:'rotate(-90deg)', transformOrigin:'center'}} />
                        </svg>
                        <div className="lb-score-ring-val" style={{color: stampColor, fontSize: '15px'}}>{scoreValue != null ? scoreValue.toFixed(1) : '--'}</div>
                      </div>
                      <div className="lb-account-main">
                        <div className="lb-account-name">
                          {account.name}
                          {account.statusLabel && (
                            <span style={{
                              marginLeft: 8,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.6,
                              textTransform: 'uppercase',
                              color: '#8a5a10',
                              background: 'rgba(138,90,16,0.10)',
                              border: '1px solid rgba(138,90,16,0.35)',
                              borderRadius: 999,
                              padding: '2px 8px',
                              verticalAlign: 'middle',
                            }}>{account.statusLabel}</span>
                          )}
                          {isGlobal && (
                            <span style={{
                              marginLeft: 8,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.6,
                              textTransform: 'uppercase',
                              color: '#3f7050',
                              background: 'rgba(63,112,80,0.10)',
                              border: '1px solid rgba(63,112,80,0.35)',
                              borderRadius: 999,
                              padding: '2px 8px',
                              verticalAlign: 'middle',
                            }}>Score global</span>
                          )}
                        </div>
                        <div className="lb-account-summary">{cleanSummaryText(account.latestAnalysis?.summary) || (account.groups.length === 0 ? 'Cuenta sin grupo de WhatsApp conectado; score global desde checklist, Sheet y Meet.' : 'Sin análisis diario guardado todavía.')}</div>
                      </div>
                      <div className="lb-account-side">
                        <span className="lb-stamp" style={{color: stampColor, borderColor: stampColor, '--sr': gi % 2 === 0 ? '-4deg' : '3deg'} as React.CSSProperties}>{status}</span>
                        <span className="lb-account-time">{shortDate(lastMsgAt)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>

            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!selectedGroup) {
    // selectedAccount is set but selectedJid has no matching group — fall back to overview
    setSelectedAccountId(null)
    return null
  }

  return (
    <div className="lb-shell">
      <div className="lb-book">
        <div className="lb-page">
          <div className="lb-lines" />
          <div className="lb-margin" />
          <div className="lb-spine">
            <div className="lb-rings">{Array.from({length: 9}).map((_, i) => <div className="lb-ring" key={i} />)}</div>
          </div>
          <div className="lb-content">

      {/* Detail header */}
      <div className="lb-header-row">
        <div>
          <button className="lb-back-btn" onClick={() => { setSelectedAccountId(null); setSelectedJid(null) }}>← Volver</button>
          <span className="lb-eyebrow">Detalle</span>
          <h1 className="lb-h2">{selectedAccount?.name ?? selectedGroup.name}</h1>
          <p className="lb-subtext">{selectedHistory.length ? `${selectedHistory.length} día(s) analizados en el histórico` : 'Grupo pendiente de análisis diario.'}</p>
          
          {/* Conmutador de vistas */}
          <div style={{ display: 'none', gap: '8px', marginTop: '16px' }}>
            <button
              onClick={() => { setSelectedAccountId(null); setSelectedJid(null); setViewMode('semaforo') }}
              style={{
                fontFamily: "'Libre Franklin',sans-serif",
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 14px',
                borderRadius: '999px',
                cursor: 'pointer',
                background: viewMode === 'semaforo' ? '#3a3a44' : 'transparent',
                color: viewMode === 'semaforo' ? '#fdfcf8' : '#666',
                border: viewMode === 'semaforo' ? '1px solid #3a3a44' : '1px solid #d0ccc4',
                transition: 'all 0.15s'
              }}
            >
              💬 Semáforo WhatsApp
            </button>
            <button
              onClick={() => { setSelectedAccountId(null); setSelectedJid(null); setViewMode('reuniones') }}
              style={{
                fontFamily: "'Libre Franklin',sans-serif",
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 14px',
                borderRadius: '999px',
                cursor: 'pointer',
                background: (viewMode as string) === 'reuniones' ? '#3a3a44' : 'transparent',
                color: (viewMode as string) === 'reuniones' ? '#fdfcf8' : '#666',
                border: (viewMode as string) === 'reuniones' ? '1px solid #3a3a44' : '1px solid #d0ccc4',
                transition: 'all 0.15s'
              }}
            >
              🎙 Reuniones (Fireflies)
            </button>
          </div>
        </div>
      </div>

      {/* Group tabs — shown when the account has multiple groups */}
      {selectedAccount && selectedAccount.groups.length > 1 && (
        <div style={{display:'flex', gap:8, marginBottom:16, flexWrap:'wrap'}}>
          {selectedAccount.groups.map(g => (
            <button key={g.jid}
              onClick={() => setSelectedJid(g.jid)}
              style={{
                fontFamily:"'Libre Franklin',sans-serif", fontSize:13,
                padding:'5px 14px', borderRadius:999, cursor:'pointer',
                background: selectedJid === g.jid ? '#3a3a44' : 'transparent',
                color: selectedJid === g.jid ? '#fdfcf8' : '#666',
                border: selectedJid === g.jid ? '1px solid #3a3a44' : '1px solid #d0ccc4',
              }}>
              {g.name}
            </button>
          ))}
        </div>
      )}

      <nav className="lb-tabs" aria-label="Secciones del cliente">
        <button className={`lb-tab${clientTab === 'resumen' ? ' active' : ''}`} onClick={() => setClientTab('resumen')}>Resumen</button>
        <button className={`lb-tab${clientTab === 'whatsapp' ? ' active' : ''}`} onClick={() => setClientTab('whatsapp')}>WhatsApp</button>
        <button className={`lb-tab${clientTab === 'historico' ? ' active' : ''}`} onClick={() => setClientTab('historico')}>Histórico</button>
        <button className={`lb-tab${clientTab === 'meet' ? ' active' : ''}`} onClick={() => setClientTab('meet')}>Meet</button>
        <button className={`lb-tab${clientTab === 'publicaciones' ? ' active' : ''}`} onClick={() => setClientTab('publicaciones')}>Publicaciones</button>
        {selectedAccount?.account_id === PEPE_ACCOUNT_ID && (
          <button className={`lb-tab${clientTab === 'reportes' ? ' active' : ''}`} onClick={() => setClientTab('reportes')}>Reportes</button>
        )}
        {selectedAccount?.account_id === PEPE_ACCOUNT_ID && (
          <button className={`lb-tab${clientTab === 'simulador' ? ' active' : ''}`} onClick={() => setClientTab('simulador')}>🎮 Simulador</button>
        )}
      </nav>

      {clientTab === 'resumen' && (
        <div className="lb-resumen" style={{marginTop:24}}>
          {/* Internal folder-style sub-tabs */}
          <div className="lb-folder-tabs">
            <button
              className={`lb-folder-tab${resumenSubTab === 'diagnostico' ? ' active' : ''}`}
              onClick={() => setResumenSubTab('diagnostico')}
            >
              📁 Diagnóstico y Contrato
            </button>
            <button
              className={`lb-folder-tab${resumenSubTab === 'tareas' ? ' active' : ''}`}
              onClick={() => setResumenSubTab('tareas')}
            >
              📋 Tareas y Señales
              {allActions.length > 0 && (
                <span className="lb-folder-tab-badge">{allActions.length}</span>
              )}
            </button>
            <button
              className={`lb-folder-tab${resumenSubTab === 'metodologia' ? ' active' : ''}`}
              onClick={() => setResumenSubTab('metodologia')}
            >
              🔬 Metodologías AI
              {selectedMethodologyBullets.length > 0 && (
                <span className="lb-folder-tab-badge">{selectedMethodologyBullets.length}</span>
              )}
            </button>
          </div>

          <div className="lb-folder-body">
            {resumenSubTab === 'diagnostico' && (
              <div style={{display:'flex', gap:22, flexWrap:'wrap', alignItems:'flex-start'}}>
                <div className="lb-score-postit" style={{background: displayScore != null && displayScore >= 80 ? '#d4eedd' : displayScore != null && displayScore >= 45 ? '#fdf1ad' : '#fde8e6', width: 210, margin: 0}}>
                  <div className="lb-score-postit-val" style={{color: displayScore != null && displayScore >= 80 ? '#3f7050' : displayScore != null && displayScore >= 45 ? '#b07d1e' : '#a8453b'}}>{displayScore != null ? displayScore.toFixed(1) : '--'}</div>
                  <div className="lb-score-postit-label">Score global parcial</div>
                  <div className="lb-score-postit-note">WA real: {selectedScore != null ? Number(selectedScore).toFixed(1) : '--'} / 100</div>
                  {latestSelectedAnalysis && (
                    <div style={{marginTop:10, display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center'}}>
                      <span className={`lb-pill ${badgeClass(latestSelectedAnalysis.sentiment) === 'green' ? 'lb-pill-green' : badgeClass(latestSelectedAnalysis.sentiment) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{latestSelectedAnalysis.sentiment}</span>
                      <span className={`lb-pill ${badgeClass(selectedSatisfaction) === 'green' ? 'lb-pill-green' : badgeClass(selectedSatisfaction) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{selectedSatisfaction}</span>
                    </div>
                  )}
                </div>
                <div className="lb-summary-card" style={{flex:1, border:'none', boxShadow:'none', padding:0, background:'transparent', minWidth:320}}>
                  <div className="lb-methodology-actions" style={{marginBottom:24}}>
                    <div className="lb-section-title" style={{marginBottom:12}}>Acciones recomendadas</div>
                    {selectedMethodologyActions.length ? (
                      selectedMethodologyActions.map((item, index) => (
                        <div className="lb-methodology-action" key={`diag-action-${item.action}-${index}`}>
                          <span className="lb-methodology-priority">{item.priority}</span>
                          <div>
                            <strong>{item.action}</strong>
                            <div>{item.owner} · {item.methodology}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="lb-subtext" style={{ margin: 0 }}>Sin acciones nuevas recomendadas.</p>
                    )}
                  </div>

                  <div className="lb-section-title" style={{marginBottom:10}}>Resumen acumulado</div>
                  <div style={{marginBottom:20}}>
                    <RecentSummaries history={selectedHistory} empty="Este grupo existe en Supabase, pero todavía no tiene resumen guardado." />
                  </div>
                  <DriveIntelCard intel={
                    /^\d+$/.test(selectedAccount.account_id.trim())
                      ? driveIntel.find(d => String(Number(d.account_number)) === String(Number(selectedAccount.account_id.trim()))) ?? null
                      : null
                  } />
                  <ContractTimeline contract={accountChecklistData?.contract} history={accountChecklistData?.contracts_history} />
                  <ScoreBreakdown components={weightedScore.components} />
                </div>
              </div>
            )}

            {resumenSubTab === 'tareas' && (
              <div className="lb-resumen-grid" style={{marginTop:0}}>
                <div>
                  <div className="lb-section-head" style={{marginTop:0}}>
                    <div className="lb-section-title">Compilado de tareas</div>
                    <span className="lb-section-count">{allActions.length}</span>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:12}}>
                    {allActions.length
                      ? allActions.slice(-6).map((item, index) => <TaskCard item={item} key={index} />)
                      : <p className="lb-subtext">No hay tareas acumuladas.</p>}
                  </div>
                </div>
                <div>
                  <div className="lb-section-head" style={{marginTop:0}}>
                    <div className="lb-section-title">Señales</div>
                    <span className="lb-section-count">{positiveSignals.length + negativeSignals.length}</span>
                  </div>
                  <SignalList title="A favor" items={positiveSignals} tone="green" />
                  <div style={{marginTop:16}} />
                  <SignalList title="A revisar" items={negativeSignals} tone="red" />
                </div>
              </div>
            )}

            {resumenSubTab === 'metodologia' && (
              <div className="lb-methodology-card" style={{marginTop:0, border:'none', padding:0, background:'transparent', boxShadow:'none'}}>
                <div className="lb-section-head" style={{ marginTop: 0 }}>
                  <div>
                    <div className="lb-section-title">Metodologías cosas por hacer</div>
                    <div className="lb-section-sub">
                      {selectedMethodologyAnalysis
                        ? `${shortDateOnly(selectedMethodologyAnalysis.analysis_date)} · ${selectedMethodologyAnalysis.model || 'modelo configurado'}`
                        : 'Pendiente de análisis diario.'}
                    </div>
                  </div>
                  <span className="lb-section-count">{selectedMethodologyBullets.length}</span>
                </div>
                {selectedMethodologyAnalysis ? (
                  <>
                    <div className="lb-methodology-status-row" style={{margin: '16px 0 18px'}}>
                      <span className={`lb-pill ${
                        badgeClass(selectedMethodologyAnalysis.overall_status || 'neutral') === 'green'
                          ? 'lb-pill-green'
                          : badgeClass(selectedMethodologyAnalysis.overall_status || 'neutral') === 'red'
                            ? 'lb-pill-red'
                            : 'lb-pill-amber'
                      }`}>
                        {selectedMethodologyAnalysis.overall_status || 'neutral'}
                      </span>
                      <p className="lb-subtext" style={{margin: 0, maxWidth: 920}}>{selectedMethodologyAnalysis.summary || 'Sin resumen metodológico.'}</p>
                    </div>
                    <div className="lb-methodology-list">
                      {selectedMethodologyBullets.map((item, index) => (
                        <div className="lb-methodology-item" key={`${item.methodology}-${item.dimension}-${index}`}>
                          <div className="lb-methodology-item-head">
                            <span className="lb-methodology-chip">{item.methodology}</span>
                            <span className={`lb-methodology-state ${badgeClass(item.status)}`}>{item.status}</span>
                          </div>
                          <div className="lb-methodology-dimension">{item.dimension}</div>
                          <p className="lb-methodology-bullet">{item.bullet}</p>
                          {item.why && <p className="lb-methodology-why">Por qué: {item.why}</p>}
                        </div>
                      ))}
                    </div>
                    <div className="lb-methodology-actions">
                      <div className="lb-section-title">Acciones recomendadas</div>
                      {selectedMethodologyActions.length ? (
                        selectedMethodologyActions.map((item, index) => (
                          <div className="lb-methodology-action" key={`${item.action}-${index}`}>
                            <span className="lb-methodology-priority">{item.priority}</span>
                            <div>
                              <strong>{item.action}</strong>
                              <div>{item.owner} · {item.methodology}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="lb-subtext" style={{ margin: 0 }}>Sin acciones nuevas recomendadas.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="lb-subtext" style={{ margin: 0 }}>
                    Aquí aparecerá el análisis diario por metodología: Blackwell R3, Chris Lehane y Agente IA Crisis.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {clientTab === 'whatsapp' && (
        <div className="lb-resumen" style={{marginTop:24}}>
          {/* Calendario de días */}
          {selectedHistory.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="lb-section-title" style={{ fontSize: 22, marginBottom: 10 }}>Día de Análisis</div>
              <div className="lb-date-strip" style={{ overflowX: 'auto', paddingBottom: 8, whiteSpace: 'nowrap', display: 'flex', gap: 8 }}>
                {[...selectedHistory].reverse().map((analysis) => {
                  const isActive = selectedHistoryId === analysis.id || (selectedHistoryId === null && analysis.id === latestSelectedAnalysis?.id)
                  return (
                    <button
                      key={analysis.id}
                      className={`lb-date-btn${isActive ? ' active' : ''}`}
                      onClick={() => setSelectedHistoryId(analysis.id)}
                      style={{
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0
                      }}
                    >
                      {fmtShortDate(analysis.analysis_date)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="lb-whatsapp-grid">
            <div className="lb-summary-card">
              <div className="lb-section-title" style={{marginBottom:10}}>Resumen acumulado</div>
              <RecentSummaries history={selectedHistory} empty="Este grupo existe en Supabase, pero todavia no tiene resumen acumulado." />
            </div>
            <div className="lb-summary-card">
              <div className="lb-section-title" style={{marginBottom:10}}>Resumen diario</div>
              <p className="lb-summary-text">
                {cleanSummaryText(activeDayAnalysis?.summary) || 'No hay resumen del dia seleccionado.'}
              </p>
              {activeDayAnalysis && (
                <div style={{marginTop:14, display:'flex', gap:8, flexWrap:'wrap'}}>
                  <span className={`lb-pill ${badgeClass(activeDayAnalysis.sentiment) === 'green' ? 'lb-pill-green' : badgeClass(activeDayAnalysis.sentiment) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{activeDayAnalysis.sentiment}</span>
                  <span className={`lb-pill ${badgeClass(normalizeSatisfaction(activeDayAnalysis.satisfaction)) === 'green' ? 'lb-pill-green' : badgeClass(normalizeSatisfaction(activeDayAnalysis.satisfaction)) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{normalizeSatisfaction(activeDayAnalysis.satisfaction)}</span>
                  <span className="lb-pill lb-pill-amber">WA {activeDayAnalysis.new_score ?? '--'} / 100</span>
                </div>
              )}
            </div>
          </div>

          <div className="lb-messages-panel">
            <div className="lb-section-head" style={{marginBottom:18, marginTop:0}}>
              <div>
                <div className="lb-section-title">Mensajes</div>
                <div className="lb-section-sub">{detailLoading ? 'Cargando...' : `${detailMessages.length} mensajes del periodo visible`}</div>
              </div>
            </div>
            {detailLoading ? (
              <p className="lb-subtext" style={{textAlign:'center', padding:'32px 0'}}>Cargando mensajes...</p>
            ) : detailMessages.length === 0 ? (
              <p className="lb-subtext" style={{textAlign:'center', padding:'32px 0'}}>Sin mensajes disponibles para este grupo.</p>
            ) : (
              <div className="lb-messages" style={{maxWidth:'100%'}}>
                {detailMessages.map((message) => {
                  const isTeam = message.speaker_team === 'blackwell'
                  return (
                    <div className={`lb-bubble-wrap ${isTeam ? 'right' : 'left'}`} key={message.id}>
                      <div className={`lb-bubble ${isTeam ? 'right' : 'left'}`}>
                        <div className="lb-bubble-name" style={{color: isTeam ? '#3a6ea5' : '#3f7050'}}>{message.speaker_label || message.push_name || message.author || 'Sin autor'}</div>
                        <div className="lb-bubble-text">{message.body || '(sin texto)'}</div>
                        <div className="lb-bubble-time">{shortDate(message.sent_at)} Â· {message.msg_type}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {clientTab === 'historico' && (() => {
        const rangeDays = chartRange === '7d' ? 7 : chartRange === '30d' ? 30 : 365
        const cutoff = new Date(new Date(`${todayMexicoStr()}T12:00:00`).getTime() - (rangeDays - 1) * 86400000).toISOString().slice(0, 10)
        const filteredHistory = selectedHistoricalScores.filter(a => a.analysis_date >= cutoff)
        return (
        <div className="lb-historico">
          <div className="lb-section-head">
            <div className="lb-section-title">Histórico de score global</div>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              {(['7d','30d','365d'] as const).map(r => (
                <button key={r} onClick={() => setChartRange(r)} style={{
                  fontFamily:"'Libre Franklin',sans-serif", fontSize:12, fontWeight: chartRange === r ? 700 : 400,
                  padding:'3px 12px', borderRadius:999, cursor:'pointer', transition:'all .12s',
                  background: chartRange === r ? '#3a3a44' : 'transparent',
                  color: chartRange === r ? '#fdfcf8' : '#888',
                  border: chartRange === r ? '1px solid #3a3a44' : '1px solid #d0ccc4',
                }}>
                  {r === '7d' ? 'Semanal' : r === '30d' ? 'Mensual' : 'Anual'}
                </button>
              ))}
              <span className="lb-section-count" style={{marginLeft:4}}>{rangeDays} días</span>
            </div>
          </div>
          <div className="lb-chart-wrap">
            <ScoreGraph items={selectedHistoricalScores} startDate={cutoff} selectedId={selectedHistoryId} onSelect={setSelectedHistoryId} />
          </div>

          <div style={{ padding: '0 8px' }}>
            <MilestonesTimeline milestones={selectedAccountMilestones} onDeleteClick={handleDeleteMilestone} />
          </div>

          <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:18}}>
            {filteredHistory.length
              ? filteredHistory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedHistoryId(item.id)}
                  style={{
                    display:'flex', gap:14, alignItems:'center', padding:'12px 16px',
                    background: selectedHistoryId === item.id ? '#fffdf0' : '#fff',
                    border: `1px solid ${selectedHistoryId === item.id ? '#d4c87a' : '#ece9e0'}`,
                    borderRadius:8, cursor:'pointer', textAlign:'left', transition:'all .12s'
                  }}>
                  <div style={{width:42, height:42, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', background: item.score != null && item.score >= 30 ? '#d4eedd' : item.score != null && item.score >= 15 ? '#fdf1ad' : '#fde8e6', fontFamily:"'Libre Franklin',sans-serif", fontWeight:800, fontSize:14, color: item.score != null && item.score >= 30 ? '#3f7050' : item.score != null && item.score >= 15 ? '#b07d1e' : '#a8453b', flexShrink:0}}>{item.score ?? '--'}</div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <div>
                        <span style={{fontFamily:"'Caveat',cursive", fontSize:20, fontWeight:700, color:'#1d1d1f'}}>{fmtShortDate(item.analysis_date)}</span>
                        <span style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:11, color:'#9aa0a6', marginLeft:8}}>{item.analysis_date}</span>
                      </div>
                      <span style={{fontFamily:"'Caveat',cursive", fontWeight:700, fontSize:19, color: item.delta >= 0 ? '#3f7050' : '#a8453b'}}>{item.delta > 0 ? '+' : ''}{item.delta}</span>
                    </div>
                    <p style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:13, color:'#5f636a', margin:'3px 0 0'}}>{cleanSummaryText(item.summary) || 'Sin resumen guardado.'}</p>
                  </div>
                </button>
              ))
              : <p className="lb-subtext">No hay histórico guardado para esta cuenta todavía.</p>}
          </div>

          {selectedDayAnalysis && (
            <div style={{marginTop:28, padding:'22px 24px', background:'#fff', border:'1px solid #ece9e0', borderRadius:12}}>
              <div className="lb-section-head" style={{marginTop:0}}>
                <div>
                  <div className="lb-section-title">Detalle del día</div>
                  <div className="lb-section-sub">{selectedDayAnalysis.analysis_date}</div>
                </div>
                <span style={{fontFamily:"'Libre Franklin',sans-serif", fontWeight:800, fontSize:22, color: (selectedDayScore?.delta ?? 0) >= 0 ? '#3f7050' : '#a8453b'}}>{(selectedDayScore?.delta ?? 0) > 0 ? '+' : ''}{selectedDayScore?.delta ?? 0}</span>
              </div>
              <p className="lb-summary-text" style={{marginBottom:20}}>{selectedDayAnalysis.summary || 'Sin resumen guardado.'}</p>
              <div className="lb-resumen-grid">
                <div>
                  <div className="lb-section-title" style={{fontSize:20, marginBottom:10}}>Tareas</div>
                  <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    {actionItems.length
                      ? actionItems.map((item, i) => <TaskCard item={item} key={i} compact />)
                      : <p className="lb-subtext">No hay tareas detectadas.</p>}
                  </div>
                </div>
                <div>
                  <div className="lb-section-title" style={{fontSize:20, marginBottom:10}}>Señales</div>
                  <SignalList title="A favor" items={positiveSignals} tone="green" />
                  <SignalList title="A revisar" items={negativeSignals} tone="red" />
                </div>
              </div>
              <button className="lb-btn-outline" style={{marginTop:20}} onClick={() => setMessagesOpen((open) => !open)}>
                {messagesOpen ? 'Ocultar mensajes' : `Ver ${detailLoading ? '...' : detailMessages.length} mensajes del día`}
              </button>
              {messagesOpen && (
                <div className="lb-messages" style={{marginTop:18}}>
                  {detailMessages.slice(0, 12).map((message) => {
                    const isTeam = message.speaker_team === 'blackwell'
                    return (
                      <div className={`lb-bubble-wrap ${isTeam ? 'right' : 'left'}`} key={message.id}>
                        <div className={`lb-bubble ${isTeam ? 'right' : 'left'}`}>
                          <div className="lb-bubble-name">{message.speaker_label || message.push_name || message.author || 'Sin autor'}</div>
                          <div className="lb-bubble-text">{message.body || '(sin texto)'}</div>
                          <div className="lb-bubble-time">{shortDate(message.sent_at)} · {message.msg_type}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        )
      })()}

      {clientTab === 'mensajes' && (
        <div style={{marginTop:22}}>
          <div className="lb-section-head" style={{marginBottom:18}}>
            <div>
              <div className="lb-section-title">Mensajes</div>
              <div className="lb-section-sub">{detailLoading ? 'Cargando...' : `${detailMessages.length} mensajes recientes`}</div>
            </div>
          </div>
          {detailLoading ? (
            <p className="lb-subtext" style={{textAlign:'center', padding:'32px 0'}}>Cargando mensajes...</p>
          ) : detailMessages.length === 0 ? (
            <p className="lb-subtext" style={{textAlign:'center', padding:'32px 0'}}>Sin mensajes disponibles para este grupo.</p>
          ) : (
            <div className="lb-messages" style={{maxWidth:'100%'}}>
              {detailMessages.map((message) => {
                const isTeam = message.speaker_team === 'blackwell'
                return (
                  <div className={`lb-bubble-wrap ${isTeam ? 'right' : 'left'}`} key={message.id}>
                    <div className={`lb-bubble ${isTeam ? 'right' : 'left'}`}>
                      <div className="lb-bubble-name" style={{color: isTeam ? '#3a6ea5' : '#3f7050'}}>{message.speaker_label || message.push_name || message.author || 'Sin autor'}</div>
                      <div className="lb-bubble-text">{message.body || '(sin texto)'}</div>
                      <div className="lb-bubble-time">{shortDate(message.sent_at)} · {message.msg_type}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {clientTab === 'publicaciones' && (
        <div className="lb-publications">
          <div className="lb-section-head">
            <div>
              <div className="lb-section-title">Publicaciones logradas</div>
              <div className="lb-section-sub">
                Datos del Sheet sincronizados a Supabase. El porcentaje CO se activara cuando carguemos las metas del contrato.
              </div>
            </div>
            <span className="lb-section-count">{selectedAccountPublications.length}</span>
          </div>

          {selectedAccount?.operational && (
            <div className="lb-co-mini">
              <strong>{selectedAccount.operational.delivered_publications_count}</strong>
              <span>
                publicaciones registradas en {String(selectedAccount.operational.period_month).padStart(2, '0')}/{selectedAccount.operational.period_year}
              </span>
              <em>Meta pendiente</em>
            </div>
          )}

          {selectedAccountPublications.length ? (
            <div className="lb-publication-list">
              {selectedAccountPublications.map((publication) => {
                const quality = qualityForPublication(publication)
                const matchedAliases = Array.isArray(quality?.matched_aliases)
                  ? quality?.matched_aliases.filter(Boolean).join(', ')
                  : ''
                const evidence = [quality?.title_evidence, quality?.body_evidence].filter(Boolean).join(' / ')
                const canOpenPublication = Boolean(publication.url?.startsWith('http'))

                return (
                <article className="lb-publication-card" key={publication.id}>
                  <div className="lb-publication-main">
                    <div className="lb-publication-title">{publication.media_name || 'Medio sin nombre'}</div>
                    <div className="lb-publication-meta">
                      {publication.publication_date ? shortDateOnly(publication.publication_date) : 'Sin fecha'}
                      {publication.sheet_client_name ? ` · ${publication.sheet_client_name}` : ''}
                      {publication.service ? ` · ${publication.service}` : ''}
                    </div>
                    {(publication.provider || publication.columnist || publication.comments) && (
                      <p>
                        {[publication.provider, publication.columnist, publication.comments].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className={`lb-publication-quality ${quality ? '' : 'is-empty'}`}>
                      {quality ? (
                        <>
                          <div className="lb-publication-quality-head">
                            <strong>Calidad de nota</strong>
                            {quality.badge && (
                              <span className="lb-quality-chip type" title={quality.type_source === 'authored' ? 'Nota propia: el cliente es el autor/firma' : quality.type_source === 'inferred' ? 'Tipo inferido del link' : 'Tipo tomado del Sheet (Servicio)'}>
                                {quality.badge}
                              </span>
                            )}
                            <span
                              className={`lb-quality-chip ${qualityTone(quality)}`}
                              title={fetchErrorInfo(quality)?.detail ?? undefined}
                            >
                              {qualityScoreText(quality)}
                            </span>
                          </div>
                          {/* Cuando la nota no se pudo leer, los chips título/cuerpo/editorial
                              engañan (no se leyó nada): mostramos solo el motivo real. */}
                          {quality.status === 'fetch_error' ? (
                            <p className="lb-quality-evidence">{fetchErrorInfo(quality)?.detail}</p>
                          ) : (
                            <div className="lb-publication-quality-grid">
                              <span className={`lb-quality-chip ${qualityTone(quality, quality.title_match)}`}>
                                {quality.title_match ? 'Cliente en titulo' : 'Titulo sin cliente'}
                              </span>
                              <span className={`lb-quality-chip ${qualityTone(quality, quality.body_match)}`}>
                                {quality.body_match ? 'Cliente en cuerpo' : 'Cuerpo sin cliente'}
                              </span>
                              {(!quality.deliverable_type || quality.deliverable_type === 'nota') && (
                                <>
                                  <span className="lb-quality-chip muted">
                                    {qualityText(quality.editorial_quality, 'Editorial pendiente')}
                                  </span>
                                  <span className="lb-quality-chip muted">
                                    {qualityText(quality.focus, 'Enfoque pendiente')}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                          {quality.article_title && (
                            <p className="lb-quality-evidence">Titulo leido: {quality.article_title}</p>
                          )}
                          {quality.status !== 'fetch_error' && (matchedAliases || evidence) && (
                            <p className="lb-quality-evidence">
                              {matchedAliases ? `Match: ${matchedAliases}` : ''}
                              {matchedAliases && evidence ? ' · ' : ''}
                              {evidence ? `Evidencia: ${evidence}` : ''}
                            </p>
                          )}
                          {(() => {
                            const visibleChecklist = (Array.isArray(quality.evidence?.checklist) ? quality.evidence.checklist : [])
                              .filter(item => !checklistItemHidden(item))
                            if (!visibleChecklist.length) return null
                            return (
                              <ul className="lb-quality-checklist">
                                {visibleChecklist.map((item, i) => {
                                  const isPositive = checklistItemPositive(item)
                                  return (
                                    <li key={i} className={`lb-quality-checklist-item ${isPositive ? 'positive' : 'negative'}`}>
                                      <span className="lb-quality-checklist-icon">{isPositive ? '✓' : '✗'}</span>
                                      <span>{item.replace(/^(s[ií]|no):\s*/i, '')}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )
                          })()}
                        </>
                      ) : (
                        <span>{canOpenPublication ? 'Sin analisis PQ todavia para este link.' : 'No hay link en el Sheet para esta fila.'}</span>
                      )}
                    </div>
                  </div>
                  {canOpenPublication && publication.url && (
                    <a className="lb-publication-link" href={publication.url} target="_blank" rel="noreferrer">
                      Abrir nota
                    </a>
                  )}
                </article>
                )
              })}
            </div>
          ) : (
            <p className="lb-subtext" style={{ textAlign: 'center', padding: '32px 0' }}>
              Aun no hay publicaciones sincronizadas para este cliente.
            </p>
          )}
        </div>
      )}

      {clientTab === 'reportes' && selectedAccount?.account_id === PEPE_ACCOUNT_ID && (
        <PepeReportsTab />
      )}
      {clientTab === 'simulador' && selectedAccount?.account_id === PEPE_ACCOUNT_ID && (
        <PepeSimuladorTab />
      )}

      {clientTab === 'meet' && (() => {
        const activeMeeting = selectedAccountMeetings.find(m => m.id === selectedMeetingId) ?? selectedAccountMeetings[0] ?? null

        return (
          <div style={{marginTop:22}}>
            <div className="lb-section-head" style={{marginBottom:18}}>
              <div>
                <div className="lb-section-title">Meet</div>
                <div className="lb-section-sub">{selectedAccountMeetings.length} minutas ligadas a este cliente</div>
              </div>
              <button
                onClick={handleSyncMeetings}
                disabled={meetingsLoading}
                className="lb-btn-outline"
                style={{fontSize:14, padding:'7px 16px'}}
              >
                {meetingsLoading ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>

            {/* SC Session Analyses from checklist.json */}
            {(() => {
              const allScores: [string, any][] = Object.entries(accountChecklistData?.scores ?? {})
                .filter(([, v]: [string, any]) => v?.transcripciones?.sesion_score != null)
                .sort(([a], [b]) => b.localeCompare(a))
              if (!allScores.length) return null
              const [latestPeriod, latestData] = allScores[0]
              const sc = latestData.transcripciones
              const scoreColor = sc.sesion_score >= 80 ? '#217a4c' : sc.sesion_score >= 50 ? '#b07d1e' : '#a32d2d'
              const scoreBg = sc.sesion_score >= 80 ? 'rgba(33,122,76,0.07)' : sc.sesion_score >= 50 ? 'rgba(239,180,18,0.08)' : 'rgba(163,45,45,0.07)'
              return (
                <div style={{ border: `1px solid ${scoreColor}30`, borderLeft: `4px solid ${scoreColor}`, borderRadius: 8, padding: '16px 20px', marginBottom: 24, background: scoreBg }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>{sc.sesion_score}/100</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>SC Sesión</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>{latestPeriod}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {[
                      { label: `Asistencia: ${sc.attended_on_time ? 'Puntual' : sc.attended ? 'Tardó' : 'No asistió'}`, ok: sc.attended_on_time },
                      { label: `Participación: ${sc.participation_level ?? '—'}`, ok: sc.participation_level === 'alta' || sc.participation_level === 'media' },
                      { label: `Tono: ${sc.tone ?? '—'}`, ok: sc.tone === 'positivo' },
                      { label: `Info estratégica: ${sc.shared_strategic_info ? 'Sí' : 'No'}`, ok: sc.shared_strategic_info },
                    ].map((tag, i) => (
                      <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, fontFamily: 'var(--mono)', background: tag.ok ? 'rgba(33,122,76,0.10)' : 'rgba(120,128,140,0.10)', color: tag.ok ? '#217a4c' : 'var(--char)', border: `1px solid ${tag.ok ? 'rgba(33,122,76,0.20)' : 'var(--rule)'}` }}>
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  {Array.isArray(sc.checklist) && sc.checklist.length > 0 && (
                    <ul style={{ margin: '8px 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {sc.checklist.map((item: string, i: number) => {
                        const isPos = checklistItemPositive(item)
                        return (
                          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-900)' }}>
                            <span style={{ flexShrink: 0, fontWeight: 700, color: isPos ? '#217a4c' : '#a32d2d' }}>{isPos ? '✓' : '✗'}</span>
                            <span>{item.replace(/^(s[ií]|no):\s*/i, '')}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {sc.reasoning && (
                    <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--char)', lineHeight: 1.6, fontStyle: 'italic' }}>{sc.reasoning}</p>
                  )}
                  {Array.isArray(sc.accionables) && sc.accionables.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 5 }}>Accionables</div>
                      {sc.accionables.map((a: string, i: number) => (
                        <div key={i} style={{ fontSize: 12.5, color: 'var(--char)', padding: '3px 0 3px 12px', borderLeft: '2px solid var(--rule)' }}>→ {a}</div>
                      ))}
                    </div>
                  )}
                  {sc.survey && (() => {
                    // Soporta ambos formatos: Supabase (question_a/question_b con score)
                    // y el viejo del checklist estático (tipo_a/tipo_b/tipo_c).
                    const qa = sc.survey.question_a ?? (sc.survey.tipo_a ? { question: sc.survey.tipo_a.pregunta, answer: sc.survey.tipo_a.respuesta } : null)
                    const qb = sc.survey.question_b ?? (sc.survey.tipo_b ? { question: sc.survey.tipo_b.pregunta, answer: sc.survey.tipo_b.respuesta } : null)
                    const hasA = qa && (qa.score != null || qa.question || qa.answer)
                    const hasB = qb && (qb.score != null || qb.question || qb.answer)
                    if (!hasA && !hasB && !sc.survey.tipo_c) return null
                    return (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--rule-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 4 }}>Survey aplicado</div>
                        {hasA && <div style={{ fontSize: 12.5, color: 'var(--char)' }}><strong>Tipo A</strong> — {qa.question || 'Satisfacción general'} <span style={{ color: scoreColor, fontWeight: 600 }}>→ {qa.answer ?? '—'}{qa.score != null ? ` (${qa.score}/100)` : ''}</span></div>}
                        {hasB && <div style={{ fontSize: 12.5, color: 'var(--char)' }}><strong>Tipo B</strong> — {qb.question || 'Impacto en objetivo'} <span style={{ color: scoreColor, fontWeight: 600 }}>→ {qb.answer ?? '—'}{qb.score != null ? ` (${qb.score}/100)` : ''}</span></div>}
                        {sc.survey.tipo_c && <div style={{ fontSize: 12.5, color: 'var(--char)' }}><strong>Accionable C</strong> — {sc.survey.tipo_c.respuesta}</div>}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            {selectedAccountMeetings.length === 0 ? (
              <p className="lb-subtext" style={{textAlign:'center', padding:'32px 0'}}>Sin minutas de Meet para este cliente.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '62vh', overflowY: 'auto', paddingRight: '4px' }}>
                  {selectedAccountMeetings.map((meeting) => {
                    const isSelected = activeMeeting?.id === meeting.id
                    return (
                      <button
                        key={meeting.id}
                        onClick={() => setSelectedMeetingId(meeting.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          padding: '12px 16px',
                          background: isSelected ? '#fffdf0' : '#fff',
                          border: `1px solid ${isSelected ? '#d4c87a' : '#ece9e0'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all .12s'
                        }}
                      >
                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink-900)' }}>{meeting.title}</span>
                        <span style={{ fontSize: '11px', color: '#9aa0a6', fontFamily: 'var(--mono)' }}>
                          {new Date(meeting.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div>
                  {activeMeeting && (
                    <>
                      <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: '12px', padding: '24px' }}>
                        <h2 className="lb-h2" style={{ marginTop: 0, fontSize: '30px' }}>{activeMeeting.title}</h2>
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', marginBottom: '18px' }}>
                          Fecha de importacion: {new Date(activeMeeting.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </div>
                        <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: '18px' }}>
                          <div style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a6', marginBottom: '8px' }}>Resumen ejecutivo</div>
                          <p className="lb-summary-text" style={{ margin: 0, lineHeight: '1.6' }}>{activeMeeting.summary}</p>
                        </div>
                      </div>

                      <div className="lb-section-head" style={{ marginTop: 24 }}>
                        <div className="lb-section-title">Tareas detectadas</div>
                        <span className="lb-section-count">{activeMeeting.action_items?.length || 0}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {activeMeeting.action_items?.length ? (
                          activeMeeting.action_items.map((item: string, idx: number) => {
                            const match = item.match(/^([^:-]+)[:|-]\s*(.+)$/)
                            const speaker = match ? match[1].trim() : null
                            const taskText = match ? match[2].trim() : item

                            return (
                              <article key={idx} className="lb-task" style={{ borderLeft: '4px solid #00a884', background: 'rgba(0,168,132,0.02)' }}>
                                <div className="lb-task-header">
                                  <div className="lb-task-title">{taskText}</div>
                                  {speaker && (
                                    <span className="lb-task-tag blackwell" style={{ background: 'rgba(0,168,132,0.1)', color: '#00a884', border: '1px solid rgba(0,168,132,0.25)' }}>
                                      {speaker}
                                    </span>
                                  )}
                                </div>
                                <div className="lb-task-footer" style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '11px', color: '#9aa0a6' }}>Fuente: Notas Gemini (Gmail / Meet)</span>
                                </div>
                              </article>
                            )
                          })
                        ) : (
                          <p className="lb-subtext">No se detectaron tareas pendientes en esta minuta.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}

          </div>
        </div>
      </div>


    </div>
  )
}

function fmtShortDate(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`)
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(d)
}

type ChartPoint = {
  id: number | null
  date: string
  score: number
  delta: number
  summary: string | null
  filled: boolean  // true = day had no messages, score carried forward
}

type HistoricalScoreItem = {
  id: number
  analysis_date: string
  score: number | null       // daily WA score — used for chart
  global_score: number | null // weighted global — used for detail cards
  delta: number
  wa_score: number | null
  summary: string | null
}

function todayMexicoStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date())
}

function buildChartPoints(items: HistoricalScoreItem[], startDate?: string): ChartPoint[] {
  if (!items.length) return []

  const byDate = new Map(items.map(i => [i.analysis_date, i]))
  const sorted = [...items].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))
  const today  = todayMexicoStr()

  // If a startDate is given (range selector), use it; else use first analysis date
  const startStr = startDate && startDate > sorted[0].analysis_date ? startDate : sorted[0].analysis_date
  const start = new Date(`${startStr}T12:00:00`)
  const end   = new Date(`${today}T12:00:00`)

  // Carry-forward score from before the window
  let lastScore = Number(sorted[0].score ?? 0)
  for (const item of sorted) {
    if (item.analysis_date < startStr) lastScore = Number(item.score ?? lastScore)
  }

  const result: ChartPoint[] = []
  const cur = new Date(start)
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const analysis = byDate.get(dateStr)
    if (analysis) {
      lastScore = Number(analysis.score ?? lastScore)
      result.push({ id: analysis.id, date: dateStr, score: lastScore, delta: analysis.delta, summary: analysis.summary, filled: false })
    } else {
      result.push({ id: null, date: dateStr, score: lastScore, delta: 0, summary: null, filled: true })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

function ScoreGraph({ items, selectedId, onSelect, startDate }: { items: HistoricalScoreItem[]; selectedId: number | null; onSelect: (id: number) => void; startDate?: string }) {
  const chartPoints = buildChartPoints(items, startDate)
  const width = 760
  const chartH = 180
  const padding = 28
  const totalH = chartH + 28

  const mapped = chartPoints.map((cp, index) => {
    const x = chartPoints.length <= 1 ? width / 2 : padding + (index * (width - padding * 2)) / (chartPoints.length - 1)
    const y = chartH - padding - (cp.score / 100) * (chartH - padding * 2)
    return { ...cp, x, y }
  })

  const todayStr  = todayMexicoStr()

  // Gray dashed baseline — all points connected
  const grayPath = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // Colored solid segments — only runs of real analysis days
  const coloredSegs: string[] = []
  let run: typeof mapped = []
  for (const p of mapped) {
    if (!p.filled) { run.push(p) }
    else {
      if (run.length >= 2) coloredSegs.push(run.map((r, j) => `${j === 0 ? 'M' : 'L'} ${r.x} ${r.y}`).join(' '))
      run = []
    }
  }
  if (run.length >= 2) coloredSegs.push(run.map((r, j) => `${j === 0 ? 'M' : 'L'} ${r.x} ${r.y}`).join(' '))

  const showLabel = (idx: number, date: string) =>
    date === todayStr || chartPoints.length <= 10 || idx % Math.ceil(chartPoints.length / 10) === 0 || idx === chartPoints.length - 1

  return (
    <div className="score-graph" aria-label="Grafica historica de puntos">
      <svg viewBox={`0 0 ${width} ${totalH}`} role="img">
        <defs>
          <linearGradient id="lbScoreLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#3f7050" />
            <stop offset="50%" stopColor="#b07d1e" />
            <stop offset="100%" stopColor="#a8453b" />
          </linearGradient>
        </defs>

        <line className="grid-line" x1={padding} x2={width - padding} y1={padding} y2={padding} />
        <line className="grid-line" x1={padding} x2={width - padding} y1={chartH / 2} y2={chartH / 2} />
        <line className="grid-line" x1={padding} x2={width - padding} y1={chartH - padding} y2={chartH - padding} />
        <text x={padding - 4} y={padding + 4} textAnchor="end" fontSize="10" fill="#b0b4ba">100</text>
        <text x={padding - 4} y={chartH / 2 + 4} textAnchor="end" fontSize="10" fill="#b0b4ba">50</text>
        <text x={padding - 4} y={chartH - padding + 4} textAnchor="end" fontSize="10" fill="#b0b4ba">0</text>

        {/* Gray dashed baseline — always connects all days including gaps */}
        <path d={grayPath} fill="none" stroke="#d0ccc4" strokeWidth="1.5" strokeDasharray="4 4" />

        {/* Colored solid line — overlaid only on real-analysis runs */}
        {coloredSegs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="url(#lbScoreLine)" strokeWidth="2.5" />
        ))}

        {/* Dots + tooltips */}
        {(() => {
          let lastLabelX = -999
          return mapped.map((point, idx) => {
          const dotColor = point.filled ? '#b8b4ac' : point.score >= 85 ? '#3f7050' : point.score >= 70 ? '#b07d1e' : '#a8453b'
          const isSelected = !point.filled && selectedId === point.id
          const tooltip = point.filled
            ? `Sin mensajes · ${fmtShortDate(point.date)}`
            : `${fmtShortDate(point.date)} · score global ${point.score}${point.delta !== 0 ? ` (${point.delta > 0 ? '+' : ''}${point.delta})` : ''}${point.summary ? '\n' + point.summary : ''}`
          const showScoreLabel = !point.filled && (point.x - lastLabelX) >= 38
          if (showScoreLabel) lastLabelX = point.x
          return (
            <g key={`${point.date}-${idx}`}
               style={{cursor: point.filled ? 'default' : 'pointer'}}
               onClick={() => { if (!point.filled && point.id) onSelect(point.id) }}>
              <title>{tooltip}</title>
              {/* Score label — only on real days with enough spacing */}
              {showScoreLabel && (
                <text x={point.x} y={point.y - 11} textAnchor="middle" fontSize="11" fontWeight="700" fill={dotColor} fontFamily="'Libre Franklin',sans-serif">
                  {point.score}
                </text>
              )}
              {/* Dot */}
              <circle cx={point.x} cy={point.y}
                r={point.filled ? 3 : isSelected ? 7 : 5}
                fill={isSelected ? dotColor : point.filled ? '#e8e4dc' : '#fdfcf8'}
                stroke={dotColor}
                strokeWidth={point.filled ? 1 : isSelected ? 0 : 2.5}
                opacity={point.filled ? 0.7 : 1}
              />
              {/* Invisible hit area so small gray dots are hoverable */}
              <circle cx={point.x} cy={point.y} r="10" fill="transparent" />
              {/* Date label */}
              {showLabel(idx, point.date) && (
                <text x={point.x} y={chartH + 18} textAnchor="middle" fontSize="10"
                  fontWeight={point.date === todayStr ? '700' : '400'}
                  fill={point.date === todayStr ? '#3a6ea5' : point.filled ? '#c8c4ba' : '#9aa0a6'}
                  fontFamily="'Libre Franklin',sans-serif">
                  {point.date === todayStr ? 'hoy' : fmtShortDate(point.date)}
                </text>
              )}
            </g>
          )
        })
        })()}
      </svg>
    </div>
  )
}


const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  'por hacer':   { color: '#78808c', bg: 'rgba(120,128,140,0.10)', icon: '○' },
  'en proceso':  { color: '#3a6ea5', bg: 'rgba(58,110,165,0.10)',  icon: '◑' },
  'en revisión': { color: '#ef8212', bg: 'rgba(239,130,18,0.10)',  icon: '◕' },
  'en revision': { color: '#ef8212', bg: 'rgba(239,130,18,0.10)',  icon: '◕' },
  'bloqueada':   { color: '#e44258', bg: 'rgba(228,66,88,0.10)',   icon: '⊘' },
  'concluida':   { color: '#00a884', bg: 'rgba(0,168,132,0.10)',   icon: '●' },
}

const URGENCY_CONFIG: Record<string, { color: string; icon: string }> = {
  'high':   { color: '#e44258', icon: '▲' },
  'medium': { color: '#ef8212', icon: '■' },
  'low':    { color: '#78808c', icon: '▼' },
}

const WORK_TYPE_ICON: Record<string, string> = {
  'reunión': '👥', 'reunion': '👥',
  'campaña': '📢', 'campana': '📢',
  'crisis': '⚡',
  'nota a cliente': '📝', 'nota_clientes': '📝',
  'reporte': '📊',
  'análisis': '🔍', 'analisis': '🔍',
  'media training': '🎙',
}

function getStatusConfig(status: string) {
  const key = status.toLowerCase().trim()
  return STATUS_CONFIG[key] ?? { color: '#78808c', bg: 'rgba(120,128,140,0.10)', icon: '○' }
}

type ContractHistoryEntry = { nombre?: string; vigencia?: string; estatus?: string; nota?: string }

// Tarjeta de inteligencia documental del Drive (tabla drive_account_intel):
// estado del contrato, vigencia, objetivos, entregables comprometidos y faltantes.
function DriveIntelCard({ intel }: { intel: any | null }) {
  if (!intel) return null
  const chip = intel.tiene_contrato_firmado === true
    ? { label: 'Contrato firmado', color: '#3f7050' }
    : intel.tiene_contrato_firmado === false
      ? { label: `${intel.tipo_acuerdo === 'propuesta' ? 'Propuesta' : intel.tipo_acuerdo || 'Acuerdo'} sin firma`, color: '#b07d1e' }
      : { label: 'Sin documentos de contrato', color: '#a8453b' }
  const fmt = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const objetivos: string[] = Array.isArray(intel.objetivos) ? intel.objetivos : []
  const faltantes: string[] = Array.isArray(intel.faltantes) ? intel.faltantes : []
  return (
    <div style={{ background: '#fff', border: '1px solid #ece9e0', borderRadius: 12, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="lb-section-title" style={{ margin: 0 }}>Contrato & Drive</div>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: chip.color, background: `${chip.color}1a`, border: `1px solid ${chip.color}55`, borderRadius: 999, padding: '3px 10px' }}>{chip.label}</span>
        <span style={{ fontSize: 11, color: '#9aa0a6', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>{intel.docs_total ?? 0} docs en Drive</span>
      </div>
      {intel.resumen && <p className="lb-summary-text" style={{ margin: '0 0 12px' }}>{intel.resumen}</p>}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--char)', marginBottom: objetivos.length || faltantes.length ? 12 : 0 }}>
        {(intel.vigencia_inicio || intel.vigencia_fin) && (
          <span><strong>Vigencia:</strong> {fmt(intel.vigencia_inicio) ?? '¿?'} → {fmt(intel.vigencia_fin) ?? '¿?'}</span>
        )}
        {intel.meta_entregables && <span style={{ flexBasis: '100%' }}><strong>Entregables comprometidos:</strong> {intel.meta_entregables}</span>}
        {intel.renovacion && <span style={{ flexBasis: '100%' }}><strong>Renovación:</strong> {intel.renovacion}</span>}
      </div>
      {objetivos.length > 0 && (
        <div style={{ marginBottom: faltantes.length ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#9aa0a6', marginBottom: 6 }}>Objetivos del contrato</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {objetivos.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}
      {faltantes.length > 0 && (
        <div style={{ background: 'rgba(168,69,59,0.06)', border: '1px solid rgba(168,69,59,0.25)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#a8453b', marginBottom: 6 }}>Faltantes documentales</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#7a3a33', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {faltantes.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function ContractTimeline({ contract, history }: { contract?: { vigencia?: string; nota?: string; fase_actual?: string } | null; history?: ContractHistoryEntry[] | null }) {
  const [showHistory, setShowHistory] = useState(false)
  const pastContracts = (history ?? []).filter(h => h.vigencia)
  if ((!contract?.vigencia || !contract.vigencia.includes('/')) && !pastContracts.length) return null
  if (!contract?.vigencia || !contract.vigencia.includes('/')) {
    return (
      <div className="lb-score-breakdown" aria-label="Contratos anteriores" style={{ marginBottom: 12 }}>
        <div className="lb-score-breakdown-head"><span>Contratos</span><strong>Sin contrato vigente</strong></div>
        <ContractHistoryList entries={pastContracts} />
      </div>
    )
  }
  const [startStr, endStr] = contract.vigencia.split('/')
  const start = new Date(`${startStr}T00:00:00`)
  const end = new Date(`${endStr}T23:59:59`)
  const now = new Date()
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null

  const total = end.getTime() - start.getTime()
  const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), 0), total)
  const pct = (elapsed / total) * 100
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000))
  const monthsLeft = Math.floor(daysLeft / 30)
  const expired = now > end
  const notStarted = now < start

  const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  const barColor = expired ? '#a32d2d' : daysLeft <= 60 ? '#b07d1e' : '#217a4c'
  const remainingText = expired
    ? 'Contrato vencido'
    : notStarted
      ? 'Aún no inicia'
      : monthsLeft >= 1
        ? `${monthsLeft} mes${monthsLeft === 1 ? '' : 'es'} restante${monthsLeft === 1 ? '' : 's'} (${daysLeft} días)`
        : `${daysLeft} días restantes`

  return (
    <div className="lb-score-breakdown" aria-label="Línea de tiempo del contrato" style={{ marginBottom: 12 }}>
      <div className="lb-score-breakdown-head">
        <span>Vigencia del contrato</span>
        <strong style={{ color: barColor }}>{remainingText}</strong>
      </div>
      <div style={{ padding: '6px 0 2px 0' }}>
        <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'rgba(120,128,140,0.15)', overflow: 'visible' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 6, background: `linear-gradient(90deg, ${barColor}88, ${barColor})` }} />
          {!expired && !notStarted && (
            <div style={{ position: 'absolute', left: `${pct}%`, top: -4, bottom: -4, width: 2, background: '#1c2027', borderRadius: 1 }} title={`Hoy: ${fmt(now)}`} />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: '#78808c' }}>
          <span>Inicio: {fmt(start)}</span>
          <span style={{ fontWeight: 600, color: '#3d434c' }}>Hoy: {fmt(now)} · {Math.round(pct)}% transcurrido</span>
          <span>Fin: {fmt(end)}</span>
        </div>
        {(contract.fase_actual || contract.nota) && (
          <p style={{ margin: '8px 0 0 0', fontSize: 12, lineHeight: 1.45, color: '#78808c' }}>
            {contract.fase_actual ? `Fase actual: ${contract.fase_actual.replace('_', ' ')}. ` : ''}{contract.nota ?? ''}
          </p>
        )}
        {pastContracts.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#78808c' }}
            >
              {showHistory ? '▾' : '▸'} Contratos anteriores ({pastContracts.length})
            </button>
            {showHistory && <ContractHistoryList entries={pastContracts} />}
          </div>
        )}
      </div>
    </div>
  )
}

function ContractHistoryList({ entries }: { entries: ContractHistoryEntry[] }) {
  const fmt = (s: string) => {
    const d = new Date(`${s}T00:00:00`)
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return (
    <div style={{ marginTop: 6 }}>
      {entries.map((h, i) => {
        const [s, e] = (h.vigencia ?? '').split('/')
        return (
          <div key={i} style={{
            padding: '8px 12px',
            marginBottom: 6,
            background: 'rgba(120,128,140,0.06)',
            borderRadius: 8,
            borderLeft: '3px solid rgba(120,128,140,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13, color: '#3d434c' }}>{h.nombre ?? 'Contrato'}</strong>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#78808c', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h.estatus ?? 'concluido'}</span>
            </div>
            {s && e && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#78808c' }}>{fmt(s)} → {fmt(e)}</p>}
            {h.nota && <p style={{ margin: '4px 0 0 0', fontSize: 12, lineHeight: 1.45, color: '#78808c' }}>{h.nota}</p>}
          </div>
        )
      })}
    </div>
  )
}

function MilestonesTimeline({
  milestones,
  onDeleteClick,
}: {
  milestones: AccountMilestone[]
  onDeleteClick: (id: number) => void
}) {
  return (
    <div style={{ marginTop: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="lb-section-title" style={{ margin: 0 }}>Historial de Hitos y Crisis</div>
      </div>

      {milestones.length === 0 ? (
        <p className="lb-subtext" style={{ margin: 0, fontStyle: 'italic' }}>
          Sin hitos registrados para esta cuenta.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '2px solid #e2e8f0', paddingLeft: 16, marginLeft: 8 }}>
          {milestones.map((m) => {
            const isCrisis = m.event_type === 'crisis';
            const isOportunidad = m.event_type === 'oportunidad';
            const isCambio = m.event_type === 'cambio_estrategico';
            
            let color = '#718096'; // grey for normal hito
            let bg = '#edf2f7';
            if (isCrisis) {
              color = '#e53e3e'; // red
              bg = '#fff5f5';
            } else if (isOportunidad) {
              color = '#319795'; // teal
              bg = '#e6fffa';
            } else if (isCambio) {
              color = '#805ad5'; // purple
              bg = '#faf5ff';
            }

            return (
              <div
                key={m.id}
                style={{
                  position: 'relative',
                  background: bg,
                  borderRadius: 6,
                  padding: '10px 14px',
                  border: `1px solid ${color}30`
                }}
              >
                {/* Dot indicator on timeline */}
                <div
                  style={{
                    position: 'absolute',
                    left: -22,
                    top: 14,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: color,
                    border: '2px solid #fff'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '13px', color: '#1a202c' }}>{m.title}</strong>
                      <span
                        style={{
                          fontSize: '9px',
                          textTransform: 'uppercase',
                          fontWeight: 'bold',
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: color,
                          color: '#fff'
                        }}
                      >
                        {m.event_type.replace('_', ' ')}
                      </span>
                      {m.impact_level === 'high' && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 'bold',
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: '#e53e3e',
                            color: '#fff'
                          }}
                        >
                          Impacto Alto
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: '#718096', display: 'block', marginTop: 2 }}>
                      Fecha del hito: {new Date(m.event_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {m.description && (
                      <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#4a5568', lineHeight: 1.4 }}>
                        {m.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onDeleteClick(m.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#a0aec0',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold'
                    }}
                    title="Eliminar hito"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreBreakdown({ components }: { components: ReturnType<typeof buildWeightedScore>['components'] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="lb-score-breakdown" aria-label="Componentes del score global">
      <div className="lb-score-breakdown-head">
        <span>Ponderación conectada</span>
        <strong>Global = CO 30% · PQ 25% · SC 45%</strong>
      </div>
      <div className="lb-score-bars">
        {components.map((component) => {
          const fill = component.value == null
            ? 0
            : Math.min(100, (Number(component.value) / component.max) * 100)
          const valueText = component.value == null
            ? component.status === 'conectado' ? 'meta pendiente' : 'pendiente'
            : `${component.value}/${component.max}`
          const details: string[] = (component as any).details ?? []
          const isOpen = expanded === component.key
          return (
            <div key={component.key}>
              <div
                className={`lb-score-bar-row ${component.status}`}
                onClick={() => details.length && setExpanded(isOpen ? null : component.key)}
                style={details.length ? { cursor: 'pointer' } : undefined}
                title={details.length ? 'Clic para ver el desglose' : undefined}
              >
                <div className="lb-score-bar-label">
                  <strong>{component.label}{details.length ? <span style={{ marginLeft: 5, fontSize: 11, color: '#78808c' }}>{isOpen ? '▾' : '▸'}</span> : null}</strong>
                  <span>{component.caption}</span>
                </div>
                <div className="lb-score-bar-track">
                  <div className="lb-score-bar-fill" style={{ width: `${fill}%` }} />
                </div>
                <div className="lb-score-bar-value">{valueText}</div>
              </div>
              {isOpen && details.length > 0 && (
                <div style={{
                  margin: '2px 0 10px 0',
                  padding: '10px 14px',
                  background: 'rgba(120,128,140,0.06)',
                  borderRadius: 8,
                  borderLeft: '3px solid rgba(120,128,140,0.35)',
                }}>
                  {details.map((d, i) => {
                    const isSi = d.toLowerCase().startsWith('si:') || d.toLowerCase().startsWith('sí:')
                    const isNo = d.toLowerCase().startsWith('no:')
                    return (
                      <p key={i} style={{
                        margin: '4px 0',
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: isSi ? '#217a4c' : isNo ? '#a32d2d' : '#3d434c',
                      }}>
                        {isSi ? '✓ ' : isNo ? '✗ ' : '· '}{d}
                      </p>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskCard({ item, compact = false }: { item: unknown; compact?: boolean }) {
  const detail = actionDetail(item)
  const sc = getStatusConfig(detail.status ?? '')
  const urg = URGENCY_CONFIG[(detail.urgency ?? '').toLowerCase()] ?? URGENCY_CONFIG['low']
  const wtIcon = WORK_TYPE_ICON[(detail.workType ?? '').toLowerCase()] ?? '📋'

  return (
    <article className="lb-task" style={{borderLeft: `4px solid ${sc.color}`}}>
      <div className="lb-task-header">
        <div className="lb-task-title">{actionText(item)}</div>
        {detail.client && detail.client !== 'Sin cliente' && (
          <span className="lb-task-tag blackwell">{detail.client}</span>
        )}
      </div>

      <div className="lb-task-status-row">
        <span className="lb-task-status" style={{color: sc.color}}>
          <span className="lb-task-status-dot" style={{background: sc.color}} />
          {detail.status}
        </span>
        {detail.dueDate && <span className="lb-task-priority" style={{color: urg.color}}>{detail.dueDate}</span>}
      </div>

      {!compact && (
        <div className="lb-task-fields">
          <div>
            <div className="lb-task-field-label">Fecha entrega</div>
            <div className="lb-task-field-val">{shortDateOnly(detail.dueDate) || '—'}</div>
          </div>
          <div>
            <div className="lb-task-field-label">Responsable</div>
            <div className="lb-task-field-val">{detail.owner}</div>
          </div>
          <div>
            <div className="lb-task-field-label">{wtIcon} Tipo</div>
            <div className="lb-task-field-val">{detail.workType}</div>
          </div>
          <div>
            <div className="lb-task-field-label">Cliente</div>
            <div className="lb-task-field-val">{detail.client}</div>
          </div>
        </div>
      )}

      {(detail.evidenceSpeaker || detail.evidenceQuote || detail.evidenceReason) && !compact && (
        <div className="lb-signal-green" style={{marginTop:12, fontSize:12.5}}>
          {detail.evidenceSpeaker ? <strong>{detail.evidenceSpeaker}: </strong> : null}
          {detail.evidenceQuote || detail.evidenceReason}
        </div>
      )}

      <div className="lb-task-footer">
        <span>{detail.mondayItemId ? `Monday #${detail.mondayItemId}` : ''}</span>
      </div>
    </article>
  )
}

function SignalList({ title, items, tone }: { title: string; items: unknown[]; tone: 'green' | 'red' }) {
  const cls = tone === 'green' ? 'lb-signal-green' : 'lb-signal-red'
  return (
    <div style={{marginBottom: 14}}>
      <div style={{fontFamily:"'Libre Franklin',sans-serif", fontWeight:700, fontSize:13, letterSpacing:'.05em', textTransform:'uppercase', color:'#9aa0a6', marginBottom:8}}>{title}</div>
      {items.length
        ? items.map((item, index) => <div className={cls} key={index}>{String(item)}</div>)
        : <p className="lb-subtext" style={{fontSize:13}}>Sin registros.</p>}
    </div>
  )
}
