import { useApp } from '../../context/AppContext'
import { StatusDot } from '../shared/Badge'

const TIER_LEGEND = {
  top:         { label: 'Top ingresos',  color: '#38761d' },
  estrategica: { label: 'Estratégica',   color: '#bf9000' },
}

export function TopStrategicList() {
  const { accounts, openModal } = useApp()

  const topAccounts = accounts.filter(a => a.tier === 'top' && a.isActive)
  const estratAccounts = accounts.filter(a => a.tier === 'estrategica' && a.isActive)

  function renderGroup(label: string, color: string, items: typeof accounts) {
    return (
      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '8px',
            paddingBottom: '8px',
            borderBottom: '1px solid var(--rule-soft)',
            fontFamily: 'var(--mono)',
            fontSize: '10.5px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-700)',
          }}
        >
          <span style={{ color }}>{label}</span>
          <span style={{ color: 'var(--char)', fontSize: '10px' }}>{items.length}</span>
        </div>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--char)', fontFamily: 'var(--mono)', fontSize: '11px', padding: '10px' }}>
            Sin cuentas
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {items.map(a => (
              <div
                key={a.id}
                onClick={() => openModal(a.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 1fr auto',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '2px',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: 'var(--paper-soft)',
                  border: '1px solid var(--rule-soft)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--paper-soft)')}
              >
                <StatusDot color={a.color} />
                <span style={{ fontSize: '13.5px', color: 'var(--ink-900)', fontWeight: 500 }}>{a.name}</span>
                {a.global !== null ? (
                  <span
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '13.5px',
                      color: 'var(--ink-800)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                    }}
                  >
                    {a.global}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' }}>—</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pane-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="section-label" style={{ marginBottom: '14px' }}>Cuentas top + estratégicas</div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderGroup('Top ingresos', TIER_LEGEND.top.color, topAccounts)}
        {renderGroup('Estratégicas', TIER_LEGEND.estrategica.color, estratAccounts)}
      </div>
    </div>
  )
}
