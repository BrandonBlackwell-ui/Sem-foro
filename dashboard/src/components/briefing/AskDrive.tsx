import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'

const QUICK_PROMPTS = [
  '¿Qué cuentas están en mayor riesgo esta semana?',
  '¿Quién tiene los mejores resultados de placements Tier 1?',
  '¿Qué cuentas tienen falta de contrato en Drive?',
  '¿Qué decisiones urgentes debe tomar Humberto antes del lunes?',
]

interface Citation {
  type: 'account' | 'file' | 'delta'
  id: string
  label: string
  raw: string
}

interface Plan {
  fields: string[]
  accounts: string[] | 'all'
  model: string
  reasoning: string
  context_chars: number
}

interface Usage {
  model?: string
  input_tokens?: number
  output_tokens?: number
  cost_usd?: string | number
  // legacy compat
  router?: { input_tokens: number; output_tokens: number; cost_usd: number; model: string }
  answer?: { input_tokens: number; output_tokens: number; cost_usd: number; model: string }
  total_cost_usd?: number
}

interface AskResponse {
  answer: string
  citations: Citation[]
  plan?: Plan
  routing?: {       // legacy — mantener compatibilidad con versiones anteriores
    intent?: string; buckets?: string[]; accounts?: string[] | null
    model?: string; difficulty?: string; reasoning?: string; context_chars?: number
  }
  usage: Usage
  ms: { total: number; router?: number; answer?: number }
}

const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-opus-4-5': 'Opus 4.5',
}

const FIELD_LABEL: Record<string, string> = {
  // nuevos campos (plan.fields)
  scores: 'Scores', risk: 'Riesgos', action: 'Acciones',
  contract: 'Contratos', checklist: 'Checklist',
  activity: 'Subcarpetas', briefing: 'Briefing', opportunities: 'Oportunidades',
  // legacy (routing.buckets)
  account_summaries: 'Resúmenes', subfolder_activity: 'Subcarpetas',
  contracts: 'Contratos', deltas: 'Deltas', cross_findings: 'Hallazgos',
  executive_briefing: 'Briefing', next_actions: 'Acciones', monday_tickets: 'Monday',
}

const DIFFICULTY_LABEL: Record<string, string> = {
  simple: 'fácil', medium: 'media', complex: 'compleja',
}

export function AskDrive() {
  const { driveIntelligence, syncData, accounts, openModal } = useApp()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<'idle' | 'routing' | 'answering'>('idle')
  const [result, setResult] = useState<AskResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showReasoning, setShowReasoning] = useState(false)

  // Versión slim de los accounts: lo mínimo que necesita el router/respondedor
  const computedAccountsSlim = useMemo(() => {
    return accounts.map(a => ({
      number: a.number,
      name: a.name,
      tier: a.tier,
      color: a.color,
      status: a.status,
      global: a.global,
      co: a.co,
      pq: a.pq,
      sc: a.sc,
      contractStatus: a.contractStatus ? {
        status: a.contractStatus.status,
        source: a.contractStatus.source,
        filename_evidence: a.contractStatus.filename_evidence,
        latest_modified: a.contractStatus.latest_modified,
        months_old: a.contractStatus.months_old,
      } : null,
    }))
  }, [accounts])

  async function askRun(q?: string) {
    const text = (q || query).trim()
    if (!text) return
    setLoading(true)
    setStage('routing')
    setResult(null)
    setErrorMsg(null)

    try {
      // Estado visual: el router suele tardar 1-2s; pasamos a "answering" tras 1.4s
      const answerTimer = window.setTimeout(() => setStage('answering'), 1400)

      const resp = await fetch('/.netlify/functions/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          driveIntelligence,
          computedAccounts: computedAccountsSlim,
          syncData: syncData ? { accounts: syncData.accounts, deltas: syncData.deltas } : null,
        }),
      })

      window.clearTimeout(answerTimer)

      // Graceful degradation: 404 means function not deployed
      if (resp.status === 404) {
        throw new Error(
          'Ask Drive no está disponible en este entorno. ' +
          'La función Netlify (ask.js) no está desplegada. ' +
          'Haz un deploy manual en app.netlify.com para activarla.'
        )
      }

      const raw = await resp.text()
      let data: AskResponse | { error: string }
      try { data = JSON.parse(raw) }
      catch { throw new Error(`La función respondió con un formato inesperado (HTTP ${resp.status}).`) }

      if (!resp.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : `Error del servidor (HTTP ${resp.status})`)
      }

      setResult(data as AskResponse)
    } catch (err) {
      setErrorMsg(String(err instanceof Error ? err.message : err))
    } finally {
      setLoading(false)
      setStage('idle')
    }
  }

  function handleQuickPrompt(p: string) {
    setQuery(p)
    askRun(p)
  }

  return (
    <section>
      <h2
        style={{
          fontSize: '17px',
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink-900)',
          marginBottom: '6px',
        }}
      >
        Ask Drive · pregunta sobre el portafolio
      </h2>
      <p
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '10.5px',
          color: 'var(--char)',
          letterSpacing: '0.04em',
          marginBottom: '14px',
        }}
      >
        Pregúntale a la IA con el contexto completo del Drive Intelligence. Cita cuentas, archivos y deltas reales.
      </p>

      {/* Quick prompts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        {QUICK_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => handleQuickPrompt(p)}
            disabled={loading}
            className="ask-chip"
          >
            {p.length > 50 ? p.slice(0, 48) + '…' : p}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') askRun() }}
          placeholder="Ej. Resúmeme el estado de MAJA en 3 frases"
          disabled={loading}
          style={{
            flex: 1,
            background: 'var(--paper-soft)',
            border: '1px solid var(--rule)',
            borderRadius: '2px',
            padding: '11px 16px',
            fontSize: '14px',
            color: 'var(--text)',
          }}
        />
        <button
          onClick={() => askRun()}
          disabled={loading || !query.trim()}
          style={{
            background: loading ? 'var(--char)' : 'var(--ink-800)',
            color: 'var(--paper-bright)',
            border: 'none',
            padding: '11px 18px',
            borderRadius: '2px',
            fontSize: '14px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            opacity: (!query.trim() && !loading) ? 0.5 : 1,
            minWidth: '120px',
          }}
        >
          {loading ? (stage === 'routing' ? 'Analizando…' : 'Respondiendo…') : 'Preguntar'}
        </button>
      </div>

      {/* Estado: cargando con indicador de etapa */}
      {loading && (
        <div className="ask-stage">
          <div className={`ask-stage-dot ${stage === 'routing' ? 'active' : 'done'}`} />
          <span className={stage === 'routing' ? 'active' : 'done'}>
            Etapa 1 · Router elige contexto y modelo
          </span>
          <div className="ask-stage-sep" />
          <div className={`ask-stage-dot ${stage === 'answering' ? 'active' : ''}`} />
          <span className={stage === 'answering' ? 'active' : ''}>
            Etapa 2 · Respondiendo con el modelo elegido
          </span>
        </div>
      )}

      {/* Error */}
      {errorMsg && !loading && (
        <div className="ask-error">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Resultado */}
      {result && !loading && (() => {
        // Normalizar: nuevo API usa `plan`, viejo usaba `routing`
        const p = result.plan
        const r = result.routing
        const model   = p?.model   ?? r?.model   ?? '—'
        const fields  = p?.fields  ?? r?.buckets  ?? []
        const accts   = p?.accounts === 'all' ? null : (p?.accounts ?? r?.accounts ?? null)
        const ctxKb   = ((p?.context_chars ?? r?.context_chars ?? 0) / 1024).toFixed(1)
        const reason  = p?.reasoning ?? r?.reasoning ?? ''
        const intent  = r?.intent ?? ''
        const diff    = r?.difficulty ?? ''
        // usage: nuevo es flat, viejo era router/answer
        const cost    = result.usage.cost_usd ?? result.usage.total_cost_usd ?? 0
        const uModel  = result.usage.model ?? result.usage.answer?.model ?? model
        const inTok   = result.usage.input_tokens ?? result.usage.answer?.input_tokens ?? 0
        const outTok  = result.usage.output_tokens ?? result.usage.answer?.output_tokens ?? 0
        return (
          <div className="ask-result">
            {/* Plan pill */}
            <div className="ask-routing">
              <span className="ask-model-pill">
                {MODEL_LABEL[model] || model}
              </span>
              {diff && (
                <span className="ask-routing-meta">
                  dificultad <strong>{DIFFICULTY_LABEL[diff] || diff}</strong>
                </span>
              )}
              {fields.length > 0 && (
                <>
                  <span className="ask-routing-sep">·</span>
                  <span className="ask-routing-meta">
                    {fields.map(f => FIELD_LABEL[f] || f).join(', ')}
                  </span>
                </>
              )}
              {accts && accts.length > 0 && (
                <>
                  <span className="ask-routing-sep">·</span>
                  <span className="ask-routing-meta">
                    {accts.length} cuenta{accts.length === 1 ? '' : 's'} en foco
                  </span>
                </>
              )}
              <button
                type="button"
                className="ask-routing-toggle"
                onClick={() => setShowReasoning(s => !s)}
              >
                {showReasoning ? '— ocultar razonamiento' : '+ ver razonamiento'}
              </button>
            </div>

            {showReasoning && (
              <div className="ask-reasoning">
                {intent && <div><strong>Intent:</strong> {intent}</div>}
                {reason && <div><strong>Razonamiento:</strong> {reason}</div>}
                <div><strong>Contexto enviado:</strong> {ctxKb}KB</div>
              </div>
            )}

            {/* Answer */}
            <AnswerBody text={result.answer} onAccountClick={openModal} accounts={accounts} />

            {/* Citations */}
            {result.citations.length > 0 && (
              <div className="ask-citations">
                <div className="ask-citations-label">Cuentas citadas</div>
                <div className="ask-citations-chips">
                  {result.citations.map(c => (
                    <button
                      key={`${c.type}:${c.id}`}
                      className="ask-citation-chip"
                      onClick={() => {
                        if (c.type === 'account') {
                          const acc = accounts.find(a =>
                            a.number === c.id
                            || a.number === c.id.padStart(2, '0')
                            || a.number === c.id.replace(/^0+/, ''),
                          )
                          if (acc) openModal(acc.id)
                        }
                      }}
                    >
                      #{c.id} {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="ask-meta">
              <span>
                <strong>{MODEL_LABEL[uModel] || uModel}</strong>
                &nbsp;· {inTok}→{outTok} tok
              </span>
              <span className="ask-meta-sep">|</span>
              <span>
                ${Number(cost).toFixed(4)} USD · {result.ms.total}ms
              </span>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

// ─── Cuerpo de la respuesta con citas clickeables y formato simple ──────────

function AnswerBody({
  text,
  onAccountClick,
  accounts,
}: {
  text: string
  onAccountClick: (id: string) => void
  accounts: ReturnType<typeof useApp>['accounts']
}) {
  // Convertimos:
  //   - [#NN Nombre]  →  chip clickeable
  //   - **negrita**   →  <strong>
  //   - líneas que empiezan con "- "  →  bullets
  // Mantenemos saltos de línea como párrafos.

  const blocks = useMemo(() => parseAnswerBlocks(text), [text])

  function renderInline(part: string, key: string) {
    // [#NN Nombre]
    const segments: React.ReactNode[] = []
    const re = /\[#(\d{1,3})\s+([^\]]+)\]/g
    let lastIndex = 0
    let m
    let idx = 0
    while ((m = re.exec(part)) !== null) {
      if (m.index > lastIndex) {
        segments.push(
          <span key={`${key}-t-${idx}`}>
            {renderBold(part.slice(lastIndex, m.index), `${key}-b-${idx}`)}
          </span>,
        )
      }
      const number = m[1]
      const label = m[2].trim()
      const acc = accounts.find(a =>
        a.number === number
        || a.number === number.padStart(2, '0')
        || a.number === number.replace(/^0+/, ''),
      )
      segments.push(
        <button
          key={`${key}-c-${idx}`}
          type="button"
          className="ask-inline-citation"
          onClick={() => { if (acc) onAccountClick(acc.id) }}
          disabled={!acc}
          title={acc ? `Abrir ficha de ${label}` : 'Cuenta no disponible'}
        >
          #{number} {label}
        </button>,
      )
      lastIndex = m.index + m[0].length
      idx++
    }
    if (lastIndex < part.length) {
      segments.push(
        <span key={`${key}-t-end`}>
          {renderBold(part.slice(lastIndex), `${key}-b-end`)}
        </span>,
      )
    }
    return segments
  }

  return (
    <div className="ask-answer">
      {blocks.map((block, i) => {
        if (block.type === 'bullets') {
          return (
            <ul key={`bul-${i}`} className="ask-answer-bullets">
              {block.items.map((it, j) => (
                <li key={`li-${i}-${j}`}>{renderInline(it, `b${i}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={`p-${i}`} className="ask-answer-p">
            {renderInline(block.text, `p${i}`)}
          </p>
        )
      })}
    </div>
  )
}

function renderBold(s: string, key: string): React.ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g)
  return parts.map((p, i) =>
    i % 2 === 1
      ? <strong key={`${key}-${i}`}>{p}</strong>
      : <span key={`${key}-${i}`}>{p}</span>,
  )
}

type Block = { type: 'p'; text: string } | { type: 'bullets'; items: string[] }

function parseAnswerBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let buf: string[] = []
  let bullets: string[] = []

  const flushP = () => {
    if (buf.length) {
      const t = buf.join(' ').trim()
      if (t) blocks.push({ type: 'p', text: t })
      buf = []
    }
  }
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ type: 'bullets', items: bullets })
      bullets = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushBullets()
      flushP()
      continue
    }
    if (/^[-•]\s+/.test(line)) {
      flushP()
      bullets.push(line.replace(/^[-•]\s+/, ''))
    } else {
      flushBullets()
      buf.push(line)
    }
  }
  flushBullets()
  flushP()
  return blocks
}
