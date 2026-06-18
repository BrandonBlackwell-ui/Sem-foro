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

function fmtDate(value: string | null | undefined) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function badgeClass(value: string) {
  const normalized = value.toLowerCase()
  if (['positive', 'satisfied', 'low'].includes(normalized)) return 'green'
  if (['neutral', 'unknown', 'mixed', 'medium'].includes(normalized)) return 'yellow'
  if (['negative', 'unsatisfied', 'high'].includes(normalized)) return 'red'
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

function dayWindowUtc(date: string) {
  const start = new Date(`${date}T00:00:00-06:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
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
  const selectedSatisfaction = selectedAnalysis ? normalizeSatisfaction(selectedAnalysis.satisfaction) : 'unknown'

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
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(selectedGroup.jid)}&order=sent_at.desc&limit=50`,
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
    const activeCount = groupSummaries.filter((group) => group.active).length
    const scoredCount = groupSummaries.filter((group) => group.score).length

    return (
      <main className="real-shell">
        <header className="real-header">
          <div>
            <div className="real-kicker">Semaforo WhatsApp</div>
            <h1>Cuentas y grupos</h1>
            <p>Selecciona un grupo para abrir su resumen, tareas, senales y mensajes crudos desde Supabase.</p>
          </div>
          <button className="real-button" onClick={() => window.location.reload()}>
            Actualizar
          </button>
        </header>

        <section className="real-grid metrics">
          <div className="real-card">
            <span className="real-label">Grupos detectados</span>
            <strong>{groupSummaries.length}</strong>
            <small>{activeCount} activos en wa_groups</small>
          </div>
          <div className="real-card">
            <span className="real-label">Con analisis</span>
            <strong>{analyzedCount}</strong>
            <small>{analyses.length} analisis guardados</small>
          </div>
          <div className="real-card">
            <span className="real-label">Con puntaje</span>
            <strong>{scoredCount}</strong>
            <small>{scores.length} cuentas con score</small>
          </div>
          <div className="real-card">
            <span className="real-label">Mensajes recientes</span>
            <strong>{rawMessages.length}</strong>
            <small>Ultimos registros leidos</small>
          </div>
        </section>

        <section className="account-grid">
          {groupSummaries.map((group) => {
            const scoreValue = group.score?.current_score ?? group.analysis?.new_score ?? null
            const sentiment = group.analysis?.sentiment ?? 'sin analisis'
            return (
              <button className="account-card" key={group.jid} onClick={() => setSelectedJid(group.jid)}>
                <div className="account-card-top">
                  <span className={`score-badge ${scoreColor(scoreValue)}`}>{scoreValue ?? '--'}</span>
                  <span className={`real-pill ${group.analysis ? badgeClass(sentiment) : 'gray'}`}>{sentiment}</span>
                </div>
                <strong>{group.name}</strong>
                <small>{group.account_id}</small>
                <div className="account-meta">
                  <span>{group.message_count} mensajes recientes</span>
                  <span>{group.analysis ? group.analysis.analysis_date : 'pendiente'}</span>
                </div>
                <p>{group.analysis?.summary || 'Este grupo aun no tiene analisis diario guardado en Supabase.'}</p>
              </button>
            )
          })}
        </section>
      </main>
    )
  }

  return (
    <main className="real-shell">
      <header className="real-header">
        <div>
          <button className="back-button" onClick={() => setSelectedJid(null)}>
            Volver a cuentas
          </button>
          <div className="real-kicker">Detalle de grupo</div>
          <h1>{selectedGroup.name}</h1>
          <p>{selectedGroup.jid}</p>
        </div>
        <button className="real-button" onClick={() => window.location.reload()}>
          Actualizar
        </button>
      </header>

      {!selectedAnalysis ? (
        <section className="real-card">
          <h2>Sin analisis guardado</h2>
          <p>Este grupo existe en Supabase, pero todavia no tiene una fila en wa_daily_analysis.</p>
        </section>
      ) : (
        <>
          <section className="real-grid metrics">
            <div className="real-card">
              <span className="real-label">Cuenta</span>
              <strong>{selectedAnalysis.group_name || selectedGroup.name}</strong>
              <small>{selectedAnalysis.account_id}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Score actual</span>
              <strong className={`score ${scoreColor(selectedGroup.score?.current_score)}`}>
                {selectedGroup.score?.current_score ?? selectedAnalysis.new_score ?? '-'}
              </strong>
              <small>Delta total: {selectedGroup.score?.total_delta ?? selectedAnalysis.score_delta}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Delta del dia</span>
              <strong className={selectedAnalysis.score_delta >= 0 ? 'score green' : 'score red'}>
                {selectedAnalysis.score_delta > 0 ? '+' : ''}
                {selectedAnalysis.score_delta}
              </strong>
              <small>{selectedAnalysis.analysis_date}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Mensajes analizados</span>
              <strong>{selectedAnalysis.message_count}</strong>
              <small>{fmtDate(selectedAnalysis.analyzed_at)}</small>
            </div>
          </section>

          <section className="real-grid split">
            <article className="real-card">
              <div className="section-head">
                <h2>Analisis Claude</h2>
                <span className="real-pill">{selectedAnalysis.model || 'Sin modelo'}</span>
              </div>
              <div className="pill-row">
                <span className={`real-pill ${badgeClass(selectedAnalysis.sentiment)}`}>{selectedAnalysis.sentiment}</span>
                <span className={`real-pill ${badgeClass(selectedSatisfaction)}`}>{selectedSatisfaction}</span>
                <span className={`real-pill ${badgeClass(selectedAnalysis.risk_level)}`}>riesgo {selectedAnalysis.risk_level}</span>
              </div>
              <p className="summary">{selectedAnalysis.summary || 'Sin resumen'}</p>
            </article>

            <article className="real-card">
              <h2>Tareas detectadas</h2>
              <div className="item-list">
                {asArray(selectedAnalysis.action_items).length ? (
                  asArray(selectedAnalysis.action_items).map((item, index) => (
                    <div className="list-item" key={index}>
                      <strong>{isRecord(item) ? fieldText(item.action, JSON.stringify(item)) : String(item)}</strong>
                      <small>
                        {isRecord(item) ? fieldText(item.owner, 'Sin responsable') : 'Sin responsable'} -{' '}
                        {isRecord(item) ? fieldText(item.urgency, 'sin urgencia') : 'sin urgencia'}
                      </small>
                    </div>
                  ))
                ) : (
                  <p>No hay tareas detectadas.</p>
                )}
              </div>
            </article>
          </section>

          <section className="real-grid split">
            <SignalCard title="Senales positivas" items={asArray(selectedAnalysis.positive_signals)} tone="green" />
            <SignalCard title="Senales negativas" items={asArray(selectedAnalysis.negative_signals)} tone="red" />
          </section>

          <section className="real-card">
            <h2>Evidencia</h2>
            <div className="item-list evidence">
              {asArray(selectedAnalysis.evidence).length ? (
                asArray(selectedAnalysis.evidence).map((item, index) => (
                  <div className="list-item" key={index}>
                    <strong>{isRecord(item) ? fieldText(item.quote, JSON.stringify(item)) : String(item)}</strong>
                    <small>{isRecord(item) ? fieldText(item.why_it_matters) : ''}</small>
                  </div>
                ))
              ) : (
                <p>Sin evidencia estructurada.</p>
              )}
            </div>
          </section>
        </>
      )}

      <section className="real-card">
        <div className="section-head">
          <h2>Mensajes crudos del grupo</h2>
          <span className="real-pill">{detailLoading ? 'cargando' : `${detailMessages.length} filas`}</span>
        </div>
        <div className="message-table">
          {detailMessages.map((message) => (
            <div className="message-row" key={message.id}>
              <time>{fmtDate(message.sent_at)}</time>
              <strong>{message.push_name || message.author || 'Sin autor'}</strong>
              <span>{message.msg_type}</span>
              <p>{message.body || '(sin texto)'}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function SignalCard({ title, items, tone }: { title: string; items: unknown[]; tone: 'green' | 'red' }) {
  return (
    <article className="real-card">
      <h2>{title}</h2>
      <div className="item-list">
        {items.length ? (
          items.map((item, index) => (
            <div className={`list-item ${tone}`} key={index}>
              <strong>{String(item)}</strong>
            </div>
          ))
        ) : (
          <p>Sin senales.</p>
        )}
      </div>
    </article>
  )
}
