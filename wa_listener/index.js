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
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import qrcode from "qrcode-terminal";
import pino from "pino";
import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
const PAIRING_PHONE_NUMBER = process.env.WA_PAIRING_PHONE_NUMBER?.replace(/\D/g, "");
const AUTH_DIR = process.env.AUTH_DIR || join(__dir, "auth_state");
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECTS = 120;

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
let reconnectCount = 0;

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

function getEpochSeconds(timestamp) {
  if (!timestamp) return Math.floor(Date.now() / 1000);
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") return Number(timestamp);
  if (typeof timestamp.toNumber === "function") return timestamp.toNumber();
  const n = Number(timestamp);
  return Number.isFinite(n) ? n : Math.floor(Date.now() / 1000);
}

function getMessageType(message) {
  if (!message) return "unknown";
  const type = Object.keys(message)[0];
  return type ? type.replace("Message", "") : "unknown";
}

function getMessageText(message) {
  if (!message) return null;

  if (message.ephemeralMessage?.message) {
    return getMessageText(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return getMessageText(message.viewOnceMessage.message);
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.documentMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    message.reactionMessage?.text ||
    null
  );
}

function buildMessageRow(msg, mapping) {
  const remoteJid = msg.key?.remoteJid;
  const participantJid = msg.key?.participant || msg.participant || null;
  const authorJid = participantJid || remoteJid || null;
  const body = getMessageText(msg.message);
  const msgType = getMessageType(msg.message);
  const epoch = getEpochSeconds(msg.messageTimestamp);
  const sentAt = new Date(epoch * 1000).toISOString();
  const status = msg.status == null ? null : Number(msg.status);
  const isSystem = Boolean(msg.messageStubType) || Boolean(body && isSystemBody(body));

  return {
    msg_id: msg.key?.id,
    remote_jid: remoteJid,
    group_jid: remoteJid,
    from_me: Boolean(msg.key?.fromMe),
    participant_jid: participantJid,
    account_id: mapping.accountId,
    group_name: mapping.name,
    push_name: msg.pushName || null,
    author: normalizeJidUser(authorJid),
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
      console.log("\nScan this QR with WhatsApp -> Linked devices -> Link a device:\n");
      qrcode.generate(qr, { small: true });
      console.log("\nIf the QR expires, a new one will appear automatically.\n");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`WhatsApp connection closed. Reason: ${statusCode}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect && reconnectCount < MAX_RECONNECTS) {
        reconnectCount++;
        console.log(`Retry ${reconnectCount}/${MAX_RECONNECTS} in ${RECONNECT_DELAY_MS / 1000}s...`);
        setTimeout(connectToWhatsApp, RECONNECT_DELAY_MS);
      } else if (statusCode === DisconnectReason.loggedOut) {
        console.log("Session logged out. Delete wa_listener/auth_state and restart to scan a new QR.");
        process.exit(1);
      } else {
        console.error("Maximum reconnect attempts reached. Restart the listener manually.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      reconnectCount = 0;
      console.log("WhatsApp connected.");
      await loadGroupMappings();

      const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
      const unmapped = [];
      for (const [jid, meta] of Object.entries(groups)) {
        if (!groupCache.has(jid)) unmapped.push({ jid, name: meta.subject });
      }

      if (unmapped.length > 0) {
        console.log("\nGroups not mapped in Supabase wa_groups:");
        for (const g of unmapped) {
          console.log(`insert into wa_groups (jid, name, account_id) values ('${g.jid}', '${g.name.replaceAll("'", "''")}', 'XX');`);
        }
        console.log("Fill account_id and run those inserts in Supabase SQL Editor.\n");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const rows = [];
    for (const msg of messages) {
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid || !isJidGroup(remoteJid)) continue;

      const mapping = groupCache.get(remoteJid);
      if (!mapping) continue;

      const row = buildMessageRow(msg, mapping);
      if (!row.msg_id || !row.remote_jid || !row.key) continue;

      console.log(`[${row.account_id}] ${row.author ?? "unknown"}: ${row.body?.slice(0, 60) ?? `(${row.msg_type})`}`);
      rows.push(row);
    }

    await insertMessages(rows);
  });

  sock.ev.on("groups.update", async () => {
    await loadGroupMappings();
  });

  return sock;
}

console.log("Blackwell WA Listener starting...");
await loadGroupMappings();
await connectToWhatsApp();
