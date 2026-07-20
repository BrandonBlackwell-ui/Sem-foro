import { useEffect, useMemo, useState } from 'react'
import {
  fetchPepeReports,
  type PepeReport,
  type ReportSentiment,
  type ReportAnalysis,
  type NetworkBreakdown,
  type ReportVoice,
} from '../lib/pepeReports'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fmtDate(dateKey: string | null): string {
  if (!dateKey) return 'Sin fecha'
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return dateKey
  return `${d} ${MONTHS[m - 1] ?? m} ${y}`
}

type Tone = { bg: string; fg: string }
const TEAL: Tone = { bg: 'var(--teal-bg)', fg: 'var(--teal)' }
const AMBER: Tone = { bg: 'var(--amber-bg)', fg: 'var(--amber)' }
const CRIMSON: Tone = { bg: 'var(--crimson-bg)', fg: 'var(--crimson)' }
const GRAY: Tone = { bg: 'var(--gray-bg)', fg: 'var(--slate)' }

function riskTone(nivel?: string): Tone {
  const n = (nivel ?? '').toLowerCase()
  if (n.includes('alto')) return CRIMSON
  if (n.includes('medio')) return AMBER
  if (n.includes('bajo')) return TEAL
  return GRAY
}

function trendTone(t?: string): Tone {
  const n = (t ?? '').toLowerCase()
  if (n.includes('empeor')) return CRIMSON
  if (n.includes('mejor')) return TEAL
  if (n.includes('estable')) return GRAY
  return GRAY
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function SentimentBar({ s, compact }: { s?: ReportSentiment; compact?: boolean }) {
  if (!s) return null
  const c = Math.max(0, s.critico ?? 0)
  const n = Math.max(0, s.neutral ?? 0)
  const f = Math.max(0, s.favorable ?? 0)
  const total = c + n + f
  if (total === 0) return null
  const pct = (v: number) => `${(v / total) * 100}%`
  return (
    <div style={{ minWidth: compact ? 120 : 200 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
        <div style={{ width: pct(f), background: 'var(--teal)' }} title={`Favorable ${f}%`} />
        <div style={{ width: pct(n), background: 'var(--slate-2)' }} title={`Neutral ${n}%`} />
        <div style={{ width: pct(c), background: 'var(--crimson)' }} title={`Crítico ${c}%`} />
      </div>
      {!compact && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--teal)' }}>▲ {f}% favorable</span>
          <span>● {n}% neutral</span>
          <span style={{ color: 'var(--crimson)' }}>▼ {c}% crítico</span>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function BulletList({ items, tone }: { items?: string[]; tone?: Tone }) {
  if (!items || !items.length) return null
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => (
        <li
          key={i}
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text)',
            paddingLeft: 12,
            borderLeft: `2px solid ${tone ? tone.fg : 'var(--ink-500)'}`,
          }}
        >
          {it}
        </li>
      ))}
    </ul>
  )
}

function VoiceRow({ v }: { v: ReportVoice }) {
  const who = v.nombre || v.username || 'Anónimo'
  const meta = [v.platform, v.tier || v.alcance, v.dominio].filter(Boolean).join(' · ')
  const nums = [
    v.notas != null ? `${v.notas} nota(s)` : null,
    v.likes != null ? `${v.likes} likes` : null,
    v.followers ? `${v.followers.toLocaleString('es-MX')} seg.` : null,
    v.impacto ? `impacto ${v.impacto}` : null,
  ].filter(Boolean).join(' · ')
  const text = v.comentario_o_post || v.titular_ejemplo || (v.temas || v.keywords || []).join(', ')
  return (
    <div style={{ padding: '8px 10px', background: 'var(--paper-soft)', borderRadius: 'var(--radius)', border: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{who}</strong>
        {meta && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{meta}</span>}
      </div>
      {nums && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{nums}</div>}
      {text && <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 4, lineHeight: 1.45 }}>{text}</div>}
    </div>
  )
}

function VoiceGroup({ title, voices, tone }: { title: string; voices?: ReportVoice[]; tone: Tone }) {
  if (!voices || !voices.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: tone.fg, marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {voices.map((v, i) => <VoiceRow key={i} v={v} />)}
      </div>
    </div>
  )
}

function NetworkCard({ name, net }: { name: string; net: NetworkBreakdown }) {
  return (
    <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 13, textTransform: 'capitalize' }}>{name.replace(/_/g, ' ')}</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {net.tendencia && <Chip tone={trendTone(net.tendencia)}>{net.tendencia}</Chip>}
        </div>
      </div>
      {net.sentimiento && <div style={{ marginBottom: 8 }}><SentimentBar s={net.sentimiento} compact /></div>}
      {(net.posts != null || net.comentarios != null) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
          {[net.posts != null ? `${net.posts} posts` : null, net.comentarios != null ? `${net.comentarios} comentarios` : null].filter(Boolean).join(' · ')}
        </div>
      )}
      {net.lectura && <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>{net.lectura}</div>}
      {net.focos && net.focos.length > 0 && (
        <ul style={{ margin: '0 0 6px', paddingLeft: 16, fontSize: 12, color: 'var(--muted)' }}>
          {net.focos.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      {net.recomendacion && (
        <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, background: 'var(--paper-soft)', padding: '6px 8px', borderRadius: 'var(--radius)', borderLeft: '2px solid var(--ink-500)' }}>
          <strong>Recomendación: </strong>{net.recomendacion}
        </div>
      )}
    </div>
  )
}

function ReportDetail({ a }: { a: ReportAnalysis }) {
  const voces = a.analisis_voces
  const redes = a.desglose_por_red ? Object.entries(a.desglose_por_red) : []
  const comp = a.comparativa_historica
  return (
    <div style={{ marginTop: 4 }}>
      {a.sentimiento && (
        <Section title="Sentimiento del periodo">
          <SentimentBar s={a.sentimiento} />
        </Section>
      )}

      {a.resumen_ejecutivo && a.resumen_ejecutivo.length > 0 && (
        <Section title="Resumen ejecutivo"><BulletList items={a.resumen_ejecutivo} /></Section>
      )}

      {a.alertas && a.alertas.length > 0 && (
        <Section title="Alertas"><BulletList items={a.alertas} tone={CRIMSON} /></Section>
      )}

      {a.plan_accion && a.plan_accion.length > 0 && (
        <Section title="Plan de acción"><BulletList items={a.plan_accion} tone={{ bg: '', fg: 'var(--ink-500)' }} /></Section>
      )}

      {a.oportunidades && a.oportunidades.length > 0 && (
        <Section title="Oportunidades"><BulletList items={a.oportunidades} tone={TEAL} /></Section>
      )}

      {redes.length > 0 && (
        <Section title="Desglose por red">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {redes.map(([name, net]) => <NetworkCard key={name} name={name} net={net} />)}
          </div>
        </Section>
      )}

      {voces && (voces.medios_destacados?.length || voces.aliados_destacados?.length || voces.criticos_destacados?.length) ? (
        <Section title="Voces destacadas">
          <VoiceGroup title="Medios" voices={voces.medios_destacados} tone={GRAY} />
          <VoiceGroup title="Aliados" voices={voces.aliados_destacados} tone={TEAL} />
          <VoiceGroup title="Críticos" voices={voces.criticos_destacados} tone={CRIMSON} />
        </Section>
      ) : null}

      {comp && (comp.resumen || comp.alertas_resueltas?.length || comp.alertas_persistentes?.length) ? (
        <Section title="Comparativa histórica">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {comp.delta_favorable != null && (
              <Chip tone={comp.delta_favorable >= 0 ? TEAL : CRIMSON}>
                Favorable {comp.delta_favorable >= 0 ? '+' : ''}{comp.delta_favorable} pts
              </Chip>
            )}
            {comp.delta_critico != null && (
              <Chip tone={comp.delta_critico <= 0 ? TEAL : CRIMSON}>
                Crítico {comp.delta_critico >= 0 ? '+' : ''}{comp.delta_critico} pts
              </Chip>
            )}
          </div>
          {comp.resumen && <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', marginBottom: 8 }}>{comp.resumen}</div>}
          {comp.alertas_resueltas && comp.alertas_resueltas.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--teal)', marginBottom: 4 }}>Resueltas</div>
              <BulletList items={comp.alertas_resueltas} tone={TEAL} />
            </div>
          )}
          {comp.alertas_persistentes && comp.alertas_persistentes.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)', marginBottom: 4 }}>Persistentes</div>
              <BulletList items={comp.alertas_persistentes} tone={AMBER} />
            </div>
          )}
        </Section>
      ) : null}
    </div>
  )
}

export function PepeReportsTab() {
  const [reports, setReports] = useState<PepeReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [themeFilter, setThemeFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPepeReports()
      .then((rows) => { if (alive) { setReports(rows); setError(null) } })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const themes = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of reports ?? []) {
      if (r.theme_key) m.set(r.theme_key, r.theme_label || r.theme_key)
    }
    return Array.from(m.entries())
  }, [reports])

  const filtered = useMemo(() => {
    const rows = reports ?? []
    return themeFilter === 'all' ? rows : rows.filter((r) => r.theme_key === themeFilter)
  }, [reports, themeFilter])

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--muted)' }}>Cargando reportes de IA…</div>
  }
  if (error) {
    return (
      <div style={{ padding: 16, marginTop: 16, background: 'var(--crimson-bg)', color: 'var(--crimson)', borderRadius: 'var(--radius)', fontSize: 13 }}>
        No se pudieron cargar los reportes: {error}
      </div>
    )
  }
  if (!reports || reports.length === 0) {
    return <div style={{ padding: 24, color: 'var(--muted)' }}>Todavía no hay reportes de IA guardados para Pepe.</div>
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="lb-section-head">
        <div>
          <div className="lb-section-title">Reportes de IA · Pepe Aguilar</div>
          <div className="lb-section-sub">
            Monitoreo de redes y reputación generado por IA. Fuente: Supabase dedicado de Pepe (solo lectura).
          </div>
        </div>
        <span className="lb-section-count">{filtered.length}</span>
      </div>

      {/* Filtro por tema */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        <FilterChip active={themeFilter === 'all'} onClick={() => setThemeFilter('all')}>Todos</FilterChip>
        {themes.map(([key, label]) => (
          <FilterChip key={key} active={themeFilter === key} onClick={() => setThemeFilter(key)}>{label}</FilterChip>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((r) => {
          const a = r.ai_analysis
          const open = openId === r.id
          const risk = riskTone(a?.nivel_riesgo)
          return (
            <article
              key={r.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--panel)',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text)',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', minWidth: 92 }}>{fmtDate(r.date_key)}</span>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{r.theme_label || r.theme_key || 'Reporte'}</span>
                {a?.sentimiento && <SentimentBar s={a.sentimiento} compact />}
                {a?.nivel_riesgo && <Chip tone={risk}>Riesgo {a.nivel_riesgo}</Chip>}
                <Chip tone={r.approved ? TEAL : GRAY}>{r.approved ? 'Aprobado' : 'Borrador'}</Chip>
                <span style={{ fontSize: 16, color: 'var(--muted)', width: 16, textAlign: 'center' }}>{open ? '−' : '+'}</span>
              </button>
              {open && (
                <div style={{ padding: '4px 16px 18px', borderTop: '1px solid var(--border-soft)' }}>
                  {a ? <ReportDetail a={a} /> : <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>Este reporte no tiene análisis estructurado.</div>}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--ink-500)' : 'var(--border)'}`,
        background: active ? 'var(--ink-500)' : 'transparent',
        color: active ? 'var(--paper-bright)' : 'var(--muted)',
      }}
    >
      {children}
    </button>
  )
}
