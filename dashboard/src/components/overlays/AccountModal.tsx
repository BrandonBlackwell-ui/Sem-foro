import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import type { AccountAssignment } from '../../context/AppContext'
import { Badge, StatusDot } from '../shared/Badge'
import { CONTRACT_STATUS_LABEL } from '../../hooks/useAccounts'
import { TASK_STATUS_LABEL, WORK_TYPE_LABEL } from '../../types'
import type { ComputedAccount, ContractStatusKey, TaskStatus, WorkType } from '../../types'

/** Extrae texto de un item que puede ser string u objeto con clave conocida. */
function toStr(v: unknown, ...keys: string[]): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    for (const k of keys) {
      const val = (v as Record<string, unknown>)[k]
      if (typeof val === 'string') return val
    }
    // último recurso: primer valor string del objeto
    const first = Object.values(v as object).find(x => typeof x === 'string')
    if (first) return first as string
  }
  return String(v ?? '')
}

/** Normaliza un campo que debería ser array pero la IA puede devolver como string/null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArr<T = any>(v: T[] | string | null | undefined): T[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) return [v as unknown as T]
  return []
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--rule-soft)' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>{title}</div>
      {children}
    </div>
  )
}

function IndRow({ label, value, source }: { label: string; value: number | null; source?: string }) {
  if (value === null) return null
  const color = value >= 80 ? 'var(--teal)' : value >= 65 ? 'var(--amber)' : value >= 45 ? 'var(--orange)' : 'var(--crimson)'
  const barClass = value >= 65 ? '' : value >= 45 ? 'warn' : 'danger'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--rule-soft)', alignItems: 'center' }}>
      <div>
        <span style={{ fontSize: '13.5px', color: 'var(--ink-900)', fontWeight: 500 }}>{label}</span>
        {source && <small style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginLeft: '8px' }}>{source}</small>}
        <div className={`ind-bar ${barClass}`} style={{ marginTop: '6px' }}>
          <div className="fill" style={{ width: `${value}%`, background: color }} />
        </div>
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '14px', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', minWidth: '36px', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

function Block({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em',
        color: accent || 'var(--ink-700)', fontWeight: 700, marginBottom: '9px', paddingBottom: '5px',
        borderBottom: '1px solid var(--rule-soft)',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {items.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--slate-2)', flexShrink: 0, marginTop: '1px', fontSize: '13px', lineHeight: 1.4 }}>▸</span>
          <span style={{ fontSize: '13px', color: 'var(--graphite)', lineHeight: 1.55 }}>{t}</span>
        </div>
      ))}
    </div>
  )
}

const PROMISE_STATUS: Record<string, { bg: string; bd: string; fg: string; label: string }> = {
  cumplido:    { bg: 'rgba(0,168,132,0.10)', bd: 'rgba(0,168,132,0.30)', fg: 'var(--teal)',    label: 'Cumplido' },
  en_proceso:  { bg: 'rgba(58,110,165,0.10)', bd: 'rgba(58,110,165,0.30)', fg: 'var(--slate-2)', label: 'En proceso' },
  pendiente:   { bg: 'rgba(239,130,18,0.10)', bd: 'rgba(239,130,18,0.30)', fg: 'var(--orange)',  label: 'Pendiente' },
  en_riesgo:   { bg: 'rgba(180,58,58,0.10)',  bd: 'rgba(180,58,58,0.30)',  fg: 'var(--crimson)', label: 'En riesgo' },
}

function StatusChip({ status }: { status?: string | null }) {
  const key = (status || '').toLowerCase()
  const s = PROMISE_STATUS[key]
  if (!s) return null
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      color: s.fg, background: s.bg, border: `1px solid ${s.bd}`, padding: '1px 7px', borderRadius: '10px', flexShrink: 0,
    }}>
      {s.label}
    </span>
  )
}

function AssignmentPanel({ account }: { account: ComputedAccount }) {
  const { assignments, setAssignment } = useApp()
  const saved: Partial<AccountAssignment> = assignments[account.id] || {}
  const [consultant, setConsultant] = useState(saved.consultant || '')
  // Pre-llenar director de célula con cellLead automático si no hay asignación manual
  const [cellDirector, setCellDirector] = useState(
    saved.cell_director || account.cellLead || ''
  )
  const [updatedBy, setUpdatedBy] = useState(saved.updated_by || '')
  const [open, setOpen] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [saveError, setSaveError] = useState('')

  const hasAssignment = !!(saved.consultant || saved.cell_director)

  async function handleSave() {
    setSaveError('')
    const result = await setAssignment(account.id, {
      account_name: account.name,
      consultant: consultant.trim(),
      cell_director: cellDirector.trim(),
      updated_by: updatedBy.trim() || 'Ops',
    })
    if (result.ok) {
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } else {
      setSaveError(result.error || 'No se pudo guardar en Supabase.')
    }
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      style={{
        background: 'none', border: '1px solid var(--rule)', borderRadius: '2px',
        padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
        color: hasAssignment ? 'var(--accent)' : 'var(--char)', marginBottom: '10px',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}
    >
      <span>👤</span>
      {hasAssignment
        ? `${saved.consultant || '—'} · Dir: ${saved.cell_director || '—'}`
        : 'Asignar consultor y director de célula'}
    </button>
  )

  return (
    <div style={{
      background: 'var(--paper-soft)', border: '1px solid var(--rule)',
      borderRadius: '4px', padding: '14px 16px', marginBottom: '12px',
    }}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
        <span>👤 Asignación del equipo</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--char)', fontSize: '14px' }}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <label style={{ fontSize: '11px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          CONSULTOR
          <input
            value={consultant}
            onChange={e => setConsultant(e.target.value)}
            placeholder="Ej. Ángel López"
            style={{ padding: '7px 10px', border: '1px solid var(--rule)', borderRadius: '2px', fontSize: '13px', background: 'var(--paper-bright)' }}
          />
        </label>
        <label style={{ fontSize: '11px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          DIRECTOR DE CÉLULA
          <input
            value={cellDirector}
            onChange={e => setCellDirector(e.target.value)}
            placeholder="Ej. Sol Martínez"
            style={{ padding: '7px 10px', border: '1px solid var(--rule)', borderRadius: '2px', fontSize: '13px', background: 'var(--paper-bright)' }}
          />
        </label>
      </div>

      <label style={{ fontSize: '11px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
        REGISTRADO POR
        <input
          value={updatedBy}
          onChange={e => setUpdatedBy(e.target.value)}
          placeholder="Tu nombre"
          style={{ padding: '7px 10px', border: '1px solid var(--rule)', borderRadius: '2px', fontSize: '13px', background: 'var(--paper-bright)', maxWidth: '200px' }}
        />
      </label>

      <button
        onClick={handleSave}
        style={{
          background: savedOk ? '#16a34a' : 'var(--ink-800)', color: '#fff',
          border: 'none', borderRadius: '2px', padding: '8px 16px',
          fontSize: '13px', cursor: 'pointer', fontWeight: 500,
        }}
      >
        {savedOk ? '✓ Guardado' : 'Guardar'}
      </button>
      {saveError && (
        <div style={{ marginTop: '8px', padding: '7px 10px', background: 'rgba(180,58,58,0.08)', border: '1px solid rgba(180,58,58,0.35)', borderRadius: '2px', fontSize: '12px', color: 'var(--crimson)' }}>
          ⚠ No se guardó: {saveError}
        </div>
      )}
    </div>
  )
}

const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  por_hacer: 'var(--char)',
  en_proceso: 'var(--slate-2)',
  en_revision: 'var(--orange)',
  hecho: 'var(--teal)',
}
const WORK_TYPES_M: WorkType[] = ['reporte', 'analisis', 'media_training', 'crisis', 'nota_clientes', 'campana', 'reunion', 'otro']

function TasksPanel({ account }: { account: ComputedAccount }) {
  const { tasks, addTask, updateTask, deleteTask, generateTasksFromIA } = useApp()
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const accTasks = tasks
    .filter(t => t.account_id === account.id)
    .sort((a, b) => (a.status === 'hecho' ? 1 : 0) - (b.status === 'hecho' ? 1 : 0))

  async function handleGen() {
    setBusy(true); setMsg('')
    try {
      const r = await generateTasksFromIA(account.id)
      setMsg(r.created > 0 ? `✓ ${r.created} pendientes agregados` : 'Sin pendientes nuevos')
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  function handleAdd() {
    if (!newTitle.trim()) return
    addTask({
      account_id: account.id, account_name: account.name,
      title: newTitle.trim(), responsable: account.cellLead || null, source: 'manual',
    })
    setNewTitle('')
  }

  return (
    <Section title="Tareas / pendientes (Monday → Supabase)">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={handleGen}
          disabled={busy}
          style={{ background: 'var(--slate-2)', color: '#fff', border: 'none', borderRadius: '2px', padding: '6px 12px', fontSize: '12px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? 'Generando…' : '⚙ Generar pendientes desde IA'}
        </button>
        {msg && <span style={{ fontSize: '12px', color: 'var(--teal)' }}>{msg}</span>}
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="Nueva tarea para esta cuenta…"
          style={{ flex: 1, background: 'var(--paper-bright)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '7px 10px', fontSize: '12.5px', color: 'var(--text)' }}
        />
        <button onClick={handleAdd} style={{ background: 'var(--ink-800)', color: '#fff', border: 'none', borderRadius: '2px', padding: '7px 14px', fontSize: '12.5px', cursor: 'pointer' }}>
          Agregar
        </button>
      </div>

      {accTasks.length === 0 ? (
        <p style={{ fontSize: '12.5px', color: 'var(--char)', margin: 0 }}>
          Sin tareas registradas. Genera el pendiente desde el análisis IA o agrega una manualmente.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {accTasks.map(t => (
            <div key={t.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 10px', background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', borderRadius: '3px', borderLeft: `3px solid ${TASK_STATUS_COLOR[t.status]}`, opacity: t.status === 'hecho' ? 0.6 : 1 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12.5px', color: 'var(--ink-900)', fontWeight: 500, lineHeight: 1.45, textDecoration: t.status === 'hecho' ? 'line-through' : 'none' }}>
                  {t.title}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--char)', background: 'var(--bg)', padding: '1px 6px', borderRadius: '8px', border: '1px solid var(--rule-soft)' }}>
                    {WORK_TYPE_LABEL[(t.work_type || 'otro') as WorkType]}
                  </span>
                  {t.responsable && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)' }}>· {t.responsable}</span>}
                  {t.due_date && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--orange)' }}>· {t.due_date}</span>}
                  {t.delivery_link && <a href={t.delivery_link} target="_blank" rel="noreferrer" style={{ fontSize: '11px' }}>🔗</a>}
                </div>
              </div>
              <select
                value={t.status}
                onChange={e => updateTask(t.id, { status: e.target.value as TaskStatus })}
                style={{ background: 'var(--paper-bright)', border: `1px solid ${TASK_STATUS_COLOR[t.status]}`, color: TASK_STATUS_COLOR[t.status], borderRadius: '10px', padding: '3px 6px', fontSize: '10px', fontFamily: 'var(--mono)', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
              >
                {(['por_hacer', 'en_proceso', 'en_revision', 'hecho'] as TaskStatus[]).map(s => (
                  <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button
                onClick={() => { if (confirm(`¿Eliminar "${t.title}"?`)) deleteTask(t.id) }}
                title="Eliminar"
                style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: '2px', cursor: 'pointer', color: 'var(--crimson)', fontSize: '11px', padding: '3px 6px', flexShrink: 0 }}
              >🗑</button>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '10px', fontFamily: 'var(--mono)' }}>
        {WORK_TYPES_M.length} tipos · editable en el tab "Tareas"
      </p>
    </Section>
  )
}

function OverridePanel({ account }: { account: ComputedAccount }) {
  const { setScoreOverride, scoreOverrides, overrideReasons, setOverrideReason, accounts } = useApp()
  const [open, setOpen] = useState(false)
  const ovs = scoreOverrides[account.id] || {}
  const savedReason = overrideReasons[account.id]

  // Local draft state
  const [draftCo, setDraftCo] = useState<string>(() => ovs['co'] != null ? String(ovs['co']) : '')
  const [draftPq, setDraftPq] = useState<string>(() => ovs['pq'] != null ? String(ovs['pq']) : '')
  const [draftSc, setDraftSc] = useState<string>(() => ovs['sc'] != null ? String(ovs['sc']) : '')
  const [draftReason, setDraftReason] = useState<string>(() => savedReason?.reason || '')
  const [draftSetBy, setDraftSetBy] = useState<string>(() => savedReason?.setBy || '')
  const [saved, setSaved] = useState(false)

  const hasActiveOverride = Object.keys(ovs).length > 0

  function handleSave() {
    const parse = (v: string) => v.trim() === '' ? null : Math.max(0, Math.min(100, parseFloat(v)))
    const co = parse(draftCo)
    const pq = parse(draftPq)
    const sc = parse(draftSc)
    setScoreOverride(account.id, 'co', co)
    setScoreOverride(account.id, 'pq', pq)
    setScoreOverride(account.id, 'sc', sc)
    if (draftReason.trim()) {
      setOverrideReason(
        account.id,
        draftReason.trim(),
        draftSetBy.trim() || 'Ops',
        account.name,
        { co, pq, sc }
      )
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleClear() {
    ;['co', 'pq', 'sc'].forEach(ax => setScoreOverride(account.id, ax, null))
    // Borrar de Supabase (importado desde AppContext via clearAllOverrides, pero aquí borramos solo esta cuenta)
    fetch(`https://vqgfkfvywbpjldreuplb.supabase.co/rest/v1/score_overrides?account_id=eq.${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
      headers: {
        'apikey': 'sb_publishable_MQ8JlDI41ymSUpcrV_8o_w_uLl8g1SM',
        'Authorization': 'Bearer sb_publishable_MQ8JlDI41ymSUpcrV_8o_w_uLl8g1SM',
      },
    }).catch(() => {})
    setDraftCo(''); setDraftPq(''); setDraftSc('')
    setDraftReason(''); setDraftSetBy('')
    setOpen(false)
  }

  function handleExport() {
    // Genera CSV con todos los overrides activos de todas las cuentas
    const rows: string[] = [
      ['Cuenta', 'ID', 'CO override', 'PQ override', 'SC override', 'Motivo', 'Responsable', 'Fecha'].join(',')
    ]
    for (const acc of accounts) {
      const ovAcc = scoreOverrides[acc.id]
      if (!ovAcc || Object.keys(ovAcc).length === 0) continue
      const r = overrideReasons[acc.id]
      rows.push([
        `"${acc.name}"`,
        acc.id,
        ovAcc['co'] ?? '',
        ovAcc['pq'] ?? '',
        ovAcc['sc'] ?? '',
        `"${r?.reason || ''}"`,
        `"${r?.setBy || ''}"`,
        r?.date || new Date().toISOString().slice(0, 10),
      ].join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `score_overrides_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            background: hasActiveOverride ? 'rgba(239,130,18,0.1)' : 'transparent',
            border: `1px solid ${hasActiveOverride ? 'var(--orange)' : 'var(--rule)'}`,
            padding: '6px 10px', borderRadius: '2px', fontSize: '11.5px',
            fontFamily: 'var(--mono)', letterSpacing: '0.04em',
            color: hasActiveOverride ? 'var(--orange)' : 'var(--ink-700)', cursor: 'pointer',
          }}
        >
          {hasActiveOverride ? '✏ Override activo' : 'Ajustar score manualmente'}
        </button>
        {Object.keys(scoreOverrides).some(id => Object.keys(scoreOverrides[id]).length > 0) && (
          <button
            onClick={handleExport}
            style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '6px 10px', borderRadius: '2px', fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--char)', cursor: 'pointer' }}
          >
            ↓ Exportar Excel
          </button>
        )}
        {hasActiveOverride && savedReason && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)' }}>
            {savedReason.setBy && `${savedReason.setBy} · `}{savedReason.date} — "{savedReason.reason.slice(0, 60)}{savedReason.reason.length > 60 ? '…' : ''}"
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="override-panel" style={{ marginTop: '10px', padding: '14px 16px', border: '1px solid var(--orange)', borderRadius: '3px', background: 'rgba(239,130,18,0.04)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--orange)', marginBottom: '12px', fontWeight: 700 }}>
        ✏ Override manual de calificación
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--char)', marginBottom: '10px' }}>
        Si el cálculo automático está mal, pega aquí el valor correcto del 0–100.<br />
        Para volver al automático, deja en blanco.
      </div>

      {/* Scores */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {([['co', draftCo, setDraftCo], ['pq', draftPq, setDraftPq], ['sc', draftSc, setDraftSc]] as [string, string, (v: string) => void][]).map(([axis, val, setter]) => (
          <div key={axis} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--char)' }}>
              {axis.toUpperCase()} auto: {ovs[axis] ?? '—'}
            </label>
            <input
              type="number" min={0} max={100}
              value={val}
              onChange={e => setter(e.target.value)}
              placeholder="auto"
              style={{ width: '72px', background: 'var(--paper-soft)', border: `1px solid ${val ? 'var(--orange)' : 'var(--rule)'}`, borderRadius: '2px', padding: '6px 10px', fontSize: '12.5px', color: 'var(--text)' }}
            />
          </div>
        ))}
      </div>

      {/* Motivo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--char)' }}>
          Motivo del ajuste *
        </label>
        <textarea
          value={draftReason}
          onChange={e => setDraftReason(e.target.value)}
          placeholder="Ej: Error grave de operaciones. Cliente pidió pausa. Score manual hasta resolver."
          rows={2}
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '7px 10px', fontSize: '12px', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <input
          type="text"
          value={draftSetBy}
          onChange={e => setDraftSetBy(e.target.value)}
          placeholder="Tu nombre (quién hace el ajuste)"
          style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '6px 10px', fontSize: '12px', color: 'var(--text)', fontFamily: 'inherit' }}
        />
      </div>

      {/* Botones */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          style={{ background: 'var(--orange)', border: 'none', padding: '7px 16px', borderRadius: '2px', fontSize: '12px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          {saved ? '✓ Guardado' : 'Guardar'}
        </button>
        <button
          onClick={handleExport}
          style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '7px 14px', borderRadius: '2px', fontSize: '12px', color: 'var(--ink-700)', cursor: 'pointer' }}
        >
          ↓ Exportar Excel (CSV)
        </button>
        <button
          onClick={handleClear}
          style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '7px 12px', borderRadius: '2px', fontSize: '12px', color: 'var(--char)', cursor: 'pointer' }}
        >
          Limpiar override
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'transparent', border: 'none', padding: '7px 8px', fontSize: '12px', color: 'var(--char)', cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export function AccountModal() {
  const { accounts, modalAccountId, closeModal } = useApp()
  if (!modalAccountId) return null
  const account = accounts.find(a => a.id === modalAccountId)
  if (!account) return null

  const contractLabel = account.contractStatus
    ? CONTRACT_STATUS_LABEL[account.contractStatus.status as ContractStatusKey]
    : null

  const files = account.drive?.files || []

  // Defensive: account_summary might have string fields that contain nested JSON
  // (happens when Claude wraps the response in a code fence inside a field value)
  function unwrapSummaryField(val: unknown): unknown {
    if (typeof val !== 'string') return val
    const s = val.trim()
    if (!s.startsWith('```') && !s.startsWith('{')) return val
    try {
      const text = s.startsWith('```')
        ? s.split('```').map(p => p.startsWith('json') ? p.slice(4) : p).reduce((a, b) => b.length > a.length ? b : a, '').trim()
        : s
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') return parsed
    } catch { /* use as-is */ }
    return val
  }

  const rawSummary = account.drive?.account_summary
  const driveAnalysis = (() => {
    if (!rawSummary) return undefined
    // If content_summary itself contains a full JSON, unwrap it
    const cs = rawSummary.content_summary
    if (typeof cs === 'string' && (cs.trim().startsWith('```') || cs.trim().startsWith('{'))) {
      const nested = unwrapSummaryField(cs)
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return { ...nested as typeof rawSummary, ...rawSummary, content_summary: (nested as typeof rawSummary).content_summary ?? cs }
      }
    }
    return rawSummary
  })()

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,27,69,0.55)',
          zIndex: 80,
          backdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Modal */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--ink-800)',
            width: 'min(880px, 94vw)',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 16px 40px rgba(14,27,69,0.18)',
            zIndex: 90,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '22px 28px 16px',
              borderBottom: '2px solid var(--ink-900)',
              position: 'sticky', top: 0,
              background: 'var(--panel)',
              zIndex: 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink-900)', marginBottom: '6px' }}>
                {account.name}
              </h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusDot color={account.color} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
                  {account.number} · {account.driveTitle}
                </span>
                {account.statusVariant && <Badge variant={account.statusVariant}>{account.statusVariant}</Badge>}
                {account.cadenceType === 'on-demand' && <Badge variant="ondemand">on-demand</Badge>}
                {account.cell && <Badge variant={`cell-${account.cell.toLowerCase()}`}>Célula {account.cell}</Badge>}
                {contractLabel && account.contractStatus?.status !== 'signed_current' && (
                  <Badge variant="orange">🔓 {contractLabel.short}</Badge>
                )}
              </div>
            </div>
            <button
              onClick={closeModal}
              style={{
                width: '32px', height: '32px',
                border: '1px solid var(--rule)',
                background: 'transparent',
                borderRadius: '2px',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                fontSize: '14px',
                color: 'var(--ink-700)',
                flexShrink: 0,
                marginLeft: '16px',
              }}
            >
              ×
            </button>
          </div>

          {/* Contrato alert */}
          {account.contratoAlert && (
            <div style={{ padding: '0 28px', marginTop: '16px' }}>
              <div className="contrato-alert">
                <strong>⚠ Contrato pendiente</strong> — {account.contratoAlert}.
                El score es <strong>indicativo</strong> (no auditable) sin alcance contractual firmado.
                Sube el archivo a <code>01.Contrato_OC</code> para validar.
              </div>
            </div>
          )}

          {/* Scores */}
          <Section title="Indicadores de salud">
            <IndRow label="CO — Cumplimiento Operativo" value={account.co} />
            <IndRow label="PQ — Performance / Calidad" value={account.pq} />
            <IndRow label="SC — Satisfacción del Cliente" value={account.sc} />
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--rule-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
                  Global · {account.scoreFormula}
                </span>
                {account.global !== null && (
                  <span
                    className={`color-${account.color}`}
                    style={{ fontFamily: 'var(--mono)', fontSize: '28px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {account.global}
                  </span>
                )}
              </div>
            </div>
            <AssignmentPanel account={account} />
            <OverridePanel account={account} />
          </Section>

          {/* Tareas / pendientes */}
          <TasksPanel account={account} />

          {/* Drive content */}
          {driveAnalysis && (
            <Section title="Análisis Drive · evidencia leída">
              {/* Stamp with analysis date */}
              {(() => {
                const genDate = account.drive?.analyzed_at || null
                if (!genDate) return null
                const d = new Date(genDate)
                if (Number.isNaN(d.getTime())) return null
                const today = new Date()
                const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000)
                const locale = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
                const rel = diffDays === 0 ? 'hoy' : diffDays === 1 ? 'ayer' : `hace ${diffDays}d`
                return (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginBottom: '16px', letterSpacing: '0.04em' }}>
                    Análisis generado el {locale} · {rel} — las referencias relativas se anclan a esa fecha.
                  </div>
                )
              })()}

              {/* 1 · Propósito del proyecto */}
              {driveAnalysis.project_purpose && (
                <div style={{ background: 'rgba(58,110,165,0.07)', border: '1px solid rgba(58,110,165,0.25)', borderLeft: '4px solid var(--slate-2)', padding: '12px 16px', borderRadius: '2px', marginBottom: '18px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--slate-2)', fontWeight: 700, marginBottom: '6px' }}>
                    🎯 Propósito del proyecto
                  </div>
                  <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--ink-900)', lineHeight: 1.6, fontWeight: 500 }}>
                    {driveAnalysis.project_purpose}
                  </p>
                </div>
              )}

              {/* 2 · Qué hacemos por el cliente */}
              {asArr(driveAnalysis.scope_of_service).length > 0 && (
                <Block title="🤝 Qué hacemos por el cliente">
                  <Bullets items={asArr(driveAnalysis.scope_of_service).filter(Boolean) as string[]} />
                </Block>
              )}

              {/* 3 · Resumen ejecutivo */}
              {driveAnalysis.content_summary && (
                <p style={{ fontSize: '13.5px', color: 'var(--graphite)', lineHeight: 1.7, marginBottom: '20px' }}>
                  {driveAnalysis.content_summary}
                </p>
              )}

              {/* 4 · Lo que prometimos al cliente */}
              {asArr(driveAnalysis.client_promises).length > 0 ? (
                <Block title="📋 Lo que prometimos al cliente">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {asArr(driveAnalysis.client_promises).map((p, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                        <span style={{ color: 'var(--char)', fontSize: '11px', flexShrink: 0, marginTop: '2px', fontFamily: 'var(--mono)' }}>#{i + 1}</span>
                        <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', color: 'var(--ink-900)', fontWeight: 500, lineHeight: 1.5 }}>
                            {p.promise}
                            {p.cadence && p.cadence !== 'null' && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginLeft: '8px' }}>· {p.cadence}</span>
                            )}
                          </span>
                          <StatusChip status={p.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Block>
              ) : (asArr(driveAnalysis.commitments).length > 0 && (
                <Block title="📋 Lo que prometimos al cliente">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {asArr(driveAnalysis.commitments).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                        <span style={{ color: 'var(--char)', fontSize: '11px', flexShrink: 0, marginTop: '2px', fontFamily: 'var(--mono)' }}>#{i + 1}</span>
                        <span style={{ fontSize: '12.5px', color: 'var(--ink-900)', fontWeight: 500, flex: 1 }}>
                          {c.description}
                          {c.frequency && c.frequency !== 'null' && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginLeft: '8px' }}>· {c.frequency}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </Block>
              ))}

              {/* 5 · CHECKLIST: Cumplido vs Pendiente */}
              {(asArr(driveAnalysis.fulfilled).length > 0 || asArr(driveAnalysis.pending).length > 0) && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--ink-700)', fontWeight: 700, marginBottom: '10px', paddingBottom: '5px', borderBottom: '2px solid var(--rule)' }}>
                    ✅ Checklist de cumplimiento
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {asArr(driveAnalysis.fulfilled).map((item, i) => (
                      <div key={`f-${i}`} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(0,168,132,0.07)', border: '1px solid rgba(0,168,132,0.22)', borderLeft: '4px solid var(--teal)', padding: '8px 12px', borderRadius: '2px' }}>
                        <span style={{ color: 'var(--teal)', fontWeight: 700, fontSize: '15px', lineHeight: 1, flexShrink: 0, marginTop: '1px' }}>☑</span>
                        <span style={{ fontSize: '13px', color: 'var(--ink-900)', lineHeight: 1.55 }}>{item}</span>
                      </div>
                    ))}
                    {asArr(driveAnalysis.pending).map((item, i) => (
                      <div key={`p-${i}`} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(239,130,18,0.07)', border: '1px solid rgba(239,130,18,0.25)', borderLeft: '4px solid var(--orange)', padding: '8px 12px', borderRadius: '2px' }}>
                        <span style={{ color: 'var(--orange)', fontWeight: 700, fontSize: '15px', lineHeight: 1, flexShrink: 0, marginTop: '1px' }}>☐</span>
                        <span style={{ fontSize: '13px', color: 'var(--ink-900)', lineHeight: 1.55 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6 · Plan de acción */}
              {asArr(driveAnalysis.action_plan).length > 0 && (
                <Block title="🗺 Plan de acción">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {asArr(driveAnalysis.action_plan).map((step, i) => {
                      const stepObj = typeof step === 'object' && step !== null ? step as Record<string, unknown> : { step: String(step) }
                      const st = (String(stepObj.status || '')).toLowerCase()
                      const icon = st === 'hecho' ? '☑' : st === 'en_proceso' ? '◐' : '☐'
                      const iconColor = st === 'hecho' ? 'var(--teal)' : st === 'en_proceso' ? 'var(--slate-2)' : 'var(--char)'
                      return (
                        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '5px 0' }}>
                          <span style={{ color: iconColor, fontWeight: 700, fontSize: '15px', lineHeight: 1.3, flexShrink: 0 }}>{icon}</span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '13px', color: 'var(--ink-900)', lineHeight: 1.5, textDecoration: st === 'hecho' ? 'line-through' : 'none', opacity: st === 'hecho' ? 0.7 : 1 }}>
                              {toStr(stepObj.step ?? step, 'step', 'action', 'description')}
                            </span>
                            {(stepObj.owner != null || stepObj.due != null) && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginLeft: '8px' }}>
                                {stepObj.owner && String(stepObj.owner) !== 'null' ? `· ${String(stepObj.owner)}` : ''}
                                {stepObj.due && String(stepObj.due) !== 'null' ? ` · ${String(stepObj.due)}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Block>
              )}

              {/* 7 · En qué punto vamos */}
              {driveAnalysis.current_status && (
                <Block title="📍 En qué punto vamos hoy">
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--graphite)', lineHeight: 1.6 }}>
                    {driveAnalysis.current_status}
                  </p>
                </Block>
              )}

              {/* 8 · Riesgos + Oportunidades */}
              {(() => {
                const risks = asArr(driveAnalysis.risks).length > 0
                  ? asArr(driveAnalysis.risks)
                  : (driveAnalysis.business_risk ? [{ risk: driveAnalysis.business_risk, severity: null }] : [])
                const opps = asArr(driveAnalysis.opportunities).length > 0
                  ? asArr(driveAnalysis.opportunities)
                  : (driveAnalysis.opportunity ? [driveAnalysis.opportunity] : [])
                if (risks.length === 0 && opps.length === 0) return null
                const SEV: Record<string, string> = { alta: 'var(--crimson)', media: 'var(--orange)', baja: 'var(--amber)' }
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: risks.length && opps.length ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '18px' }}>
                    {risks.length > 0 && (
                      <div style={{ background: 'rgba(180,58,58,0.06)', border: '1px solid rgba(180,58,58,0.28)', borderLeft: '4px solid var(--crimson)', padding: '12px 14px', borderRadius: '2px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--crimson)', fontWeight: 700, marginBottom: '8px' }}>
                          ⚠ Riesgos
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {risks.map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start' }}>
                              {(typeof r === 'object' && r !== null && (r as {severity?: string}).severity) && (
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEV[((r as {severity?: string}).severity || '').toLowerCase()] || 'var(--char)', flexShrink: 0, marginTop: '5px' }} />
                              )}
                              <span style={{ fontSize: '12.5px', color: 'var(--ink-900)', lineHeight: 1.5 }}>{toStr(r, 'risk', 'description', 'text')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {opps.length > 0 && (
                      <div style={{ background: 'rgba(0,168,132,0.06)', border: '1px solid rgba(0,168,132,0.25)', borderLeft: '4px solid var(--teal)', padding: '12px 14px', borderRadius: '2px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--teal)', fontWeight: 700, marginBottom: '8px' }}>
                          💡 Oportunidades
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {opps.map((o, i) => (
                            <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start' }}>
                              <span style={{ color: 'var(--teal)', flexShrink: 0, marginTop: '1px' }}>▸</span>
                              <span style={{ fontSize: '12.5px', color: 'var(--ink-900)', lineHeight: 1.5 }}>{toStr(o, 'opportunity', 'description', 'text')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 9 · Acciones urgentes (esta semana) */}
              {(() => {
                let urgent: { action?: string | null; owner?: string | null; due?: string | null }[] = []
                if (asArr(driveAnalysis.urgent_actions).length > 0) {
                  urgent = asArr(driveAnalysis.urgent_actions)
                } else if (asArr(driveAnalysis.immediate_actions).length > 0) {
                  urgent = asArr(driveAnalysis.immediate_actions).map(a => ({ action: a as string, owner: null, due: null }))
                } else if (driveAnalysis.recommended_action) {
                  urgent = [{ action: driveAnalysis.recommended_action, owner: null, due: null }]
                }
                if (urgent.length === 0) return null
                return (
                  <div style={{ marginBottom: '18px', background: 'rgba(255,193,7,0.07)', border: '1px solid var(--amber)', borderLeft: '4px solid var(--amber)', padding: '12px 16px', borderRadius: '2px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--amber)', fontWeight: 700, marginBottom: '10px' }}>
                      ⚡ Acciones urgentes — esta semana
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {urgent.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, color: 'var(--amber)', flexShrink: 0, minWidth: '22px' }}>({i + 1})</span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '13px', color: 'var(--ink-900)', lineHeight: 1.55, fontWeight: 500 }}>{a.action}</span>
                            {(a.owner || a.due) && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', marginLeft: '8px' }}>
                                {a.owner && a.owner !== 'null' ? `· ${a.owner}` : ''}
                                {a.due && a.due !== 'null' ? ` · ${a.due}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* 10 · Recomendaciones estratégicas */}
              {(() => {
                const recs = asArr(driveAnalysis.strategic_recommendations).length > 0
                  ? asArr(driveAnalysis.strategic_recommendations)
                  : asArr(driveAnalysis.strategic_steps)
                if (!recs || recs.length === 0) return null
                return (
                  <Block title="🧭 Recomendaciones estratégicas">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {recs.map((step, i) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)', flexShrink: 0, marginTop: '2px' }}>{i + 1}.</span>
                          <span style={{ fontSize: '13px', color: 'var(--graphite)', lineHeight: 1.55 }}>{toStr(step, 'recommendation', 'step', 'action', 'description', 'text')}</span>
                        </div>
                      ))}
                    </div>
                  </Block>
                )
              })()}

              {/* 11 · Hallazgos por archivo */}
              {asArr(driveAnalysis.per_file_notes).length > 0 && (
                <Block title="🔍 Hallazgos por archivo">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {asArr(driveAnalysis.per_file_notes).map((n, i) => (
                      <div key={i} style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', padding: '8px 12px', borderRadius: '2px', borderLeft: '3px solid var(--slate-2)' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', fontWeight: 600, color: 'var(--ink-900)' }}>
                            {n.file || '—'}
                          </span>
                          {n.folder && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--char)', background: 'var(--bg)', padding: '1px 6px', borderRadius: '10px', border: '1px solid var(--rule-soft)' }}>
                              {n.folder}
                            </span>
                          )}
                        </div>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--graphite)', lineHeight: 1.55 }}>
                          {n.finding || '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </Block>
              )}

              {/* 12 · Hechos clave */}
              {asArr(driveAnalysis.key_facts).length > 0 && (
                <Block title="Hechos clave">
                  <Bullets items={asArr(driveAnalysis.key_facts).filter(Boolean) as string[]} />
                </Block>
              )}

              {/* 13 · Notas del analista */}
              {driveAnalysis.notes && (
                <div style={{ marginTop: '8px', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--rule-soft)', borderRadius: '2px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--char)', fontWeight: 600 }}>
                    Notas del analista
                  </span>
                  <p style={{ marginTop: '5px', fontSize: '12px', color: 'var(--graphite)', lineHeight: 1.5 }}>
                    {driveAnalysis.notes}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* Métricas del playbook leídas del contenido */}
          {driveAnalysis && (driveAnalysis.pq_assessment || driveAnalysis.co_assessment || asArr(driveAnalysis.sc_signals).length > 0 || driveAnalysis.media_reconciliation) && (
            <Section title="Métricas operativas (leídas del contenido)">
              {driveAnalysis.pq_assessment && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-700)', fontWeight: 600, marginBottom: '6px' }}>
                    PQ — Performance / Calidad
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    {driveAnalysis.pq_assessment.placements != null && driveAnalysis.pq_assessment.placements !== '' && (
                      <Badge variant="green">{String(driveAnalysis.pq_assessment.placements)} placements</Badge>
                    )}
                    {driveAnalysis.pq_assessment.tier_mix && <Badge variant="yellow">{driveAnalysis.pq_assessment.tier_mix}</Badge>}
                    {driveAnalysis.pq_assessment.score_estimate != null && driveAnalysis.pq_assessment.score_estimate !== '' && (
                      <Badge variant="ondemand">PQ ~{String(driveAnalysis.pq_assessment.score_estimate)}</Badge>
                    )}
                  </div>
                  {driveAnalysis.pq_assessment.quality_narrative && (
                    <p style={{ fontSize: '12.5px', color: 'var(--graphite)', lineHeight: 1.5, margin: '4px 0 0' }}>{driveAnalysis.pq_assessment.quality_narrative}</p>
                  )}
                  {driveAnalysis.pq_assessment.result_vs_objective && (
                    <p style={{ fontSize: '12.5px', color: 'var(--graphite)', lineHeight: 1.5, margin: '4px 0 0' }}>
                      <strong>Resultado vs objetivo:</strong> {driveAnalysis.pq_assessment.result_vs_objective}
                    </p>
                  )}
                </div>
              )}

              {driveAnalysis.co_assessment && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-700)', fontWeight: 600, marginBottom: '6px' }}>
                    CO — Cumplimiento Operativo
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {driveAnalysis.co_assessment.committed != null && driveAnalysis.co_assessment.committed !== '' && (
                      <Badge variant="ondemand">{String(driveAnalysis.co_assessment.committed)} comprometidos</Badge>
                    )}
                    {driveAnalysis.co_assessment.on_time != null && driveAnalysis.co_assessment.on_time !== '' && (
                      <Badge variant="green">{String(driveAnalysis.co_assessment.on_time)} a tiempo</Badge>
                    )}
                    {driveAnalysis.co_assessment.late != null && driveAnalysis.co_assessment.late !== '' && (
                      <Badge variant="yellow">{String(driveAnalysis.co_assessment.late)} tarde</Badge>
                    )}
                    {driveAnalysis.co_assessment.missed != null && driveAnalysis.co_assessment.missed !== '' && (
                      <Badge variant="orange">{String(driveAnalysis.co_assessment.missed)} no entregados</Badge>
                    )}
                  </div>
                  {driveAnalysis.co_assessment.note && (
                    <p style={{ fontSize: '12.5px', color: 'var(--graphite)', lineHeight: 1.5, margin: '6px 0 0' }}>{driveAnalysis.co_assessment.note}</p>
                  )}
                </div>
              )}

              {asArr(driveAnalysis.sc_signals).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-700)', fontWeight: 600, marginBottom: '6px' }}>
                    SC — Señales del cliente
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {asArr(driveAnalysis.sc_signals).map((s, i) => (
                      <li key={i} style={{ fontSize: '12.5px', lineHeight: 1.5, marginBottom: '3px', color: s.type === 'negative' ? 'var(--crimson)' : 'var(--teal)' }}>
                        {s.date && <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>[{s.date}] </span>}
                        {s.signal && <strong>{s.signal}</strong>}{s.note ? `: ${s.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {driveAnalysis.media_reconciliation && (driveAnalysis.media_reconciliation.placements != null || driveAnalysis.media_reconciliation.gap) && (
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-700)', fontWeight: 600, marginBottom: '6px' }}>
                    Reconciliación de medios
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {driveAnalysis.media_reconciliation.placements != null && driveAnalysis.media_reconciliation.placements !== '' && (
                      <Badge variant="green">{String(driveAnalysis.media_reconciliation.placements)} publicadas</Badge>
                    )}
                    {driveAnalysis.media_reconciliation.reports != null && driveAnalysis.media_reconciliation.reports !== '' && (
                      <Badge variant="ondemand">{String(driveAnalysis.media_reconciliation.reports)} reportadas</Badge>
                    )}
                  </div>
                  {driveAnalysis.media_reconciliation.gap && (
                    <p style={{ fontSize: '12.5px', color: 'var(--orange)', lineHeight: 1.5, margin: '6px 0 0' }}>{driveAnalysis.media_reconciliation.gap}</p>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Subfolder checklist */}
          {account.subfolderActivity && (
            <Section title="Actividad por carpeta Drive">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                {Object.entries(account.subfolderActivity).map(([folder, data]) => {
                  const daysOld = data.latestModified
                    ? Math.round((Date.now() - new Date(data.latestModified).getTime()) / 86400000)
                    : null
                  return (
                    <div key={folder} style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', padding: '10px 12px', borderRadius: '2px' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-700)', marginBottom: '4px', fontWeight: 600 }}>
                        {folder.slice(0, 30)}
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--char)' }}>
                        {data.fileCount ?? '?'} archivos
                        {daysOld !== null && ` · últ. ${daysOld === 0 ? 'hoy' : `hace ${daysOld}d`}`}
                      </div>
                      {data.latestFile && (
                        <div style={{ fontSize: '11px', color: 'var(--char)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {data.latestFile}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Files */}
          {files.length > 0 && (
            <Section title={`Archivos leídos (${files.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.slice(0, 20).map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '5px 8px', background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', borderRadius: '2px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)', flexShrink: 0, minWidth: '16px' }}>{i + 1}.</span>
                    <span style={{ fontSize: '12px', color: 'var(--ink-900)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.title}
                    </span>
                    {f.subfolder && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9.5px', color: 'var(--char)', background: 'var(--bg)', padding: '1px 6px', borderRadius: '10px', border: '1px solid var(--rule-soft)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {f.subfolder}
                      </span>
                    )}
                    {f.kind && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--muted)', flexShrink: 0 }}>
                        {f.kind}
                      </span>
                    )}
                  </div>
                ))}
                {files.length > 20 && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)', padding: '4px 8px' }}>
                    + {files.length - 20} más…
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Next action */}
          {account.nextAction?.action && (
            <Section title="Próxima acción">
              <p style={{ fontSize: '13px', color: 'var(--ink-900)', lineHeight: 1.55 }}>
                {account.nextAction.action}
              </p>
              {account.nextAction.due && (
                <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)', marginTop: '6px' }}>
                  Fecha límite: {account.nextAction.due}
                  {account.nextAction.owner && ` · Responsable: ${account.nextAction.owner}`}
                </p>
              )}
            </Section>
          )}

          {/* Contract status */}
          {account.contractStatus && (
            <Section title="Estado del contrato">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Badge variant={account.contractStatus.status === 'signed_current' ? 'green' : 'orange'}>
                  {contractLabel?.label || account.contractStatus.status}
                </Badge>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
                  fuente: {account.contractStatus.source}
                </span>
              </div>
              {account.contractStatus.filename_evidence && (
                <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)', marginTop: '8px' }}>
                  Evidencia: {account.contractStatus.filename_evidence}
                  {account.contractStatus.latest_modified && ` · ${account.contractStatus.latest_modified?.slice(0, 10)}`}
                </p>
              )}
              {account.contractStatus.months_old && (
                <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--amber)', marginTop: '4px' }}>
                  ⚠ Contrato de hace {account.contractStatus.months_old} meses
                </p>
              )}
            </Section>
          )}
        </div>
      </div>
    </>
  )
}
