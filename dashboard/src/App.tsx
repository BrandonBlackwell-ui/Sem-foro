import { useEffect, useMemo, useState } from 'react'

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

function badgeClass(value: string) {
  const normalized = value.toLowerCase()
  if (['positive', 'satisfied', 'low', 'estable', 'blackwell'].includes(normalized)) return 'green'
  if (['neutral', 'unknown', 'mixed', 'medium', 'pendiente', 'shared'].includes(normalized)) return 'yellow'
  if (['negative', 'unsatisfied', 'high', 'atencion'].includes(normalized)) return 'red'
  if (['client'].includes(normalized)) return 'gray'
  return 'gray'
}

function normalizeSatisfaction(value: string) {
  const normalized = value.toLowerCase()
  if (['high', 'positive', 'good'].includes(normalized)) return 'satisfied'
  if (['low', 'negative', 'bad'].includes(normalized)) return 'unsatisfied'
  return normalized || 'unknown'
}

function scoreColor(score: number | null | undefined) {
  const value = Number(score ?? 0)
  if (value >= 80) return 'green'
  if (value >= 65) return 'yellow'
  if (value >= 50) return 'orange'
  return 'red'
}

function scoreLabel(score: number | null | undefined) {
  if (score == null) return 'Pendiente'
  if (score >= 80) return 'Sano'
  if (score >= 65) return 'Estable'
  if (score >= 50) return 'Observar'
  return 'Atencion'
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

function actionMeta(item: unknown) {
  if (!isRecord(item)) return 'Sin responsable'
  const owner = fieldText(item.owner, 'Sin responsable')
  const urgency = fieldText(item.urgency, 'sin urgencia')
  return `${owner} - ${urgency}`
}

function actionOwnerType(item: unknown) {
  if (!isRecord(item)) return 'unknown'
  return fieldText(item.owner_type, 'unknown')
}

export default function App() {
  const [analyses, setAnalyses] = useState<DailyAnalysis[]>([])
  const [scores, setScores] = useState<AccountScore[]>([])
  const [rawMessages, setRawMessages] = useState<WaMessage[]>([])
  const [detailMessages, setDetailMessages] = useState<WaMessage[]>([])
  const [groups, setGroups] = useState<WaGroup[]>([])
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const [selectedOverviewDate, setSelectedOverviewDate] = useState<string>('latest')
  const [clientTab, setClientTab] = useState<'resumen' | 'historico' | 'mensajes'>('resumen')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [analysisRows, scoreRows, groupRows, rawRows] = await Promise.all([
          supabaseGet<DailyAnalysis[]>('/rest/v1/wa_daily_analysis?select=*&order=analyzed_at.desc&limit=200'),
          supabaseGet<AccountScore[]>('/rest/v1/wa_account_scores?select=*&order=current_score.desc'),
          supabaseGet<WaGroup[]>('/rest/v1/wa_groups?select=jid,name,account_id,active&order=name.asc'),
          supabaseGet<WaMessage[]>(
            '/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&order=sent_at.desc&limit=500',
          ),
        ])

        setAnalyses(analysisRows)
        setScores(scoreRows)
        setGroups(groupRows)
        setRawMessages(rawRows)
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

  const analysisDates = useMemo(() => {
    return Array.from(new Set(analyses.map((analysis) => analysis.analysis_date))).sort((a, b) => b.localeCompare(a))
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

  const selectedGroup = selectedJid ? groupSummaries.find((group) => group.jid === selectedJid) ?? null : null
  const selectedHistory = useMemo(() => {
    if (!selectedGroup) return []
    return analyses
      .filter((analysis) => analysis.group_jid === selectedGroup.jid)
      .sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))
  }, [analyses, selectedGroup])
  const latestSelectedAnalysis = selectedJid ? latestAnalysisByGroup.get(selectedJid) ?? null : null
  const selectedDayAnalysis = selectedHistory.find((analysis) => analysis.id === selectedHistoryId) ?? null
  const activeDayAnalysis = selectedDayAnalysis ?? latestSelectedAnalysis
  const selectedScore = selectedGroup?.score?.current_score ?? latestSelectedAnalysis?.new_score ?? null
  const selectedSatisfaction = latestSelectedAnalysis ? normalizeSatisfaction(latestSelectedAnalysis.satisfaction) : 'unknown'
  const allActions = selectedHistory.flatMap((analysis) => asArray(analysis.action_items))
  const allPositiveSignals = selectedHistory.flatMap((analysis) => asArray(analysis.positive_signals))
  const allNegativeSignals = selectedHistory.flatMap((analysis) => asArray(analysis.negative_signals))
  const actionItems = activeDayAnalysis ? asArray(activeDayAnalysis.action_items) : []
  const positiveSignals = activeDayAnalysis ? asArray(activeDayAnalysis.positive_signals) : []
  const negativeSignals = activeDayAnalysis ? asArray(activeDayAnalysis.negative_signals) : []

  useEffect(() => {
    setMessagesOpen(false)
    setClientTab('resumen')
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
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(activeDayAnalysis.group_jid)}&sent_at=gte.${encodeURIComponent(startIso)}&sent_at=lt.${encodeURIComponent(endIso)}&order=sent_at.asc`,
          )
          setDetailMessages(rows)
        } else {
          const rows = await supabaseGet<WaMessage[]>(
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(selectedGroup.jid)}&order=sent_at.desc&limit=30`,
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
      <main className="real-shell real-center">
        <div className="real-kicker">Supabase</div>
        <h1>Conectando datos reales...</h1>
      </main>
    )
  }

  if (error) {
    return (
      <main className="real-shell real-center">
        <div className="real-kicker danger">Error</div>
        <h1>No se pudieron leer datos de Supabase</h1>
        <p>{error}</p>
      </main>
    )
  }

  if (!selectedGroup) {
    const analyzedCount = groupSummaries.filter((group) => group.analysis).length
    const needsAnalysis = groupSummaries.length - analyzedCount
    const averageScore = scores.length
      ? Math.round(scores.reduce((total, score) => total + score.current_score, 0) / scores.length)
      : null

    return (
      <main className="app-shell">
        <header className="product-header">
          <div>
            <span className="eyebrow">Semaforo WhatsApp</span>
            <h1>Cuentas</h1>
            <p>Vista rapida de salud, actividad y analisis diario por grupo.</p>
          </div>
          <button className="primary-button" onClick={() => window.location.reload()}>
            Actualizar
          </button>
        </header>

        <section className="overview-strip">
          <MetricCard label="Score promedio" value={averageScore ?? '--'} detail={averageScore ? scoreLabel(averageScore) : 'Sin puntajes'} tone={scoreColor(averageScore)} />
          <MetricCard label="Analizadas" value={analyzedCount} detail={`${needsAnalysis} pendientes`} />
          <MetricCard label="Grupos activos" value={groupSummaries.filter((group) => group.active).length} detail={`${groupSummaries.length} totales`} />
        </section>

        <section className="calendar-panel card-3d">
          <div>
            <span className="eyebrow">Calendario</span>
            <h2>Compilado por dia</h2>
          </div>
          <div className="date-strip">
            <button className={selectedOverviewDate === 'latest' ? 'active' : ''} onClick={() => setSelectedOverviewDate('latest')}>
              Ultimo
            </button>
            {analysisDates.map((day) => (
              <button className={selectedOverviewDate === day ? 'active' : ''} key={day} onClick={() => setSelectedOverviewDate(day)}>
                {day}
              </button>
            ))}
          </div>
        </section>

        <section className="account-list" aria-label="Cuentas de WhatsApp">
          {groupSummaries.map((group) => {
            const scoreValue = group.score?.current_score ?? group.analysis?.new_score ?? null
            const sentiment = group.analysis?.sentiment ?? 'pendiente'
            const status = scoreLabel(scoreValue)
            return (
              <button className="account-row card-3d" key={group.jid} onClick={() => setSelectedJid(group.jid)}>
                <span className={`score-dot ${scoreColor(scoreValue)}`}>{scoreValue ?? '--'}</span>
                <span className="account-main">
                  <strong>{group.name}</strong>
                  <small>{group.analysis?.summary || 'Sin analisis diario guardado todavia.'}</small>
                </span>
                <span className="account-side">
                  <span className={`status-pill ${badgeClass(sentiment)}`}>{group.analysis ? status : 'Pendiente'}</span>
                  <small>{shortDate(group.last_message_at)}</small>
                </span>
              </button>
            )
          })}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="product-header">
        <div>
          <button className="back-button" onClick={() => setSelectedJid(null)}>
            Volver
          </button>
          <span className="eyebrow">Detalle</span>
          <h1>{selectedGroup.name}</h1>
          <p>{selectedHistory.length ? `${selectedHistory.length} dia(s) analizados en el historico` : 'Grupo pendiente de analisis diario.'}</p>
        </div>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Actualizar
        </button>
      </header>

      <nav className="client-tabs" aria-label="Secciones del cliente">
        <button className={clientTab === 'resumen' ? 'active' : ''} onClick={() => setClientTab('resumen')}>
          Resumen
        </button>
        <button className={clientTab === 'historico' ? 'active' : ''} onClick={() => setClientTab('historico')}>
          Historico
        </button>
        <button className={clientTab === 'mensajes' ? 'active' : ''} onClick={() => setClientTab('mensajes')}>
          Mensajes
        </button>
      </nav>

      {clientTab === 'resumen' && (
        <>
          <section className="detail-hero">
            <div className={`score-panel card-3d ${scoreColor(selectedScore)}`}>
              <span>{selectedScore ?? '--'}</span>
              <small>Ultimo score - {scoreLabel(selectedScore)}</small>
            </div>
            <div className="detail-summary card-3d">
              <div className="pill-row">
                <span className={`status-pill ${latestSelectedAnalysis ? badgeClass(latestSelectedAnalysis.sentiment) : 'yellow'}`}>
                  {latestSelectedAnalysis?.sentiment ?? 'pendiente'}
                </span>
                <span className={`status-pill ${badgeClass(selectedSatisfaction)}`}>{selectedSatisfaction}</span>
                <span className={`status-pill ${latestSelectedAnalysis ? badgeClass(latestSelectedAnalysis.risk_level) : 'yellow'}`}>
                  riesgo {latestSelectedAnalysis?.risk_level ?? 'pendiente'}
                </span>
              </div>
              <p>{selectedHistory.length ? `Resumen acumulado de ${selectedHistory.length} dia(s): ${selectedHistory.map((item) => item.summary).filter(Boolean).slice(-3).join(' ')}` : 'Este grupo existe en Supabase, pero todavia no tiene resumen guardado.'}</p>
            </div>
            <ScoreOrbit score={selectedScore} tone={scoreColor(selectedScore)} analyzed={Boolean(latestSelectedAnalysis)} />
          </section>

          <section className="detail-grid">
            <article className="focus-card card-3d">
              <div className="section-head">
                <h2>Compilado de tareas</h2>
                <span>{allActions.length}</span>
              </div>
              <div className="task-list">
                {allActions.length ? (
                  allActions.slice(-6).map((item, index) => (
                    <div className="task-item" key={index}>
                      <div className="task-title">
                        <strong>{actionText(item)}</strong>
                        <span className={`owner-type ${badgeClass(actionOwnerType(item))}`}>{actionOwnerType(item)}</span>
                      </div>
                      <small>{actionMeta(item)}</small>
                    </div>
                  ))
                ) : (
                  <p>No hay tareas acumuladas.</p>
                )}
              </div>
            </article>

            <article className="focus-card card-3d">
              <div className="section-head">
                <h2>Compilado de senales</h2>
                <span>{allPositiveSignals.length + allNegativeSignals.length}</span>
              </div>
              <SignalList title="A favor" items={allPositiveSignals.slice(-5)} tone="green" />
              <SignalList title="A revisar" items={allNegativeSignals.slice(-5)} tone="red" />
            </article>
          </section>
        </>
      )}

      {clientTab === 'historico' && (
        <section className="focus-card card-3d">
          <div className="section-head">
            <h2>Historico de puntos</h2>
            <span>{selectedHistory.length} dias</span>
          </div>
          <ScoreGraph items={selectedHistory} selectedId={selectedHistoryId} onSelect={setSelectedHistoryId} />
          <div className="timeline">
            {selectedHistory.length ? (
              selectedHistory.map((item) => (
                <button className={`timeline-item ${selectedHistoryId === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedHistoryId(item.id)}>
                  <div className={`timeline-score ${scoreColor(item.new_score)}`}>{item.new_score ?? '--'}</div>
                  <div>
                    <header>
                      <strong>{item.analysis_date}</strong>
                      <span className={item.score_delta >= 0 ? 'green' : 'red'}>
                        {item.score_delta > 0 ? '+' : ''}
                        {item.score_delta}
                      </span>
                    </header>
                    <p>{item.summary || 'Sin resumen guardado.'}</p>
                  </div>
                </button>
              ))
            ) : (
              <p>No hay historico guardado para esta cuenta todavia.</p>
            )}
          </div>
          {selectedDayAnalysis && (
            <div className="day-detail">
              <div className="section-head">
                <div>
                  <h2>Detalle del dia</h2>
                  <p>{selectedDayAnalysis.analysis_date}</p>
                </div>
                <span className={selectedDayAnalysis.score_delta >= 0 ? 'green' : 'red'}>
                  {selectedDayAnalysis.score_delta > 0 ? '+' : ''}
                  {selectedDayAnalysis.score_delta}
                </span>
              </div>
              <p className="day-summary">{selectedDayAnalysis.summary || 'Sin resumen guardado.'}</p>
              <div className="detail-grid day-grid">
                <article>
                  <h3>Tareas</h3>
                  <div className="task-list">
                    {actionItems.length ? (
                      actionItems.map((item, index) => (
                        <div className="task-item" key={index}>
                          <div className="task-title">
                            <strong>{actionText(item)}</strong>
                            <span className={`owner-type ${badgeClass(actionOwnerType(item))}`}>{actionOwnerType(item)}</span>
                          </div>
                          <small>{actionMeta(item)}</small>
                        </div>
                      ))
                    ) : (
                      <p>No hay tareas detectadas.</p>
                    )}
                  </div>
                </article>
                <article>
                  <h3>Senales</h3>
                  <SignalList title="A favor" items={positiveSignals} tone="green" />
                  <SignalList title="A revisar" items={negativeSignals} tone="red" />
                </article>
              </div>
              <button className="secondary-button" onClick={() => setMessagesOpen((open) => !open)}>
                {messagesOpen ? 'Ocultar mensajes' : `Ver ${detailLoading ? '' : detailMessages.length} mensajes del dia`}
              </button>
              {messagesOpen && (
                <div className="message-feed">
                  {detailMessages.slice(0, 12).map((message) => (
                    <article className="chat-message" key={message.id}>
                      <header>
                        <strong>{message.push_name || message.author || 'Sin autor'}</strong>
                        <time>{shortDate(message.sent_at)}</time>
                      </header>
                      <p>{message.body || '(sin texto)'}</p>
                      <span>{message.msg_type}</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {clientTab === 'mensajes' && (
      <section className="focus-card card-3d">
        <div className="section-head collapsible-head">
          <div>
            <h2>Mensajes</h2>
            <p>Conversacion cruda disponible para auditoria.</p>
          </div>
          <button className="secondary-button" onClick={() => setMessagesOpen((open) => !open)}>
            {messagesOpen ? 'Ocultar' : `Ver ${detailLoading ? '' : detailMessages.length} mensajes`}
          </button>
        </div>
        {messagesOpen && (
          <div className="message-feed">
            {detailMessages.slice(0, 12).map((message) => (
              <article className="chat-message" key={message.id}>
                <header>
                  <strong>{message.push_name || message.author || 'Sin autor'}</strong>
                  <time>{shortDate(message.sent_at)}</time>
                </header>
                <p>{message.body || '(sin texto)'}</p>
                <span>{message.msg_type}</span>
              </article>
            ))}
          </div>
        )}
      </section>
      )}
    </main>
  )
}

function ScoreGraph({ items, selectedId, onSelect }: { items: DailyAnalysis[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const width = 760
  const height = 180
  const padding = 22
  const points = items.map((item, index) => {
    const score = Number(item.new_score ?? 0)
    const x = items.length <= 1 ? width / 2 : padding + (index * (width - padding * 2)) / (items.length - 1)
    const y = height - padding - (score / 100) * (height - padding * 2)
    return { x, y, score, date: item.analysis_date, id: item.id }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <div className="score-graph" aria-label="Grafica historica de puntos">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="scoreLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#1F8F7C" />
            <stop offset="55%" stopColor="#B8841C" />
            <stop offset="100%" stopColor="#B43A3A" />
          </linearGradient>
        </defs>
        <line className="grid-line" x1={padding} x2={width - padding} y1={padding} y2={padding} />
        <line className="grid-line" x1={padding} x2={width - padding} y1={height / 2} y2={height / 2} />
        <line className="grid-line" x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        {path && <path className="score-path" d={path} />}
        {points.map((point) => (
          <g className="score-point-hit" key={point.id} onClick={() => onSelect(point.id)}>
            <circle className={`score-point ${scoreColor(point.score)} ${selectedId === point.id ? 'active' : ''}`} cx={point.x} cy={point.y} r="6" />
            <text x={point.x} y={point.y - 12} textAnchor="middle">
              {point.score}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function ScoreOrbit({ score, tone, analyzed }: { score: number | null; tone: string; analyzed: boolean }) {
  return (
    <aside className={`score-orbit ${tone}`} aria-label="Visualizacion 3D del estado">
      <div className="orbit-stage">
        <div className="orbit-ring one" />
        <div className="orbit-ring two" />
        <div className="orbit-core">
          <span>{score ?? '--'}</span>
        </div>
        <i className="satellite a" />
        <i className="satellite b" />
        <i className="satellite c" />
      </div>
      <strong>{analyzed ? 'Analisis activo' : 'Pendiente'}</strong>
      <small>{score == null ? 'Sin score historico' : 'Score vivo desde Supabase'}</small>
    </aside>
  )
}

function MetricCard({ label, value, detail, tone = 'gray' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className="metric-card card-3d">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function SignalList({ title, items, tone }: { title: string; items: unknown[]; tone: 'green' | 'red' }) {
  return (
    <div className="signal-list">
      <h3>{title}</h3>
      {items.length ? (
        items.map((item, index) => (
          <p className={tone} key={index}>
            {String(item)}
          </p>
        ))
      ) : (
        <p>Sin registros.</p>
      )}
    </div>
  )
}
