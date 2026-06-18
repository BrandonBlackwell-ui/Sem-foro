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
  if (['positive', 'satisfied', 'low', 'estable'].includes(normalized)) return 'green'
  if (['neutral', 'unknown', 'mixed', 'medium', 'pendiente'].includes(normalized)) return 'yellow'
  if (['negative', 'unsatisfied', 'high', 'atencion'].includes(normalized)) return 'red'
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

export default function App() {
  const [analyses, setAnalyses] = useState<DailyAnalysis[]>([])
  const [scores, setScores] = useState<AccountScore[]>([])
  const [rawMessages, setRawMessages] = useState<WaMessage[]>([])
  const [detailMessages, setDetailMessages] = useState<WaMessage[]>([])
  const [groups, setGroups] = useState<WaGroup[]>([])
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
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
      const analysis = latestAnalysisByGroup.get(group.jid) ?? null
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
        const analysis = latestAnalysisByGroup.get(jid) ?? null
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
  }, [groups, latestAnalysisByGroup, rawMessages, scoreByAccount])

  const selectedGroup = selectedJid ? groupSummaries.find((group) => group.jid === selectedJid) ?? null : null
  const selectedAnalysis = selectedGroup?.analysis ?? null
  const selectedScore = selectedGroup?.score?.current_score ?? selectedAnalysis?.new_score ?? null
  const selectedSatisfaction = selectedAnalysis ? normalizeSatisfaction(selectedAnalysis.satisfaction) : 'unknown'
  const selectedHistory = useMemo(() => {
    if (!selectedGroup) return []
    return analyses
      .filter((analysis) => analysis.group_jid === selectedGroup.jid)
      .sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))
  }, [analyses, selectedGroup])
  const actionItems = selectedAnalysis ? asArray(selectedAnalysis.action_items) : []
  const positiveSignals = selectedAnalysis ? asArray(selectedAnalysis.positive_signals) : []
  const negativeSignals = selectedAnalysis ? asArray(selectedAnalysis.negative_signals) : []

  useEffect(() => {
    async function loadDetailMessages() {
      if (!selectedGroup) {
        setDetailMessages([])
        return
      }

      setDetailLoading(true)
      try {
        if (selectedAnalysis) {
          const { startIso, endIso } = dayWindowUtc(selectedAnalysis.analysis_date)
          const rows = await supabaseGet<WaMessage[]>(
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(selectedAnalysis.group_jid)}&sent_at=gte.${encodeURIComponent(startIso)}&sent_at=lt.${encodeURIComponent(endIso)}&order=sent_at.asc`,
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
  }, [selectedAnalysis, selectedGroup])

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

        <section className="account-list" aria-label="Cuentas de WhatsApp">
          {groupSummaries.map((group) => {
            const scoreValue = group.score?.current_score ?? group.analysis?.new_score ?? null
            const sentiment = group.analysis?.sentiment ?? 'pendiente'
            const status = scoreLabel(scoreValue)
            return (
              <button className="account-row" key={group.jid} onClick={() => setSelectedJid(group.jid)}>
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
          <p>{selectedAnalysis ? `Analisis del ${selectedAnalysis.analysis_date}` : 'Grupo pendiente de analisis diario.'}</p>
        </div>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Actualizar
        </button>
      </header>

      <section className="detail-hero">
        <div className={`score-panel ${scoreColor(selectedScore)}`}>
          <span>{selectedScore ?? '--'}</span>
          <small>{scoreLabel(selectedScore)}</small>
        </div>
        <div className="detail-summary">
          <div className="pill-row">
            <span className={`status-pill ${selectedAnalysis ? badgeClass(selectedAnalysis.sentiment) : 'yellow'}`}>
              {selectedAnalysis?.sentiment ?? 'pendiente'}
            </span>
            <span className={`status-pill ${badgeClass(selectedSatisfaction)}`}>{selectedSatisfaction}</span>
            <span className={`status-pill ${selectedAnalysis ? badgeClass(selectedAnalysis.risk_level) : 'yellow'}`}>
              riesgo {selectedAnalysis?.risk_level ?? 'pendiente'}
            </span>
          </div>
          <p>{selectedAnalysis?.summary || 'Este grupo existe en Supabase, pero todavia no tiene resumen guardado.'}</p>
        </div>
      </section>

      <section className="focus-card">
        <div className="section-head">
          <h2>Progreso historico</h2>
          <span>{selectedHistory.length} dias</span>
        </div>
        <div className="timeline">
          {selectedHistory.length ? (
            selectedHistory.map((item) => (
              <article className="timeline-item" key={item.id}>
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
              </article>
            ))
          ) : (
            <p>No hay historico guardado para esta cuenta todavia.</p>
          )}
        </div>
      </section>

      <section className="detail-grid">
        <article className="focus-card">
          <div className="section-head">
            <h2>Tareas</h2>
            <span>{actionItems.length}</span>
          </div>
          <div className="task-list">
            {actionItems.length ? (
              actionItems.map((item, index) => (
                <div className="task-item" key={index}>
                  <strong>{actionText(item)}</strong>
                  <small>{actionMeta(item)}</small>
                </div>
              ))
            ) : (
              <p>No hay tareas detectadas.</p>
            )}
          </div>
        </article>

        <article className="focus-card">
          <div className="section-head">
            <h2>Senales</h2>
            <span>{positiveSignals.length + negativeSignals.length}</span>
          </div>
          <SignalList title="A favor" items={positiveSignals} tone="green" />
          <SignalList title="A revisar" items={negativeSignals} tone="red" />
        </article>
      </section>

      <section className="focus-card">
        <div className="section-head">
          <h2>Mensajes</h2>
          <span>{detailLoading ? 'cargando' : `${detailMessages.length}`}</span>
        </div>
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
      </section>
    </main>
  )
}

function MetricCard({ label, value, detail, tone = 'gray' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className="metric-card">
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
