const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || ''
const BOARD_ID = process.env.MONDAY_TASKS_BOARD_ID || '18418418634'

// Fetch all item IDs currently on the Monday board (paginated)
async function fetchMondayItemIds() {
  const ids = new Set()
  let cursor = null

  do {
    const query = cursor
      ? `{ boards(ids: [${BOARD_ID}]) { items_page(limit: 200, cursor: "${cursor}") { cursor items { id } } } }`
      : `{ boards(ids: [${BOARD_ID}]) { items_page(limit: 200) { cursor items { id } } } }`

    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: MONDAY_API_KEY,
        'API-Version': '2024-01',
      },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) throw new Error(`Monday API error: ${res.status}`)
    const json = await res.json()
    if (json.errors) throw new Error(`Monday GraphQL error: ${JSON.stringify(json.errors)}`)

    const page = json.data?.boards?.[0]?.items_page
    if (!page) break
    for (const item of page.items || []) ids.add(String(item.id))
    cursor = page.cursor || null
  } while (cursor)

  return ids
}

// Fetch all active wa_tasks that have a monday_item_id
async function fetchActiveMondayTasks() {
  const res = await fetch(
    `${SB_URL}/rest/v1/wa_tasks?select=id,monday_item_id&monday_item_id=not.is.null&deleted_at=is.null&limit=1000`,
    {
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
      },
    }
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  return res.json()
}


// Mark tasks as deleted
async function archiveTasks(taskIds) {
  if (!taskIds.length) return 0
  const idList = taskIds.join(',')
  const res = await fetch(`${SB_URL}/rest/v1/wa_tasks?id=in.(${idList})`, {
    method: 'PATCH',
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`Supabase patch error: ${res.status}`)
  return taskIds.length
}

export default async function handler(req, res) {
  // Allow GET (from dashboard on load) and POST
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  if (!MONDAY_API_KEY) return res.status(500).json({ error: 'MONDAY_API_KEY not configured' })
  if (!SB_SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' })

  try {
    const [mondayIds, supabaseTasks] = await Promise.all([
      fetchMondayItemIds(),
      fetchActiveMondayTasks(),
    ])

    // Tasks whose monday_item_id no longer exists in Monday
    const orphaned = supabaseTasks.filter(t => !mondayIds.has(String(t.monday_item_id)))
    const archivedCount = await archiveTasks(orphaned.map(t => t.id))

    return res.status(200).json({
      ok: true,
      monday_items: mondayIds.size,
      supabase_tasks: supabaseTasks.length,
      archived: archivedCount,
      archived_ids: orphaned.map(t => t.monday_item_id),
    })
  } catch (err) {
    console.error('[monday-sync]', err)
    return res.status(500).json({ error: String(err) })
  }
}
