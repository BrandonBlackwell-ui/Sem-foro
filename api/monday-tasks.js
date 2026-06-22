const MONDAY_API_KEY = process.env.MONDAY_API_KEY || ''
const BOARD_ID = process.env.MONDAY_TASKS_BOARD_ID || '18418418634'

const COLUMN_IDS = {
  status:      process.env.MONDAY_TASKS_STATUS_COLUMN_ID      || 'color_mm452en1',
  due_date:    process.env.MONDAY_TASKS_DUE_DATE_COLUMN_ID    || 'date_mm45ncq9',
  responsible: process.env.MONDAY_TASKS_RESPONSIBLE_COLUMN_ID || 'multiple_person_mm453tee',
  work_type:   process.env.MONDAY_TASKS_WORK_TYPE_COLUMN_ID   || 'color_mm4513mj',
  client:      process.env.MONDAY_TASKS_GROUP_COLUMN_ID       || 'color_mm4ecz6r',
}

async function fetchAllItems() {
  const items = []
  let cursor = null

  do {
    const query = cursor
      ? `{
          boards(ids: [${BOARD_ID}]) {
            items_page(limit: 200, cursor: "${cursor}") {
              cursor
              items {
                id name
                column_values(ids: ["${COLUMN_IDS.status}","${COLUMN_IDS.due_date}","${COLUMN_IDS.responsible}","${COLUMN_IDS.work_type}","${COLUMN_IDS.client}"]) {
                  id text value
                }
              }
            }
          }
        }`
      : `{
          boards(ids: [${BOARD_ID}]) {
            items_page(limit: 200) {
              cursor
              items {
                id name
                column_values(ids: ["${COLUMN_IDS.status}","${COLUMN_IDS.due_date}","${COLUMN_IDS.responsible}","${COLUMN_IDS.work_type}","${COLUMN_IDS.client}"]) {
                  id text value
                }
              }
            }
          }
        }`

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
    if (json.errors) throw new Error(`Monday GraphQL: ${JSON.stringify(json.errors)}`)

    const page = json.data?.boards?.[0]?.items_page
    if (!page) break
    items.push(...(page.items || []))
    cursor = page.cursor || null
  } while (cursor)

  return items
}

function colVal(item, colId) {
  const col = item.column_values?.find(c => c.id === colId)
  return col?.text || null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!MONDAY_API_KEY) return res.status(500).json({ error: 'MONDAY_API_KEY not configured' })

  try {
    const items = await fetchAllItems()
    const tasks = items.map(item => ({
      monday_item_id: item.id,
      action: item.name,
      monday_status:           colVal(item, COLUMN_IDS.status),
      monday_due_date:         colVal(item, COLUMN_IDS.due_date),
      monday_responsible_text: colVal(item, COLUMN_IDS.responsible),
      monday_work_type:        colVal(item, COLUMN_IDS.work_type),
      monday_client_label:     colVal(item, COLUMN_IDS.client),
    }))

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(tasks)
  } catch (err) {
    console.error('[monday-tasks]', err)
    return res.status(500).json({ error: String(err) })
  }
}
