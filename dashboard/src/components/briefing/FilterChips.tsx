import { useApp } from '../../context/AppContext'
import type { FilterId } from '../../types'

const FILTERS: { id: FilterId; label: string; color?: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'top-strategic', label: 'Top + Estratégicas' },
  { id: 'cell-A', label: 'Célula A · Marisol' },
  { id: 'cell-B', label: 'Célula B · Johanna' },
  { id: 'red', label: 'Rojas', color: 'red' },
  { id: 'orange', label: 'Naranjas', color: 'orange' },
  { id: 'yellow', label: 'Amarillas', color: 'yellow' },
  { id: 'green', label: 'Verdes', color: 'green' },
  { id: 'stale', label: 'Stale' },
  { id: 'no-deliverable', label: 'Sin entregable' },
  { id: 'ondemand', label: 'On-demand' },
  { id: 'contract-issue', label: '🔓 Contrato' },
  { id: 'whatsapp', label: '💬 WhatsApp' },
  { id: 'concluded', label: 'Concluidas' },
]

const ACTIVE_COLORS: Record<string, string> = {
  red: 'var(--crimson)',
  orange: 'var(--orange)',
  yellow: 'var(--amber)',
  green: 'var(--teal)',
}

export function FilterChips() {
  const { masterFilter, setMasterFilter } = useApp()

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        alignItems: 'center',
        marginBottom: '14px',
        padding: '12px 14px',
        background: 'var(--panel)',
        border: '1px solid var(--rule)',
        borderRadius: '2px',
      }}
    >
      {FILTERS.map(f => {
        const isActive = masterFilter === f.id
        const activeColor = f.color ? ACTIVE_COLORS[f.color] : 'var(--ink-800)'
        return (
          <button
            key={f.id}
            onClick={() => setMasterFilter(f.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '999px',
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: isActive ? `1px solid ${activeColor}` : '1px solid var(--rule)',
              background: isActive ? activeColor : 'var(--paper-soft)',
              color: isActive ? (f.color ? '#fff' : 'var(--paper-bright)') : 'var(--ink-700)',
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s',
              whiteSpace: 'nowrap',
            }}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}
