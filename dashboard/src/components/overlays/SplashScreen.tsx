import { useApp } from '../../context/AppContext'

const QUOTES = [
  'La reputación es un espejo: se forma con lo que dices y lo que haces.',
  'Los medios no crean la realidad, pero definen cuál parte de ella cuenta.',
  'Un portafolio saludable requiere atención constante, no solo reacción.',
  'El silencio en un cliente activo es la primera señal de riesgo.',
]

export function SplashScreen() {
  const { splashOpen, dismissSplash, accounts, syncData } = useApp()

  if (!splashOpen) return null

  const active = accounts.filter(a => a.isActive)
  const counts = { green: 0, yellow: 0, orange: 0, red: 0 }
  active.forEach(a => {
    if (a.color !== 'gray') counts[a.color as keyof typeof counts] = (counts[a.color as keyof typeof counts] || 0) + 1
  })

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches'
  const dateStr = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const quote = QUOTES[now.getDate() % QUOTES.length]

  const urgentDecisions = accounts.filter(a =>
    a.isActive &&
    (a.tier === 'top' || a.tier === 'estrategica') &&
    (a.color === 'red' || a.color === 'orange') &&
    a.cadenceType !== 'on-demand'
  ).slice(0, 5)

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={e => { if (e.target === e.currentTarget) dismissSplash() }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,69,0.55)', zIndex: 70, backdropFilter: 'blur(3px)' }}
      >
        {/* Content */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 75,
            background: 'var(--panel)',
            border: '1px solid var(--ink-800)',
            width: 'min(980px, 94vw)',
            maxHeight: '92vh',
            overflow: 'auto',
            padding: '40px 48px',
            backgroundImage: 'linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        >
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-700)', marginBottom: '8px', fontWeight: 600 }}>
            {dateStr.toUpperCase()}
          </div>

          <h1 style={{ fontSize: '32px', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink-900)', lineHeight: 1.1, marginBottom: '8px' }}>
            {greeting}
          </h1>

          <div style={{ fontStyle: 'italic', color: 'var(--char)', fontSize: '14px', borderLeft: '2px solid var(--ink-500)', paddingLeft: '12px', margin: '12px 0' }}>
            {quote}
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', margin: '18px 0' }}>
            {[
              { label: 'Cuentas activas', value: active.length, color: 'var(--ink-900)' },
              { label: 'Rojas', value: counts.red, color: 'var(--crimson)' },
              { label: 'Naranjas', value: counts.orange, color: 'var(--orange)' },
              { label: 'Verdes', value: counts.green, color: 'var(--teal)' },
            ].map(s => (
              <div key={s.label} style={{ padding: '14px 18px', background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '2px' }}>
                <div style={{ fontSize: '28px', fontWeight: 600, color: s.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {s.value}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--char)', marginTop: '6px' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Urgent decisions */}
          {urgentDecisions.length > 0 && (
            <div style={{ marginTop: '18px' }}>
              <div className="section-label" style={{ marginBottom: '12px' }}>
                Decisiones urgentes esta semana
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {urgentDecisions.map(a => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      background: 'var(--paper-soft)',
                      border: '1px solid var(--rule)',
                      borderLeft: `3px solid ${a.color === 'red' ? 'var(--crimson)' : 'var(--orange)'}`,
                      borderRadius: '2px',
                    }}
                  >
                    <span className={`dot ${a.color}`} />
                    <strong style={{ color: 'var(--ink-900)', fontSize: '13px' }}>{a.name}</strong>
                    {a.global !== null && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)' }}>· {a.global}</span>
                    )}
                    {a.summary?.recommended_action && (
                      <span style={{ color: 'var(--char)', fontSize: '12.5px', marginLeft: 'auto', textAlign: 'right', maxWidth: '40%' }}>
                        {a.summary.recommended_action.slice(0, 80)}{a.summary.recommended_action.length > 80 ? '…' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', letterSpacing: '0.04em' }}>
              v3.6 · Proyecto Blackwell · {syncData.syncedAt ? syncData.syncedAt.slice(0, 10) : 'sin sync'}
            </span>
            <button
              onClick={dismissSplash}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'var(--ink-800)', color: 'var(--paper-bright)',
                padding: '10px 16px', borderRadius: '2px', fontSize: '13px', fontWeight: 500,
                border: 'none', cursor: 'pointer',
              }}
            >
              Ver dashboard →
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
