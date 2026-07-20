// Reportes de IA de Pepe Aguilar.
// Viven en un Supabase SEPARADO del dashboard (proyecto dedicado al monitoreo
// de redes/reputación de Pepe). Solo se leen; nunca se escribe aquí.
// La tabla `reports` completa es de Pepe, por eso no hay filtro por cliente.

const REPORTS_SUPABASE_URL =
  import.meta.env.VITE_REPORTS_SUPABASE_URL || 'https://aeywtloohrhyxvmxqzqe.supabase.co'
const REPORTS_SUPABASE_ANON_KEY =
  import.meta.env.VITE_REPORTS_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXd0bG9vaHJoeXh2bXhxenFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzY2NzksImV4cCI6MjA5ODQxMjY3OX0.um2x046pEAJhlK6g98brVPFbc1nKFO8ixSUzmoU8dZw'

// account_id del dashboard (clave de WhatsApp) para Pepe Aguilar.
export const PEPE_ACCOUNT_ID = '35'

export type ReportSentiment = { critico?: number; neutral?: number; favorable?: number }

export type NetworkBreakdown = {
  focos?: string[]
  lectura?: string
  tendencia?: string
  sentimiento?: ReportSentiment
  recomendacion?: string
  posts?: number
  comentarios?: number
}

export type ReportVoice = {
  tono?: string
  sentiment?: string
  nombre?: string
  username?: string
  platform?: string
  tier?: string
  alcance?: string
  dominio?: string
  notas?: number
  likes?: number
  followers?: number
  engagement?: number
  impacto?: string
  temas?: string[]
  keywords?: string[]
  titular_ejemplo?: string
  comentario_o_post?: string
}

export type ReportAnalysis = {
  nivel_riesgo?: string
  sentimiento?: ReportSentiment
  resumen_ejecutivo?: string[]
  alertas?: string[]
  plan_accion?: string[]
  oportunidades?: string[]
  desglose_por_red?: Record<string, NetworkBreakdown>
  analisis_voces?: {
    medios_destacados?: ReportVoice[]
    aliados_destacados?: ReportVoice[]
    criticos_destacados?: ReportVoice[]
  }
  comparativa_historica?: {
    resumen?: string
    delta_critico?: number
    delta_favorable?: number
    alertas_resueltas?: string[]
    alertas_persistentes?: string[]
  }
  [key: string]: unknown
}

export type PepeReport = {
  id: string
  report_id: string | null
  date_key: string | null
  theme_key: string | null
  theme_label: string | null
  filename: string | null
  created_at: string
  ai_analysis: ReportAnalysis | null
  approved: boolean | null
  admin_rationale: Record<string, unknown> | null
}

export async function fetchPepeReports(): Promise<PepeReport[]> {
  const url =
    `${REPORTS_SUPABASE_URL}/rest/v1/reports` +
    `?select=id,report_id,date_key,theme_key,theme_label,filename,created_at,ai_analysis,approved,admin_rationale` +
    `&order=date_key.desc,created_at.desc`
  const res = await fetch(url, {
    headers: {
      apikey: REPORTS_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${REPORTS_SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Reports Supabase ${res.status}: ${text}`)
  }
  return (await res.json()) as PepeReport[]
}
