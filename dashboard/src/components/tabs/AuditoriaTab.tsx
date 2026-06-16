import { useApp } from '../../context/AppContext'
import type { CrossAccountFinding } from '../../types'

function FindingCard({ finding }: { finding: CrossAccountFinding | string }) {
  const f = typeof finding === 'string'
    ? { title: finding, description: undefined, severity: undefined, affected_accounts: undefined }
    : finding

  return (
    <div className="pane-card" style={{ padding: '14px 16px' }}>
      <h3 className="section-label" style={{ marginBottom: '8px', fontSize: '10px' }}>
        {f.severity && (
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: '9px',
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: '999px',
            background: f.severity === 'high' ? 'var(--crimson-bg)' : f.severity === 'medium' ? 'var(--amber-bg)' : 'var(--teal-bg)',
            color: f.severity === 'high' ? 'var(--crimson)' : f.severity === 'medium' ? 'var(--amber)' : 'var(--teal)',
            textTransform: 'uppercase',
            marginRight: '8px',
          }}>
            {f.severity}
          </span>
        )}
        {f.title}
      </h3>
      {f.description && (
        <p style={{ fontSize: '12.5px', color: 'var(--graphite)', lineHeight: 1.6 }}>{f.description}</p>
      )}
      {f.affected_accounts && f.affected_accounts.length > 0 && (
        <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', marginTop: '8px' }}>
          Cuentas: {f.affected_accounts.join(', ')}
        </p>
      )}
    </div>
  )
}

export function AuditoriaTab() {
  const { syncData, driveIntelligence } = useApp()

  const DI = driveIntelligence
  const coverage = DI?.coverage_summary
  const findings = DI?.cross_account_findings || []
  const mediaRecon = DI?.media_reconciliation || []

  const syncedAt = syncData.syncedAt
  const auditMeta = syncedAt
    ? `sync: ${syncedAt} · schema: ${(syncData as any).schema_version || '4.1'} · cuentas: ${syncData.accounts.length} · deltas: ${syncData.deltas?.length || 0}`
    : 'Sin datos de sync disponibles'

  return (
    <section className="pane-card">
      <h2 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em', marginBottom: '20px' }}>
        Auditoría · trazabilidad del sync
      </h2>

      {/* Meta técnica */}
      <div style={{ marginBottom: '24px' }}>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Información técnica</h3>
        <pre
          style={{
            fontFamily: 'var(--mono)',
            background: 'var(--bg)',
            padding: '10px 14px',
            borderRadius: '4px',
            fontSize: '12px',
            color: 'var(--ink-900)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {auditMeta}
        </pre>
      </div>

      {/* Reconciliación de medios */}
      {mediaRecon.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 className="section-label" style={{ marginBottom: '10px' }}>Reconciliación tracker de medios vs reporte</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--panel)', border: '1px solid var(--rule)', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Cuenta', 'Placements', 'Reportes', 'Gap'].map(h => (
                    <th key={h} style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-700)', background: 'var(--paper-soft)', textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--ink-800)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mediaRecon.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--rule-soft)' }}>{row.account || '—'}</td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--rule-soft)', fontFamily: 'var(--mono)' }}>{row.placements ?? '—'}</td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--rule-soft)', fontFamily: 'var(--mono)' }}>{row.reports ?? '—'}</td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--rule-soft)', color: row.gap ? 'var(--amber)' : 'var(--teal)' }}>{row.gap || 'OK'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hallazgos transversales */}
      {findings.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 className="section-label" style={{ marginBottom: '12px' }}>Hallazgos transversales del Drive Intelligence</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
            {findings.map((f, i) => (
              <FindingCard key={i} finding={f as CrossAccountFinding | string} />
            ))}
          </div>
        </div>
      )}

      {/* Cobertura */}
      {coverage && (
        <div>
          <h3 className="section-label" style={{ marginBottom: '10px' }}>Cobertura del baseline</h3>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--char)', lineHeight: 1.7 }}>
            <div>Total cuentas: {coverage.total_accounts ?? '—'}</div>
            <div>Analizadas: {coverage.analyzed_accounts ?? '—'}</div>
            {coverage.accounts_missing_baseline && coverage.accounts_missing_baseline.length > 0 && (
              <div style={{ marginTop: '8px', color: 'var(--amber)' }}>
                Sin baseline: {coverage.accounts_missing_baseline.join(', ')}
              </div>
            )}
          </div>
          {DI?.executive_briefing && (() => {
            // Defensive parse: sometimes the field arrives as a raw JSON string
            let briefingText = DI.executive_briefing
            if (typeof briefingText === 'string' && briefingText.trimStart().startsWith('{')) {
              try {
                const parsed = JSON.parse(briefingText)
                if (parsed && typeof parsed.executive_briefing === 'string') {
                  briefingText = parsed.executive_briefing
                }
              } catch { /* use as-is */ }
            }
            return (
              <div style={{ marginTop: '12px', background: 'var(--paper-soft)', border: '1px solid var(--rule)', padding: '12px 14px', borderRadius: '2px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-700)', marginBottom: '8px' }}>
                  Executive briefing
                </div>
                <p style={{ fontSize: '13px', color: 'var(--graphite)', lineHeight: 1.6 }}>
                  {briefingText}
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {!DI && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '12px', padding: '40px 0' }}>
          Drive Intelligence no disponible. Corre el baseline para generar análisis.
        </div>
      )}
    </section>
  )
}
