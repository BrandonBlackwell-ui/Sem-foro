import { useMemo } from 'react'
import { useApp } from '../../context/AppContext'

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  return Number.isNaN(d) || !Number.isFinite(d) ? null : Math.max(0, d)
}

export function WhatsAppRadar() {
  const { accounts, openModal } = useApp()

  const rows = useMemo(() => {
    return accounts
      .filter(a => a.isActive)
      .map(a => {
        const sa = a.subfolderActivity
        const waKey = sa ? Object.keys(sa).find(k => /^04/i.test(k)) : null
        const waData = waKey && sa ? sa[waKey] : null
        const fileCount = waData?.fileCount ?? 0
        const lastModDays = daysAgo(waData?.latestModified)
        const lastFile = waData?.latestFile || null

        // Classify signal
        let signal: 'ok' | 'warning' | 'gap' | 'missing' = 'missing'
        if (fileCount > 0) {
          if (lastModDays !== null && lastModDays <= 14) signal = 'ok'
          else if (lastModDays !== null && lastModDays <= 30) signal = 'warning'
          else signal = 'gap'
        }

        return { account: a, fileCount, lastModDays, lastFile, signal }
      })
      .sort((a, b) => {
        const order = { gap: 0, missing: 1, warning: 2, ok: 3 }
        return order[a.signal] - order[b.signal]
      })
  }, [accounts])

  const SIGNAL_STYLE: Record<string, { color: string; label: string }> = {
    ok:      { color: 'var(--teal)',    label: 'Al día' },
    warning: { color: 'var(--amber)',   label: 'Revisar' },
    gap:     { color: 'var(--orange)',  label: 'Gap' },
    missing: { color: 'var(--crimson)', label: 'Sin docs' },
  }

  const counts = useMemo(() => ({
    ok:      rows.filter(r => r.signal === 'ok').length,
    warning: rows.filter(r => r.signal === 'warning').length,
    gap:     rows.filter(r => r.signal === 'gap').length,
    missing: rows.filter(r => r.signal === 'missing').length,
  }), [rows])

  return (
    <section className="pane-card" style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink-900)' }}>
          💬 Radar WhatsApp · cobertura de documentación
        </h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {(['ok', 'warning', 'gap', 'missing'] as const).map(sig => (
            <span key={sig} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: SIGNAL_STYLE[sig].color }}>
              {SIGNAL_STYLE[sig].label}: <strong>{counts[sig]}</strong>
            </span>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr>
              {['Cuenta', 'Estatus WA', 'Archivos', 'Última actividad', 'Último archivo'].map(h => (
                <th
                  key={h}
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-700)',
                    background: 'var(--paper-soft)',
                    textAlign: 'left',
                    padding: '9px 14px',
                    borderBottom: '1px solid var(--ink-800)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, fileCount, lastModDays, lastFile, signal }) => {
              const sig = SIGNAL_STYLE[signal]
              return (
                <tr
                  key={account.id}
                  onClick={() => openModal(account.id)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--rule-soft)' }}
                >
                  <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--ink-900)' }}>
                    {account.name}
                  </td>
                  <td style={{ padding: '8px 14px' }}>
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '9.5px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: sig.color,
                      fontWeight: 700,
                    }}>
                      {sig.label}
                    </span>
                  </td>
                  <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', color: 'var(--char)' }}>
                    {fileCount > 0 ? fileCount : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
                    {lastModDays !== null
                      ? lastModDays === 0 ? 'hoy'
                        : lastModDays === 1 ? 'ayer'
                        : `hace ${lastModDays}d`
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 14px', color: 'var(--graphite)', fontSize: '11.5px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lastFile || <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
