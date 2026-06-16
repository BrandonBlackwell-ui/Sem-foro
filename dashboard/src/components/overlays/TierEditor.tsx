import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import type { AccountTier } from '../../types'

const TIERS: { value: AccountTier; label: string; color: string }[] = [
  { value: 'top',         label: 'Top ingresos',  color: '#38761d' },
  { value: 'estrategica', label: 'Estratégica',   color: '#bf9000' },
  { value: 'otra',        label: 'Otra activa',   color: '#94a3b8' },
  { value: 'inactiva',    label: 'Inactiva',      color: '#cbd5e1' },
]

export function TierEditor() {
  const { tierEditorOpen, closeTierEditor, accounts, tierOverrides, setTierOverrides } = useApp()
  const [search, setSearch] = useState('')
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, AccountTier>>({})
  const [status, setStatus] = useState('Sin cambios pendientes.')

  const allAccounts = useMemo(() => {
    return accounts.map(a => ({
      id: a.id,
      number: a.number,
      name: a.name,
      currentTier: (pendingOverrides[a.number] !== undefined ? pendingOverrides[a.number] : a.tier) as AccountTier,
      originalTier: a.tier,
    }))
  }, [accounts, pendingOverrides])

  const filtered = allAccounts.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase())
  )

  const pendingCount = Object.keys(pendingOverrides).length

  function setTier(number: string, tier: AccountTier) {
    setPendingOverrides(prev => ({ ...prev, [number]: tier }))
    setStatus(`${Object.keys(pendingOverrides).length + 1} cambio(s) pendiente(s). Guarda para aplicar.`)
  }

  function save() {
    const newOverrides = { ...tierOverrides }
    Object.entries(pendingOverrides).forEach(([num, tier]) => {
      const key = String(num).padStart(2, '0')
      if (tier === null) delete newOverrides[key]
      else newOverrides[key] = tier as string
    })
    setTierOverrides(newOverrides)
    setPendingOverrides({})
    setStatus('Cambios guardados.')
    closeTierEditor()
  }

  function reset() {
    setTierOverrides({})
    setPendingOverrides({})
    setStatus('Segmentación restablecida al default del xlsx.')
  }

  function exportJson() {
    const data = { ...tierOverrides, ...pendingOverrides }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tier-segmentation.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!tierEditorOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={e => { if (e.target === e.currentTarget) closeTierEditor() }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,69,0.5)', zIndex: 85, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {/* Editor */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 'min(640px, 94vw)',
            maxHeight: '80vh',
            background: 'var(--panel)',
            border: '1px solid var(--ink-800)',
            zIndex: 88,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '18px 22px', borderBottom: '2px solid var(--ink-900)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink-900)' }}>
              Editar segmentación de cuentas
            </h2>
            <button
              onClick={closeTierEditor}
              style={{ background: 'transparent', border: '1px solid var(--rule)', borderRadius: '2px', width: '30px', height: '30px', cursor: 'pointer', color: 'var(--ink-700)', display: 'grid', placeItems: 'center' }}
            >
              ×
            </button>
          </div>

          {/* Info */}
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', letterSpacing: '0.02em', padding: '10px 22px 0', lineHeight: 1.5 }}>
            Define qué cuentas son <strong style={{ color: '#38761d' }}>Top</strong> y cuáles son{' '}
            <strong style={{ color: '#8a6300' }}>Estratégicas</strong>. Los cambios se guardan en localStorage.
          </div>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cuenta…"
            style={{
              margin: '10px 22px',
              background: 'var(--paper-soft)',
              border: '1px solid var(--rule)',
              borderRadius: '2px',
              padding: '8px 12px',
              fontSize: '13px',
              color: 'var(--text)',
            }}
          />

          {/* Rows */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0 22px 12px' }}>
            {filtered.map(a => (
              <div
                key={a.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '2px',
                  alignItems: 'center',
                  background: 'var(--paper-soft)',
                  border: '1px solid var(--rule-soft)',
                  marginBottom: '4px',
                }}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)' }}>{a.number}</span>
                <span style={{ fontSize: '13px', color: 'var(--ink-900)', fontWeight: 500 }}>{a.name}</span>
                <select
                  value={a.currentTier || 'otra'}
                  onChange={e => setTier(a.number, e.target.value as AccountTier)}
                  style={{
                    background: 'var(--panel)',
                    border: '1px solid var(--rule)',
                    borderRadius: '2px',
                    padding: '4px 8px',
                    fontSize: '11.5px',
                    fontFamily: 'var(--mono)',
                    color: 'var(--ink-900)',
                    cursor: 'pointer',
                  }}
                >
                  {TIERS.map(t => (
                    <option key={t.value} value={t.value || ''}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>{status}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={reset} style={{ background: 'transparent', border: '1px solid rgba(180,58,58,0.35)', color: 'var(--crimson)', padding: '8px 13px', borderRadius: '2px', fontSize: '12.5px', cursor: 'pointer' }}>
                Restablecer default
              </button>
              <button onClick={exportJson} style={{ background: 'transparent', border: '1px solid var(--rule)', padding: '8px 13px', borderRadius: '2px', fontSize: '12.5px', cursor: 'pointer', color: 'var(--ink-700)' }}>
                Exportar JSON
              </button>
              <button
                onClick={save}
                disabled={pendingCount === 0}
                style={{
                  background: 'var(--ink-800)', color: 'var(--paper-bright)',
                  border: '1px solid var(--ink-800)', padding: '8px 13px', borderRadius: '2px',
                  fontSize: '12.5px', cursor: pendingCount === 0 ? 'not-allowed' : 'pointer',
                  opacity: pendingCount === 0 ? 0.6 : 1,
                }}
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
