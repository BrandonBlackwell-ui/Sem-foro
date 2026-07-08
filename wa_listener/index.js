/**
 * WhatsApp listener for Blackwell Semaforo.
 *
 * First run:
 *   1. Create wa_listener/.env from .env.example.
 *   2. Run: npm install
 *   3. Run: npm start
 *   4. Scan the QR with WhatsApp -> Linked devices.
 *
 * The session is stored in AUTH_DIR or ./auth_state/ and must never be committed.
 * On Railway, mount a persistent volume and set AUTH_DIR=/data/auth_state.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  downloadContentFromMessage,
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import http from "http";
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";
import pino from "pino";
import WebSocket from "ws";
import { readFileSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const __dir = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dir, ".env");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [k, ...rest] = trimmed.split("=");
    if (k && rest.length) process.env[k.trim()] = rest.join("=").trim();
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || "es";
const MAX_TRANSCRIBE_AUDIO_BYTES = Number(process.env.MAX_TRANSCRIBE_AUDIO_BYTES || 25 * 1024 * 1024);
const PAIRING_MODE = (process.env.WA_PAIRING_MODE || "qr").toLowerCase();
const PAIRING_PHONE_NUMBER =
  PAIRING_MODE === "code" ? process.env.WA_PAIRING_PHONE_NUMBER?.replace(/\D/g, "") : "";
const AUTH_DIR = process.env.AUTH_DIR || join(__dir, "auth_state");
const GROUP_REFRESH_INTERVAL_MS = Number(process.env.WA_GROUP_REFRESH_INTERVAL_MS || 10 * 60 * 1000);
const RECONNECT_DELAY_MS = 5_000;
const PAIRING_RETRY_DELAY_MS = Number(process.env.WA_PAIRING_RETRY_DELAY_MS || 90_000);
const MAX_RECONNECTS = 120;
const PORT = process.env.PORT ? Number(process.env.PORT) : null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required in wa_listener/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});
const logger = pino({ level: "silent" });
const groupCache = new Map();
const participantCache = loadParticipantMappings();
let reconnectCount = 0;
let latestQrDataUrl = null;
let latestQrAt = null;
let latestPairingCode = null;
let latestPairingAt = null;
let isWhatsAppConnected = false;
let groupRefreshTimer = null;
let statusServer = null;

const AUTO_ACCOUNT_RULES = [
  { pattern: /\bturbofin\b/i, accountId: "01", projectUid: "TU01" },
  { pattern: /maja/i, accountId: "02", projectUid: "MA02" },
  { pattern: /\bcredix\b/i, accountId: "05", projectUid: "CR05" },
  { pattern: /\bmedios\s*rr\b|\brr\b/i, accountId: "06", projectUid: "RR06" },
  { pattern: /\bapollo\b/i, accountId: "07", projectUid: "AP07" },
  { pattern: /\buldis\b/i, accountId: "08", projectUid: "UL08" },
  { pattern: /\bazvi\b/i, accountId: "09", projectUid: "GA09" },
  { pattern: /\bascenso\b|\bf.tbol\b/i, accountId: "11", projectUid: "AD11" },
  { pattern: /\btello\b|\bmtv\b(?!\s*linkedin)/i, accountId: "12", projectUid: "MT12" },
  { pattern: /\bcima\b|grupo\s+cima/i, accountId: "13", projectUid: "GC13" },
  { pattern: /\bdalinde\b|\bdsai\b|edici[oó]n\s+notas\s+blackwell/i, accountId: "14", projectUid: "DA14" },
  { pattern: /\bstprm\b|\bcomms\s*l[ií]der\b/i, accountId: "18", projectUid: "ST18" },
  { pattern: /\bveracruz\b/i, accountId: "20", projectUid: "VE20" },
  { pattern: /\bnuvoil\b/i, accountId: "21", projectUid: "NU21" },
  { pattern: /\bbernardo\b|\bbv seguimiento\b/i, accountId: "26", projectUid: "BV26" },
  { pattern: /\bcoast\s*oil\b/i, accountId: "29", projectUid: "CO29" },
  { pattern: /\bsupply\s*pay\b|\bsupply_pay\b|\bharvest\s*ai\b/i, accountId: "34", projectUid: "SP34" },
  { pattern: /\bpepe\s*aguilar\b|\bppa\b/i, accountId: "35", projectUid: "PA35" },
  { pattern: /\bkarpower\b|\bkps\b/i, accountId: "38", projectUid: "KP38" },
  { pattern: /\bismerely\b/i, accountId: "39", projectUid: "IS39" },
  { pattern: /\baustria\b/i, accountId: "40", projectUid: "AU40" },
  { pattern: /\bifa\b|\bceltics\b/i, accountId: "41", projectUid: "IC41" },
  { pattern: /\bmtv\s*linkedin\b|\bmario\s*q\b/i, accountId: "42", projectUid: "ML42" },
  { pattern: /\biran\s*guerrero\b/i, accountId: "43", projectUid: "IG43" },
  { pattern: /\blch\b|\bluxury\s*travel\b/i, accountId: "44", projectUid: "LL44" },
  { pattern: /\binovamedik\b/i, accountId: "45", projectUid: "IN45" },
];

function startStatusServer() {
  if (!PORT) return;

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, connected: isWhatsAppConnected }));
      return;
    }

    if (req.url === "/" || req.url === "/qr") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="10" />
  <title>Blackwell WhatsApp Listener</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #111; color: #fff; }
    main { text-align: center; max-width: 560px; padding: 24px; }
    img { width: min(82vw, 420px); height: auto; background: #fff; padding: 16px; border-radius: 12px; }
    .code { display: inline-block; margin: 12px 0; padding: 16px 20px; border: 1px solid #444; border-radius: 12px; font-size: clamp(34px, 8vw, 64px); font-weight: 800; letter-spacing: 0.12em; color: #fff; background: #181818; }
    p { color: #bbb; line-height: 1.5; }
    code { color: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>Blackwell WhatsApp Listener</h1>
    ${
      isWhatsAppConnected
        ? "<h2>WhatsApp connected.</h2><p>You can close this page. Keep the Railway service running.</p>"
        : latestQrDataUrl
          ? `<p>Scan this QR in WhatsApp -> Linked devices -> Link a device.</p><img src="${latestQrDataUrl}" alt="WhatsApp QR" /><p>Generated: <code>${latestQrAt}</code></p><p>This page refreshes automatically.</p>`
          : latestPairingCode
            ? `<p>Open WhatsApp -> Linked devices -> Link with phone number instead.</p><div class="code">${latestPairingCode}</div><p>Generated: <code>${latestPairingAt}</code></p><p>This code expires fast. This page refreshes automatically.</p>`
            : "<p>Waiting for a QR. Refresh in a few seconds.</p>"
    }
  </main>
</body>
</html>`);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  statusServer = server;
  server.listen(PORT, () => {
    console.log(`Status server listening on port ${PORT}. Open /qr to scan WhatsApp.`);
  });
}

function shutdown(signal) {
  console.log(`${signal} received. Shutting down WA listener gracefully.`);
  if (groupRefreshTimer) {
    clearInterval(groupRefreshTimer);
    groupRefreshTimer = null;
  }

  if (statusServer) {
    statusServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref?.();
    return;
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function loadGroupMappings() {
  const { data, error } = await supabase
    .from("wa_groups")
    .select("jid, account_id, name")
    .eq("active", true);

  if (error) {
    console.error("Error loading wa_groups from Supabase:", error.message);
    return;
  }

  groupCache.clear();
  for (const g of data ?? []) {
    groupCache.set(g.jid, { accountId: g.account_id, name: g.name });
  }

  console.log(`${groupCache.size} mapped WhatsApp groups loaded from Supabase`);
}

function projectMappingForGroupName(name) {
  const rule = AUTO_ACCOUNT_RULES.find((r) => r.pattern.test(name || ""));
  return rule ? { accountId: rule.accountId, projectUid: rule.projectUid } : { accountId: "00_UNMAPPED", projectUid: null };
}

async function registerGroup(jid, name) {
  if (!jid || groupCache.has(jid)) return groupCache.get(jid) || null;

  const projectMapping = projectMappingForGroupName(name);
  const row = {
    jid,
    name: name || jid,
    account_id: projectMapping.accountId,
    active: true,
  };
  if (projectMapping.projectUid) {
    row.project_uid = projectMapping.projectUid;
  }
  const { error } = await supabase
    .from("wa_groups")
    .upsert(row, { onConflict: "jid", ignoreDuplicates: true });

  if (error) {
    if (row.project_uid && /project_uid|schema cache|column/i.test(error.message || "")) {
      delete row.project_uid;
      const retry = await supabase
        .from("wa_groups")
        .upsert(row, { onConflict: "jid", ignoreDuplicates: true });
      if (!retry.error) {
        const mapping = { accountId: row.account_id, name: row.name, projectUid: null };
        groupCache.set(jid, mapping);
        console.log(`Auto-registered group '${row.name}' -> account ${row.account_id}`);
        console.log("project_uid column is not available yet; run migration 011_blackwell_project_uid.sql.");
        return mapping;
      }
    }
    console.error(`Could not auto-register group '${row.name}':`, error.message);
    return null;
  }

  const mapping = { accountId: row.account_id, name: row.name, projectUid: projectMapping.projectUid };
  groupCache.set(jid, mapping);
  console.log(`Auto-registered group '${row.name}' -> account ${row.account_id}`);
  if (row.account_id === "00_UNMAPPED") {
    console.log("New group saved as 00_UNMAPPED. Assign account_id in Supabase wa_groups when needed.");
  }
  return mapping;
}

async function refreshParticipatingGroups(sock) {
  await loadGroupMappings();

  const groups = await sock.groupFetchAllParticipating().catch((error) => {
    console.warn("Could not fetch participating WhatsApp groups:", error?.message || error);
    return {};
  });
  const unmapped = [];
  for (const [jid, meta] of Object.entries(groups)) {
    if (!groupCache.has(jid)) unmapped.push({ jid, name: meta.subject });
  }

  for (const group of unmapped) {
    await registerGroup(group.jid, group.name);
  }

  if (unmapped.length) {
    console.log(`Group refresh registered ${unmapped.length} new WhatsApp group(s).`);
  }
}

async function mappingForMessageGroup(sock, remoteJid) {
  const cached = groupCache.get(remoteJid);
  if (cached) return cached;

  const meta = await sock.groupMetadata(remoteJid).catch((error) => {
    console.warn(`Could not fetch metadata for unknown group ${remoteJid}:`, error?.message || error);
    return null;
  });
  return registerGroup(remoteJid, meta?.subject || remoteJid);
}

async function insertMessages(rows) {
  if (!rows.length) return;

  const { error } = await supabase
    .from("wa_messages")
    .upsert(rows, { onConflict: "msg_id,remote_jid", ignoreDuplicates: true });

  if (error) {
    console.error("Error inserting wa_messages:", error.message);
    return;
  }

  console.log(`${rows.length} WhatsApp message(s) saved`);
}

const SYSTEM_SUBSTRINGS = [
  "added",
  "removed",
  "left",
  "created group",
  "changed the group",
  "messages and calls are end-to-end encrypted",
  "anadio",
  "salio",
  "creo",
  "cambio",
  "estan cifrados",
];

function isSystemBody(body) {
  if (!body) return false;
  const lower = body.toLowerCase();
  return SYSTEM_SUBSTRINGS.some((s) => lower.includes(s.toLowerCase()));
}

function toJsonb(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeJidUser(jid) {
  if (!jid) return null;
  return String(jid).split("@")[0];
}

function loadParticipantMappings() {
  const candidates = [
    join(__dir, "..", "data", "wa_participants.json"),
    join(process.cwd(), "data", "wa_participants.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const rows = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
      const mappings = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        const phone = phoneDigits(row?.phone);
        if (!phone) continue;
        mappings.set(phone, row);
        if (phone.length >= 10) mappings.set(phone.slice(-10), row);
      }
      console.log(`${mappings.size} WhatsApp participant aliases loaded`);
      return mappings;
    } catch (error) {
      console.warn(`Could not load participant aliases from ${path}:`, error?.message || error);
    }
  }

  return new Map();
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      output += "\n";
      continue;
    }

    output += char;
  }

  return output;
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function speakerTeamLabel(team) {
  const normalized = String(team || "").trim().toLowerCase();
  if (["bws", "blackwell", "blackwell strategy"].includes(normalized)) return "Blackwell";
  if (["cliente", "client"].includes(normalized)) return "Cliente";
  return String(team || "").trim() || null;
}

function resolveSpeaker(author, pushName) {
  const digits = phoneDigits(author);
  const participant = participantCache.get(digits) || participantCache.get(digits.slice(-10));

  if (participant) {
    const name = String(participant.name || author || pushName || "").trim() || null;
    const team = speakerTeamLabel(participant.team);
    return {
      name,
      team,
      label: team ? `${name} (${team})` : name,
    };
  }

  const fallbackName = String(pushName || author || "").trim() || null;
  return {
    name: fallbackName,
    team: null,
    label: fallbackName,
  };
}

function getEpochSeconds(timestamp) {
  if (!timestamp) return Math.floor(Date.now() / 1000);
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") return Number(timestamp);
  if (typeof timestamp.toNumber === "function") return timestamp.toNumber();
  const n = Number(timestamp);
  return Number.isFinite(n) ? n : Math.floor(Date.now() / 1000);
}

function getMessageType(message) {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped) return "unknown";
  const type = Object.keys(unwrapped)[0];
  return type ? type.replace("Message", "") : "unknown";
}

function unwrapMessage(message) {
  if (!message) return null;

  if (message.ephemeralMessage?.message) {
    return unwrapMessage(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return unwrapMessage(message.viewOnceMessage.message);
  }

  return message;
}

function getMessageText(message) {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped) return null;

  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.documentMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.buttonsResponseMessage?.selectedDisplayText ||
    unwrapped.listResponseMessage?.title ||
    unwrapped.templateButtonReplyMessage?.selectedDisplayText ||
    unwrapped.reactionMessage?.text ||
    null
  );
}

function getAudioMessage(message) {
  const unwrapped = unwrapMessage(message);
  return unwrapped?.audioMessage || null;
}

function getDocumentMessage(message) {
  const unwrapped = unwrapMessage(message);
  return unwrapped?.documentMessage || null;
}

async function parseDocumentMessage(documentMessage) {
  if (!documentMessage) return null;
  const mime = documentMessage.mimetype || "";
  const fileName = documentMessage.fileName || "documento";
  try {
    const stream = await downloadContentFromMessage(documentMessage, "document");
    const buffer = await streamToBuffer(stream);
    if (!buffer.length) return null;

    if (mime.includes("officedocument.wordprocessingml.document") || fileName.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ? `[Contenido de documento ${fileName}]:\n${result.value.trim()}` : null;
    } else if (mime.includes("pdf") || fileName.endsWith(".pdf")) {
      const data = await pdfParse(buffer);
      return data.text ? `[Contenido de documento ${fileName}]:\n${data.text.trim()}` : null;
    }
  } catch (error) {
    console.warn(`Failed to parse document ${fileName}:`, error?.message || error);
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function transcribeAudioMessage(audioMessage) {
  if (!audioMessage || !DEEPGRAM_API_KEY) return null;

  const declaredLength = Number(audioMessage.fileLength || 0);
  if (declaredLength > MAX_TRANSCRIBE_AUDIO_BYTES) {
    console.warn(`Skipping audio transcription: file too large (${declaredLength} bytes).`);
    return null;
  }

  try {
    const stream = await downloadContentFromMessage(audioMessage, "audio");
    const audioBuffer = await streamToBuffer(stream);
    if (!audioBuffer.length) return null;

    if (audioBuffer.length > MAX_TRANSCRIBE_AUDIO_BYTES) {
      console.warn(`Skipping audio transcription: downloaded file too large (${audioBuffer.length} bytes).`);
      return null;
    }

    return await transcribeWithDeepgram(audioBuffer, audioMessage.mimetype || "audio/ogg");
  } catch (error) {
    console.warn("Audio transcription failed:", error?.message || error);
    return null;
  }
}

async function transcribeWithDeepgram(audioBuffer, contentType) {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    smart_format: "true",
    punctuate: "true",
  });

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      "Content-Type": contentType,
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(60_000),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Deepgram ${response.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
  }

  return json?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || null;
}

async function buildMessageRow(msg, mapping) {
  const remoteJid = msg.key?.remoteJid;
  const participantJid = msg.key?.participant || msg.participant || null;
  const authorJid = participantJid || remoteJid || null;
  const author = normalizeJidUser(authorJid);
  const speaker = resolveSpeaker(author, msg.pushName || null);
  let body = getMessageText(msg.message);
  const msgType = getMessageType(msg.message);
  const epoch = getEpochSeconds(msg.messageTimestamp);
  const sentAt = new Date(epoch * 1000).toISOString();
  const status = msg.status == null ? null : Number(msg.status);
  const isSystem = Boolean(msg.messageStubType) || Boolean(body && isSystemBody(body));
  const audioMessage = getAudioMessage(msg.message);
  const documentMessage = getDocumentMessage(msg.message);

  if (!body && audioMessage) {
    const transcript = await transcribeAudioMessage(audioMessage);
    if (transcript) {
      body = `[Audio transcrito] ${transcript}`;
    }
  } else if (documentMessage) {
    const docText = await parseDocumentMessage(documentMessage);
    if (docText) {
      body = body ? `${body}\n\n${docText}` : docText;
    }
  }

  return {
    msg_id: msg.key?.id,
    remote_jid: remoteJid,
    group_jid: remoteJid,
    from_me: Boolean(msg.key?.fromMe),
    participant_jid: participantJid,
    account_id: mapping.accountId,
    group_name: mapping.name,
    push_name: msg.pushName || null,
    author,
    speaker_name: speaker.name,
    speaker_team: speaker.team,
    speaker_label: speaker.label,
    body,
    msg_type: isSystem ? "system" : msgType,
    sent_at: sentAt,
    message_timestamp: epoch,
    status: Number.isFinite(status) ? status : null,
    broadcast: msg.broadcast == null ? null : Boolean(msg.broadcast),
    key: toJsonb(msg.key),
    message: toJsonb(msg.message),
    raw: toJsonb(msg),
    source: "baileys",
  };
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`Connecting to WhatsApp Web v${version.join(".")}...`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    browser: ["Blackwell Semaforo", "Chrome", "128.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  if (!state.creds.registered && PAIRING_PHONE_NUMBER) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PAIRING_PHONE_NUMBER);
        latestPairingCode = code;
        latestPairingAt = new Date().toISOString();
        console.log("");
        console.log("WhatsApp pairing code:");
        console.log(code);
        console.log("");
        console.log("Open WhatsApp -> Linked devices -> Link with phone number instead.");
      } catch (error) {
        console.error("Error requesting WhatsApp pairing code:", error?.message || error);
      }
    }, 2_000);
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
      latestQrAt = new Date().toISOString();
      latestPairingCode = null;
      latestPairingAt = null;
      isWhatsAppConnected = false;
      console.log("\nScan this QR with WhatsApp -> Linked devices -> Link a device:\n");
      qrcode.generate(qr, { small: true });
      if (PORT) {
        console.log(`Or open the Railway public URL at /qr to scan a clean QR image.`);
      }
      console.log("\nIf the QR expires, a new one will appear automatically.\n");
    }

    if (connection === "close") {
      isWhatsAppConnected = false;
      if (groupRefreshTimer) {
        clearInterval(groupRefreshTimer);
        groupRefreshTimer = null;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`WhatsApp connection closed. Reason: ${statusCode}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect && reconnectCount < MAX_RECONNECTS) {
        reconnectCount++;
        console.log(`Retry ${reconnectCount}/${MAX_RECONNECTS} in ${RECONNECT_DELAY_MS / 1000}s...`);
        setTimeout(connectToWhatsApp, RECONNECT_DELAY_MS);
      } else if (statusCode === DisconnectReason.loggedOut) {
        if (PAIRING_PHONE_NUMBER) {
          reconnectCount++;
          console.log(
            "Pairing code was not accepted or expired. " +
            `Waiting ${Math.round(PAIRING_RETRY_DELAY_MS / 1000)}s before generating a new one...`
          );
          setTimeout(connectToWhatsApp, PAIRING_RETRY_DELAY_MS);
        } else {
          reconnectCount++;
          latestQrDataUrl = null;
          latestQrAt = null;
          console.log(
            "Session logged out. Clearing saved WhatsApp auth state " +
            `from ${AUTH_DIR} and waiting ${Math.round(PAIRING_RETRY_DELAY_MS / 1000)}s for a new QR...`
          );
          rmSync(AUTH_DIR, { recursive: true, force: true });
          setTimeout(connectToWhatsApp, PAIRING_RETRY_DELAY_MS);
        }
      } else {
        console.error("Maximum reconnect attempts reached. Restart the listener manually.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      reconnectCount = 0;
      isWhatsAppConnected = true;
      latestQrDataUrl = null;
      latestPairingCode = null;
      latestPairingAt = null;
      console.log("WhatsApp connected.");
      await refreshParticipatingGroups(sock);
      if (groupRefreshTimer) clearInterval(groupRefreshTimer);
      groupRefreshTimer = setInterval(() => {
        refreshParticipatingGroups(sock).catch((error) => {
          console.warn("Periodic WhatsApp group refresh failed:", error?.message || error);
        });
      }, GROUP_REFRESH_INTERVAL_MS);
      groupRefreshTimer.unref?.();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return;

      const rows = [];
      for (const msg of messages) {
        try {
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid || !isJidGroup(remoteJid)) continue;

          const mapping = await mappingForMessageGroup(sock, remoteJid);
          if (!mapping) continue;

          const row = await buildMessageRow(msg, mapping);
          if (!row.msg_id || !row.remote_jid || !row.key) continue;

          console.log(`[${row.account_id}] ${row.author ?? "unknown"}: ${row.body?.slice(0, 60) ?? `(${row.msg_type})`}`);
          rows.push(row);
        } catch (error) {
          console.error("Error processing WhatsApp message:", error?.message || error);
        }
      }

      await insertMessages(rows);
    } catch (error) {
      console.error("Error handling messages.upsert:", error?.message || error);
    }
  });

  sock.ev.on("groups.update", async () => {
    await loadGroupMappings();
  });

  return sock;
}

console.log("Blackwell WA Listener starting...");
startStatusServer();
await loadGroupMappings();
await connectToWhatsApp();
