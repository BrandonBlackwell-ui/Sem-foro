// Lee el texto de un contrato/propuesta y devuelve los campos rellenados por LLM
// para que el admin los revise antes de guardar. Mismo esquema que
// scripts/sync/drive_contract_intel.py, para que el alta manual y el sync
// automático produzcan la misma forma de datos.
//
// Env requeridas en Vercel: OPENROUTER_API_KEY, (opcional OPENROUTER_MODEL), ADMIN_TOKEN
//
// El navegador extrae el texto del PDF/DOCX (o lo pega) y manda { token, text }.

import crypto from 'crypto'

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim()
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.1-flash-lite'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const MAX_DOC_CHARS = 18000

function tokenOk(provided) {
  if (!ADMIN_TOKEN || typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(ADMIN_TOKEN)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const EXTRACTION_SYSTEM =
  'Eres un analista de contratos de una agencia de comunicación. Extrae SOLO lo que ' +
  'aparezca explícitamente en el texto del contrato/propuesta. Si un dato no está, ' +
  'usa null (o lista vacía). No inventes. Responde ÚNICAMENTE con un objeto JSON.'

const EXTRACTION_INSTRUCTIONS =
  'Del siguiente texto de contrato(s), extrae este JSON EXACTO:\n' +
  '{\n' +
  '  "tiene_contrato_firmado": boolean,\n' +
  '  "tipo_acuerdo": "contrato|ODC|propuesta|convenio_intercambio|anexo|null",\n' +
  '  "vigencia_inicio": "YYYY-MM-DD exacto, o null (nunca texto)",\n' +
  '  "vigencia_fin": "YYYY-MM-DD exacto, o null (nunca texto)",\n' +
  '  "periodicidad_pago": "texto o null",\n' +
  '  "meta_mensual_num": <ENTERO o null>,\n' +
  '  "meta_entregables": "descripción breve y literal de los entregables comprometidos.",\n' +
  '  "objetivos": ["..."],\n' +
  '  "servicios": ["..."],\n' +
  '  "resumen": "1-2 frases",\n' +
  '  "renovacion": "condiciones de renovación/prórroga, o null",\n' +
  '  "faltantes": ["huecos documentales o datos que no venían"],\n' +
  '  "notas": "observaciones relevantes o null"\n' +
  '}\n'

function stripFences(s) {
  return String(s || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurada' })
  if (!ADMIN_TOKEN) return res.status(500).json({ error: 'ADMIN_TOKEN no configurado' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  if (!tokenOk(body.token)) return res.status(401).json({ error: 'Token de admin inválido' })

  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) return res.status(400).json({ error: 'Falta "text" del contrato' })

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://github.com/BrandonBlackwell-ui/Sem-foro',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Blackwell Semaforo - Admin',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM },
          { role: 'user', content: EXTRACTION_INSTRUCTIONS + '\n\n=== TEXTO ===\n' + text.slice(0, MAX_DOC_CHARS) },
        ],
      }),
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      return res.status(502).json({ error: `OpenRouter ${upstream.status}: ${detail.slice(0, 300)}` })
    }
    const data = await upstream.json()
    const raw = data?.choices?.[0]?.message?.content
    let fields
    try { fields = JSON.parse(stripFences(raw)) } catch {
      return res.status(502).json({ error: 'El LLM no devolvió JSON válido', raw: String(raw).slice(0, 500) })
    }
    // Normaliza meta_mensual_num → texto canónico "N publicaciones/mes"
    let meta = (fields.meta_entregables || '').trim()
    const n = fields.meta_mensual_num
    if (n != null && n !== '' && !Number.isNaN(Number(n)) && Number(n) > 0) {
      meta = `${Math.round(Number(n))} publicaciones/mes`
    }
    return res.status(200).json({ ok: true, model: OPENROUTER_MODEL, fields: { ...fields, meta_entregables: meta } })
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) })
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}
