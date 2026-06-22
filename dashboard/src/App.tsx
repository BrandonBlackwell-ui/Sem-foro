import React, { useEffect, useMemo, useState } from 'react'

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

type WaTask = {
  id: number
  analysis_id: number | null
  account_id: string
  group_jid: string | null
  group_name: string | null
  analysis_date: string
  action: string
  owner: string | null
  owner_type: string | null
  urgency: string | null
  due_date: string | null
  work_type: string | null
  client_label: string | null
  evidence_speaker: string | null
  evidence_quote: string | null
  evidence_reason: string | null
  monday_item_id: string | null
  monday_item_name: string | null
  monday_created_at: string | null
  monday_status: string | null
  monday_due_date: string | null
  monday_responsible_text: string | null
  monday_work_type: string | null
  monday_client_label: string | null
  monday_updated_at: string | null
  last_synced_to_monday_at: string | null
  last_synced_from_monday_at: string | null
  raw_action: unknown
  raw_monday: unknown
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZ2ZrZnZ5d2JwamxkcmV1cGxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjEwNDMsImV4cCI6MjA5NzA5NzA0M30.wR9_YXMi2udYsVNLY8SlPFwpxkqZ3j78hv961ShBkQk'

async function supabasePatch(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
}

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
  const [tasks, setTasks] = useState<WaTask[]>([])
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const [selectedOverviewDate] = useState<string>('latest')
  const [groupFilter, setGroupFilter] = useState<'all' | 'analyzed' | 'active' | 'inactive'>('all')
  const [deletedTasks, setDeletedTasks] = useState<WaTask[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
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
            '/rest/v1/wa_messages?select=id,account_id,group_name,group_jid,push_name,author,speaker_label,speaker_team,body,msg_type,sent_at&order=sent_at.desc&limit=500',
          ),
        ])
        // Sync with Monday first — archives tasks deleted from Monday
        await fetch('/api/monday-sync').catch(() => {})

        const taskRows = await supabaseGet<WaTask[]>(
          '/rest/v1/wa_tasks?select=*&order=updated_at.desc&limit=500&deleted_at=is.null',
        ).catch(() => [])

        setAnalyses(analysisRows)
        setScores(scoreRows)
        setGroups(groupRows)
        setRawMessages(rawRows)
        setTasks(taskRows)
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

  async function archiveTask(id: number) {
    await supabasePatch(`/rest/v1/wa_tasks?id=eq.${id}`, { deleted_at: new Date().toISOString() })
    setTasks(prev => prev.filter(t => t.id !== id))
  }
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
  const selectedTasks = selectedGroup ? tasks.filter((task) => task.group_jid === selectedGroup.jid) : []
  const allActions = selectedTasks.length ? selectedTasks : selectedHistory.flatMap((analysis) => asArray(analysis.action_items))
  const allPositiveSignals = selectedHistory.flatMap((analysis) => asArray(analysis.positive_signals))
  const allNegativeSignals = selectedHistory.flatMap((analysis) => asArray(analysis.negative_signals))
  const activeDayTasks = activeDayAnalysis
    ? selectedTasks.filter((task) => task.analysis_id === activeDayAnalysis.id || task.analysis_date === activeDayAnalysis.analysis_date)
    : []
  const actionItems = activeDayTasks.length ? activeDayTasks : activeDayAnalysis ? asArray(activeDayAnalysis.action_items) : []
  const positiveSignals = activeDayAnalysis ? asArray(activeDayAnalysis.positive_signals) : []
  const negativeSignals = activeDayAnalysis ? asArray(activeDayAnalysis.negative_signals) : []

  useEffect(() => {
    setMessagesOpen(false)
    setClientTab('resumen')
    setSelectedHistoryId(null)
    setShowDeleted(false)
    setDeletedTasks([])
  }, [selectedJid])

  useEffect(() => {
    if (!showDeleted || !selectedGroup) return
    supabaseGet<WaTask[]>(
      `/rest/v1/wa_tasks?select=*&group_jid=eq.${encodeURIComponent(selectedGroup.jid)}&deleted_at=not.is.null&order=deleted_at.desc&limit=100`
    ).then(setDeletedTasks).catch(() => {})
  }, [showDeleted, selectedGroup])

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

  if (!selectedGroup) {
    const analyzedCount = groupSummaries.filter((group) => group.analysis).length
    const todayStr = todayMexicoStr()
    // Groups with messages today but no analysis yet (analyzer hasn't run for them yet)
    const pendingAnalysis = groupSummaries.filter((g) => !g.analysis && g.last_message_at && g.last_message_at.slice(0,10) >= todayStr)
    // Groups with no messages at all recently (truly quiet)
    const trulyQuiet = groupSummaries.filter((g) => !g.analysis && (!g.last_message_at || g.last_message_at.slice(0,10) < todayStr))
    const averageScore = scores.length
      ? Math.round(scores.reduce((total, score) => total + score.current_score, 0) / scores.length)
      : null

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
                  <p className="lb-subtext">Vista rápida de salud, actividad y análisis diario por grupo.</p>
                </div>
                <div className="lb-header-actions">
                  <button className="lb-btn-solid" onClick={() => window.location.reload()}>Actualizar</button>
                </div>
              </div>

              {/* Post-it stats */}
              <div className="lb-stats-row">
                <div className="lb-postit lb-postit-green" style={{animationDelay:'0ms'}}>
                  <div className="lb-postit-label">Score promedio</div>
                  <div className="lb-postit-value" style={{color: averageScore && averageScore >= 85 ? '#3f7050' : averageScore && averageScore >= 70 ? '#b07d1e' : '#a8453b'}}>{averageScore ?? '--'}</div>
                  <div className="lb-postit-detail">{averageScore ? scoreLabel(averageScore) : 'Sin puntajes'}</div>
                </div>
                <div className="lb-postit lb-postit-yellow" style={{animationDelay:'80ms', cursor:'pointer', outline: groupFilter === 'analyzed' ? '2px solid #b07d1e' : 'none', outlineOffset:3}} onClick={() => setGroupFilter(f => f === 'analyzed' ? 'all' : 'analyzed')}>
                  <div className="lb-postit-label">Analizados hoy {groupFilter === 'analyzed' && <span style={{fontSize:13}}>✕</span>}</div>
                  <div className="lb-postit-value" style={{color:'#b07d1e'}}>{analyzedCount}<span style={{fontSize:24,fontWeight:400}}> / {groupSummaries.length}</span></div>
                  <div className="lb-postit-detail" style={{color:'#8a6010'}}>
                    {pendingAnalysis.length > 0 ? `${pendingAnalysis.length} con mensajes, esperando análisis` : 'Todos los activos revisados'} · <em>clic para filtrar</em>
                  </div>
                </div>
                <div className="lb-postit lb-postit-blue" style={{animationDelay:'160ms', cursor:'pointer', outline: groupFilter === 'inactive' ? '2px solid #3a6ea5' : 'none', outlineOffset:3}} onClick={() => setGroupFilter(f => f === 'inactive' ? 'all' : 'inactive')}>
                  <div className="lb-postit-label">Sin mensajes recientes {groupFilter === 'inactive' && <span style={{fontSize:13}}>✕</span>}</div>
                  <div className="lb-postit-value" style={{color:'#1a4a7a'}}>{trulyQuiet.length}</div>
                  <div className="lb-postit-detail" style={{color:'#3a5a8a'}}>sin mensajes en días previos · <em>clic para filtrar</em></div>
                </div>
              </div>


              {/* Account list */}
              {groupFilter !== 'all' && (
                <div style={{display:'flex', alignItems:'center', gap:10, margin:'8px 0 4px', padding:'8px 14px', background: groupFilter === 'analyzed' ? 'rgba(176,125,30,.10)' : 'rgba(58,110,165,.10)', borderRadius:8}}>
                  <span style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:13, fontWeight:600, color: groupFilter === 'analyzed' ? '#8a6010' : '#3a5a8a'}}>
                    {groupFilter === 'analyzed'
                      ? `Mostrando ${analyzedCount} grupos analizados hoy`
                      : `Mostrando ${trulyQuiet.length} grupos sin mensajes recientes`}
                  </span>
                  <button onClick={() => setGroupFilter('all')} style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:12, color:'#9aa0a6', background:'none', border:'1px solid #ccc', borderRadius:999, padding:'2px 10px', cursor:'pointer'}}>Ver todos</button>
                </div>
              )}
              <div className="lb-account-list">
                {groupSummaries.filter(g => {
                  if (groupFilter === 'analyzed') return !!g.analysis
                  if (groupFilter === 'inactive') return !g.analysis && (!g.last_message_at || g.last_message_at.slice(0,10) < todayStr)
                  return true
                }).map((group, gi) => {
                  const scoreValue = group.score?.current_score ?? group.analysis?.new_score ?? null
                  const hasMsgsToday = !group.analysis && group.last_message_at && group.last_message_at.slice(0,10) >= todayStr
                  const status = group.analysis ? scoreLabel(scoreValue) : hasMsgsToday ? 'En proceso' : 'Pendiente'
                  const stampColor = group.analysis
                    ? (scoreValue != null && scoreValue >= 85 ? '#3f7050' : scoreValue != null && scoreValue >= 70 ? '#b07d1e' : '#a8453b')
                    : hasMsgsToday ? '#3a6ea5' : '#9aa0a6'
                  const r = 26
                  const circ = 2 * Math.PI * r
                  const offset = scoreValue != null ? circ * (1 - scoreValue / 100) : circ
                  return (
                    <button className="lb-account-row" key={group.jid} style={{borderLeft: `5px solid ${stampColor}`, animationDelay: `${gi * 40}ms`}} onClick={() => setSelectedJid(group.jid)}>
                      <div className="lb-score-ring">
                        <svg width="62" height="62" viewBox="0 0 62 62">
                          <circle cx="31" cy="31" r={r} fill="none" stroke="#e8e4d8" strokeWidth="5" />
                          <circle cx="31" cy="31" r={r} fill="none" stroke={stampColor} strokeWidth="5"
                            strokeDasharray={`${circ}`} strokeDashoffset={offset}
                            style={{transition:'stroke-dashoffset 1s ease', transform:'rotate(-90deg)', transformOrigin:'center'}} />
                        </svg>
                        <div className="lb-score-ring-val" style={{color: stampColor}}>{scoreValue ?? '--'}</div>
                      </div>
                      <div className="lb-account-main">
                        <div className="lb-account-name">{group.name}</div>
                        <div className="lb-account-summary">{group.analysis?.summary || 'Sin análisis diario guardado todavía.'}</div>
                      </div>
                      <div className="lb-account-side">
                        <span className="lb-stamp" style={{color: stampColor, borderColor: stampColor, '--sr': gi % 2 === 0 ? '-4deg' : '3deg'} as React.CSSProperties}>{status}</span>
                        <span className="lb-account-time">{shortDate(group.last_message_at)}</span>
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
          <button className="lb-back-btn" onClick={() => setSelectedJid(null)}>← Volver</button>
          <span className="lb-eyebrow">Detalle</span>
          <h1 className="lb-h2">{selectedGroup.name}</h1>
          <p className="lb-subtext">{selectedHistory.length ? `${selectedHistory.length} día(s) analizados en el histórico` : 'Grupo pendiente de análisis diario.'}</p>
        </div>
        <div className="lb-header-actions">
          <button className="lb-btn-solid" onClick={() => window.location.reload()}>Actualizar</button>
        </div>
      </div>

      <nav className="lb-tabs" aria-label="Secciones del cliente">
        <button className={`lb-tab${clientTab === 'resumen' ? ' active' : ''}`} onClick={() => setClientTab('resumen')}>Resumen</button>
        <button className={`lb-tab${clientTab === 'historico' ? ' active' : ''}`} onClick={() => setClientTab('historico')}>Histórico</button>
        <button className={`lb-tab${clientTab === 'mensajes' ? ' active' : ''}`} onClick={() => setClientTab('mensajes')}>Mensajes</button>
      </nav>

      {clientTab === 'resumen' && (
        <div className="lb-resumen" style={{marginTop:24}}>
          {/* Score + summary hero */}
          <div style={{display:'flex', gap:22, flexWrap:'wrap', alignItems:'flex-start'}}>
            <div className="lb-score-postit" style={{background: selectedScore != null && selectedScore >= 85 ? '#d4eedd' : selectedScore != null && selectedScore >= 70 ? '#fdf1ad' : '#fde8e6'}}>
              <div className="lb-score-postit-val" style={{color: selectedScore != null && selectedScore >= 85 ? '#3f7050' : selectedScore != null && selectedScore >= 70 ? '#b07d1e' : '#a8453b'}}>{selectedScore ?? '--'}</div>
              <div className="lb-score-postit-label">Último score · {scoreLabel(selectedScore)}</div>
              {latestSelectedAnalysis && (
                <div style={{marginTop:10, display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center'}}>
                  <span className={`lb-pill ${badgeClass(latestSelectedAnalysis.sentiment) === 'green' ? 'lb-pill-green' : badgeClass(latestSelectedAnalysis.sentiment) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{latestSelectedAnalysis.sentiment}</span>
                  <span className={`lb-pill ${badgeClass(selectedSatisfaction) === 'green' ? 'lb-pill-green' : badgeClass(selectedSatisfaction) === 'red' ? 'lb-pill-red' : 'lb-pill-amber'}`}>{selectedSatisfaction}</span>
                </div>
              )}
            </div>
            <div className="lb-summary-card" style={{flex:1}}>
              <div className="lb-section-title" style={{marginBottom:10}}>Resumen acumulado</div>
              <p className="lb-summary-text">
                {selectedHistory.length
                  ? selectedHistory.map((item) => item.summary).filter(Boolean).slice(-3).join(' ')
                  : 'Este grupo existe en Supabase, pero todavía no tiene resumen guardado.'}
              </p>
            </div>
          </div>

          {/* Tasks + signals grid */}
          <div className="lb-resumen-grid" style={{marginTop:28}}>
            <div>
              <div className="lb-section-head" style={{marginTop:0}}>
                <div className="lb-section-title">Compilado de tareas</div>
                <span className="lb-section-count">{allActions.length}</span>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                {allActions.length
                  ? allActions.slice(-6).map((item, index) => <TaskCard item={item} key={index} onArchive={archiveTask} />)
                  : <p className="lb-subtext">No hay tareas acumuladas.</p>}
              </div>

              {/* Deleted tasks history */}
              <div style={{marginTop:18, borderTop:'1px dashed #e6e2d6', paddingTop:14}}>
                <button
                  onClick={() => setShowDeleted(v => !v)}
                  style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:13, color:'#9aa0a6', background:'none', border:'1px dashed #d0ccc4', borderRadius:999, padding:'4px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                  <span style={{fontSize:16}}>🗑</span>
                  {showDeleted ? 'Ocultar eliminadas' : 'Ver tareas eliminadas de Monday'}
                </button>
                {showDeleted && (
                  <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:10}}>
                    {deletedTasks.length === 0
                      ? <p className="lb-subtext" style={{fontSize:13}}>No hay tareas eliminadas registradas para este grupo.</p>
                      : deletedTasks.map((item) => (
                        <div key={item.id} style={{opacity:0.65, position:'relative'}}>
                          <div style={{position:'absolute', top:8, right:10, fontFamily:"'Caveat',cursive", fontSize:14, color:'#a8453b', transform:'rotate(-2deg)', border:'1px solid #a8453b', borderRadius:4, padding:'1px 8px', background:'#fde8e6'}}>
                            Eliminada {item.deleted_at ? new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(item.deleted_at)) : ''}
                          </div>
                          <TaskCard item={item} />
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="lb-section-head" style={{marginTop:0}}>
                <div className="lb-section-title">Señales</div>
                <span className="lb-section-count">{allPositiveSignals.length + allNegativeSignals.length}</span>
              </div>
              <SignalList title="A favor" items={allPositiveSignals.slice(-5)} tone="green" />
              <SignalList title="A revisar" items={allNegativeSignals.slice(-5)} tone="red" />
            </div>
          </div>
        </div>
      )}

      {clientTab === 'historico' && (
        <div className="lb-historico">
          <div className="lb-section-head">
            <div className="lb-section-title">Histórico de puntos</div>
            <span className="lb-section-count">
              {selectedHistory.length > 0
                ? (() => {
                    const first = selectedHistory[0].analysis_date
                    const today = todayMexicoStr()
                    const ms = new Date(`${today}T12:00:00`).getTime() - new Date(`${first}T12:00:00`).getTime()
                    return Math.round(ms / 86400000) + 1
                  })()
                : 0} días
            </span>
          </div>
          <div className="lb-chart-wrap">
            <ScoreGraph items={selectedHistory} selectedId={selectedHistoryId} onSelect={setSelectedHistoryId} />
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:18}}>
            {selectedHistory.length
              ? selectedHistory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedHistoryId(item.id)}
                  style={{
                    display:'flex', gap:14, alignItems:'center', padding:'12px 16px',
                    background: selectedHistoryId === item.id ? '#fffdf0' : '#fff',
                    border: `1px solid ${selectedHistoryId === item.id ? '#d4c87a' : '#ece9e0'}`,
                    borderRadius:8, cursor:'pointer', textAlign:'left', transition:'all .12s'
                  }}>
                  <div style={{width:42, height:42, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', background: item.new_score != null && item.new_score >= 85 ? '#d4eedd' : item.new_score != null && item.new_score >= 70 ? '#fdf1ad' : '#fde8e6', fontFamily:"'Libre Franklin',sans-serif", fontWeight:800, fontSize:14, color: item.new_score != null && item.new_score >= 85 ? '#3f7050' : item.new_score != null && item.new_score >= 70 ? '#b07d1e' : '#a8453b', flexShrink:0}}>{item.new_score ?? '--'}</div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <div>
                        <span style={{fontFamily:"'Caveat',cursive", fontSize:20, fontWeight:700, color:'#1d1d1f'}}>{fmtShortDate(item.analysis_date)}</span>
                        <span style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:11, color:'#9aa0a6', marginLeft:8}}>{item.analysis_date}</span>
                      </div>
                      <span style={{fontFamily:"'Caveat',cursive", fontWeight:700, fontSize:19, color: item.score_delta >= 0 ? '#3f7050' : '#a8453b'}}>{item.score_delta > 0 ? '+' : ''}{item.score_delta}</span>
                    </div>
                    <p style={{fontFamily:"'Libre Franklin',sans-serif", fontSize:13, color:'#5f636a', margin:'3px 0 0'}}>{item.summary || 'Sin resumen guardado.'}</p>
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
                <span style={{fontFamily:"'Libre Franklin',sans-serif", fontWeight:800, fontSize:22, color: selectedDayAnalysis.score_delta >= 0 ? '#3f7050' : '#a8453b'}}>{selectedDayAnalysis.score_delta > 0 ? '+' : ''}{selectedDayAnalysis.score_delta}</span>
              </div>
              <p className="lb-summary-text" style={{marginBottom:20}}>{selectedDayAnalysis.summary || 'Sin resumen guardado.'}</p>
              <div className="lb-resumen-grid">
                <div>
                  <div className="lb-section-title" style={{fontSize:20, marginBottom:10}}>Tareas</div>
                  <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    {actionItems.length
                      ? actionItems.map((item, i) => <TaskCard item={item} key={i} compact onArchive={archiveTask} />)
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
      )}

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

function todayMexicoStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date())
}

function buildChartPoints(items: DailyAnalysis[]): ChartPoint[] {
  if (!items.length) return []

  const byDate = new Map(items.map(i => [i.analysis_date, i]))
  const sorted = [...items].sort((a, b) => a.analysis_date.localeCompare(b.analysis_date))

  const start  = new Date(`${sorted[0].analysis_date}T12:00:00`)
  const today  = todayMexicoStr()
  // End = today if today is after last analysis, otherwise last analysis
  const endStr = today > sorted[sorted.length - 1].analysis_date ? today : sorted[sorted.length - 1].analysis_date
  const end    = new Date(`${endStr}T12:00:00`)

  const result: ChartPoint[] = []
  let lastScore = Number(sorted[0].new_score ?? 0)

  const cur = new Date(start)
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const analysis = byDate.get(dateStr)
    if (analysis) {
      lastScore = Number(analysis.new_score ?? lastScore)
      result.push({ id: analysis.id, date: dateStr, score: lastScore, delta: analysis.score_delta, summary: analysis.summary, filled: false })
    } else {
      result.push({ id: null, date: dateStr, score: lastScore, delta: 0, summary: null, filled: true })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

function ScoreGraph({ items, selectedId, onSelect }: { items: DailyAnalysis[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const chartPoints = buildChartPoints(items)
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
        {mapped.map((point, idx) => {
          const dotColor = point.filled ? '#b8b4ac' : point.score >= 85 ? '#3f7050' : point.score >= 70 ? '#b07d1e' : '#a8453b'
          const isSelected = !point.filled && selectedId === point.id
          const tooltip = point.filled
            ? `Sin mensajes · ${fmtShortDate(point.date)}`
            : `${fmtShortDate(point.date)} · score ${point.score}${point.delta !== 0 ? ` (${point.delta > 0 ? '+' : ''}${point.delta})` : ''}${point.summary ? '\n' + point.summary : ''}`
          return (
            <g key={`${point.date}-${idx}`}
               style={{cursor: point.filled ? 'default' : 'pointer'}}
               onClick={() => { if (!point.filled && point.id) onSelect(point.id) }}>
              <title>{tooltip}</title>
              {/* Score label — only on real days */}
              {!point.filled && (
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
        })}
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

function TaskCard({ item, compact = false, onArchive }: { item: unknown; compact?: boolean; onArchive?: (id: number) => void }) {
  const detail = actionDetail(item)
  const ownerType = actionOwnerType(item)
  const sc = getStatusConfig(detail.status ?? '')
  const urg = URGENCY_CONFIG[(detail.urgency ?? '').toLowerCase()] ?? URGENCY_CONFIG['low']
  const wtIcon = WORK_TYPE_ICON[(detail.workType ?? '').toLowerCase()] ?? '📋'
  const ownerTagClass = ownerType === 'blackwell' ? 'blackwell' : 'client'

  return (
    <article className="lb-task" style={{borderLeft: `4px solid ${sc.color}`}}>
      <div className="lb-task-header">
        <div className="lb-task-title">{actionText(item)}</div>
        <span className={`lb-task-tag ${ownerTagClass}`}>{ownerType}</span>
      </div>

      <div className="lb-task-status-row">
        <span className="lb-task-status" style={{color: sc.color}}>
          <span className="lb-task-status-dot" style={{background: sc.color}} />
          {detail.status}
        </span>
        <span className="lb-task-priority" style={{color: urg.color}}>{urg.icon} {detail.urgency}</span>
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
        <span>{detail.mondayItemId ? `Monday #${detail.mondayItemId}` : 'Sin item Monday'}</span>
        <span>{detail.createdAt ? `Creada ${shortDate(detail.createdAt)}` : ''}</span>
        <span>{detail.syncedAt ? `Sync ${shortDate(detail.syncedAt)}` : ''}</span>
        {onArchive && isRecord(item) && typeof item.id === 'number' && (
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm('¿Archivar esta tarea? No aparecerá en el dashboard pero quedará en el historial.')) onArchive(item.id as number) }}
            style={{marginLeft:'auto', fontFamily:"'Libre Franklin',sans-serif", fontSize:11, color:'#c8902a', background:'none', border:'1px solid #e8d8b8', borderRadius:999, padding:'2px 10px', cursor:'pointer'}}
            title="Archivar tarea (ya no está en Monday)"
          >
            Archivar
          </button>
        )}
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
