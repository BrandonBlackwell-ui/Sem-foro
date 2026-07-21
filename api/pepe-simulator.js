// Proxy del simulador de escenarios de Pepe Aguilar ("PEPE QUEST").
// El frontend arma el contexto (reportes reales) y los mensajes; aquí solo
// reenviamos a OpenRouter con la key del servidor. Modelo y límites fijos
// para que el endpoint no sirva como proxy LLM genérico.

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SIM_MODEL = process.env.PEPE_SIM_MODEL || 'z-ai/glm-5.2'
const MAX_MESSAGES = 4
const MAX_CONTENT_CHARS = 40000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' })
  }

  const messages = req.body?.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'messages inválidos' })
  }
  for (const m of messages) {
    if (
      !m || typeof m.content !== 'string' ||
      m.content.length > MAX_CONTENT_CHARS ||
      !['system', 'user', 'assistant'].includes(m.role)
    ) {
      return res.status(400).json({ error: 'mensaje inválido' })
    }
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://github.com/BrandonBlackwell-ui/Sem-foro',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Blackwell Semaforo - Pepe Quest',
      },
      body: JSON.stringify({
        model: SIM_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 3800,
        response_format: { type: 'json_object' },
      }),
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      return res.status(502).json({ error: `OpenRouter ${upstream.status}: ${detail.slice(0, 300)}` })
    }
    const data = await upstream.json()
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text) {
      return res.status(502).json({ error: 'OpenRouter devolvió respuesta vacía' })
    }
    return res.status(200).json({ text, model: SIM_MODEL })
  } catch (err) {
    return res.status(500).json({ error: String(err) })
  }
}
