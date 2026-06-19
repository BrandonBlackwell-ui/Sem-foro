import type { VercelRequest, VercelResponse } from '@vercel/node'

const SB_URL = process.env.SUPABASE_URL ?? 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? ''
const MONDAY_SIGNING_SECRET = process.env.MONDAY_SIGNING_SECRET ?? ''

// Monday column IDs → wa_tasks fields
const COLUMN_MAP: Record<string, string> = {
  color_mm452en1:       'monday_status',
  date_mm45ncq9:        'monday_due_date',
  multiple_person_mm453tee: 'monday_responsible_text',
  color_mm4513mj:       'monday_work_type',
  color_mm4ecz6r:       'monday_client_label',
}

function extractValue(columnId: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>

  if (columnId === 'date_mm45ncq9') {
    // { "date": "2026-06-20" }
    return (v.date as string) ?? null
  }
  if (columnId === 'multiple_person_mm453tee') {
    // { "personsAndTeams": [{ "id": 123, "name": "Daniel" }] }
    const people = v.personsAndTeams as Array<{ name?: string }> | undefined
    return people?.map(p => p.name).filter(Boolean).join(', ') ?? null
  }
  // Status / label columns: { "label": { "text": "En proceso" } }
  const label = (v.label as Record<string, string> | undefined)?.text
  return label ?? null
}

async function sbPatch(mondayItemId: string, patch: Record<string, unknown>) {
  const url = `${SB_URL}/rest/v1/wa_tasks?monday_item_id=eq.${mondayItemId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ...patch, monday_updated_at: new Date().toISOString(), last_synced_from_monday_at: new Date().toISOString() }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase PATCH failed: ${res.status} ${text}`)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Monday challenge handshake (first-time webhook registration)
  if (req.method === 'GET' && req.query.challenge) {
    return res.status(200).json({ challenge: req.query.challenge })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const body = req.body as Record<string, unknown>

  // Monday also sends challenge via POST on initial setup
  if (body?.challenge) {
    return res.status(200).json({ challenge: body.challenge })
  }

  const event = body?.event as Record<string, unknown> | undefined
  if (!event) return res.status(400).json({ error: 'No event' })

  const itemId = String(event.itemId ?? event.pulseId ?? '')
  const columnId = event.columnId as string | undefined

  if (!itemId) return res.status(400).json({ error: 'No itemId' })

  try {
    if (columnId && COLUMN_MAP[columnId]) {
      // Single column changed
      const field = COLUMN_MAP[columnId]
      const val = extractValue(columnId, event.value)
      await sbPatch(itemId, { [field]: val })
    } else if (event.type === 'create_item') {
      // New item created in Monday — nothing to do (our scripts handle creation)
    } else if (event.type === 'delete_item') {
      // Item deleted — mark as deleted or ignore
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[monday-webhook]', err)
    return res.status(500).json({ error: String(err) })
  }
}
