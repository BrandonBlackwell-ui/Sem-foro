import { useApp } from '../../context/AppContext'

export function TopBar() {
  const { syncData, openConfig } = useApp()

  const syncedAt = syncData.syncedAt
  const dt = syncedAt ? syncedAt.replace('T', ' ').slice(0, 16) : null
  const ndelta = (syncData.deltas || []).length
  const accountCount = (syncData.accounts || []).length

  return (
    <>
      {/* SVG filters for ink effect */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id="bw-ink" x="-3%" y="-15%" width="106%" height="130%"
            filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={3} seed={4} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={1.4} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="bw-ink-rough" x="-3%" y="-80%" width="106%" height="260%"
            colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.04 0.5" numOctaves={2} seed={7} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.5} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <header
        className="topbar"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '24px',
          alignItems: 'end',
          borderBottom: '2px solid var(--ink-900)',
          padding: '20px 0 18px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '24px', flexWrap: 'wrap' }}>
          {/* Brand */}
          <div>
            <div
              style={{
                fontFamily: 'var(--sans)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                fontSize: '44px',
                color: 'var(--ink-800)',
                filter: 'url(#bw-ink)',
                lineHeight: 1,
              }}
            >
              Blackwell
              <span style={{ fontSize: '0.22em', fontWeight: 600, position: 'relative', top: '-1.1em', left: '0.06em', opacity: 0.85 }}>®</span>
            </div>
            <div
              style={{
                display: 'block',
                height: '3px',
                background: 'var(--ink-800)',
                filter: 'url(#bw-ink-rough)',
                marginTop: '2px',
                borderRadius: '1px',
              }}
            />
          </div>

          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--rule)', margin: '6px 0' }} />

          {/* Title */}
          <div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '11px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-700)',
                marginBottom: '4px',
                fontWeight: 600,
              }}
            >
              BW · Doc · 05 · Semáforo
            </div>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: 'var(--ink-900)',
                display: 'flex',
                alignItems: 'baseline',
                gap: '10px',
              }}
            >
              Semáforo de cuentas
              <small
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '10.5px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--char)',
                  fontWeight: 600,
                  border: '1px solid var(--rule)',
                  padding: '2px 8px',
                  borderRadius: '999px',
                }}
              >
                v3.6
              </small>
            </h1>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.04em', color: 'var(--char)', marginTop: '6px' }}>
              {dt ? (
                <>
                  <span>Corte: {dt} UTC</span>
                  <span style={{ margin: '0 4px' }}>·</span>
                  <span>{accountCount} cuentas Drive</span>
                  <span
                    className={`chip ${ndelta === 0 ? 'ok' : 'warn'}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '2px 8px',
                      marginLeft: '8px',
                      fontFamily: 'var(--mono)',
                      fontSize: '10px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      border: '1px solid var(--rule)',
                      borderRadius: '999px',
                      color: ndelta === 0 ? 'var(--teal)' : 'var(--amber)',
                    }}
                  >
                    {ndelta === 0 ? 'Sync OK' : `${ndelta} alertas`}
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--crimson)' }}>Sin sync</span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={openConfig}
          style={{
            background: 'transparent',
            color: 'var(--ink-800)',
            border: '1px solid var(--ink-800)',
            borderRadius: '2px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            lineHeight: 1,
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--ink-800)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--paper-bright)'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-800)'
          }}
          title="Configuración"
        >
          ⚙ Config
        </button>
      </header>
    </>
  )
}
