import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import {
  TASK_STATUS_LABEL, WORK_TYPE_LABEL,
} from '../../types'
import type { ClientTask, TaskStatus, WorkType } from '../../types'

const STATUS_STYLE: Record<TaskStatus, { bg: string; fg: string; bd: string }> = {
  por_hacer:   { bg: 'rgba(120,128,140,0.12)', fg: 'var(--char)',    bd: 'rgba(120,128,140,0.35)' },
  en_proceso:  { bg: 'rgba(58,110,165,0.12)',  fg: 'var(--slate-2)', bd: 'rgba(58,110,165,0.40)' },
  en_revision: { bg: 'rgba(239,130,18,0.12)',  fg: 'var(--orange)',  bd: 'rgba(239,130,18,0.40)' },
  hecho:       { bg: 'rgba(0,168,132,0.12)',   fg: 'var(--teal)',    bd: 'rgba(0,168,132,0.40)' },
}

const STATUS_ORDER: TaskStatus[] = ['por_hacer', 'en_proceso', 'en_revision', 'hecho']
const WORK_TYPES: WorkType[] = ['reporte', 'analisis', 'media_training', 'crisis', 'nota_clientes', 'campana', 'reunion', 'otro']

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--paper-bright)',
  border: '1px solid var(--rule-soft)', borderRadius: '2px', padding: '5px 7px',
  fontSize: '12px', color: 'var(--text)', fontFamily: 'inherit',
}

function StatusSelect({ value, onChange }: { value: TaskStatus; onChange: (v: TaskStatus) => void }) {
  const s = STATUS_STYLE[value]
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as TaskStatus)}
      style={{
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`, borderRadius: '12px',
        padding: '4px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'var(--mono)',
        cursor: 'pointer', appearance: 'none', textAlign: 'center', width: '100%',
      }}
    >
      {STATUS_ORDER.map(st => <option key={st} value={st}>{TASK_STATUS_LABEL[st]}</option>)}
    </select>
  )
}

function TaskRow({ task }: { task: ClientTask }) {
  const { updateTask, deleteTask } = useApp()
  const [title, setTitle] = useState(task.title)
  const [responsable, setResponsable] = useState(task.responsable || '')
  const [due, setDue] = useState(task.due_date || '')
  const [link, setLink] = useState(task.delivery_link || '')
  const [expanded, setExpanded] = useState(false)
  const done = task.status === 'hecho'

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--rule-soft)', opacity: done ? 0.6 : 1 }}>
        {/* Tarea */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '240px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
            {task.detail && task.detail !== task.title && (
              <button
                onClick={() => setExpanded(e => !e)}
                title="Ver detalle"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--char)', fontSize: '10px', padding: '4px 2px 0', flexShrink: 0 }}
              >
                {expanded ? '▾' : '▸'}
              </button>
            )}
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== task.title) updateTask(task.id, { title: title.trim() }) }}
              style={{ ...inputStyle, fontWeight: 500, textDecoration: done ? 'line-through' : 'none' }}
            />
          </div>
          {expanded && task.detail && (
            <p style={{ margin: '6px 0 0 18px', fontSize: '11.5px', color: 'var(--graphite)', lineHeight: 1.5 }}>
              {task.detail}
            </p>
          )}
          {task.source === 'ia' && (
            <span style={{ marginLeft: '18px', fontFamily: 'var(--mono)', fontSize: '8.5px', color: 'var(--muted)', letterSpacing: '0.08em' }}>IA</span>
          )}
        </td>

        {/* Cliente */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '11.5px', color: 'var(--ink-900)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {task.account_name || task.account_id}
        </td>

        {/* Estado */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '112px' }}>
          <StatusSelect value={task.status} onChange={v => updateTask(task.id, { status: v })} />
        </td>

        {/* Responsable */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '120px' }}>
          <input
            value={responsable}
            onChange={e => setResponsable(e.target.value)}
            onBlur={() => { if (responsable !== (task.responsable || '')) updateTask(task.id, { responsable: responsable.trim() || null }) }}
            placeholder="—"
            style={inputStyle}
          />
        </td>

        {/* Fecha entrega */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '128px' }}>
          <input
            type="date"
            value={due}
            onChange={e => { setDue(e.target.value); updateTask(task.id, { due_date: e.target.value || null }) }}
            style={inputStyle}
          />
        </td>

        {/* Tipo de trabajo */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '130px' }}>
          <select
            value={task.work_type || 'otro'}
            onChange={e => updateTask(task.id, { work_type: e.target.value as WorkType })}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {WORK_TYPES.map(w => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
          </select>
        </td>

        {/* Link de entrega */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '150px' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              value={link}
              onChange={e => setLink(e.target.value)}
              onBlur={() => { if (link !== (task.delivery_link || '')) updateTask(task.id, { delivery_link: link.trim() || null }) }}
              placeholder="https://…"
              style={inputStyle}
            />
            {task.delivery_link && (
              <a href={task.delivery_link} target="_blank" rel="noreferrer" title="Abrir" style={{ flexShrink: 0, textDecoration: 'none', fontSize: '13px' }}>🔗</a>
            )}
          </div>
        </td>

        {/* Acciones */}
        <td style={{ padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            {!done && (
              <button
                onClick={() => updateTask(task.id, { status: 'hecho' })}
                title="Marcar hecha"
                style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: '2px', cursor: 'pointer', color: 'var(--teal)', fontSize: '12px', padding: '3px 6px' }}
              >✓</button>
            )}
            <button
              onClick={() => { if (confirm(`¿Eliminar la tarea "${task.title}"? Se borra de Supabase.`)) deleteTask(task.id) }}
              title="Eliminar"
              style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: '2px', cursor: 'pointer', color: 'var(--crimson)', fontSize: '12px', padding: '3px 6px' }}
            >🗑</button>
          </div>
        </td>
      </tr>
    </>
  )
}

function NewTaskForm({ onClose }: { onClose: () => void }) {
  const { accounts, addTask } = useApp()
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [title, setTitle] = useState('')
  const [responsable, setResponsable] = useState('')
  const [due, setDue] = useState('')
  const [workType, setWorkType] = useState<WorkType>('otro')
  const [link, setLink] = useState('')

  function handleAdd() {
    if (!title.trim() || !accountId) return
    const acc = accounts.find(a => a.id === accountId)
    addTask({
      account_id: accountId,
      account_name: acc?.name || accountId,
      title: title.trim(),
      responsable: responsable.trim() || null,
      due_date: due || null,
      work_type: workType,
      delivery_link: link.trim() || null,
      source: 'manual',
    })
    setTitle(''); setResponsable(''); setDue(''); setLink(''); setWorkType('otro')
  }

  return (
    <div style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '4px', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>➕ Nueva tarea</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--char)', fontSize: '14px' }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '10px' }}>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cliente
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inputStyle, padding: '7px' }}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Responsable
          <input value={responsable} onChange={e => setResponsable(e.target.value)} placeholder="Ej. Ángel" style={{ ...inputStyle, padding: '7px' }} />
        </label>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Fecha entrega
          <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...inputStyle, padding: '7px' }} />
        </label>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Tipo de trabajo
          <select value={workType} onChange={e => setWorkType(e.target.value as WorkType)} style={{ ...inputStyle, padding: '7px' }}>
            {WORK_TYPES.map(w => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Link de entrega
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" style={{ ...inputStyle, padding: '7px' }} />
        </label>
      </div>
      <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
        Tarea
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Describe la tarea pendiente…" style={{ ...inputStyle, padding: '8px' }} />
      </label>
      <button
        onClick={handleAdd}
        disabled={!title.trim()}
        style={{ background: title.trim() ? 'var(--ink-800)' : 'var(--rule)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 18px', fontSize: '13px', cursor: title.trim() ? 'pointer' : 'default', fontWeight: 500 }}
      >
        Agregar tarea
      </button>
    </div>
  )
}

export function TareasTab() {
  const { tasks, accounts, generateTasksFromIA, tasksLoading } = useApp()
  const [showNew, setShowNew] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [generating, setGenerating] = useState(false)
  const [fAccount, setFAccount] = useState('all')
  const [fStatus, setFStatus] = useState<'all' | TaskStatus>('all')
  const [fType, setFType] = useState<'all' | WorkType>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (!showDone && t.status === 'hecho') return false
      if (fAccount !== 'all' && t.account_id !== fAccount) return false
      if (fStatus !== 'all' && t.status !== fStatus) return false
      if (fType !== 'all' && (t.work_type || 'otro') !== fType) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${t.title} ${t.detail || ''} ${t.account_name || ''} ${t.responsable || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      // Ordenar por estado, luego por fecha de entrega
      const so = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      if (so !== 0) return so
      const da = a.due_date || '9999'
      const db = b.due_date || '9999'
      return da.localeCompare(db)
    })
  }, [tasks, showDone, fAccount, fStatus, fType, search])

  const counts = useMemo(() => {
    const c = { por_hacer: 0, en_proceso: 0, en_revision: 0, hecho: 0 }
    for (const t of tasks) c[t.status]++
    return c
  }, [tasks])

  async function handleGenerate() {
    setGenerating(true)
    setGenMsg('')
    try {
      const r = await generateTasksFromIA()
      setGenMsg(r.created > 0
        ? `✓ ${r.created} tareas nuevas creadas (${r.accounts} cuentas).`
        : 'Todo al día — no había pendientes nuevos por agregar.')
    } catch {
      setGenMsg('Error generando tareas. Revisa la conexión a Supabase.')
    } finally {
      setGenerating(false)
      setTimeout(() => setGenMsg(''), 6000)
    }
  }

  const selStyle: React.CSSProperties = {
    background: 'var(--paper-bright)', border: '1px solid var(--rule)', borderRadius: '2px',
    padding: '6px 8px', fontSize: '12px', color: 'var(--text)',
  }

  return (
    <section>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--ink-900)', letterSpacing: '-0.01em', margin: 0 }}>
            Tareas pendientes por cliente
          </h2>
          <p style={{ fontSize: '12.5px', color: 'var(--char)', margin: '4px 0 0', maxWidth: '640px', lineHeight: 1.5 }}>
            Tablero operativo sincronizado con Supabase (reemplaza Monday). Edita cualquier campo y se guarda solo.
            Genera el pendiente desde el análisis de IA y márcalo como hecho cuando se resuelva.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{ background: 'var(--slate-2)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', fontSize: '12.5px', cursor: generating ? 'default' : 'pointer', fontWeight: 500, opacity: generating ? 0.7 : 1 }}
          >
            {generating ? 'Generando…' : '⚙ Generar desde IA'}
          </button>
          <button
            onClick={() => setShowNew(s => !s)}
            style={{ background: 'var(--ink-800)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', fontSize: '12.5px', cursor: 'pointer', fontWeight: 500 }}
          >
            ➕ Nueva tarea
          </button>
        </div>
      </div>

      {genMsg && (
        <div style={{ marginBottom: '14px', padding: '8px 12px', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '3px', fontSize: '12.5px', color: 'var(--ink-900)' }}>
          {genMsg}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {STATUS_ORDER.map(st => {
          const s = STATUS_STYLE[st]
          return (
            <button
              key={st}
              onClick={() => setFStatus(fStatus === st ? 'all' : st)}
              style={{
                background: fStatus === st ? s.fg : s.bg, color: fStatus === st ? '#fff' : s.fg,
                border: `1px solid ${s.bd}`, borderRadius: '14px', padding: '5px 12px',
                fontSize: '11.5px', fontWeight: 600, fontFamily: 'var(--mono)', cursor: 'pointer',
              }}
            >
              {TASK_STATUS_LABEL[st]} · {counts[st]}
            </button>
          )
        })}
      </div>

      {showNew && <NewTaskForm onClose={() => setShowNew(false)} />}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
        <select value={fAccount} onChange={e => setFAccount(e.target.value)} style={selStyle}>
          <option value="all">Todos los clientes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={fType} onChange={e => setFType(e.target.value as 'all' | WorkType)} style={selStyle}>
          <option value="all">Todo tipo de trabajo</option>
          {WORK_TYPES.map(w => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar…"
          style={{ ...selStyle, minWidth: '180px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--char)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Mostrar hechas
        </label>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
          {filtered.length} tareas
        </span>
      </div>

      {/* Tabla */}
      {tasksLoading ? (
        <p style={{ fontSize: '13px', color: 'var(--char)', padding: '20px 0' }}>Cargando tareas…</p>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: '4px' }}>
          <p style={{ fontSize: '13px', color: 'var(--char)', margin: 0 }}>
            No hay tareas {tasks.length === 0 ? 'todavía.' : 'con estos filtros.'}
          </p>
          {tasks.length === 0 && (
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
              Usa <strong>⚙ Generar desde IA</strong> para crear el pendiente de cada cliente automáticamente.
            </p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--rule)', borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--paper-soft)', borderBottom: '2px solid var(--rule)' }}>
                {['Tarea', 'Cliente', 'Estado', 'Responsable', 'Fecha entrega', 'Tipo de trabajo', 'Link de entrega', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-700)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => <TaskRow key={t.id} task={t} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
