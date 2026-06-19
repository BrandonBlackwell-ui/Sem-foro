import { useMemo, useState, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { TASK_STATUS_LABEL, WORK_TYPE_LABEL } from '../../types'
import type { ClientTask, TaskStatus, WorkType } from '../../types'

const COLUMN_STYLE: Record<TaskStatus, { header: string; bg: string; border: string; count: string }> = {
  por_hacer:   { header: '#78808c', bg: 'rgba(120,128,140,0.07)', border: 'rgba(120,128,140,0.25)', count: 'rgba(120,128,140,0.18)' },
  en_proceso:  { header: '#3a6ea5', bg: 'rgba(58,110,165,0.07)',  border: 'rgba(58,110,165,0.30)',  count: 'rgba(58,110,165,0.18)'  },
  en_revision: { header: '#ef8212', bg: 'rgba(239,130,18,0.07)',  border: 'rgba(239,130,18,0.30)',  count: 'rgba(239,130,18,0.18)'  },
  hecho:       { header: '#00a884', bg: 'rgba(0,168,132,0.07)',   border: 'rgba(0,168,132,0.30)',   count: 'rgba(0,168,132,0.18)'   },
}

const STATUS_ORDER: TaskStatus[] = ['por_hacer', 'en_proceso', 'en_revision', 'hecho']
const WORK_TYPES: WorkType[] = ['reporte', 'analisis', 'media_training', 'crisis', 'nota_clientes', 'campana', 'reunion', 'otro']

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--paper-bright)',
  border: '1px solid var(--rule-soft)', borderRadius: '2px', padding: '5px 7px',
  fontSize: '12px', color: 'var(--text)', fontFamily: 'inherit',
}

function TaskCard({ task, onDragStart }: { task: ClientTask; onDragStart: (id: string) => void }) {
  const { updateTask, deleteTask } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [responsable, setResponsable] = useState(task.responsable || '')
  const [due, setDue] = useState(task.due_date || '')
  const [link, setLink] = useState(task.delivery_link || '')
  const done = task.status === 'hecho'
  const col = COLUMN_STYLE[task.status]

  const isOverdue = task.due_date && !done && task.due_date < new Date().toISOString().slice(0, 10)

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      style={{
        background: 'var(--paper-bright)',
        border: `1px solid var(--rule-soft)`,
        borderLeft: `3px solid ${col.header}`,
        borderRadius: '4px',
        padding: '10px 12px',
        cursor: 'grab',
        opacity: done ? 0.65 : 1,
        transition: 'box-shadow 0.12s',
        userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Título + acciones */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' }}>
        <p
          style={{
            flex: 1, margin: 0, fontSize: '12.5px', fontWeight: 600,
            color: 'var(--ink-900)', lineHeight: 1.4,
            textDecoration: done ? 'line-through' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(e => !e)}
          title="Editar"
        >
          {task.title}
        </p>
        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {!done && (
            <button
              onClick={() => updateTask(task.id, { status: 'hecho' })}
              title="Marcar hecha"
              style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: '2px', cursor: 'pointer', color: 'var(--teal)', fontSize: '11px', padding: '2px 5px', lineHeight: 1 }}
            >✓</button>
          )}
          <button
            onClick={() => { if (confirm(`¿Eliminar "${task.title}"?`)) deleteTask(task.id) }}
            title="Eliminar"
            style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: '2px', cursor: 'pointer', color: 'var(--crimson)', fontSize: '11px', padding: '2px 5px', lineHeight: 1 }}
          >✕</button>
        </div>
      </div>

      {/* Chips de info */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: expanded ? '10px' : '0' }}>
        {task.account_name && (
          <span style={{ fontSize: '10px', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '10px', padding: '2px 7px', color: 'var(--ink-700)', fontWeight: 500 }}>
            {task.account_name}
          </span>
        )}
        {task.responsable && (
          <span style={{ fontSize: '10px', background: 'rgba(58,110,165,0.10)', border: '1px solid rgba(58,110,165,0.25)', borderRadius: '10px', padding: '2px 7px', color: 'var(--slate-2)' }}>
            {task.responsable}
          </span>
        )}
        {task.due_date && (
          <span style={{ fontSize: '10px', background: isOverdue ? 'rgba(200,30,30,0.10)' : 'var(--paper-soft)', border: `1px solid ${isOverdue ? 'rgba(200,30,30,0.30)' : 'var(--rule)'}`, borderRadius: '10px', padding: '2px 7px', color: isOverdue ? 'var(--crimson)' : 'var(--char)' }}>
            {task.due_date}
          </span>
        )}
        {task.work_type && task.work_type !== 'otro' && (
          <span style={{ fontSize: '10px', background: 'rgba(239,130,18,0.10)', border: '1px solid rgba(239,130,18,0.25)', borderRadius: '10px', padding: '2px 7px', color: '#b85f00' }}>
            {WORK_TYPE_LABEL[task.work_type]}
          </span>
        )}
        {task.delivery_link && (
          <a href={task.delivery_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '10px', textDecoration: 'none', background: 'rgba(0,168,132,0.10)', border: '1px solid rgba(0,168,132,0.25)', borderRadius: '10px', padding: '2px 7px', color: 'var(--teal)' }}>
            🔗 link
          </a>
        )}
        {task.source === 'ia' && (
          <span style={{ fontSize: '9px', fontFamily: 'var(--mono)', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '10px', padding: '2px 6px', color: 'var(--muted)', letterSpacing: '0.06em' }}>IA</span>
        )}
      </div>

      {/* Panel de edición expandible */}
      {expanded && (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--rule-soft)', paddingTop: '10px' }}
          onMouseDown={e => e.stopPropagation()}
        >
          {task.detail && task.detail !== task.title && (
            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--graphite)', lineHeight: 1.5 }}>{task.detail}</p>
          )}
          <label style={{ fontSize: '10px', color: 'var(--char)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            Tarea
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== task.title) updateTask(task.id, { title: title.trim() }) }}
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <label style={{ fontSize: '10px', color: 'var(--char)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              Responsable
              <input value={responsable} onChange={e => setResponsable(e.target.value)} onBlur={() => { if (responsable !== (task.responsable || '')) updateTask(task.id, { responsable: responsable.trim() || null }) }} placeholder="—" style={inputStyle} />
            </label>
            <label style={{ fontSize: '10px', color: 'var(--char)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              Fecha entrega
              <input type="date" value={due} onChange={e => { setDue(e.target.value); updateTask(task.id, { due_date: e.target.value || null }) }} style={inputStyle} />
            </label>
          </div>
          <label style={{ fontSize: '10px', color: 'var(--char)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            Tipo de trabajo
            <select value={task.work_type || 'otro'} onChange={e => updateTask(task.id, { work_type: e.target.value as WorkType })} style={inputStyle}>
              {WORK_TYPES.map(w => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '10px', color: 'var(--char)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            Link de entrega
            <input value={link} onChange={e => setLink(e.target.value)} onBlur={() => { if (link !== (task.delivery_link || '')) updateTask(task.id, { delivery_link: link.trim() || null }) }} placeholder="https://…" style={inputStyle} />
          </label>
        </div>
      )}
    </div>
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
  const [status, setStatus] = useState<TaskStatus>('por_hacer')

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
      status,
    })
    setTitle(''); setResponsable(''); setDue(''); setLink(''); setWorkType('otro'); setStatus('por_hacer')
  }

  return (
    <div style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '4px', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Nueva tarea</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--char)', fontSize: '14px' }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '10px' }}>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cliente
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inputStyle, padding: '7px' }}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '10px', color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Estado inicial
          <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} style={{ ...inputStyle, padding: '7px' }}>
            {STATUS_ORDER.map(st => <option key={st} value={st}>{TASK_STATUS_LABEL[st]}</option>)}
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
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} placeholder="Describe la tarea pendiente…" style={{ ...inputStyle, padding: '8px' }} />
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
  const { tasks, accounts, generateTasksFromIA, tasksLoading, updateTask } = useApp()
  const [showNew, setShowNew] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [generating, setGenerating] = useState(false)
  const [fAccount, setFAccount] = useState('all')
  const [fType, setFType] = useState<'all' | WorkType>('all')
  const [search, setSearch] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (!showDone && t.status === 'hecho') return false
      if (fAccount !== 'all' && t.account_id !== fAccount) return false
      if (fType !== 'all' && (t.work_type || 'otro') !== fType) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${t.title} ${t.detail || ''} ${t.account_name || ''} ${t.responsable || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      const da = a.due_date || '9999'
      const db = b.due_date || '9999'
      return da.localeCompare(db)
    })
  }, [tasks, showDone, fAccount, fType, search])

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, ClientTask[]> = { por_hacer: [], en_proceso: [], en_revision: [], hecho: [] }
    for (const t of filtered) map[t.status].push(t)
    return map
  }, [filtered])

  const counts = useMemo(() => {
    const c = { por_hacer: 0, en_proceso: 0, en_revision: 0, hecho: 0 }
    for (const t of tasks) if (!(!showDone && t.status === 'hecho')) c[t.status]++
    return c
  }, [tasks, showDone])

  async function handleGenerate() {
    setGenerating(true); setGenMsg('')
    try {
      const r = await generateTasksFromIA()
      setGenMsg(r.created > 0 ? `✓ ${r.created} tareas nuevas creadas (${r.accounts} cuentas).` : 'Todo al día — no había pendientes nuevos.')
    } catch {
      setGenMsg('Error generando tareas. Revisa la conexión a Supabase.')
    } finally {
      setGenerating(false)
      setTimeout(() => setGenMsg(''), 6000)
    }
  }

  function handleDrop(status: TaskStatus) {
    if (dragId && dragId !== '') {
      const task = tasks.find(t => t.id === dragId)
      if (task && task.status !== status) updateTask(dragId, { status })
    }
    setDragId(null)
    setDropTarget(null)
  }

  const selStyle: React.CSSProperties = {
    background: 'var(--paper-bright)', border: '1px solid var(--rule)', borderRadius: '2px',
    padding: '6px 8px', fontSize: '12px', color: 'var(--text)',
  }

  const visibleColumns = showDone ? STATUS_ORDER : STATUS_ORDER.filter(s => s !== 'hecho')

  return (
    <section>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--ink-900)', letterSpacing: '-0.01em', margin: 0 }}>
            Tareas por cliente
          </h2>
          <p style={{ fontSize: '12.5px', color: 'var(--char)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Arrastra las tarjetas entre columnas para cambiar el estado. Haz clic en el título para editar.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleGenerate} disabled={generating} style={{ background: 'var(--slate-2)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', fontSize: '12.5px', cursor: generating ? 'default' : 'pointer', fontWeight: 500, opacity: generating ? 0.7 : 1 }}>
            {generating ? 'Generando…' : '⚙ Generar desde IA'}
          </button>
          <button onClick={() => setShowNew(s => !s)} style={{ background: 'var(--ink-800)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', fontSize: '12.5px', cursor: 'pointer', fontWeight: 500 }}>
            + Nueva tarea
          </button>
        </div>
      </div>

      {genMsg && (
        <div style={{ marginBottom: '14px', padding: '8px 12px', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '3px', fontSize: '12.5px', color: 'var(--ink-900)' }}>
          {genMsg}
        </div>
      )}

      {showNew && <NewTaskForm onClose={() => setShowNew(false)} />}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
        <select value={fAccount} onChange={e => setFAccount(e.target.value)} style={selStyle}>
          <option value="all">Todos los clientes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={fType} onChange={e => setFType(e.target.value as 'all' | WorkType)} style={selStyle}>
          <option value="all">Todo tipo</option>
          {WORK_TYPES.map(w => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…" style={{ ...selStyle, minWidth: '160px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--char)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Mostrar concluidas
        </label>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
          {filtered.length} tareas
        </span>
      </div>

      {/* Tablero Kanban */}
      {tasksLoading ? (
        <p style={{ fontSize: '13px', color: 'var(--char)', padding: '20px 0' }}>Cargando tareas…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(220px, 1fr))`, gap: '12px', overflowX: 'auto', paddingBottom: '12px' }}>
          {visibleColumns.map(status => {
            const col = COLUMN_STYLE[status]
            const isTarget = dropTarget === status
            return (
              <div
                key={status}
                onDragOver={e => { e.preventDefault(); setDropTarget(status) }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => handleDrop(status)}
                style={{
                  background: isTarget ? col.bg : 'transparent',
                  border: `1.5px solid ${isTarget ? col.header : col.border}`,
                  borderRadius: '6px',
                  minHeight: '200px',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                {/* Cabecera de columna */}
                <div style={{ padding: '10px 12px 8px', borderBottom: `2px solid ${col.header}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: col.header, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--mono)' }}>
                    {TASK_STATUS_LABEL[status]}
                  </span>
                  <span style={{ background: col.count, color: col.header, borderRadius: '10px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {counts[status]}
                  </span>
                </div>

                {/* Tarjetas */}
                <div style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {byStatus[status].length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Sin tareas</span>
                    </div>
                  ) : (
                    byStatus[status].map(t => (
                      <TaskCard key={t.id} task={t} onDragStart={setDragId} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
