// ─── Raw data types (from JSON files) ───────────────────────────────────────

export interface SubfolderActivity {
  fileCount: number | null
  latestFile: string | null
  latestModified: string | null
  subfolderMissing?: boolean
  note?: string
}

export interface PqProxy {
  score: number | null
  tierMix?: string
  narrative?: string
}

export interface NextAction {
  action?: string
  due?: string
  owner?: string
}

export interface LastActivityEntry {
  time: string
  source?: string
  file?: string
  fileId?: string | null
}

export interface SyncAccount {
  number: string
  folderTitle: string
  folderId: string
  derivedStatus: string
  statusSuffix?: string
  latestDeliverable: { modifiedTime: string; title?: string } | null
  lastActivity: string | LastActivityEntry | null
  subfolderActivity: Record<string, SubfolderActivity> | null
  pqProxy: PqProxy | null
  nextAction: NextAction | null
  playbookViolations?: string[]
}

export interface SyncData {
  syncedAt: string | null
  accounts: SyncAccount[]
  deltas: DeltaEntry[]
  schema_version?: string
}

// ─── Drive Intelligence ──────────────────────────────────────────────────────

export interface DriveFile {
  title: string
  subfolder: string
  subfolderName?: string
  modifiedTime?: string
  size?: number
  kind?: string
  id?: string
}

export interface ScoreAdjustment {
  co_delta?: number
  pq_delta?: number
  sc_delta?: number
  reason?: string
}

export interface MondayTicket {
  tipo?: 'urgente' | 'prioridad' | 'normal'
  trigger?: string
  board_id?: string
}

export interface DatedDelta {
  date?: string | null
  change?: string | null
}

export interface Commitment {
  type?: string | null
  description?: string | null
  frequency?: string | null
}

export interface ClientPromise {
  promise?: string | null
  cadence?: string | null
  status?: 'cumplido' | 'en_proceso' | 'pendiente' | 'en_riesgo' | string | null
}

export interface ActionStep {
  step?: string | null
  status?: 'hecho' | 'en_proceso' | 'pendiente' | string | null
  owner?: string | null
  due?: string | null
}

export interface Risk {
  risk?: string | null
  severity?: 'alta' | 'media' | 'baja' | string | null
}

export interface UrgentAction {
  action?: string | null
  owner?: string | null
  due?: string | null
}

export interface PerFileNote {
  file?: string | null
  folder?: string | null
  finding?: string | null
}

export interface PqAssessment {
  placements?: number | string | null
  tier_mix?: string | null
  quality_narrative?: string | null
  result_vs_objective?: string | null
  score_estimate?: number | string | null
}

export interface ScSignal {
  date?: string | null
  type?: 'positive' | 'negative' | null
  signal?: string | null
  note?: string | null
  source?: string | null
}

export interface CoAssessment {
  committed?: number | string | null
  delivered?: number | string | null
  on_time?: number | string | null
  late?: number | string | null
  missed?: number | string | null
  note?: string | null
}

export interface MediaReconAccount {
  placements?: number | string | null
  reports?: number | string | null
  gap?: string | null
}

export interface AccountSummary {
  recommended_action?: string | null
  business_risk?: string | null
  content_summary?: string | null
  key_facts?: string[] | null
  dated_deltas?: DatedDelta[] | null
  opportunity?: string | null
  commitments?: Commitment[] | null
  per_file_notes?: PerFileNote[] | null
  fulfilled?: string[] | null
  pending?: string[] | null
  strategic_steps?: string[] | null
  immediate_actions?: string[] | null
  notes?: string | null
  // ── Nuevo esquema profesional (super JSON) ──
  project_purpose?: string | null
  scope_of_service?: string[] | null
  client_promises?: ClientPromise[] | null
  action_plan?: ActionStep[] | null
  current_status?: string | null
  risks?: Risk[] | null
  opportunities?: string[] | null
  urgent_actions?: UrgentAction[] | null
  strategic_recommendations?: string[] | null
  pq_assessment?: PqAssessment | null
  sc_signals?: ScSignal[] | null
  co_assessment?: CoAssessment | null
  media_reconciliation?: MediaReconAccount | null
  score_adjustment_recommendation?: ScoreAdjustment
  monday_ticket?: MondayTicket
}

export interface DriveAccount {
  account_id?: string
  number: string
  account_name?: string
  cadenceType?: string
  files?: DriveFile[]
  account_summary?: AccountSummary
  content_summary?: string
  media_reconciliation?: MediaRecon[]
  analyzed_at?: string
  files_read_count?: number
  files_skipped?: string[]
}

export interface CrossAccountFinding {
  title?: string
  description?: string
  severity?: 'high' | 'medium' | 'low'
  affected_accounts?: string[]
}

export interface CoverageSummary {
  total_accounts?: number
  analyzed_accounts?: number
  accounts_missing_baseline?: string[]
}

export interface DriveIntelligence {
  generated_at?: string
  schema_version?: string
  is_baseline?: boolean
  accounts: DriveAccount[]
  cross_account_findings?: (CrossAccountFinding | string)[]
  coverage_summary?: CoverageSummary
  executive_briefing?: string
  media_reconciliation?: MediaRecon[]
}

export interface MediaRecon {
  account?: string
  placements?: number
  reports?: number
  gap?: string
}

// ─── Checklist ───────────────────────────────────────────────────────────────

export type ChecklistStatus = 'ok' | 'partial' | 'missing' | 'na'

export interface ChecklistItem {
  w_co: number
  w_pq: number
  w_sc: number
  label?: string
}

export interface ChecklistSchema {
  items: Record<string, ChecklistItem>
}

export interface ChecklistEntry {
  contrato?: ChecklistStatus
  entregables?: ChecklistStatus
  reporte?: ChecklistStatus
  whatsapp?: ChecklistStatus
  transcripciones?: ChecklistStatus
  agenda?: ChecklistStatus
  evidence?: Record<string, string>
  recalcedAt?: string
}

export interface ChecklistRecalcData {
  checklist: Record<string, ChecklistEntry>
  schema: ChecklistSchema
}

// ─── Support data ────────────────────────────────────────────────────────────

export interface CadenceOverride {
  cadenceType?: 'on-demand' | 'event' | 'regular'
  note?: string
}

export interface CellMember {
  id: string
  lead_name: string
  members: string[]
  tentative_members?: string[]
}

export interface CellsData {
  cells: CellMember[]
}

export interface SegmentationAccount {
  number: number | string
  tier: 'top' | 'estrategica' | 'otra' | 'inactiva'
  name?: string
  estatus?: string
}

export interface AccountSegmentation {
  accounts: SegmentationAccount[]
}

export interface ContractOverrideEntry {
  status: ContractStatusKey
  note?: string
  set_by?: string
  since?: string
}

export interface ContractOverrides {
  overrides?: Record<string, ContractOverrideEntry>
}

export interface DeltaEntry {
  type: string
  account?: string
  message?: string
}

// ─── Computed account (buildAccounts output) ─────────────────────────────────

export type AccountColor = 'green' | 'yellow' | 'orange' | 'red' | 'gray'
export type AccountTier = 'top' | 'estrategica' | 'otra' | 'inactiva' | null
export type ContractStatusKey =
  | 'signed_current'
  | 'renewal_pending'
  | 'unsigned'
  | 'renewal_expired'
  | 'missing'
  | 'not_applicable'

export interface ContractStatusInfo {
  status: ContractStatusKey
  source: 'override' | 'heuristic'
  filename_evidence?: string | null
  latest_modified?: string | null
  months_old?: number
  override_note?: string
  override_set_by?: string
  override_since?: string
}

export interface ComputedAccount {
  id: string
  number: string
  name: string
  status: string
  statusSuffix?: string
  statusVariant: 'litigio' | 'nueva' | 'crisis' | 'onboarding' | null
  isActive: boolean
  co: number | null
  pq: number | null
  sc: number | null
  global: number | null
  color: AccountColor
  latestDeliverable: { modifiedTime: string; title?: string } | null
  lastActivity: string | null
  driveTitle: string
  drive: DriveAccount | null
  summary: AccountSummary
  subfolderActivity: Record<string, SubfolderActivity> | null
  pqProxy: PqProxy | null
  nextAction: NextAction | null
  checklistItems: ChecklistEntry | Record<string, ChecklistStatus>
  checklistSource: string
  contratoAlert: string | null
  cadenceType: string | null
  scoreFormula: string
  cadenceNote: string | null
  cell: string | null
  cellLead: string | null
  cellTentative: boolean
  tier: AccountTier
  contractStatus: ContractStatusInfo | null
}

// ─── App state ───────────────────────────────────────────────────────────────

export type TabId = 'briefing' | 'tareas' | 'equipo' | 'metodologia' | 'auditoria'
export type FilterId =
  | 'all'
  | 'top-strategic'
  | 'cell-A'
  | 'cell-B'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'stale'
  | 'no-deliverable'
  | 'ondemand'
  | 'contract-issue'
  | 'whatsapp'
  | 'concluded'

export type RoleId = 'leadership' | 'management' | 'consultor'
export type ThemeId = 'light' | 'dark'

// ─── Tareas (Monday → Supabase) ──────────────────────────────────────────────

export type TaskStatus = 'por_hacer' | 'en_proceso' | 'en_revision' | 'hecho'

export type WorkType =
  | 'reporte'
  | 'analisis'
  | 'media_training'
  | 'crisis'
  | 'nota_clientes'
  | 'campana'
  | 'reunion'
  | 'otro'

export interface ClientTask {
  id: string
  account_id: string
  account_name?: string | null
  title: string
  detail?: string | null
  status: TaskStatus
  responsable?: string | null
  due_date?: string | null
  work_type?: WorkType | null
  delivery_link?: string | null
  source: 'ia' | 'manual'
  created_at?: string | null
  updated_at?: string | null
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  por_hacer: 'Por hacer',
  en_proceso: 'En proceso',
  en_revision: 'En revisión',
  hecho: 'Hecho',
}

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  reporte: 'Reporte',
  analisis: 'Análisis',
  media_training: 'Media training',
  crisis: 'Crisis',
  nota_clientes: 'Nota a clientes',
  campana: 'Campaña',
  reunion: 'Reunión',
  otro: 'Otro',
}
