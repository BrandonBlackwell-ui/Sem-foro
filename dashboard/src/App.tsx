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

type GroupRollup = {
  key: string
  group_jid: string
  group_name: string
  account_id: string
  message_count: number
  last_message_at: string
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

export default function App() {
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [score, setScore] = useState<AccountScore | null>(null)
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [rawMessages, setRawMessages] = useState<WaMessage[]>([])
  const [groups, setGroups] = useState<WaGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const analyses = await supabaseGet<DailyAnalysis[]>(
          '/rest/v1/wa_daily_analysis?select=*&order=analyzed_at.desc&limit=1',
        )
        const latest = analyses[0] ?? null
        setAnalysis(latest)

        const [scoreRows, groupRows, rawRows] = await Promise.all([
          latest
            ? supabaseGet<AccountScore[]>(
                `/rest/v1/wa_account_scores?select=*&account_id=eq.${encodeURIComponent(latest.account_id)}&limit=1`,
              )
            : Promise.resolve([]),
          supabaseGet<WaGroup[]>('/rest/v1/wa_groups?select=jid,name,account_id,active&order=account_id.asc'),
          supabaseGet<WaMessage[]>(
            '/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&order=sent_at.desc&limit=500',
          ),
        ])

        setScore(scoreRows[0] ?? null)
        setGroups(groupRows)
        setRawMessages(rawRows)

        if (latest) {
          const start = new Date(`${latest.analysis_date}T00:00:00-06:00`)
          const end = new Date(start)
          end.setDate(end.getDate() + 1)
          const startIsoDate = start.toISOString()
          const endIsoDate = end.toISOString()
          const messageRows = await supabaseGet<WaMessage[]>(
            `/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,body,msg_type,sent_at&group_jid=eq.${encodeURIComponent(latest.group_jid)}&sent_at=gte.${encodeURIComponent(startIsoDate)}&sent_at=lt.${encodeURIComponent(endIsoDate)}&order=sent_at.asc`,
          )
          setMessages(messageRows)
        } else {
          setMessages([])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const rawGroups = useMemo<GroupRollup[]>(() => {
    const map = new Map<string, GroupRollup>()
    for (const message of rawMessages) {
      const key = message.group_jid || 'unknown'
      const current = map.get(key)
      if (current) {
        current.message_count += 1
        if (message.sent_at > current.last_message_at) current.last_message_at = message.sent_at
      } else {
        map.set(key, {
          key,
          group_jid: key,
          group_name: message.group_name || 'Sin nombre',
          account_id: message.account_id || 'Sin cuenta',
          message_count: 1,
          last_message_at: message.sent_at,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
  }, [rawMessages])

  const satisfaction = analysis ? normalizeSatisfaction(analysis.satisfaction) : 'unknown'

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

  return (
    <main className="real-shell">
      <header className="real-header">
        <div>
          <div className="real-kicker">Semaforo WhatsApp</div>
          <h1>Analisis real desde Supabase</h1>
          <p>Sin datos estaticos: analisis, score, grupos y mensajes vienen de Supabase.</p>
        </div>
        <button className="real-button" onClick={() => window.location.reload()}>
          Actualizar
        </button>
      </header>

      {!analysis ? (
        <section className="real-card">
          <h2>No hay analisis guardado</h2>
          <p>Cuando exista una fila en wa_daily_analysis, aparecera aqui.</p>
        </section>
      ) : (
        <>
          <section className="real-grid metrics">
            <div className="real-card">
              <span className="real-label">Grupo analizado</span>
              <strong>{analysis.group_name || analysis.group_jid}</strong>
              <small>{analysis.group_jid}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Score actual</span>
              <strong className={`score ${scoreColor(score?.current_score)}`}>{score?.current_score ?? analysis.new_score ?? '-'}</strong>
              <small>Delta total: {score?.total_delta ?? analysis.score_delta}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Delta del dia</span>
              <strong className={analysis.score_delta >= 0 ? 'score green' : 'score red'}>
                {analysis.score_delta > 0 ? '+' : ''}
                {analysis.score_delta}
              </strong>
              <small>{analysis.analysis_date}</small>
            </div>
            <div className="real-card">
              <span className="real-label">Mensajes analizados</span>
              <strong>{analysis.message_count}</strong>
              <small>{fmtDate(analysis.analyzed_at)}</small>
            </div>
          </section>

          <section className="real-grid split">
            <article className="real-card">
              <div className="section-head">
                <h2>Analisis Claude</h2>
                <span className="real-pill">{analysis.model || 'Sin modelo'}</span>
              </div>
              <div className="pill-row">
                <span className={`real-pill ${badgeClass(analysis.sentiment)}`}>{analysis.sentiment}</span>
                <span className={`real-pill ${badgeClass(satisfaction)}`}>{satisfaction}</span>
                <span className={`real-pill ${badgeClass(analysis.risk_level)}`}>riesgo {analysis.risk_level}</span>
              </div>
              <p className="summary">{analysis.summary || 'Sin resumen'}</p>
            </article>

            <article className="real-card">
              <h2>Tareas detectadas</h2>
              <div className="item-list">
                {asArray(analysis.action_items).length ? (
                  asArray(analysis.action_items).map((item, index) => (
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
            <SignalCard title="Senales positivas" items={asArray(analysis.positive_signals)} tone="green" />
            <SignalCard title="Senales negativas" items={asArray(analysis.negative_signals)} tone="red" />
          </section>

          <section className="real-card">
            <h2>Evidencia</h2>
            <div className="item-list evidence">
              {asArray(analysis.evidence).length ? (
                asArray(analysis.evidence).map((item, index) => (
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
          <h2>Mensajes crudos del grupo analizado</h2>
          <span className="real-pill">{messages.length} filas</span>
        </div>
        <div className="message-table">
          {messages.map((message) => (
            <div className="message-row" key={message.id}>
              <time>{fmtDate(message.sent_at)}</time>
              <strong>{message.push_name || message.author || 'Sin autor'}</strong>
              <span>{message.msg_type}</span>
              <p>{message.body || '(sin texto)'}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="real-grid split">
        <article className="real-card">
          <div className="section-head">
            <h2>Grupos desde wa_messages</h2>
            <span className="real-pill">{rawGroups.length} grupos</span>
          </div>
          <div className="item-list">
            {rawGroups.map((group) => (
              <div className="list-item compact" key={group.key}>
                <strong>{group.group_name}</strong>
                <small>{group.account_id} - {group.message_count} mensajes recientes - {fmtDate(group.last_message_at)}</small>
                <code>{group.group_jid}</code>
              </div>
            ))}
          </div>
        </article>

        <article className="real-card">
          <div className="section-head">
            <h2>Mapeo wa_groups</h2>
            <span className="real-pill">{groups.length} grupos</span>
          </div>
          <div className="item-list">
            {groups.map((group) => (
              <div className="list-item compact" key={group.jid}>
                <strong>{group.name}</strong>
                <small>{group.account_id} - {group.active ? 'activo' : 'inactivo'}</small>
                <code>{group.jid}</code>
              </div>
            ))}
          </div>
        </article>
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
