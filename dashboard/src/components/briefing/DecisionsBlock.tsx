import { useApp } from '../../context/AppContext'
import { StatusDot } from '../shared/Badge'
import { CONTRACT_STATUS_LABEL } from '../../hooks/useAccounts'
import type { ComputedAccount, ContractStatusKey } from '../../types'

interface Candidate {
  name: string
  id: string
  pr: number
  txt: string
  color: string
  score: number | null
  cell: string | null
  cellLead: string | null
}

function buildCandidates(accounts: ComputedAccount[]): Candidate[] {
  const candidates: Candidate[] = []
  accounts.forEach(a => {
    if (!a.isActive) return
    if (a.cadenceType === 'on-demand' || a.cadenceType === 'event') return
    const contractIssue = a.contractStatus &&
      ['unsigned', 'renewal_pending', 'renewal_expired', 'missing'].includes(a.contractStatus.status)
    const passesNormal = (a.tier === 'top' || a.tier === 'estrategica') && (a.color === 'red' || a.color === 'orange')
    if (!passesNormal && !contractIssue) return

    let txt = ''
    if (contractIssue && !passesNormal) {
      const csLabel = (CONTRACT_STATUS_LABEL[a.contractStatus!.status as ContractStatusKey])?.label || a.contractStatus!.status
      const note = a.contractStatus!.source === 'override' && a.contractStatus!.override_note
        ? ' · ' + a.contractStatus!.override_note
        : (a.contractStatus!.filename_evidence ? ' · evidencia: ' + a.contractStatus!.filename_evidence : '')
      txt = `🔓 ${csLabel} (score ${a.color}, revisar firma/renovación)${note}`
    } else {
      txt = a.summary?.recommended_action ||
        a.summary?.monday_ticket?.trigger ||
        (a.color === 'red' ? 'Cuenta en rojo · revisar evidencia Drive y plan de recuperación'
          : a.color === 'orange' ? 'Naranja · cerrar gaps de checklist antes del próximo corte'
          : 'Amarilla · vigilar tendencia')
      if (contractIssue) {
        const csLabel = (CONTRACT_STATUS_LABEL[a.contractStatus!.status as ContractStatusKey])?.label || ''
        txt = `🔓 ${csLabel} · ${txt}`
      }
    }

    let pr = 99
    if (a.summary?.monday_ticket?.tipo) {
      pr = a.summary.monday_ticket.tipo === 'urgente' ? 1
        : a.summary.monday_ticket.tipo === 'prioridad' ? 2 : 3
    } else {
      pr = a.color === 'red' ? 2 : a.color === 'orange' ? 3 : 4
    }

    candidates.push({ name: a.name, id: a.id, pr, txt, color: a.color, score: a.global, cell: a.cell, cellLead: a.cellLead })
  })

  const colorRank: Record<string, number> = { red: 0, orange: 1 }
  candidates.sort((x, y) => {
    if (x.pr !== y.pr) return x.pr - y.pr
    const cx = colorRank[x.color] ?? 9
    const cy = colorRank[y.color] ?? 9
    if (cx !== cy) return cx - cy
    return (x.score ?? 999) - (y.score ?? 999)
  })

  return candidates
}

function CandidateItem({ c, onClick }: { c: Candidate; onClick: () => void }) {
  return (
    <li
      style={{
        position: 'relative',
        padding: '10px 0 10px 32px',
        borderBottom: '1px dotted var(--rule-soft)',
        fontSize: '13px',
        lineHeight: 1.55,
        color: 'var(--graphite)',
        listStyle: 'none',
      }}
    >
      <StatusDot color={c.color} />
      <strong
        style={{ color: 'var(--ink-900)', fontWeight: 600, letterSpacing: '-0.005em', marginLeft: '6px', cursor: 'pointer' }}
        onClick={onClick}
      >
        {c.name}
      </strong>
      {c.score !== null && (
        <span style={{ color: 'var(--muted)', fontSize: '11.5px', marginLeft: '6px' }}>· {c.score}</span>
      )}
      <span style={{ color: 'var(--char)', fontSize: '12.5px', marginLeft: '6px' }}>— {c.txt}</span>
    </li>
  )
}

export function DecisionsBlock() {
  const { accounts, openModal } = useApp()
  const candidates = buildCandidates(accounts)

  return (
    <div
      className="pane-card"
      style={{ padding: '20px 22px' }}
    >
      <div className="section-label" style={{ marginBottom: '14px' }}>
        Decisiones requeridas
        <span style={{ color: 'var(--muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: '10.5px' }}>
          · top + estratégicas
        </span>
      </div>

      {candidates.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
          Todas las cuentas en verde · sin pendientes.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '14px',
          }}
        >
          {/* Group by cell if cells data available */}
          <CellDecisions candidates={candidates} onOpen={openModal} />
        </div>
      )}
    </div>
  )
}

function CellDecisions({ candidates, onOpen }: { candidates: Candidate[]; onOpen: (id: string) => void }) {
  const [cells, setCells] = React.useState<{ id: string; lead_name: string }[]>([])
  React.useEffect(() => {
    fetch('/data/cells.json')
      .then(r => r.json())
      .then((d: any) => setCells(d.cells || []))
      .catch(() => {})
  }, [])

  if (!cells.length) {
    return (
      <ol style={{ margin: '0', padding: 0 }}>
        {candidates.map(c => (
          <CandidateItem key={c.id} c={c} onClick={() => onOpen(c.id)} />
        ))}
      </ol>
    )
  }

  const byCell: Record<string, Candidate[]> = {}
  cells.forEach(c => { byCell[c.id] = [] })
  const orphans: Candidate[] = []
  candidates.forEach(c => {
    if (c.cell && byCell[c.cell]) byCell[c.cell].push(c)
    else orphans.push(c)
  })

  return (
    <>
      {cells.map(cell => (
        <div
          key={cell.id}
          style={{
            background: 'var(--paper-soft)',
            border: '1px solid var(--rule-soft)',
            borderLeft: `3px solid ${cell.id === 'A' ? 'var(--ink-700)' : 'var(--blue-600)'}`,
            borderLeftStyle: cell.id === 'A' ? 'solid' : 'dashed',
            padding: '16px 18px',
            borderRadius: '2px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--rule-soft)',
              fontFamily: 'var(--sans)',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--ink-900)',
            }}
          >
            <span>Célula {cell.id} · {cell.lead_name}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '11.5px' }}>
              {byCell[cell.id].length} pendiente{byCell[cell.id].length !== 1 ? 's' : ''}
            </span>
          </div>
          {byCell[cell.id].length === 0 ? (
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '12.5px' }}>
              Sin pendientes · todas las cuentas en verde.
            </p>
          ) : (
            <ol style={{ margin: '6px 0 0', padding: 0, counterReset: 'dec' }}>
              {byCell[cell.id].map(c => (
                <CandidateItem key={c.id} c={c} onClick={() => onOpen(c.id)} />
              ))}
            </ol>
          )}
        </div>
      ))}
      {orphans.length > 0 && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>
            Sin célula asignada
          </div>
          <ol style={{ margin: 0, padding: 0 }}>
            {orphans.map(c => <CandidateItem key={c.id} c={c} onClick={() => onOpen(c.id)} />)}
          </ol>
        </div>
      )}
    </>
  )
}

import React from 'react'
