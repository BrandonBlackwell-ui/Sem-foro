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
  groups: GroupSummary[]
  score: AccountScore | null
  operational: OperationalScore | null
  publicationQuality: PublicationQualityScore | null
  analyzedToday: boolean
  hasMessagesToday: boolean
  latestAnalysis: DailyAnalysis | null
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


function scoreLabel(score: number | null | undefined) {
  if (score == null) return 'Pendiente'
  if (score >= 80) return 'Sano'
  if (score >= 65) return 'Estable'
  if (score >= 50) return 'Observar'
  return 'Atencion'
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10
}

function buildWeightedScore(waScore: number | null | undefined, operational?: OperationalScore | null, publicationQuality?: PublicationQualityScore | null) {
  const normalizedWa = waScore == null ? null : clampScore(Number(waScore))
  const coScore = operational?.co_score == null ? null : clampScore(Number(operational.co_score))
  const pqScore = publicationQuality?.pq_score == null ? null : clampScore(Number(publicationQuality.pq_score))
  const coIntoGlobal = coScore == null ? 0 : coScore * 0.375
  const pqIntoGlobal = pqScore == null ? 0 : pqScore * 0.25
  const waIntoSc = normalizedWa == null ? 0 : normalizedWa * 0.4
  const waIntoGlobal = waIntoSc * 0.375
  const coCaption = operational
    ? coScore == null
      ? `${operational.delivered_publications_count} publicaciones registradas · meta pendiente`
      : `CO ${roundScore(coScore)}/100`
    : 'Cumplimiento operativo'
  const pqCaption = publicationQuality
    ? pqScore == null
      ? `${publicationQuality.analyzed_count} notas analizadas · tiers pendientes`
      : `PQ ${roundScore(pqScore)}/100`
    : 'Calidad de publicaciones'
  const components = [
    {
      key: 'co',
      label: 'CO',
      caption: coCaption,
      value: coScore == null ? null : roundScore(coIntoGlobal),
      max: 37.5,
      contribution: coIntoGlobal,
      status: coScore == null ? (operational ? 'conectado' : 'pendiente') : 'conectado',
    },
    {
      key: 'pq',
      label: 'PQ',
      caption: pqCaption,
      value: pqScore == null ? null : roundScore(pqIntoGlobal),
      max: 25,
      contribution: pqIntoGlobal,
      status: pqScore == null ? (publicationQuality ? 'conectado' : 'pendiente') : 'conectado',
    },
    {
      key: 'sc',
      label: 'SC',
      caption: normalizedWa == null ? 'Falta WhatsApp, Meets y survey' : `Parcial: WA ${roundScore(normalizedWa)}/100`,
      value: normalizedWa == null ? null : roundScore(waIntoGlobal),
      max: 37.5,
      contribution: waIntoGlobal,
      status: normalizedWa == null ? 'pendiente' : 'parcial',
    },
    {
      key: 'wa',
      label: 'WA',
      caption: 'Subscore conectado',
      value: normalizedWa == null ? null : roundScore(normalizedWa),
      max: 100,
      contribution: normalizedWa ?? 0,
      status: normalizedWa == null ? 'pendiente' : 'conectado',
    },
    {
      key: 'meet',
      label: 'Meet',
      caption: 'Pendiente de clasificar minutas',
      value: null as number | null,
      max: 100,
      contribution: 0,
      status: 'pendiente',
    },
    {
      key: 'survey',
      label: 'Survey',
      caption: 'Tipo A/B pendiente',
      value: null as number | null,
      max: 100,
      contribution: 0,
      status: 'pendiente',
    },
  ]

  return {
    globalPartial: normalizedWa == null && coScore == null && pqScore == null ? null : roundScore(waIntoGlobal + coIntoGlobal + pqIntoGlobal),
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


export default function App() {
  const [analyses, setAnalyses] = useState<DailyAnalysis[]>([])
  const [scores, setScores] = useState<AccountScore[]>([])
  const [rawMessages, setRawMessages] = useState<WaMessage[]>([])
  const [detailMessages, setDetailMessages] = useState<WaMessage[]>([])
  const [groups, setGroups] = useState<WaGroup[]>([])
  const [operationalScores, setOperationalScores] = useState<OperationalScore[]>([])
  const [publications, setPublications] = useState<AccountPublication[]>([])
  const [publicationQualityScores, setPublicationQualityScores] = useState<PublicationQualityScore[]>([])
  const [tasks, setTasks] = useState<WaTask[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const [selectedOverviewDate] = useState<string>('latest')
  const [groupFilter, setGroupFilter] = useState<'all' | 'analyzed' | 'active' | 'inactive'>('all')
  const [clientTab, setClientTab] = useState<'whatsapp' | 'historico' | 'mensajes' | 'meet' | 'publicaciones'>('whatsapp')
  const [chartRange, setChartRange] = useState<'7d' | '30d' | '365d'>('30d')
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Gemini Meetings Integration States
  const [viewMode, setViewMode] = useState<'semaforo' | 'reuniones'>('semaforo')
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
      
      const key = emailSubject;
      
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title: title,
          date: task.created_at || new Date().toISOString(),
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
        const [analysisRows, scoreRows, groupRows, rawRows, taskDbRows, mediaRows, pqRows] = await Promise.all([
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
        ])
        const taskRows = await fetch('/api/monday-tasks')
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])

        setAnalyses(analysisRows)
        setScores(scoreRows)
        setGroups(groupRows)
        setRawMessages(rawRows)
        setOperationalScores(mediaRows.operationalScores)
        setPublications(mediaRows.publications)
        setPublicationQualityScores(pqRows)
        setTasks(taskRows)
        setDbTasks(taskDbRows)
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
      result.push({
        account_id: key,
        name: mainGroup.name,
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
  }, [groupSummaries, operationalLookup, publicationQualityLookup])

  const selectedAccount = selectedAccountId ? accountSummaries.find(a => a.account_id === selectedAccountId) ?? null : null

  const selectedGroup = selectedJid ? groupSummaries.find((group) => group.jid === selectedJid) ?? null : null

  const selectedAccountMeetings = useMemo(() => {
    if (!selectedAccount) return []

    const candidates = [
      selectedAccount.account_id,
      selectedAccount.name,
      ...selectedAccount.groups.map(group => group.name),
    ]
      .filter(Boolean)
      .map(value => String(value).toLowerCase())

    return meetings.filter(meeting => {
      const title = meeting.title.toLowerCase()

      return meeting.tasks.some(task => {
        const taskText = [
          task.account_id,
          task.monday_client_label,
          task.client_label,
          task.raw_action?.monday_client_label,
          task.raw_action?.client_label,
          task.raw_action?.email_subject,
          task.action,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return candidates.some(candidate => taskText.includes(candidate) || title.includes(candidate))
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

    let previousScore: number | null = null
    return selectedHistory.map((analysis) => {
      const [year, month] = analysis.analysis_date.split('-').map((part) => Number.parseInt(part, 10))
      const operationalForMonth =
        operationalScores.find((row) => {
          const rowKeys = explicitLinkedKeys([row.account_id, row.account_name])
          return row.period_year === year &&
            row.period_month === month &&
            Array.from(rowKeys).some((key) => accountKeys.has(key))
        }) ?? null
      const publicationQualityForMonth =
        publicationQualityScores.find((row) => {
          const rowKeys = explicitLinkedKeys([row.account_id, row.account_name])
          return row.period_year === year &&
            row.period_month === month &&
            Array.from(rowKeys).some((key) => accountKeys.has(key))
        }) ?? null
      const score = buildWeightedScore(analysis.new_score, operationalForMonth, publicationQualityForMonth).globalPartial
      const delta = score == null || previousScore == null ? 0 : roundScore(score - previousScore)
      if (score != null) previousScore = score
      return {
        id: analysis.id,
        analysis_date: analysis.analysis_date,
        score,
        delta,
        wa_score: analysis.new_score,
        summary: analysis.summary,
      }
    })
  }, [operationalScores, publicationQualityScores, selectedAccount, selectedHistory])

  const latestSelectedAnalysis = selectedJid ? latestAnalysisByGroup.get(selectedJid) ?? null : null
  const selectedDayAnalysis = selectedHistory.find((analysis) => analysis.id === selectedHistoryId) ?? null
  const selectedDayScore = selectedHistoricalScores.find((analysis) => analysis.id === selectedHistoryId) ?? null
  const activeDayAnalysis = selectedDayAnalysis ?? latestSelectedAnalysis
  const selectedScore = selectedGroup?.score?.current_score ?? latestSelectedAnalysis?.new_score ?? null
  const weightedScore = buildWeightedScore(selectedScore, selectedAccount?.operational ?? null, selectedAccount?.publicationQuality ?? null)
  const displayScore = weightedScore.globalPartial
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
    setClientTab('whatsapp')
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
    const analyzedCount = accountSummaries.filter(a => a.analyzedToday).length
    const pendingAnalysis = accountSummaries.filter(a => !a.analyzedToday && a.hasMessagesToday)
    const trulyQuiet = accountSummaries.filter(a => !a.analyzedToday && !a.hasMessagesToday)
    const todayScores = accountSummaries
      .filter(a => a.analyzedToday && a.score)
      .map(a => a.score!.current_score)
    const averageScore = todayScores.length
      ? Math.round(todayScores.reduce((t, s) => t + s, 0) / todayScores.length)
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
                <div style={{fontFamily:'var(--caveat)', fontSize:36, fontWeight:700, color:'#3a3a44', lineHeight:1, textAlign:'right'}}>
                  {new Date().toLocaleDateString('es-MX', {day:'numeric', month:'long', year:'numeric', timeZone:'America/Mexico_City'})}
                </div>
              </div>

              {/* Post-it stats */}
              <div className="lb-stats-row">
                <div className="lb-postit lb-postit-green" style={{animationDelay:'0ms'}}>
                  <div className="lb-postit-label">Score promedio</div>
                  <div className="lb-postit-value" style={{color: averageScore && averageScore >= 85 ? '#3f7050' : averageScore && averageScore >= 70 ? '#b07d1e' : '#a8453b'}}>{averageScore ?? '--'}</div>
                  <div className="lb-postit-detail">{averageScore ? '' : 'Sin puntajes'}</div>
                </div>
                <div className="lb-postit lb-postit-yellow" style={{animationDelay:'80ms', cursor:'pointer', outline: groupFilter === 'analyzed' ? '2px solid #b07d1e' : 'none', outlineOffset:3}} onClick={() => setGroupFilter(f => f === 'analyzed' ? 'all' : 'analyzed')}>
                  <div className="lb-postit-label">Analizados hoy {groupFilter === 'analyzed' && <span style={{fontSize:13}}>✕</span>}</div>
                  <div className="lb-postit-value" style={{color:'#b07d1e'}}>{analyzedCount}<span style={{fontSize:24,fontWeight:400}}> / {accountSummaries.length}</span></div>
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
                {accountSummaries.filter(account => {
                  if (groupFilter === 'analyzed') return account.analyzedToday
                  if (groupFilter === 'inactive') return !account.analyzedToday && !account.hasMessagesToday
                  return true
                }).map((account, gi) => {
                  const scoreValue = account.analyzedToday ? (account.latestAnalysis?.new_score ?? null) : null
                  const status = account.analyzedToday ? scoreLabel(scoreValue) : account.hasMessagesToday ? 'En proceso' : 'Pendiente'
                  const stampColor = account.analyzedToday
                    ? (scoreValue != null && scoreValue >= 85 ? '#3f7050' : scoreValue != null && scoreValue >= 70 ? '#b07d1e' : '#a8453b')
                    : account.hasMessagesToday ? '#3a6ea5' : '#9aa0a6'
                  const r = 26
                  const circ = 2 * Math.PI * r
                  const offset = scoreValue != null ? circ * (1 - scoreValue / 100) : circ
                  const mainGroup = account.groups.find(g => !g.name.toLowerCase().includes('interno')) ?? account.groups[0]
                  const lastMsgAt = account.groups.map(g => g.last_message_at ?? '').sort().reverse()[0] || null
                  return (
                    <button className="lb-account-row" key={account.account_id} style={{borderLeft: `5px solid ${stampColor}`, animationDelay: `${gi * 40}ms`}} onClick={() => { setSelectedAccountId(account.account_id); setSelectedJid(mainGroup?.jid ?? null) }}>
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
                        <div className="lb-account-name">{account.name}</div>
                        <div className="lb-account-summary">{account.latestAnalysis?.summary || 'Sin análisis diario guardado todavía.'}</div>
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
        <button className={`lb-tab${clientTab === 'whatsapp' ? ' active' : ''}`} onClick={() => setClientTab('whatsapp')}>WhatsApp</button>
        <button className={`lb-tab${clientTab === 'historico' ? ' active' : ''}`} onClick={() => setClientTab('historico')}>Histórico</button>
        <button className={`lb-tab${clientTab === 'mensajes' ? ' active' : ''}`} onClick={() => setClientTab('mensajes')}>Mensajes</button>
        <button className={`lb-tab${clientTab === 'meet' ? ' active' : ''}`} onClick={() => setClientTab('meet')}>Meet</button>
        <button className={`lb-tab${clientTab === 'publicaciones' ? ' active' : ''}`} onClick={() => setClientTab('publicaciones')}>Publicaciones</button>
      </nav>

      {clientTab === 'whatsapp' && (
        <div className="lb-resumen" style={{marginTop:24}}>
          {/* Score + summary hero */}
          <div style={{display:'flex', gap:22, flexWrap:'wrap', alignItems:'flex-start'}}>
            <div className="lb-score-postit" style={{background: displayScore != null && displayScore >= 80 ? '#d4eedd' : displayScore != null && displayScore >= 45 ? '#fdf1ad' : '#fde8e6'}}>
              <div className="lb-score-postit-val" style={{color: displayScore != null && displayScore >= 80 ? '#3f7050' : displayScore != null && displayScore >= 45 ? '#b07d1e' : '#a8453b'}}>{displayScore ?? '--'}</div>
              <div className="lb-score-postit-label">Score global parcial</div>
              <div className="lb-score-postit-note">WA real: {selectedScore ?? '--'} / 100</div>
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
              <ScoreBreakdown components={weightedScore.components} />
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
              <SignalList title="A revisar" items={negativeSignals} tone="red" />
            </div>
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
              {selectedAccountPublications.map((publication) => (
                <article className="lb-publication-card" key={publication.id}>
                  <div>
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
                  </div>
                  {publication.url && (
                    <a className="lb-publication-link" href={publication.url} target="_blank" rel="noreferrer">
                      Abrir nota
                    </a>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="lb-subtext" style={{ textAlign: 'center', padding: '32px 0' }}>
              Aun no hay publicaciones sincronizadas para este cliente.
            </p>
          )}
        </div>
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
  score: number | null
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

function ScoreBreakdown({ components }: { components: ReturnType<typeof buildWeightedScore>['components'] }) {
  return (
    <div className="lb-score-breakdown" aria-label="Componentes del score global">
      <div className="lb-score-breakdown-head">
        <span>Ponderación conectada</span>
        <strong>Global = CO 37.5% · PQ 25% · SC 37.5%</strong>
      </div>
      <div className="lb-score-bars">
        {components.map((component) => {
          const fill = component.value == null
            ? 0
            : Math.min(100, (Number(component.value) / component.max) * 100)
          const valueText = component.value == null
            ? component.status === 'conectado' ? 'meta pendiente' : 'pendiente'
            : `${component.value}/${component.max}`
          return (
            <div className={`lb-score-bar-row ${component.status}`} key={component.key}>
              <div className="lb-score-bar-label">
                <strong>{component.label}</strong>
                <span>{component.caption}</span>
              </div>
              <div className="lb-score-bar-track">
                <div className="lb-score-bar-fill" style={{ width: `${fill}%` }} />
              </div>
              <div className="lb-score-bar-value">{valueText}</div>
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
