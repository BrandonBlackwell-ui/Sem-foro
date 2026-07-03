import type {
  SyncData,
  DriveIntelligence,
  DriveAccount,
  ChecklistRecalcData,
  CadenceOverride,
  CellsData,
  AccountSegmentation,
  ContractOverrides,
  ComputedAccount,
  AccountColor,
  ContractStatusInfo,
  ContractStatusKey,
  ChecklistEntry,
  ChecklistStatus,
} from '../types'

const NUMBER_TO_ID: Record<string, string> = {
  '01': 'turbofin', '02': 'maja', '03': 'aduanas', '04': 'idlayr', '05': 'credix',
  '06': 'rocha', '07': 'apollo', '08': 'uldis', '09': 'azvi', '10': 'jack',
  '11': 'futbol', '12': 'tello', '13': 'cima', '14': 'dalinde', '15': 'armor',
  '16': 'mapelly', '17': 'irugami', '18': 'stprm', '19': 'pujol', '20': 'veracruz',
  '21': 'nuvoil', '22': 'totalplay', '23': 'luca', '24': 'gicsa', '25': 'andy',
  '26': 'bernardo', '27': 'cuernavaca', '28': 'queretaro', '29': 'coastoil',
  '30': 'erikrubi', '31': 'sasil', '32': 'cojab', '33': 'neza', '34': 'supplypay',
  '35': 'pepe', '36': 'terry', '37': 'leadsales', '38': 'karpowership',
}

const PREFIX_TO_ITEM: Record<string, string> = {
  '01': 'contrato', '02': 'entregables', '03': 'reporte',
  '04': 'whatsapp', '05': 'transcripciones', '06': 'agenda',
}

// Playbook §5 — etiquetas en la carpeta raíz que sacan al proyecto del score
// del portafolio. En Drive aparecen tras "/" o entre paréntesis. El orden
// importa: la terminación anticipada se evalúa antes que "concluido".
const EXCLUSION_LABELS: { re: RegExp; status: string }[] = [
  { re: /(terminaci[oó]n\s+anticipada|terminanci[oó]n\s+anticipada|early\s+termination)/i, status: 'terminated_early' },
  { re: /(proyecto\s+conclu[ií]d[oa]|conclu[ií]d[oa]|concluded)/i, status: 'concluded' },
  { re: /(evento\s+[uú]nico|one[\s-]?off)/i, status: 'event_single' },
  { re: /(pausa|paused|detenido)/i, status: 'paused' },
  { re: /(hist[oó]rico|historical)/i, status: 'historical' },
]

/**
 * Devuelve el status de exclusión (Playbook §5) si la carpeta raíz lleva una
 * etiqueta tras "/" o entre paréntesis, o null si la cuenta es activa.
 * Solo mira la parte después de "/" o lo que va entre paréntesis, para no
 * confundirse con un nombre de cliente que contenga alguna de esas palabras.
 */
function excludedStatusFromLabel(folderTitle: string | undefined | null): string | null {
  if (!folderTitle) return null
  const afterSlash = folderTitle.includes('/') ? folderTitle.slice(folderTitle.indexOf('/')) : ''
  const parenMatch = folderTitle.match(/\(([^)]*)\)/)?.[1] || ''
  const scope = `${afterSlash} ${parenMatch}`
  for (const { re, status } of EXCLUSION_LABELS) {
    if (re.test(scope)) return status
  }
  return null
}

const CONTRACT_STATUS_LABEL: Record<ContractStatusKey, { label: string; short: string }> = {
  signed_current:   { label: 'Vigente',               short: 'OK' },
  renewal_pending:  { label: 'Renovación pendiente',  short: 'Renovación pdte' },
  unsigned:         { label: 'Sin firma',              short: 'Sin firma' },
  renewal_expired:  { label: 'Renovación vencida',    short: 'Vencido' },
  missing:          { label: 'Sin contrato',           short: 'Sin contrato' },
  not_applicable:   { label: 'N/A',                    short: 'N/A' },
}

export { CONTRACT_STATUS_LABEL }

function detectContractStatus(
  accountNumber: string,
  syncData: SyncData['accounts'][0],
  syncedAtStr: string | null,
  contractOverrides: ContractOverrides,
): ContractStatusInfo | null {
  const overrides = contractOverrides.overrides || {}
  if (overrides[accountNumber]) {
    const o = overrides[accountNumber]
    return {
      status: o.status,
      source: 'override',
      override_note: o.note,
      override_set_by: o.set_by,
      override_since: o.since,
    }
  }
  const sa = syncData.subfolderActivity || {}
  let contratoSlot: typeof sa[string] | null = null
  for (const k of Object.keys(sa)) {
    if (/^0?1\b/.test(k) || /contrato/i.test(k)) { contratoSlot = sa[k]; break }
  }
  if (!contratoSlot || (contratoSlot.fileCount === 0 || contratoSlot.fileCount === null)) {
    return { status: 'missing', source: 'heuristic', filename_evidence: null }
  }
  const fn = (contratoSlot.latestFile || '').toUpperCase()
  if (/SIN\s*FIRMA|NO\s*FIRMAD/.test(fn)) {
    return { status: 'unsigned', source: 'heuristic', filename_evidence: contratoSlot.latestFile, latest_modified: contratoSlot.latestModified }
  }
  if (/RENOVACI[OÓ]N|RENEWAL/.test(fn) && !/FIRMAD|SIGNED/.test(fn)) {
    return { status: 'renewal_pending', source: 'heuristic', filename_evidence: contratoSlot.latestFile, latest_modified: contratoSlot.latestModified }
  }
  if (contratoSlot.latestModified && syncedAtStr) {
    try {
      const lm = new Date(contratoSlot.latestModified)
      const sy = new Date(syncedAtStr)
      const monthsOld = (sy.getTime() - lm.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      if (monthsOld > 12) {
        return { status: 'renewal_expired', source: 'heuristic', filename_evidence: contratoSlot.latestFile, latest_modified: contratoSlot.latestModified, months_old: Math.round(monthsOld) }
      }
    } catch { /* ignore */ }
  }
  return { status: 'signed_current', source: 'heuristic', filename_evidence: contratoSlot.latestFile, latest_modified: contratoSlot.latestModified }
}

interface BuildAccountsOptions {
  syncData: SyncData
  driveIntelligence: DriveIntelligence | null
  checklistRecalc: ChecklistRecalcData | null
  cadenceOverrides: Record<string, CadenceOverride>
  cells: CellsData | null
  accountSegmentation: AccountSegmentation | null
  contractOverrides: ContractOverrides
  tierOverrides: Record<string, string>
  scoreOverrides: Record<string, Record<string, number>>
}

export function buildAccounts(opts: BuildAccountsOptions): ComputedAccount[] {
  const {
    syncData, driveIntelligence, checklistRecalc,
    cadenceOverrides, cells, accountSegmentation,
    contractOverrides, tierOverrides, scoreOverrides,
  } = opts

  const CHK = checklistRecalc?.checklist || {}
  const CHK_SCHEMA = checklistRecalc?.schema || { items: {} }

  const driveByNumber: Record<string, DriveAccount> = {}
  if (driveIntelligence != null && driveIntelligence.accounts) {
    driveIntelligence.accounts.forEach(a => {
      driveByNumber[a.account_id || a.number] = a
    })
  }

  const cellById: Record<string, CellMember> = {}
  const tentativeIds = new Set<string>()
  if (cells?.cells) {
    cells.cells.forEach(c => {
      c.members.forEach(mid => { cellById[mid] = c })
      ;(c.tentative_members || []).forEach(mid => tentativeIds.add(mid))
    })
  }

  // Segmentation primary by number
  const SEG = accountSegmentation?.accounts || []
  const segPrimaryByNumber: Record<string, typeof SEG[0]> = {}
  SEG.forEach(rec => {
    const num = String(rec.number || '').padStart(2, '0')
    const cur = segPrimaryByNumber[num]
    if (!cur) { segPrimaryByNumber[num] = rec; return }
    const score = (r: typeof SEG[0]) => {
      if (r.tier === 'inactiva') return 0
      if (r.tier === 'otra') return 1
      if (r.estatus && /lead/i.test(r.estatus)) return 1
      return 2
    }
    if (score(rec) > score(cur)) segPrimaryByNumber[num] = rec
  })

  function tierForNumber(num: string): ComputedAccount['tier'] {
    const key = String(num || '').padStart(2, '0')
    if (Object.prototype.hasOwnProperty.call(tierOverrides, key)) {
      return tierOverrides[key] as ComputedAccount['tier']
    }
    const rec = segPrimaryByNumber[key]
    return rec ? (rec.tier as ComputedAccount['tier']) : null
  }

  function deriveItemsFromSubfolders(
    sub: Record<string, SubfolderActivity> | null,
    driveFiles: DriveIntelligence['accounts'][0]['files'],
  ): (ChecklistEntry & { evidence: Record<string, string> }) | null {
    const byPrefix: Record<string, { folderKey: string; data: SubfolderActivity }> = {}
    if (sub && typeof sub === 'object') {
      Object.keys(sub).forEach(folderKey => {
        const m = folderKey.match(/^(\d{2})/)
        if (m) byPrefix[m[1]] = { folderKey, data: sub[folderKey] }
      })
    }
    const filesByPrefix: Record<string, typeof driveFiles> = {}
    if (Array.isArray(driveFiles)) {
      driveFiles.forEach(f => {
        const m = (f.subfolder || '').match(/^(\d{2})/)
        if (m) {
          if (!filesByPrefix[m[1]]) filesByPrefix[m[1]] = []
          filesByPrefix[m[1]]!.push(f)
        }
      })
    }
    const hasSubfolderInfo = Object.keys(byPrefix).length >= 4 || Object.keys(filesByPrefix).length > 0
    if (!hasSubfolderInfo) return null

    const out: ChecklistEntry & { evidence: Record<string, string> } = { evidence: {} }
    Object.keys(PREFIX_TO_ITEM).forEach(prefix => {
      const itemKey = PREFIX_TO_ITEM[prefix]
      const ref = byPrefix[prefix]
      const filesHere = filesByPrefix[prefix] || []
      const fcReported = ref ? Number(ref.data?.fileCount || 0) : 0
      const fcUnknown = ref?.data && (ref.data.fileCount === null || ref.data.fileCount === undefined)
      const subfolderMissing = ref?.data?.subfolderMissing === true
      const note = ref?.data?.note
      const days = ref?.data?.latestModified
        ? Math.round((Date.now() - new Date(ref.data.latestModified).getTime()) / 86400000)
        : 999
      const fileCount = Math.max(fcReported, filesHere.length)
      const hasContent = fileCount > 0 || (note && /sub-?subcarpeta/i.test(note))
      const isWhatsapp = itemKey === 'whatsapp'

      let stat: ChecklistStatus, evidenceStr: string
      if (subfolderMissing && filesHere.length === 0) {
        stat = 'missing'; evidenceStr = 'subfolder no creado en Drive'
      } else if (subfolderMissing && filesHere.length > 0) {
        const minDays = filesHere.reduce((min, f) => {
          if (!f.modifiedTime) return min
          const d = Math.round((Date.now() - new Date(f.modifiedTime).getTime()) / 86400000)
          return Math.min(min, d)
        }, 999)
        if (isWhatsapp) stat = 'ok'
        else if (filesHere.length >= 2 && minDays < 14) stat = 'ok'
        else stat = 'partial'
        evidenceStr = `${filesHere.length} archivo(s) detectados · último: ${filesHere[0]?.title || ''}`
      } else if (!ref && filesHere.length === 0) {
        stat = 'missing'; evidenceStr = 'sin reporte de subfolder y sin archivos analizados'
      } else if (fileCount === 0 && !hasContent) {
        stat = 'missing'; evidenceStr = `0 archivos en ${ref ? ref.folderKey : 'subfolder ' + prefix}`
      } else if (fcUnknown && filesHere.length === 0) {
        if (days < 14) stat = 'ok'
        else if (days < 60) stat = 'partial'
        else stat = 'missing'
        evidenceStr = `archivos no enumerados directamente · últ. cambio ${(ref?.data?.latestModified || '').slice(0, 10)}`
      } else if (note && /sub-?subcarpeta/i.test(note) && filesHere.length === 0) {
        stat = 'partial'; evidenceStr = note.slice(0, 140)
      } else if (isWhatsapp && fileCount >= 1) {
        stat = 'ok'; evidenceStr = `${fileCount} archivo(s) · WhatsApp`
      } else if (fileCount >= 2 && days < 14) {
        stat = 'ok'; evidenceStr = `${fileCount} archivos · últ. ${days < 1 ? 'hoy' : 'hace ' + days + ' día' + (days !== 1 ? 's' : '')}`
      } else if (fileCount >= 1 && days < 30) {
        stat = 'partial'; evidenceStr = `${fileCount} archivo(s) · últ. ${ref?.data?.latestModified?.slice(0, 10) || '?'}`
      } else if (fileCount >= 1) {
        stat = 'partial'; evidenceStr = `${fileCount} archivo(s) · sin actividad reciente`
      } else {
        stat = 'missing'; evidenceStr = '0 archivos'
      }
      const lastFile = ref?.data?.latestFile || filesHere[0]?.title || null
      if (lastFile && stat !== 'missing') evidenceStr += ' · ' + lastFile
      ;(out as unknown as Record<string, unknown>)[itemKey] = stat
      out.evidence![itemKey] = evidenceStr
    })
    return out
  }

  return (syncData.accounts || []).map(s => {
    const aid = NUMBER_TO_ID[s.number] || ('drive-' + s.number)
    const drive = driveByNumber[s.number] || null
    const summary = drive?.account_summary || {}
    const adjust = summary.score_adjustment_recommendation || {}
    const cadOv = cadenceOverrides[aid] || {}
    // Playbook §5: si la carpeta raíz lleva etiqueta de exclusión
    // (/proyecto concluido, /terminación anticipada, /pausa, /evento único…),
    // la cuenta sale del score aunque el snapshot la traiga como "active".
    const labelStatus = excludedStatusFromLabel(s.folderTitle)
    const status = labelStatus || s.derivedStatus || 'active'
    const isActiveLike = !labelStatus && (
      status === 'active' || status === 'onboarding' ||
      (typeof status === 'string' && status.startsWith('active'))
    )

    const legacyItems = CHK[aid] || {}
    const driveFiles = drive?.files || []
    const derivedItems = deriveItemsFromSubfolders(s.subfolderActivity, driveFiles)
    const items = derivedItems || legacyItems
    const itemsSource = derivedItems
      ? `subfolderActivity + análisis Drive (sync ${(syncData.syncedAt || '').slice(0, 10)})`
      : (legacyItems.recalcedAt ? `checklist_recalc (${legacyItems.recalcedAt.slice(0, 10)})` : 'sin checklist')

    const contratoAlert: string | null = (
      isActiveLike &&
      items &&
      (items as ChecklistEntry).contrato === 'missing' &&
      ((items as ChecklistEntry).entregables === 'ok' || (items as ChecklistEntry).entregables === 'partial')
    ) ? ((items as ChecklistEntry).evidence?.contrato || 'Sin archivo en 01.Contrato_OC') : null

    function ckScore(axis: 'w_co' | 'w_pq' | 'w_sc'): number {
      let total = 0, totalWeight = 0
      Object.keys(CHK_SCHEMA.items || {}).forEach(k => {
        const v = (items as Record<string, unknown>)[k]
        const w = (CHK_SCHEMA.items[k]?.[axis]) || 0
        const score = ({ ok: 100, partial: 50, missing: 0, na: null } as Record<string, number | null>)[v as string]
        if (score === null || score === undefined) return
        total += w * score
        totalWeight += w
      })
      if (totalWeight > 0 && totalWeight < 1) return Math.round(total / totalWeight)
      return Math.round(total)
    }

    let co = ckScore('w_co'), pq = ckScore('w_pq'), sc = ckScore('w_sc')

    if (typeof adjust.co_delta === 'number') co = Math.max(0, Math.min(100, co + adjust.co_delta))
    if (typeof adjust.pq_delta === 'number') pq = Math.max(0, Math.min(100, pq + adjust.pq_delta))
    if (typeof adjust.sc_delta === 'number') sc = Math.max(0, Math.min(100, sc + adjust.sc_delta))

    // Playbook §2.1 y §7: "Si 01_Contrato_OC está vacía, CO arranca en 0 porque
    // no hay base para medir entregables comprometidos." Es un piso duro: ni el
    // ajuste de IA puede levantarlo mientras no se suba la evidencia mínima
    // (contrato, OC o propuesta aceptada). Un override manual sí lo respeta.
    const contratoMissing = (items as ChecklistEntry).contrato === 'missing'
    if (contratoMissing) co = 0

    // Apply local score overrides
    const ovs = scoreOverrides[aid] || {}
    if (typeof ovs['co'] === 'number') co = Math.max(0, Math.min(100, ovs['co']))
    if (typeof ovs['pq'] === 'number') pq = Math.max(0, Math.min(100, ovs['pq']))
    if (typeof ovs['sc'] === 'number') sc = Math.max(0, Math.min(100, ovs['sc']))

    const accCadenceType = cadOv.cadenceType || drive?.cadenceType || null
    const contractStatusInfo = isActiveLike
      ? detectContractStatus(s.number, s, syncData.syncedAt, contractOverrides)
      : null

    let global: number | null = null
    let color: AccountColor = 'gray'

    if (isActiveLike && co !== null) {
      if (accCadenceType === 'on-demand') {
        const onDemandScore = (key: string) =>
          ({ ok: 100, partial: 50, missing: 0, na: 0 } as Record<string, number>)[(items as Record<string, unknown>)[key] as string] || 0
        const odRaw = onDemandScore('contrato') * 0.3 +
          onDemandScore('entregables') * 0.4 +
          onDemandScore('whatsapp') * 0.3
        global = Math.round(odRaw * 10) / 10
        color = global >= 60 ? 'green' : global >= 40 ? 'yellow' : global >= 20 ? 'orange' : 'red'
        co = Math.round(onDemandScore('contrato') * 0.5 + onDemandScore('entregables') * 0.5)
        if (contratoMissing) co = 0
        pq = Math.round(onDemandScore('entregables'))
        sc = Math.round(onDemandScore('whatsapp'))
      } else {
        const raw = co * 0.30 + pq * 0.25 + sc * 0.45
        let capped = (co < 45 || sc < 50) ? Math.min(raw, 64) : raw
        if (contractStatusInfo?.status) {
          const cs = contractStatusInfo.status
          if (cs === 'unsigned' || cs === 'missing' || cs === 'renewal_expired') capped = Math.min(capped, 64)
          else if (cs === 'renewal_pending') capped = Math.min(capped, 79)
        }
        global = Math.round(capped * 10) / 10
        color = global >= 80 ? 'green' : global >= 65 ? 'yellow' : global >= 45 ? 'orange' : 'red'
      }
    } else {
      co = null as unknown as number
      pq = null as unknown as number
      sc = null as unknown as number
    }

    let statusVariant: ComputedAccount['statusVariant'] = null
    if (status === 'active_litigation') statusVariant = 'litigio'
    else if (status === 'active_new') statusVariant = 'nueva'
    else if (status === 'active_crisis_high') statusVariant = 'crisis'
    else if (status === 'onboarding') statusVariant = 'onboarding'

    const cellRef = cellById[aid] || null

    return {
      id: aid,
      number: s.number,
      name: (s.folderTitle || '').replace(/^\d+\.\s*/, '').split('/')[0].trim(),
      status,
      statusSuffix: s.statusSuffix || (labelStatus ? ({
        terminated_early: 'TERMINACIÓN ANTICIPADA',
        concluded: 'PROYECTO CONCLUIDO',
        event_single: 'EVENTO ÚNICO',
        paused: 'PAUSA',
        historical: 'HISTÓRICO',
      } as Record<string, string>)[labelStatus] : undefined),
      statusVariant,
      isActive: isActiveLike,
      co, pq, sc, global, color,
      latestDeliverable: (s.latestDeliverable?.modifiedTime) ? s.latestDeliverable : null,
      lastActivity: s.lastActivity
        ? (typeof s.lastActivity === 'object' ? (s.lastActivity as { time?: string }).time ?? null : s.lastActivity)
        : null,
      driveTitle: s.folderTitle,
      drive,
      summary,
      subfolderActivity: s.subfolderActivity,
      pqProxy: s.pqProxy,
      nextAction: s.nextAction,
      checklistItems: items,
      checklistSource: itemsSource,
      contratoAlert,
      cadenceType: accCadenceType,
      scoreFormula: accCadenceType === 'on-demand'
        ? 'on-demand (contrato 30% + entregables 40% + WA 30%, threshold verde ≥60)'
        : 'estándar (CO 37.5% + PQ 25% + SC 37.5%, threshold verde ≥80)',
      cadenceNote: cadOv.note || null,
      cell: cellRef ? cellRef.id : null,
      cellLead: cellRef ? cellRef.lead_name : null,
      cellTentative: tentativeIds.has(aid),
      tier: tierForNumber(s.number),
      contractStatus: contractStatusInfo,
    }
  })
}

// Type alias fix
type CellMember = {
  id: string
  lead_name: string
  members: string[]
  tentative_members?: string[]
}
type SubfolderActivity = {
  fileCount: number | null
  latestFile: string | null
  latestModified: string | null
  subfolderMissing?: boolean
  note?: string
}
