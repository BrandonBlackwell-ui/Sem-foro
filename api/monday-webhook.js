const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

const COLUMN_MAP = {
  color_mm452en1:           'monday_status',
  date_mm45ncq9:            'monday_due_date',
  multiple_person_mm453tee: 'monday_responsible_text',
  color_mm4513mj:           'monday_work_type',
  color_mm4ecz6r:           'monday_client_label',
}

function extractValue(columnId, value) {
  if (!value || typeof value !== 'object') return null
  if (columnId === 'date_mm45ncq9') return value.date || null
  if (columnId === 'multiple_person_mm453tee') {
    return (value.personsAndTeams || []).map(p => p.name).filter(Boolean).join(', ') || null
  }
  return value?.label?.text || null
}

async function sbPatch(mondayItemId, patch) {
  const res = await fetch(`${SB_URL}/rest/v1/wa_tasks?monday_item_id=eq.${mondayItemId}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      ...patch,
      monday_updated_at: new Date().toISOString(),
      last_synced_from_monday_at: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`)
}

export default async function handler(req, res) {
  // Monday challenge handshake
  if (req.query?.challenge) return res.status(200).json({ challenge: req.query.challenge })
  if (req.body?.challenge)  return res.status(200).json({ challenge: req.body.challenge })

  if (req.method !== 'POST') return res.status(405).end()

  const event = req.body?.event
  if (!event) return res.status(400).json({ error: 'No event' })

  const itemId = String(event.itemId || event.pulseId || '')
  const columnId = event.columnId

  if (!itemId) return res.status(400).json({ error: 'No itemId' })

  try {
    // Item deleted in Monday → mark as deleted in Supabase (keep record for history)
    if (event.type === 'delete_item' || event.type === 'DeleteItemEvent') {
      await sbPatch(itemId, { deleted_at: new Date().toISOString() })
      return res.status(200).json({ ok: true, action: 'marked_deleted' })
    }

    // Column changed → update the relevant field
    if (columnId && COLUMN_MAP[columnId]) {
      await sbPatch(itemId, { [COLUMN_MAP[columnId]]: extractValue(columnId, event.value) })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[monday-webhook]', err)
    return res.status(500).json({ error: String(err) })
  }
}
