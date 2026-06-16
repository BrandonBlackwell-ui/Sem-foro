import { useApp } from '../../context/AppContext'

export function GaugeCard() {
  const { accounts, openTierEditor } = useApp()
  const active = accounts.filter(a => a.isActive && a.global !== null)

  if (!active.length) {
    return (
      <div className="pane-card" style={{ display: 'flex', flexDirection: 'column' }}>
        <h3>Score del portafolio</h3>
        <div style={{ textAlign: 'center', color: 'var(--char)', padding: '24px 0' }}>sin cuentas activas</div>
      </div>
    )
  }

  const avg = active.reduce((s, a) => s + (a.global ?? 0), 0) / active.length
  const rounded = Math.round(avg * 10) / 10
  const colorClass = avg >= 80 ? 'green' : avg >= 65 ? 'yellow' : avg >= 45 ? 'orange' : 'red'
  const band = avg >= 80 ? 'verde saludable' : avg >= 65 ? 'amarillo estable' : avg >= 45 ? 'naranja en riesgo' : 'rojo crítico'

  // angle: 0 score = -90deg, 100 score = +90deg
  // map avg (0-100) → rotate (-90 to 90)
  const angle = (avg - 50) * 1.8

  return (
    <div className="pane-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div className="section-label">Score del portafolio</div>
      </div>

      <div style={{ position: 'relative', margin: '8px auto 6px', maxWidth: '260px', width: '100%' }}>
        <svg viewBox="0 0 240 140" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto' }}>
          <path d="M 20 120 A 100 100 0 0 1 104.4 21.2" stroke="#B43A3A" strokeWidth="14" fill="none" />
          <path d="M 104.4 21.2 A 100 100 0 0 1 165.4 30.9" stroke="#C26A1D" strokeWidth="14" fill="none" />
          <path d="M 165.4 30.9 A 100 100 0 0 1 200.9 61.2" stroke="#B8841C" strokeWidth="14" fill="none" />
          <path d="M 200.9 61.2 A 100 100 0 0 1 220 120" stroke="#1F8F7C" strokeWidth="14" fill="none" />
          <line
            x1="120" y1="120" x2="120" y2="60"
            stroke="var(--text)" strokeWidth="3" strokeLinecap="round"
            transform={`rotate(${angle} 120 120)`}
          />
          <circle cx="120" cy="120" r="6" fill="var(--text)" />
        </svg>

        <div style={{ textAlign: 'center', marginTop: '6px' }}>
          <div
            className={`color-${colorClass}`}
            style={{
              fontFamily: 'var(--sans)',
              fontSize: '42px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {rounded}<small style={{ fontSize: '18px', fontWeight: 400 }}>/100</small>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '14px',
          paddingTop: '10px',
          borderTop: '1px solid var(--rule-soft)',
          fontFamily: 'var(--mono)',
          fontSize: '10px',
          letterSpacing: '0.06em',
          color: 'var(--char)',
          textTransform: 'uppercase',
        }}
      >
        <span>{band}</span>
        <span>{active.length} cuentas</span>
      </div>

      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--rule-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-label" style={{ fontSize: '10px' }}>Top + Estratégicas</span>
          <button
            onClick={openTierEditor}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '10.5px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-700)',
              background: 'transparent',
              border: '1px solid var(--rule)',
              padding: '4px 8px',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            Editar segmentación
          </button>
        </div>
      </div>
    </div>
  )
}
