#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const NUMBER_TO_ID = {
  "01": "turbofin",
  "02": "maja",
  "03": "aduanas",
  "04": "idlayr",
  "05": "credix",
  "06": "rocha",
  "07": "apollo",
  "08": "uldis",
  "09": "azvi",
  "10": "jack",
  "11": "futbol",
  "12": "tello",
  "13": "cima",
  "14": "dalinde",
  "15": "armor",
  "16": "mapelly",
  "17": "irugami",
  "18": "stprm",
  "19": "pujol",
  "20": "veracruz",
  "21": "nuvoil",
  "22": "totalplay",
  "23": "luca",
  "24": "gicsa",
  "25": "andy",
  "26": "bernardo",
  "27": "cuernavaca",
  "28": "queretaro",
  "29": "coastoil",
  "30": "erikrubi",
  "31": "sasil",
  "32": "cojab",
  "33": "neza",
  "34": "supplypay",
  "35": "pepe",
  "36": "terry",
  "37": "leadsales",
  "38": "karpowership",
  "39": "ismerely",
};

const PREFIX_TO_ITEM = {
  "01": "contrato",
  "02": "entregables",
  "03": "reporte",
  "04": "whatsapp",
  "05": "transcripciones",
  "06": "agenda",
};

const EXCLUSION_LABELS = [
  /(terminaci[oó]n\s+anticipada|terminanci[oó]n\s+anticipada|early\s+termination)/i,
  /(proyecto\s+conclu[ií]d[oa]|conclu[ií]d[oa]|concluded)/i,
  /(evento\s+[uú]nico|one[\s-]?off)/i,
  /(pausa|paused|detenido)/i,
  /(hist[oó]rico|historical)/i,
];

// These are the last audited Semaforo scores from the legacy portfolio view.
// They are used as the WhatsApp pipeline starting point; daily LLM deltas
// are added on top in wa_account_scores.current_score.
const LEGACY_AUDITED_BASE_SCORES = {
  "07": 100,
  "09": 72.5,
  "12": 83.6,
  "13": 61.8,
  "18": 85,
  "20": 76.8,
  "21": 87.5,
  "26": 46.9,
  "29": 85.6,
  "35": 83.8,
  "38": 64.4,
};

function readJson(relativePath, fallback = null) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function loadEnv(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return;
  for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

function excludedStatusFromLabel(folderTitle) {
  if (!folderTitle) return null;
  const afterSlash = folderTitle.includes("/") ? folderTitle.slice(folderTitle.indexOf("/")) : "";
  const parenMatch = folderTitle.match(/\(([^)]*)\)/)?.[1] || "";
  const scope = `${afterSlash} ${parenMatch}`;
  return EXCLUSION_LABELS.some((re) => re.test(scope));
}

function normalizeScoreValue(value) {
  return { ok: 100, partial: 50, missing: 0, na: null }[value] ?? null;
}

function scoreForItems(items, schema, axis) {
  let total = 0;
  let totalWeight = 0;
  for (const key of Object.keys(schema.items || {})) {
    const value = normalizeScoreValue(items?.[key]);
    const weight = schema.items[key]?.[axis] || 0;
    if (value == null) continue;
    total += weight * value;
    totalWeight += weight;
  }
  if (totalWeight > 0 && totalWeight < 1) return Math.round(total / totalWeight);
  return Math.round(total);
}

function deriveItemsFromSubfolders(subfolders, driveFiles) {
  const byPrefix = {};
  for (const [folderKey, data] of Object.entries(subfolders || {})) {
    const match = folderKey.match(/^(\d{2})/);
    if (match) byPrefix[match[1]] = { folderKey, data };
  }

  const filesByPrefix = {};
  for (const file of Array.isArray(driveFiles) ? driveFiles : []) {
    const match = String(file.subfolder || "").match(/^(\d{2})/);
    if (!match) continue;
    filesByPrefix[match[1]] ||= [];
    filesByPrefix[match[1]].push(file);
  }

  const hasSubfolderInfo = Object.keys(byPrefix).length >= 4 || Object.keys(filesByPrefix).length > 0;
  if (!hasSubfolderInfo) return null;

  const out = {};
  for (const [prefix, itemKey] of Object.entries(PREFIX_TO_ITEM)) {
    const ref = byPrefix[prefix];
    const filesHere = filesByPrefix[prefix] || [];
    const reportedCount = ref ? Number(ref.data?.fileCount || 0) : 0;
    const unknownCount = ref?.data && (ref.data.fileCount === null || ref.data.fileCount === undefined);
    const subfolderMissing = ref?.data?.subfolderMissing === true;
    const note = ref?.data?.note || "";
    const days = ref?.data?.latestModified
      ? Math.round((Date.now() - new Date(ref.data.latestModified).getTime()) / 86400000)
      : 999;
    const fileCount = Math.max(reportedCount, filesHere.length);
    const hasContent = fileCount > 0 || /sub-?subcarpeta/i.test(note);
    const isWhatsapp = itemKey === "whatsapp";

    if (subfolderMissing && filesHere.length === 0) {
      out[itemKey] = "missing";
    } else if (subfolderMissing && filesHere.length > 0) {
      const minDays = filesHere.reduce((min, file) => {
        if (!file.modifiedTime) return min;
        return Math.min(min, Math.round((Date.now() - new Date(file.modifiedTime).getTime()) / 86400000));
      }, 999);
      if (isWhatsapp) out[itemKey] = "ok";
      else if (filesHere.length >= 2 && minDays < 14) out[itemKey] = "ok";
      else out[itemKey] = "partial";
    } else if (!ref && filesHere.length === 0) {
      out[itemKey] = "missing";
    } else if (fileCount === 0 && !hasContent) {
      out[itemKey] = "missing";
    } else if (unknownCount && filesHere.length === 0) {
      if (days < 14) out[itemKey] = "ok";
      else if (days < 60) out[itemKey] = "partial";
      else out[itemKey] = "missing";
    } else if (/sub-?subcarpeta/i.test(note) && filesHere.length === 0) {
      out[itemKey] = "partial";
    } else if (isWhatsapp && fileCount >= 1) {
      out[itemKey] = "ok";
    } else if (fileCount >= 2 && days < 14) {
      out[itemKey] = "ok";
    } else if (fileCount >= 1) {
      out[itemKey] = "partial";
    } else {
      out[itemKey] = "missing";
    }
  }

  return out;
}

function detectContractStatus(account, syncedAt) {
  let contratoSlot = null;
  for (const [key, value] of Object.entries(account.subfolderActivity || {})) {
    if (/^0?1\b/.test(key) || /contrato/i.test(key)) {
      contratoSlot = value;
      break;
    }
  }
  if (!contratoSlot || contratoSlot.fileCount === 0 || contratoSlot.fileCount === null) return "missing";
  const filename = String(contratoSlot.latestFile || "").toUpperCase();
  if (/SIN\s*FIRMA|NO\s*FIRMAD/.test(filename)) return "unsigned";
  if (/RENOVACI[OÓ]N|RENEWAL/.test(filename) && !/FIRMAD|SIGNED/.test(filename)) return "renewal_pending";
  if (contratoSlot.latestModified && syncedAt) {
    const monthsOld = (new Date(syncedAt).getTime() - new Date(contratoSlot.latestModified).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (monthsOld > 12) return "renewal_expired";
  }
  return "signed_current";
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function computeBaseScores() {
  const syncData = readJson("dashboard/public/data/accounts_status.json", { accounts: [], syncedAt: null });
  const driveIntelligence = readJson("dashboard/public/data/drive_intelligence.json", { accounts: [] });
  const checklistRecalc = readJson("dashboard/public/data/checklist_recalc.json", { checklist: {}, schema: { items: {} } });
  const cadenceOverrides = readJson("dashboard/public/data/cadence_overrides.json", { overrides: {} }).overrides || {};

  const driveByNumber = {};
  for (const account of driveIntelligence.accounts || []) {
    driveByNumber[account.account_id || account.number] = account;
  }

  const rows = [];
  for (const account of syncData.accounts || []) {
    const accountId = String(account.number || "").padStart(2, "0");
    const legacyId = NUMBER_TO_ID[accountId];
    if (!legacyId || excludedStatusFromLabel(account.folderTitle)) continue;

    const status = account.derivedStatus || "active";
    const active = status === "active" || status === "onboarding" || String(status).startsWith("active");
    if (!active) continue;

    const drive = driveByNumber[account.number] || null;
    const derivedItems = deriveItemsFromSubfolders(account.subfolderActivity, drive?.files || []);
    const items = derivedItems || checklistRecalc.checklist?.[legacyId] || {};
    const cadenceType = cadenceOverrides[legacyId]?.cadenceType || drive?.cadenceType || null;

    let co = scoreForItems(items, checklistRecalc.schema, "w_co");
    let pq = scoreForItems(items, checklistRecalc.schema, "w_pq");
    let sc = scoreForItems(items, checklistRecalc.schema, "w_sc");

    const adjust = drive?.account_summary?.score_adjustment_recommendation || {};
    if (typeof adjust.co_delta === "number") co = clampScore(co + adjust.co_delta);
    if (typeof adjust.pq_delta === "number") pq = clampScore(pq + adjust.pq_delta);
    if (typeof adjust.sc_delta === "number") sc = clampScore(sc + adjust.sc_delta);

    if (items.contrato === "missing") co = 0;

    let baseScore = null;
    if (cadenceType === "on-demand") {
      const itemScore = (key) => normalizeScoreValue(items[key]) || 0;
      baseScore = itemScore("contrato") * 0.3 + itemScore("entregables") * 0.4 + itemScore("whatsapp") * 0.3;
    } else {
      let raw = co * 0.375 + pq * 0.25 + sc * 0.375;
      let capped = co < 45 || sc < 50 ? Math.min(raw, 64) : raw;
      const contractStatus = detectContractStatus(account, syncData.syncedAt);
      if (["unsigned", "missing", "renewal_expired"].includes(contractStatus)) capped = Math.min(capped, 64);
      else if (contractStatus === "renewal_pending") capped = Math.min(capped, 79);
      baseScore = capped;
    }

    baseScore = LEGACY_AUDITED_BASE_SCORES[accountId] ?? baseScore;
    if (baseScore == null || Number.isNaN(baseScore)) continue;
    rows.push({
      account_id: accountId,
      account_name: String(account.folderTitle || accountId).replace(/^\d+\.\s*/, "").split("/")[0].trim(),
      base_score: clampScore(baseScore),
    });
  }

  return rows;
}

async function supabaseFetch(pathname, options = {}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loadTotalDeltas() {
  const rows = await supabaseFetch("/rest/v1/wa_daily_analysis?select=account_id,score_delta");
  const totals = new Map();
  for (const row of rows || []) {
    const accountId = String(row.account_id || "");
    totals.set(accountId, (totals.get(accountId) || 0) + Number(row.score_delta || 0));
  }
  return totals;
}

async function recomputeDailyAnalysisScores(baseRows) {
  const baseByAccount = new Map(baseRows.map((row) => [row.account_id, Number(row.base_score)]));
  const rows = await supabaseFetch(
    "/rest/v1/wa_daily_analysis?select=id,account_id,analysis_date,analyzed_at,score_delta&order=account_id.asc&order=analysis_date.asc&order=analyzed_at.asc&order=id.asc",
  );
  const running = new Map(baseByAccount);

  for (const row of rows || []) {
    const accountId = String(row.account_id || "");
    if (!baseByAccount.has(accountId)) continue;
    const previous = Number(running.get(accountId) ?? baseByAccount.get(accountId));
    const delta = Number(row.score_delta || 0);
    const next = clampScore(previous + delta);
    await supabaseFetch(`/rest/v1/wa_daily_analysis?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        previous_score: clampScore(previous),
        new_score: next,
      }),
    });
    running.set(accountId, next);
  }
}

async function main() {
  loadEnv(".env");
  loadEnv("wa_listener/.env");

  const dryRun = process.argv.includes("--dry-run");
  const baseRows = computeBaseScores();
  const totals = dryRun ? new Map() : await loadTotalDeltas();

  const rows = baseRows.map((row) => {
    const total_delta = Number(totals.get(row.account_id) || 0);
    return {
      ...row,
      current_score: clampScore(row.base_score + total_delta),
      total_delta,
      updated_at: new Date().toISOString(),
    };
  });

  if (dryRun) {
    for (const row of rows) {
      console.log(`${row.account_id} ${row.account_name}: base=${row.base_score}`);
    }
    console.log(`Total: ${rows.length}`);
    return;
  }

  const updated = await supabaseFetch("/rest/v1/wa_account_scores?on_conflict=account_id", {
    method: "POST",
    body: JSON.stringify(rows),
  });
  await recomputeDailyAnalysisScores(rows);
  for (const row of updated || []) {
    console.log(`${row.account_id} ${row.account_name}: base=${row.base_score}, delta=${row.total_delta}, current=${row.current_score}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
