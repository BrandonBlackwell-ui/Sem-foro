import { useApp } from '../../context/AppContext'

interface KpiCellProps {
  count: number
  label: string
  color: string
}

function KpiCell({ count, label, color }: KpiCellProps) {
  return (
    <div
      className="pane-card"
      style={{ padding: '14px 18px' }}
    >
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '9.5px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--char)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '32px',
          fontWeight: 600,
          lineHeight: 1,
          color,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}
      >
        {count}
      </div>
    </div>
  )
}

export function KpiStrip() {
  const { accounts } = useApp()
  const active = accounts.filter(a => a.isActive)
  const counts = { green: 0, yellow: 0, orange: 0, red: 0, gray: 0 }
  active.forEach(a => { counts[a.color] = (counts[a.color] || 0) + 1 })
  const nonActive = accounts.length - active.length
  counts.gray = (counts.gray || 0) + nonActive

  return (
    <div className="pane-card" style={{ padding: '20px 22px' }}>
      <div className="section-label" style={{ marginBottom: '14px' }}>Distribución del portafolio</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: '10px',
        }}
      >
        <KpiCell count={counts.red}    label="Rojas"    color="var(--crimson)" />
        <KpiCell count={counts.orange} label="Naranjas" color="var(--orange)" />
        <KpiCell count={counts.yellow} label="Amarillas" color="var(--amber)" />
        <KpiCell count={counts.green}  label="Verdes"   color="var(--teal)" />
        <KpiCell count={counts.gray}   label="Sin score" color="var(--slate-2)" />
      </div>
    </div>
  )
}
