import { useApp } from '../../context/AppContext'
import { Badge } from '../shared/Badge'
import type { ComputedAccount } from '../../types'

export function EquipoTab() {
  const { accounts } = useApp()

  // Group accounts by cell
  const cellA = accounts.filter(a => a.cell === 'A' && a.isActive)
  const cellB = accounts.filter(a => a.cell === 'B' && a.isActive)
  const unassigned = accounts.filter(a => !a.cell && a.isActive)

  function CellColumn({ label, items }: { label: string; items: ComputedAccount[] }) {
    const avgScore = items.length
      ? Math.round(items.filter(a => a.global !== null).reduce((s, a) => s + (a.global ?? 0), 0) /
          Math.max(items.filter(a => a.global !== null).length, 1) * 10) / 10
      : null

    return (
      <div className="pane-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid var(--ink-900)' }}>
          <div className="section-label">{label}</div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
            {items.length} cuentas {avgScore !== null && `· prom. ${avgScore}`}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map(a => (
            <div
              key={a.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '12px 1fr auto',
                gap: '10px',
                padding: '10px 12px',
                background: 'var(--paper-soft)',
                border: '1px solid var(--rule-soft)',
                borderLeft: `3px solid ${a.color === 'green' ? 'var(--teal)' : a.color === 'yellow' ? 'var(--amber)' : a.color === 'orange' ? 'var(--orange)' : a.color === 'red' ? 'var(--crimson)' : 'var(--slate-2)'}`,
                borderRadius: '2px',
                alignItems: 'center',
              }}
            >
              <span className={`dot ${a.color}`} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink-900)' }}>{a.name}</div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                  {a.tier && a.tier !== 'otra' && a.tier !== 'inactiva' && (
                    <Badge variant={a.tier === 'top' ? 'green' : 'yellow'}>
                      {a.tier === 'top' ? 'Top' : 'Estratégica'}
                    </Badge>
                  )}
                  {a.cadenceType === 'on-demand' && <Badge variant="ondemand">on-demand</Badge>}
                  {a.cellTentative && <Badge>tentativo</Badge>}
                </div>
              </div>
              {a.global !== null ? (
                <span
                  className={`color-${a.color}`}
                  style={{ fontFamily: 'var(--mono)', fontSize: '14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                >
                  {a.global}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' }}>—</span>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '12px', padding: '16px' }}>
              Sin cuentas asignadas
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <section>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em', marginBottom: '4px' }}>
          Carga del equipo
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '12.5px', fontFamily: 'var(--mono)' }}>
          Distribución de cuentas activas por célula (desde Drive Intelligence).
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <CellColumn label="Célula A · Marisol" items={cellA} />
        <CellColumn label="Célula B · Johanna" items={cellB} />
        {unassigned.length > 0 && (
          <CellColumn label="Sin célula asignada" items={unassigned} />
        )}
      </div>
    </section>
  )
}
