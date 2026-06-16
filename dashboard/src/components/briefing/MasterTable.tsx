import { useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Badge } from '../shared/Badge'
import { SparkLine } from '../shared/SparkLine'
import { CONTRACT_STATUS_LABEL } from '../../hooks/useAccounts'
import type { ComputedAccount, FilterId, ContractStatusKey } from '../../types'

// Tendencia = actividad acumulada del Drive: cuántos documentos se han subido
// a lo largo del tiempo (fechas modifiedTime de los archivos). Es acumulativa,
// así que la línea siempre sube (días con actividad) o se mantiene plana
// (días sin actividad).
const TREND_BUCKETS = 12

function trendSeries(account: ComputedAccount): number[] {
  const files = account.drive?.files ?? []
  const times = files
    .map(f => (f.modifiedTime ? new Date(f.modifiedTime).getTime() : NaN))
    .filter(t => Number.isFinite(t))
  if (times.length === 0) return []

  const start = Math.min(...times)
  const end = Date.now()
  const span = Math.max(end - start, 1)

  const counts = new Array(TREND_BUCKETS).fill(0)
  for (const t of times) {
    const idx = Math.min(Math.floor(((t - start) / span) * TREND_BUCKETS), TREND_BUCKETS - 1)
    counts[idx]++
  }

  let total = 0
  return counts.map(c => (total += c))
}

function activityDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

function filterAccounts(accounts: ComputedAccount[], filter: FilterId): ComputedAccount[] {
  switch (filter) {
    case 'all': return accounts
    case 'top-strategic': return accounts.filter(a => a.tier === 'top' || a.tier === 'estrategica')
    case 'cell-A': return accounts.filter(a => a.cell === 'A')
    case 'cell-B': return accounts.filter(a => a.cell === 'B')
    case 'red': return accounts.filter(a => a.color === 'red')
    case 'orange': return accounts.filter(a => a.color === 'orange')
    case 'yellow': return accounts.filter(a => a.color === 'yellow')
    case 'green': return accounts.filter(a => a.color === 'green')
    case 'stale': return accounts.filter(a => {
      const la = a.lastActivity
      if (!la) return false
      const d = Math.round((Date.now() - new Date(la).getTime()) / 86400000)
      return !Number.isNaN(d) && d > 14 && a.isActive
    })
    case 'no-deliverable': return accounts.filter(a => !a.latestDeliverable && a.isActive)
    case 'ondemand': return accounts.filter(a => a.cadenceType === 'on-demand')
    case 'contract-issue': return accounts.filter(a =>
      a.contractStatus && ['unsigned', 'renewal_pending', 'renewal_expired', 'missing'].includes(a.contractStatus.status))
    case 'whatsapp': return accounts.filter(a => {
      const sa = a.subfolderActivity
      if (!sa) return false
      const waKey = Object.keys(sa).find(k => /^04/i.test(k))
      if (!waKey) return false
      return (sa[waKey].fileCount ?? 0) > 0
    })
    case 'concluded': return accounts.filter(a => !a.isActive)
    default: return accounts
  }
}

function ScoreBar({ value }: { value: number | null; axis: 'co' | 'pq' | 'sc' }) {
  if (value === null) return <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' }}>—</span>
  const color = value >= 80 ? 'var(--teal)' : value >= 65 ? 'var(--amber)' : value >= 45 ? 'var(--orange)' : 'var(--crimson)'
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </span>
  )
}

function AccountRow({ account, onOpen }: { account: ComputedAccount; onOpen: () => void }) {
  const { assignments } = useApp()
  const contractBadge = account.contractStatus &&
    ['unsigned', 'renewal_pending', 'renewal_expired', 'missing'].includes(account.contractStatus.status)
    ? CONTRACT_STATUS_LABEL[account.contractStatus.status as ContractStatusKey]?.short
    : null

  const trend = trendSeries(account)

  // Asignación manual tiene prioridad sobre cellLead automático
  const assign = assignments[account.id]
  const resp = assign?.consultant
    ? assign.consultant.split(' ')[0]
    : account.cellLead
      ? account.cellLead.split(' ')[0]
      : account.cell
        ? `Célula ${account.cell}`
        : null

  const cellDir = assign?.cell_director
    ? assign.cell_director.split(' ')[0]
    : account.cellLead
      ? account.cellLead.split(' ')[0]
      : null

  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      {/* Account cell */}
      <td>
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--rule)',
            borderLeft: `3px solid ${
              account.color === 'green' ? 'var(--teal)'
              : account.color === 'yellow' ? 'var(--amber)'
              : account.color === 'orange' ? 'var(--orange)'
              : account.color === 'red' ? 'var(--crimson)'
              : 'var(--slate-2)'}`,
            borderRadius: '2px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink-900)', letterSpacing: '-0.005em' }}>
            {account.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
            {account.statusVariant && (
              <Badge variant={account.statusVariant}>{account.statusVariant}</Badge>
            )}
            {account.cadenceType === 'on-demand' && (
              <Badge variant="ondemand">on-demand</Badge>
            )}
            {contractBadge && (
              <Badge variant={account.contractStatus?.status === 'signed_current' ? 'green' : 'orange'}>
                🔓 {contractBadge}
              </Badge>
            )}
            {account.cell && (
              <Badge variant={`cell-${account.cell.toLowerCase()}`}>
                Célula {account.cell}
                {account.cellTentative ? ' *' : ''}
              </Badge>
            )}
          </div>
        </div>
      </td>

      {/* RESP */}
      <td>
        {(resp || cellDir) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {resp && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--char)', fontWeight: 600 }}>
                {resp}
              </span>
            )}
            {cellDir && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--muted)', fontWeight: 500 }}>
                Dir: {cellDir}
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '10px' }}>—</span>
        )}
      </td>

      {/* Tier */}
      <td>
        {account.tier ? (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: account.tier === 'top' ? '#38761d' : account.tier === 'estrategica' ? '#bf9000' : 'var(--char)',
              fontWeight: 600,
            }}
          >
            {account.tier === 'top' ? 'Top' : account.tier === 'estrategica' ? 'Estratégica' : account.tier === 'inactiva' ? 'Inactiva' : 'Otra'}
          </span>
        ) : (
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '10px' }}>—</span>
        )}
      </td>

      {/* Scores */}
      <td style={{ textAlign: 'right', padding: '9px 14px' }}><ScoreBar value={account.co} axis="co" /></td>
      <td style={{ textAlign: 'right', padding: '9px 14px' }}><ScoreBar value={account.pq} axis="pq" /></td>
      <td style={{ textAlign: 'right', padding: '9px 14px' }}><ScoreBar value={account.sc} axis="sc" /></td>
      <td style={{ textAlign: 'right', padding: '9px 14px' }}>
        {account.global !== null ? (
          <span
            className={`color-${account.color}`}
            style={{ fontFamily: 'var(--mono)', fontSize: '14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
          >
            {account.global}
          </span>
        ) : (
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' }}>—</span>
        )}
      </td>

      {/* Sparkline — solo cuentas activas con actividad en Drive; las concluidas no llevan tendencia */}
      <td>
        {account.isActive && trend.length > 0 ? (
          <SparkLine values={trend} />
        ) : (
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' }}>—</span>
        )}
      </td>

      {/* Last activity */}
      <td>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--char)' }}>
          {activityDate(account.lastActivity)}
        </span>
      </td>
    </tr>
  )
}

const HEADERS = ['Cuenta', 'Resp', 'Tier', 'CO', 'PQ', 'SC', 'Global', 'Tendencia', 'Última actividad']
const RIGHT_ALIGN = new Set(['CO', 'PQ', 'SC', 'Global'])

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <tr>
      <td
        colSpan={HEADERS.length}
        style={{
          padding: '10px 14px 6px',
          fontFamily: 'var(--mono)',
          fontSize: '9.5px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-700)',
          background: 'var(--paper-soft)',
          borderBottom: '1px solid var(--rule)',
          borderTop: '2px solid var(--rule)',
        }}
      >
        {label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({count})</span>
      </td>
    </tr>
  )
}

export function MasterTable() {
  const { accounts, masterFilter, openModal } = useApp()
  const filtered = useMemo(() => filterAccounts(accounts, masterFilter), [accounts, masterFilter])

  // Only group when showing 'all' — avoids noise on filtered views
  const useGrouping = masterFilter === 'all'

  const topStrategic = useMemo(
    () => filtered.filter(a => a.tier === 'top' || a.tier === 'estrategica'),
    [filtered],
  )
  const otherActive = useMemo(
    () => filtered.filter(a => a.isActive && a.tier !== 'top' && a.tier !== 'estrategica'),
    [filtered],
  )
  const inactive = useMemo(
    () => filtered.filter(a => !a.isActive),
    [filtered],
  )

  const renderRows = (list: ComputedAccount[]) =>
    list.map(a => (
      <AccountRow key={a.id} account={a} onOpen={() => openModal(a.id)} />
    ))

  return (
    <section>
      <h2
        style={{
          fontSize: '17px',
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink-900)',
          marginBottom: '14px',
        }}
      >
        Cuentas ({filtered.length})
      </h2>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: 'var(--panel)',
          border: '1px solid var(--rule)',
          borderRadius: '2px',
          fontSize: '13.5px',
        }}
      >
        <thead>
          <tr>
            {HEADERS.map(h => (
              <th
                key={h}
                style={{
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                  fontSize: '10.5px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-700)',
                  background: 'var(--paper-soft)',
                  textAlign: RIGHT_ALIGN.has(h) ? 'right' : 'left',
                  padding: '11px 14px',
                  borderBottom: '1px solid var(--ink-800)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {useGrouping ? (
            <>
              {topStrategic.length > 0 && (
                <>
                  <SectionHeader label="Top + Estratégicas" count={topStrategic.length} />
                  {renderRows(topStrategic)}
                </>
              )}
              {otherActive.length > 0 && (
                <>
                  <SectionHeader label="Otras cuentas activas" count={otherActive.length} />
                  {renderRows(otherActive)}
                </>
              )}
              {inactive.length > 0 && (
                <>
                  <SectionHeader label="Concluidas · Pausadas · Históricas" count={inactive.length} />
                  {renderRows(inactive)}
                </>
              )}
            </>
          ) : (
            renderRows(filtered)
          )}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={HEADERS.length} style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '12px' }}>
                Sin cuentas para este filtro
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
