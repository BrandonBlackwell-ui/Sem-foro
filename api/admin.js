// Panel de administrador — escritura manual a Supabase.
// El navegador NUNCA ve la service_role key: manda { token, action, payload }
// y aquí validamos el ADMIN_TOKEN y escribimos con la llave de servicio.
//
// Env requeridas en Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_TOKEN
//
// Acciones soportadas (payload entre paréntesis):
//   upsert_account   (account_number, client_name, folder_title?, tier?, tipo?, ingreso_mxn?, responsable?)
//   set_status       (account_number, status, note?)
//   upsert_contract  (account_number, client_name?, ...campos de drive_account_intel)
//   set_objectives   (account_number, objetivos[])
//   link_sheet       (account_number, sheet_value, sheet_id?)
//   link_wa_group    (account_number, wa_group_name, wa_group_id?)
//   set_wa_name      (phone, display_name, account_number?, role?)
//   set_assignment   (account_id, account_name?, consultant?, cell_director?)

import crypto from 'crypto'
import { computeMetaMonthly } from './_metaMonthly.js'

const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co'
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

function tokenOk(provided) {
  if (!ADMIN_TOKEN || typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(ADMIN_TOKEN)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

async function sbWrite(table, rows, onConflict) {
  const url = `${SB_URL}/rest/v1/${table}` +
    (onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '')
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  })
  const text = await resp.text().catch(() => '')
  if (!resp.ok) {
    throw new Error(`Supabase ${table} → ${resp.status}: ${text.slice(0, 400)}`)
  }
  try { return JSON.parse(text) } catch { return null }
}

async function sbDelete(table, query) {
  const resp = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Supabase DELETE ${table} → ${resp.status}: ${text.slice(0, 300)}`)
  }
  return true
}

function num2(n) {
  const s = String(n ?? '').trim().replace(/\D/g, '')
  return s ? s.padStart(2, '0') : null
}

function reqStr(payload, key) {
  const v = payload?.[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Falta "${key}"`)
  return v.trim()
}

function optDate(v) {
  if (!v) return null
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? m[0] : null
}

const STATUS_VALUES = new Set([
  'active', 'active_new', 'active_crisis_high', 'active_litigation', 'onboarding',
  'paused', 'concluded', 'terminated_early', 'event_single', 'historical',
])

async function handleAction(action, payload, setBy) {
  const now = new Date().toISOString()

  switch (action) {
    case 'upsert_account': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const client_name = reqStr(payload, 'client_name')
      const row = {
        account_number,
        client_name,
        folder_title: payload.folder_title || `${account_number}. ${client_name}`,
        tier: payload.tier || null,
        tipo: payload.tipo || null,
        ingreso_mxn: payload.ingreso_mxn != null && payload.ingreso_mxn !== '' ? Number(payload.ingreso_mxn) : null,
        responsable: payload.responsable || null,
        created_by: setBy,
        updated_at: now,
      }
      return { manual_accounts: await sbWrite('manual_accounts', row, 'account_number') }
    }

    case 'set_status': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const status = reqStr(payload, 'status')
      if (!STATUS_VALUES.has(status)) throw new Error(`status no permitido: ${status}`)
      const row = { account_number, status, note: payload.note || null, set_by: setBy, updated_at: now }
      return { account_status_overrides: await sbWrite('account_status_overrides', row, 'account_number') }
    }

    case 'upsert_contract': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])
      const row = {
        account_number,
        client_name: payload.client_name || null,
        folder_title: payload.folder_title || null,
        resumen: payload.resumen || null,
        tiene_contrato_firmado: typeof payload.tiene_contrato_firmado === 'boolean' ? payload.tiene_contrato_firmado : null,
        tipo_acuerdo: payload.tipo_acuerdo || null,
        vigencia_inicio: optDate(payload.vigencia_inicio),
        vigencia_fin: optDate(payload.vigencia_fin),
        periodicidad_pago: payload.periodicidad_pago || null,
        objetivos: asList(payload.objetivos),
        servicios: asList(payload.servicios),
        meta_entregables: payload.meta_entregables || '',
        renovacion: payload.renovacion || null,
        faltantes: asList(payload.faltantes),
        notas: payload.notas || null,
        intel: payload.intel || null,
        model: payload.model || 'manual/admin',
        synced_at: now,
      }
      return { drive_account_intel: await sbWrite('drive_account_intel', row, 'account_number') }
    }

    case 'upsert_operational': {
      // Fila de cumplimiento operativo (CO) del mes: entregadas vs comprometidas.
      // Alimenta buildWeightedScore para que la cuenta tenga CO (y deje de ser gris).
      const account_id = num2(payload.account_number) || String(payload.account_id || '').trim()
      if (!account_id) throw new Error('account_number/account_id inválido')
      const period_year = Number(payload.period_year)
      const period_month = Number(payload.period_month)
      if (!period_year || !period_month || period_month < 1 || period_month > 12) {
        throw new Error('period_year/period_month inválidos')
      }
      const delivered = payload.delivered_publications_count != null ? Number(payload.delivered_publications_count) : 0
      const committed = payload.committed_publications_count != null && payload.committed_publications_count !== ''
        ? Number(payload.committed_publications_count) : null
      let co = payload.co_score != null && payload.co_score !== '' ? Number(payload.co_score) : null
      if (co == null && committed && committed > 0) {
        co = Math.max(0, Math.min(100, Math.round((delivered / committed) * 100)))
      }
      const row = {
        account_id,
        account_name: payload.account_name || null,
        period_year, period_month,
        delivered_publications_count: delivered,
        committed_publications_count: committed,
        co_publications_score: co,
        co_score: co,
        status: committed ? 'measured' : 'needs_commitment',
        synced_at: now,
      }
      return { account_operational_scores: await sbWrite('account_operational_scores', row, 'account_id,period_year,period_month') }
    }

    case 'set_meta': {
      // Actualiza SOLO la meta de entregables en drive_account_intel (merge-
      // duplicates no toca las demás columnas de la fila existente).
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const metaText = String(payload.meta_entregables || '')
      // IA barata: convierte el texto libre en meta mensual (entero). null si no aplica
      // o si no hay API key (el front cae al regex).
      const meta_monthly = await computeMetaMonthly(metaText)
      const row = { account_number, meta_entregables: metaText, meta_monthly, synced_at: now }
      return { drive_account_intel: await sbWrite('drive_account_intel', row, 'account_number') }
    }

    case 'set_contract_dates': {
      // Fija la vigencia (inicio/fin) del contrato a mano. Marca contrato presente
      // (documento existe = cuenta con contrato, aunque no esté firmado). merge-duplicates
      // no toca las demás columnas de drive_account_intel.
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const iso = (v) => { const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
      const row = {
        account_number,
        vigencia_inicio: iso(payload.vigencia_inicio),
        vigencia_fin: iso(payload.vigencia_fin),
        tiene_contrato_firmado: true,
        synced_at: now,
      }
      return { drive_account_intel: await sbWrite('drive_account_intel', row, 'account_number') }
    }

    case 'set_objectives': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const objetivos = Array.isArray(payload.objetivos) ? payload.objetivos.filter(Boolean) : []
      const row = { account_number, objetivos, set_by: setBy, updated_at: now }
      return { account_objectives: await sbWrite('account_objectives', row, 'account_number') }
    }

    case 'link_sheet': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const sheet_value = reqStr(payload, 'sheet_value')
      const row = { account_number, sheet_value, sheet_id: payload.sheet_id || null, set_by: setBy, updated_at: now }
      return { account_sheet_links: await sbWrite('account_sheet_links', row, 'account_number,sheet_value') }
    }

    case 'link_wa_group': {
      const account_number = num2(payload.account_number)
      if (!account_number) throw new Error('account_number inválido')
      const wa_group_name = reqStr(payload, 'wa_group_name')
      const row = { account_number, wa_group_name, wa_group_id: payload.wa_group_id || null, set_by: setBy, updated_at: now }
      return { account_wa_links: await sbWrite('account_wa_links', row, 'account_number,wa_group_name') }
    }

    case 'set_wa_name': {
      const phone = String(payload.phone || '').replace(/\D/g, '')
      if (!phone) throw new Error('phone inválido')
      const display_name = reqStr(payload, 'display_name')
      const row = {
        phone, display_name,
        account_number: num2(payload.account_number),
        role: payload.role || null, set_by: setBy, updated_at: now,
      }
      return { wa_number_names: await sbWrite('wa_number_names', row, 'phone') }
    }

    case 'set_assignment': {
      const account_id = reqStr(payload, 'account_id')
      const row = {
        account_id,
        account_name: payload.account_name || account_id,
        consultant: payload.consultant || '',
        cell_director: payload.cell_director || '',
        updated_by: setBy,
        updated_at: now,
      }
      return { account_assignments: await sbWrite('account_assignments', row, 'account_id') }
    }

    case 'unlink': {
      // Revierte una vinculación (vuelve a "Falta"). Nota: si el verde viene de
      // datos reales (grupos WA detectados, consultor del roster, publicaciones
      // del Sheet), esto solo borra el vínculo MANUAL; el dato real permanece.
      const kind = String(payload.kind || '')
      const acc = num2(payload.account_number) || String(payload.account_id || '').trim()
      if (!acc) throw new Error('cuenta inválida')
      if (kind === 'wa') return { deleted: await sbDelete('account_wa_links', `account_number=eq.${encodeURIComponent(acc)}`) }
      if (kind === 'sheet') return { deleted: await sbDelete('account_sheet_links', `account_number=eq.${encodeURIComponent(acc)}`) }
      if (kind === 'consultor') return { deleted: await sbDelete('account_assignments', `account_id=eq.${encodeURIComponent(acc)}`) }
      if (kind === 'meta') return { drive_account_intel: await sbWrite('drive_account_intel', { account_number: acc, meta_entregables: '', synced_at: now }, 'account_number') }
      throw new Error(`kind inválido para unlink: ${kind}`)
    }

    default:
      throw new Error(`acción desconocida: ${action}`)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!SB_SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY no configurada en el servidor' })
  if (!ADMIN_TOKEN) return res.status(500).json({ error: 'ADMIN_TOKEN no configurado en el servidor' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  if (!tokenOk(body.token)) return res.status(401).json({ error: 'Token de admin inválido' })

  const { action, payload } = body
  if (typeof action !== 'string') return res.status(400).json({ error: 'Falta "action"' })
  const setBy = (typeof body.set_by === 'string' && body.set_by.trim()) ? body.set_by.trim() : 'admin'

  try {
    const result = await handleAction(action, payload || {}, setBy)
    return res.status(200).json({ ok: true, action, result })
  } catch (err) {
    return res.status(400).json({ ok: false, error: String(err.message || err) })
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}
