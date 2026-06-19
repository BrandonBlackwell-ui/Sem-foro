import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo
} from 'react'
import { buildAccounts } from '../hooks/useAccounts'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { extractTasksFromAccount } from '../lib/taskExtractor'
import type {
  TabId, FilterId, RoleId, ThemeId,
  SyncData, DriveIntelligence, ChecklistRecalcData,
  CadenceOverride, CellsData, AccountSegmentation, ContractOverrides,
  ComputedAccount, ClientTask,
} from '../types'

// ── Supabase config ──────────────────────────────────────────────────────────
const SB_URL = 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_KEY = 'sb_publishable_MQ8JlDI41ymSUpcrV_8o_w_uLl8g1SM'
const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

type SbOverrideRow = {
  account_id: string; account_name: string
  co: number | null; pq: number | null; sc: number | null
  reason: string; set_by: string; override_date: string
}

// ── Assignments (consultor + director de célula) ──────────────────────────────
export type AccountAssignment = {
  account_id: string
  account_name: string
  consultant: string
  cell_director: string
  updated_by: string
}

async function sbGetAssignments(): Promise<Record<string, AccountAssignment>> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/account_assignments?select=*`, { headers: SB_HEADERS })
    if (!res.ok) return {}
    const rows = await res.json() as AccountAssignment[]
    const map: Record<string, AccountAssignment> = {}
    for (const r of rows) map[r.account_id] = r
    return map
  } catch { return {} }
}

async function sbUpsertAssignment(row: AccountAssignment): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/account_assignments`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    })
    if (!res.ok) {
      const detail = res.status === 404
        ? 'La tabla account_assignments no existe en Supabase — hay que correr el SQL de creación.'
        : `Supabase respondió ${res.status}.`
      return { ok: false, error: detail }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Sin conexión a Supabase.' }
  }
}

async function sbGet(): Promise<Record<string, SbOverrideRow>> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/score_overrides?select=*`, { headers: SB_HEADERS })
    if (!res.ok) return {}
    const rows = await res.json() as SbOverrideRow[]
    const map: Record<string, SbOverrideRow> = {}
    for (const r of rows) map[r.account_id] = r
    return map
  } catch { return {} }
}

async function sbUpsert(row: SbOverrideRow) {
  try {
    await fetch(`${SB_URL}/rest/v1/score_overrides`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    })
  } catch { /* silencioso si offline */ }
}

async function sbDelete(accountId: string) {
  try {
    await fetch(`${SB_URL}/rest/v1/score_overrides?account_id=eq.${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: SB_HEADERS,
    })
  } catch { /* silencioso si offline */ }
}

// ── Tareas (Monday → Supabase) ────────────────────────────────────────────────
async function sbGetTasks(): Promise<ClientTask[]> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/client_tasks?select=*&order=created_at.asc`, { headers: SB_HEADERS })
    if (!res.ok) return []
    return await res.json() as ClientTask[]
  } catch { return [] }
}

async function sbUpsertTasks(rows: ClientTask[]) {
  if (!rows.length) return
  try {
    await fetch(`${SB_URL}/rest/v1/client_tasks`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.map(r => ({ ...r, updated_at: new Date().toISOString() }))),
    })
  } catch { /* silencioso si offline */ }
}

async function sbDeleteTask(id: string) {
  try {
    await fetch(`${SB_URL}/rest/v1/client_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: SB_HEADERS,
    })
  } catch { /* silencioso si offline */ }
}

// ─── Data loader helpers ─────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return resp.json() as Promise<T>
}

async function fetchJsVar<T>(url: string, varName: string): Promise<T> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  const text = await resp.text()
  const clean = text
    .replace(`window.${varName}`, 'var __val__')
    .replace(/;\s*$/, '')
  const fn = new Function(`${clean}; return __val__;`)
  return fn() as T
}

// ─── Context shape ───────────────────────────────────────────────────────────

interface AppContextValue {
  // Data
  syncData: SyncData
  driveIntelligence: DriveIntelligence | null
  accounts: ComputedAccount[]
  loading: boolean
  dataError: string | null

  // UI state
  currentTab: TabId
  setCurrentTab: (t: TabId) => void
  masterFilter: FilterId
  setMasterFilter: (f: FilterId) => void
  currentRole: RoleId
  setCurrentRole: (r: RoleId) => void
  theme: ThemeId
  setTheme: (t: ThemeId) => void

  // Modal / overlays
  modalAccountId: string | null
  openModal: (id: string) => void
  closeModal: () => void
  configOpen: boolean
  openConfig: () => void
  closeConfig: () => void
  tierEditorOpen: boolean
  openTierEditor: () => void
  closeTierEditor: () => void
  splashOpen: boolean
  openSplash: () => void
  dismissSplash: () => void

  // Per-account lazy drive intelligence
  fetchAccountDriveIntelligence: (accountNumber: string, accountName: string) => Promise<Record<string, unknown> | null>

  // Tier overrides
  tierOverrides: Record<string, string>
  setTierOverrides: (v: Record<string, string>) => void

  // Score overrides (per account, per axis)
  scoreOverrides: Record<string, Record<string, number>>
  overrideReasons: Record<string, { reason: string; setBy: string; date: string }>
  setScoreOverride: (accountId: string, axis: string, value: number | null) => void
  setOverrideReason: (accountId: string, reason: string, setBy: string, accountName?: string, scores?: { co?: number | null; pq?: number | null; sc?: number | null }) => void
  clearAllOverrides: () => void

  // Assignments (consultor + director de célula)
  assignments: Record<string, AccountAssignment>
  setAssignment: (accountId: string, data: Partial<Omit<AccountAssignment, 'account_id'>>) => Promise<{ ok: boolean; error?: string }>

  // Tareas (Monday → Supabase)
  tasks: ClientTask[]
  tasksLoading: boolean
  addTask: (data: Partial<ClientTask> & { account_id: string; title: string }) => void
  updateTask: (id: string, data: Partial<ClientTask>) => void
  deleteTask: (id: string) => void
  generateTasksFromIA: (accountId?: string) => Promise<{ created: number; accounts: number }>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  // ── Data state ──
  const [syncData, setSyncData] = useState<SyncData>({ syncedAt: null, accounts: [], deltas: [] })
  const [driveIntelligence, setDriveIntelligence] = useState<DriveIntelligence | null>(null)
  const [checklistRecalc, setChecklistRecalc] = useState<ChecklistRecalcData | null>(null)
  const [cadenceOverrides, setCadenceOverrides] = useState<Record<string, CadenceOverride>>({})
  const [cells, setCells] = useState<CellsData | null>(null)
  const [accountSegmentation, setAccountSegmentation] = useState<AccountSegmentation | null>(null)
  const [contractOverrides, setContractOverrides] = useState<ContractOverrides>({})
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // ── Persistent UI preferences ──
  const [theme, setThemeRaw] = useLocalStorage<ThemeId>('v35:theme', 'light')
  const [currentRole, setCurrentRole] = useLocalStorage<RoleId>('v35:role', 'leadership')
  const [tierOverrides, setTierOverrides] = useLocalStorage<Record<string, string>>('segmentationOverrides', {})

  // ── Score overrides — sincronizados con Google Sheets via /overrides ──
  // Estructura: { [accountId]: { co?: number, pq?: number, sc?: number } }
  const [scoreOverrides, setScoreOverridesRaw] = useState<Record<string, Record<string, number>>>({})

  // ── Override reasons ──
  const [overrideReasons, setOverrideReasonsRaw] = useState<Record<string, { reason: string; setBy: string; date: string }>>({})

  // ── Assignments ──
  const [assignments, setAssignmentsRaw] = useState<Record<string, AccountAssignment>>({})

  // ── Tareas ──
  const [tasks, setTasks] = useState<ClientTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)

  // ── Transient UI state ──
  const [currentTab, setCurrentTab] = useState<TabId>('briefing')
  const [masterFilter, setMasterFilter] = useState<FilterId>('all')
  const [modalAccountId, setModalAccountId] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [tierEditorOpen, setTierEditorOpen] = useState(false)
  const [splashOpen, setSplashOpen] = useState(false)

  // ── Apply theme ──
  const setTheme = useCallback((t: ThemeId) => {
    setThemeRaw(t)
    document.documentElement.setAttribute('data-theme', t)
  }, [setThemeRaw])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.setAttribute('data-grid', 'on')
  }, [theme])

  // ── Splash on first daily visit ──
  useEffect(() => {
    try {
      const key = 'v35:splash:lastShown'
      const last = localStorage.getItem(key)
      const today = new Date().toISOString().slice(0, 10)
      if (last !== today) {
        setSplashOpen(true)
        localStorage.setItem(key, today)
      }
    } catch { /* ignore */ }
  }, [])

  // ── Load all data ──
  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      try {
        const [sd, di, chk, cad, cl, seg, co] = await Promise.allSettled([
          fetchJson<SyncData>('/data/accounts_status.json'),
          fetchJsVar<DriveIntelligence>('/data/drive_intelligence.js', 'DRIVE_INTELLIGENCE'),
          fetchJsVar<ChecklistRecalcData>('/data/checklist_recalc.js', 'CHECKLIST_RECALC_DATA'),
          fetchJson<Record<string, CadenceOverride>>('/data/cadence_overrides.json'),
          fetchJson<CellsData>('/data/cells.json'),
          fetchJson<AccountSegmentation>('/data/account_segmentation.json'),
          fetchJson<ContractOverrides>('/data/cadence_overrides.json').catch(() => ({})),
        ])
        if (sd.status === 'fulfilled') setSyncData(sd.value)
        if (di.status === 'fulfilled') setDriveIntelligence(di.value)
        if (chk.status === 'fulfilled') setChecklistRecalc(chk.value)
        if (cad.status === 'fulfilled') setCadenceOverrides(cad.value as Record<string, CadenceOverride>)
        if (cl.status === 'fulfilled') setCells(cl.value)
        if (seg.status === 'fulfilled') setAccountSegmentation(seg.value)
        if (co.status === 'fulfilled') setContractOverrides(co.value as ContractOverrides)
      } catch (err) {
        setDataError(String(err))
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [])

  // ── Cargar overrides desde Supabase al iniciar ──
  useEffect(() => {
    sbGet().then(data => {
      const scores: Record<string, Record<string, number>> = {}
      const reasons: Record<string, { reason: string; setBy: string; date: string }> = {}
      for (const [aid, row] of Object.entries(data)) {
        const axisMap: Record<string, number> = {}
        if (row.co != null && !isNaN(row.co)) axisMap['co'] = row.co
        if (row.pq != null && !isNaN(row.pq)) axisMap['pq'] = row.pq
        if (row.sc != null && !isNaN(row.sc)) axisMap['sc'] = row.sc
        if (Object.keys(axisMap).length) scores[aid] = axisMap
        if (row.reason) reasons[aid] = { reason: row.reason, setBy: row.set_by || '', date: row.override_date || '' }
      }
      setScoreOverridesRaw(scores)
      setOverrideReasonsRaw(reasons)
    })
    sbGetAssignments().then(data => setAssignmentsRaw(data))
    sbGetTasks().then(data => { setTasks(data); setTasksLoading(false) })

    // Refresco silencioso cada 30s para capturar cambios de Monday
    const poll = setInterval(() => {
      sbGetTasks().then(data => setTasks(data))
    }, 30_000)
    return () => clearInterval(poll)
  }, [])

  // ── Computed accounts ──
  const accounts = useMemo(() => {
    if (!syncData.accounts.length) return []
    return buildAccounts({
      syncData,
      driveIntelligence,
      checklistRecalc,
      cadenceOverrides,
      cells,
      accountSegmentation,
      contractOverrides,
      tierOverrides,
      scoreOverrides,
    })
  }, [syncData, driveIntelligence, checklistRecalc, cadenceOverrides, cells,
      accountSegmentation, contractOverrides, tierOverrides, scoreOverrides])

  // ── Score override helpers — escriben directo a Google Sheets ──
  const setScoreOverride = useCallback((accountId: string, axis: string, value: number | null) => {
    // Actualizar estado local inmediatamente (optimistic update)
    setScoreOverridesRaw(prev => {
      const next = { ...prev }
      if (value === null) {
        if (next[accountId]) {
          const axisMap = { ...next[accountId] }
          delete axisMap[axis]
          if (Object.keys(axisMap).length === 0) delete next[accountId]
          else next[accountId] = axisMap
        }
      } else {
        next[accountId] = { ...(next[accountId] || {}), [axis]: value }
      }
      return next
    })
    // Nota: la escritura al Sheet se hace en setOverrideReason (cuando el usuario
    // presiona "Guardar" con todos los datos juntos). No escribir por cada tecla.
  }, [])

  const setOverrideReason = useCallback((
    accountId: string, reason: string, setBy: string,
    accountName?: string,
    scores?: { co?: number | null; pq?: number | null; sc?: number | null }
  ) => {
    const today = new Date().toISOString().slice(0, 10)
    setOverrideReasonsRaw(prev => ({
      ...prev,
      [accountId]: { reason, setBy, date: today },
    }))
    sbUpsert({
      account_id: accountId,
      account_name: accountName || accountId,
      co: scores?.co ?? null,
      pq: scores?.pq ?? null,
      sc: scores?.sc ?? null,
      reason,
      set_by: setBy,
      override_date: today,
    })
  }, [])

  const clearAllOverrides = useCallback(() => {
    for (const aid of Object.keys(scoreOverrides)) {
      sbDelete(aid)
    }
    setScoreOverridesRaw({})
    setOverrideReasonsRaw({})
  }, [scoreOverrides])

  // ── Assignment helper ──
  const setAssignment = useCallback(async (accountId: string, data: Partial<Omit<AccountAssignment, 'account_id'>>) => {
    let next: AccountAssignment | null = null
    setAssignmentsRaw(prev => {
      const prev_ = prev[accountId] || { account_id: accountId, account_name: '', consultant: '', cell_director: '', updated_by: '' }
      next = { ...prev_, ...data, account_id: accountId }
      return { ...prev, [accountId]: next }
    })
    // Persistir y reportar si falló (para que la UI no mienta con "Guardado")
    return sbUpsertAssignment(next!)
  }, [])

  // ── Tareas: CRUD ──
  const addTask = useCallback((data: Partial<ClientTask> & { account_id: string; title: string }) => {
    const now = new Date().toISOString()
    const row: ClientTask = {
      id: (crypto?.randomUUID?.() ?? `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      account_id: data.account_id,
      account_name: data.account_name ?? null,
      title: data.title,
      detail: data.detail ?? null,
      status: data.status ?? 'por_hacer',
      responsable: data.responsable ?? null,
      due_date: data.due_date ?? null,
      work_type: data.work_type ?? 'otro',
      delivery_link: data.delivery_link ?? null,
      source: data.source ?? 'manual',
      created_at: now,
      updated_at: now,
    }
    setTasks(prev => [...prev, row])
    sbUpsertTasks([row])
  }, [])

  const updateTask = useCallback((id: string, data: Partial<ClientTask>) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev
      const next = { ...prev[idx], ...data, updated_at: new Date().toISOString() }
      sbUpsertTasks([next])
      const copy = prev.slice()
      copy[idx] = next
      return copy
    })
  }, [])

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    sbDeleteTask(id)
  }, [])

  const generateTasksFromIA = useCallback(async (accountId?: string): Promise<{ created: number; accounts: number }> => {
    const existingIds = new Set(tasks.map(t => t.id))
    const toCreate: ClientTask[] = []
    const touchedAccounts = new Set<string>()
    const targetAccounts = accountId ? accounts.filter(a => a.id === accountId) : accounts
    for (const acc of targetAccounts) {
      const resp = assignments[acc.id]?.consultant || acc.cellLead || null
      const extracted = extractTasksFromAccount(acc, resp)
      for (const t of extracted) {
        if (existingIds.has(t.id)) continue
        existingIds.add(t.id)
        toCreate.push(t)
        touchedAccounts.add(acc.id)
      }
    }
    if (toCreate.length) {
      // Insertar en lotes de 200 para no exceder límites de payload
      for (let i = 0; i < toCreate.length; i += 200) {
        await sbUpsertTasks(toCreate.slice(i, i + 200))
      }
      setTasks(prev => [...prev, ...toCreate])
    }
    return { created: toCreate.length, accounts: touchedAccounts.size }
  }, [tasks, accounts, assignments])

  // ── Per-account lazy drive intelligence ──
  // Cache en memoria para no refetch en cada apertura del modal
  const _diCache = React.useRef<Record<string, Record<string, unknown>>>({})

  const fetchAccountDriveIntelligence = useCallback(
    async (accountNumber: string, accountName: string): Promise<Record<string, unknown> | null> => {
      const cacheKey = accountNumber
      if (_diCache.current[cacheKey]) return _diCache.current[cacheKey]

      // Construir slug del nombre (mismo algoritmo que el Python)
      const slug = accountName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
      const folderName = slug ? `${accountNumber}_${slug}` : accountNumber
      const url = `/data/accounts/${folderName}/drive_intelligence.json`

      try {
        const resp = await fetch(url)
        if (!resp.ok) return null
        const data = await resp.json() as Record<string, unknown>
        _diCache.current[cacheKey] = data
        return data
      } catch {
        return null
      }
    },
    []
  )

  const value: AppContextValue = {
    syncData, driveIntelligence, accounts, loading, dataError,
    currentTab, setCurrentTab,
    masterFilter, setMasterFilter,
    currentRole, setCurrentRole,
    theme, setTheme,
    modalAccountId,
    openModal: setModalAccountId,
    closeModal: () => setModalAccountId(null),
    configOpen,
    openConfig: () => setConfigOpen(true),
    closeConfig: () => setConfigOpen(false),
    tierEditorOpen,
    openTierEditor: () => setTierEditorOpen(true),
    closeTierEditor: () => setTierEditorOpen(false),
    splashOpen,
    openSplash: () => setSplashOpen(true),
    dismissSplash: () => setSplashOpen(false),
    tierOverrides,
    setTierOverrides,
    scoreOverrides,
    overrideReasons,
    setScoreOverride,
    setOverrideReason,
    clearAllOverrides,
    fetchAccountDriveIntelligence,
    assignments,
    setAssignment,
    tasks,
    tasksLoading,
    addTask,
    updateTask,
    deleteTask,
    generateTasksFromIA,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
