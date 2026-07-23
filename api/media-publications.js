import fs from 'fs'
import path from 'path'

const SHEET_ID = process.env.MEDIA_SHEET_ID || '1PAcofO80aMuTNdclclqCrKS-uij0S8iI'
const GENERAL_GID = process.env.MEDIA_SHEET_GENERAL_GID || '905402375'

const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZ2ZrZnZ5d2JwamxkcmV1cGxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjEwNDMsImV4cCI6MjA5NzA5NzA0M30.wR9_YXMi2udYsVNLY8SlPFwpxkqZ3j78hv961ShBkQk'

async function sbSelect(pathq) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${pathq}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    if (!r.ok) return []
    return await r.json()
  } catch {
    return []
  }
}

// Superpone los vínculos MANUALES del panel admin (account_sheet_links) sobre el
// crosswalk de archivo, resolviendo número→nombre de cliente (el match del CO es
// por nombre). Así "vincular el Sheet" en el panel pega el CO EN VIVO al recargar.
async function overlayManualCrosswalk(crosswalk) {
  const [links, roster, manual] = await Promise.all([
    sbSelect('account_sheet_links?select=account_number,sheet_value'),
    sbSelect('drive_account_roster?select=account_number,client_name'),
    sbSelect('manual_accounts?select=account_number,client_name'),
  ])
  if (!links.length) return
  const nameByNum = new Map()
  for (const r of [...roster, ...manual]) {
    const num = String(parseInt(r.account_number, 10))
    if (num !== 'NaN' && r.client_name && !nameByNum.has(num)) nameByNum.set(num, clean(r.client_name))
  }
  for (const row of links) {
    const sheetName = clean(row.sheet_value)
    const acc = clean(row.account_number)
    if (!sheetName || !acc) continue
    const num = String(parseInt(acc, 10))
    crosswalk.set(normalize(sheetName), {
      account_id: acc,
      account_name: nameByNum.get(num) || sheetName,
      sheet_client_name: sheetName,
      crosswalk_status: 'manual',
    })
  }
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim()
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows
}

function uniqueHeaders(headers) {
  const seen = new Map()
  return headers.map((header) => {
    const key = clean(header) || 'columna'
    const count = (seen.get(key) || 0) + 1
    seen.set(key, count)
    return count === 1 ? key : `${key} ${count}`
  })
}

function findHeaderIndex(rows) {
  const index = rows.slice(0, 20).findIndex((row) => {
    const cells = new Set(row.map(normalize))
    return cells.has('medio') && cells.has('cliente') && cells.has('link')
  })
  if (index < 0) throw new Error('No se encontro el header del Sheet GENERAL.')
  return index
}

function recordField(record, name, preferText = false) {
  const target = normalize(name)
  if (preferText && target === 'mes') {
    const textMonth = Object.entries(record).find(([key, value]) => normalize(key).startsWith('mes') && !parseIntSafe(value))
    if (textMonth) return clean(textMonth[1])
  }
  const exact = Object.entries(record).find(([key]) => normalize(key) === target)
  if (exact) return clean(exact[1])
  const prefixed = Object.entries(record).find(([key]) => normalize(key).startsWith(`${target} `))
  return prefixed ? clean(prefixed[1]) : ''
}

function parseIntSafe(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+/)
  return match ? Number.parseInt(match[0], 10) : null
}

function parseNumber(value) {
  const cleaned = String(value || '').replace(/,/g, '').replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const num = Number.parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

function parseDate(value) {
  const text = clean(value)
  if (!text) return null
  const parts = text.split(/[/-]/).map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  const [a, b, c] = parts
  const year = a > 1900 ? a : c
  let month = b
  let day = a > 1900 ? c : a
  // Fechas capturadas en formato US (m/d/Y): sin esto "06/25/2026" producía
  // publication_month=25 y el CO agrupaba en un periodo inexistente.
  if (month > 12 && day <= 12) [month, day] = [day, month]
  if (!year || !month || month > 12 || !day || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function loadCrosswalk() {
  // En Vercel el cwd es la raíz del repo (data/…); en dev local (Vite) es
  // dashboard/, así que probamos también ../data.
  const candidates = [
    path.join(process.cwd(), 'data', 'account_crosswalk_candidates.json'),
    path.join(process.cwd(), '..', 'data', 'account_crosswalk_candidates.json'),
  ]
  const file = candidates.find((p) => fs.existsSync(p)) || candidates[0]
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const bySheetName = new Map()
  for (const row of data.rows || []) {
    const accountId = clean(row.account_id)
    if (!accountId) continue
    const accountName = clean(row.dashboard_name) || accountId
    for (const candidate of row.sheet_candidates || []) {
      const sheetName = clean(candidate.sheet_client_name)
      if (!sheetName) continue
      bySheetName.set(normalize(sheetName), {
        account_id: accountId,
        account_name: accountName,
        sheet_client_name: sheetName,
        crosswalk_status: clean(row.status) || 'revisar',
      })
    }
  }
  return bySheetName
}

function toRecords(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => clean(cell)))
  const headerIndex = findHeaderIndex(rows)
  const headers = uniqueHeaders(rows[headerIndex])
  return rows.slice(headerIndex + 1).map((values, index) => {
    const record = { _source_row_number: String(headerIndex + index + 2) }
    headers.forEach((header, cellIndex) => {
      record[header] = clean(values[cellIndex])
    })
    return record
  })
}

// Correcciones manuales a filas del Sheet: se matchea por el texto del campo link
// y se reemplaza medio/URL. Útil cuando la fila del Sheet trae texto en vez de link.
const PUBLICATION_OVERRIDES = [
  {
    match_link_text: 'ENTREVISTA EN MILENIO PEDRO GAMBOA',
    media_name: 'Milenio',
    url: 'https://www.medialog.com.mx/mx.asp?h=653abd06a797f8de777083f55e823b22&E=YntmcXBtcHM=&X=dXlwam9mbWpu',
  },
]

function applyOverride(link, mediaName) {
  const override = PUBLICATION_OVERRIDES.find(
    (o) => normalize(o.match_link_text) === normalize(link),
  )
  if (!override) return { link, mediaName }
  return { link: override.url, mediaName: override.media_name || mediaName }
}

function buildPublications(records, crosswalk) {
  const publications = []
  for (const record of records) {
    const sheetClient = recordField(record, 'cliente')
    const rawLink = recordField(record, 'link')
    const rawMedia = recordField(record, 'medio')
    const { link, mediaName } = applyOverride(rawLink, rawMedia)
    const mapped = crosswalk.get(normalize(sheetClient))
    if (!mapped || !link) continue

    const publicationDate = parseDate(recordField(record, 'fecha'))
    const year = parseIntSafe(recordField(record, 'ano')) || (publicationDate ? Number(publicationDate.slice(0, 4)) : null)
    const month = parseIntSafe(recordField(record, 'mes')) || (publicationDate ? Number(publicationDate.slice(5, 7)) : null)
    if (!year || !month) continue

    publications.push({
      id: Number.parseInt(record._source_row_number, 10),
      account_id: mapped.account_id,
      account_name: mapped.account_name,
      sheet_client_name: sheetClient,
      media_name: mediaName,
      provider: recordField(record, 'proveedor'),
      columnist: recordField(record, 'columnista'),
      legal_name: recordField(record, 'razon social'),
      publication_date: publicationDate,
      publication_year: year,
      publication_month: month,
      publication_month_name: recordField(record, 'mes', true),
      url: link,
      service: recordField(record, 'servicio'),
      cost: parseNumber(recordField(record, 'costo')),
      cost_status: recordField(record, 'estatus costo'),
      commission: parseNumber(recordField(record, 'comision $')),
      commission_status: recordField(record, 'estatus comision'),
      comments: recordField(record, 'comentarios'),
      source_row_number: Number.parseInt(record._source_row_number, 10),
      crosswalk_status: mapped.crosswalk_status,
      synced_at: new Date().toISOString(),
    })
  }
  return publications.sort((a, b) => String(b.publication_date || '').localeCompare(String(a.publication_date || '')))
}

function buildOperationalScores(publications) {
  const map = new Map()
  for (const pub of publications) {
    const key = `${pub.account_id}:${pub.publication_year}:${pub.publication_month}`
    const current = map.get(key) || {
      account_id: pub.account_id,
      account_name: pub.account_name,
      period_year: pub.publication_year,
      period_month: pub.publication_month,
      delivered_publications_count: 0,
      committed_publications_count: null,
      co_publications_score: null,
      co_score: null,
      status: 'needs_commitment',
      synced_at: new Date().toISOString(),
    }
    current.delivered_publications_count += 1
    map.set(key, current)
  }
  return Array.from(map.values()).sort((a, b) => {
    const ak = `${a.period_year}-${String(a.period_month).padStart(2, '0')}`
    const bk = `${b.period_year}-${String(b.period_month).padStart(2, '0')}`
    return bk.localeCompare(ak)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GENERAL_GID}&cachebust=${Date.now()}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Google Sheets CSV error: ${response.status}`)

    const csvText = await response.text()
    const crosswalk = loadCrosswalk()
    await overlayManualCrosswalk(crosswalk)
    const publications = buildPublications(toRecords(csvText), crosswalk)
    const operationalScores = buildOperationalScores(publications)

    res.setHeader('Cache-Control', 'no-store, max-age=0')
    return res.status(200).json({
      source: 'google_sheets_csv_api',
      sheet_id: SHEET_ID,
      gid: GENERAL_GID,
      synced_at: new Date().toISOString(),
      publications,
      operationalScores,
    })
  } catch (err) {
    console.error('[media-publications]', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown media Sheet error' })
  }
}
