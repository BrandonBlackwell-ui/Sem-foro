// overrides.js — Netlify Function
//
// Puente entre el dashboard y Google Sheets para overrides manuales de scores.
//
// GET  /overrides                      → devuelve todos los overrides como JSON
// POST /overrides  { body: {...} }     → crea/actualiza la fila de ese account
// DELETE /overrides?accountId=xx       → borra la fila de ese account
//
// Env vars requeridas en Netlify:
//   GOOGLE_SERVICE_ACCOUNT_JSON    — contenido del service_account.json (o JSON string)
//   OVERRIDES_SHEET_ID             — ID del Google Sheet (parte de la URL)
//   OVERRIDES_SHEET_NAME           — nombre de la hoja, default "Overrides"
//
// Columnas del Sheet (fila 1 = encabezados):
//   account_id | account_name | co | pq | sc | reason | set_by | date | updated_at

const crypto = require("crypto");

const SHEET_NAME = process.env.OVERRIDES_SHEET_NAME || "Overrides";
const SHEET_ID   = process.env.OVERRIDES_SHEET_ID   || "";

// ── JWT para Google API ─────────────────────────────────────────────────────

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(serviceAccountJson) {
  const sa = typeof serviceAccountJson === "string"
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const sigInput = `${header}.${payload}`;
  const privateKey = crypto.createPrivateKey(sa.private_key);
  const sig = crypto.sign("sha256", Buffer.from(sigInput), privateKey);

  const jwt = `${sigInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Helpers de Sheets API ───────────────────────────────────────────────────

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function sheetsGet(token, range) {
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function sheetsUpdate(token, range, values) {
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  return res.json();
}

async function sheetsAppend(token, range, values) {
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  return res.json();
}

async function sheetsClear(token, range) {
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.json();
}

// ── Parsear sheet → array de objetos ────────────────────────────────────────

const HEADERS = ["account_id","account_name","co","pq","sc","reason","set_by","date","updated_at"];

function parseSheet(data) {
  const rows = data.values || [];
  if (rows.length < 1) return [];
  // Si la primera fila son encabezados, saltar; si son datos, incluir
  const start = rows[0][0] === "account_id" ? 1 : 0;
  return rows.slice(start).map(row => {
    const obj = {};
    HEADERS.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    return obj;
  }).filter(r => r.account_id);
}

// ── Asegurar que la hoja tenga encabezados ───────────────────────────────────

async function ensureHeaders(token) {
  const range = `${SHEET_NAME}!A1:I1`;
  const data = await sheetsGet(token, range);
  const first = (data.values || [[]])[0];
  if (!first || first[0] !== "account_id") {
    await sheetsUpdate(token, range, [HEADERS]);
  }
}

// ── Leer índice de fila por account_id ──────────────────────────────────────

async function findRow(token, accountId) {
  const data = await sheetsGet(token, `${SHEET_NAME}!A:A`);
  const col = (data.values || []).flat();
  for (let i = 0; i < col.length; i++) {
    if (col[i] === accountId) return i + 1; // 1-indexed
  }
  return null;
}

// ── Handler principal ────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (!SHEET_ID) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "OVERRIDES_SHEET_ID not set" }) };
  }

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_JSON not set" }) };
  }

  try {
    const token = await getAccessToken(saJson);
    await ensureHeaders(token);

    // ── GET: devolver todos los overrides ──────────────────────────────────
    if (event.httpMethod === "GET") {
      const data = await sheetsGet(token, `${SHEET_NAME}!A:I`);
      const rows = parseSheet(data);
      // Convertir a mapa por account_id
      const result = {};
      for (const r of rows) {
        result[r.account_id] = {
          account_name: r.account_name,
          co: r.co !== "" ? parseFloat(r.co) : null,
          pq: r.pq !== "" ? parseFloat(r.pq) : null,
          sc: r.sc !== "" ? parseFloat(r.sc) : null,
          reason: r.reason,
          set_by: r.set_by,
          date: r.date,
          updated_at: r.updated_at,
        };
      }
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(result) };
    }

    // ── POST: crear o actualizar override ──────────────────────────────────
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { account_id, account_name, co, pq, sc, reason, set_by } = body;
      if (!account_id) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "account_id requerido" }) };
      }
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const today = new Date().toISOString().slice(0, 10);
      const rowValues = [
        account_id,
        account_name || "",
        co != null ? co : "",
        pq != null ? pq : "",
        sc != null ? sc : "",
        reason || "",
        set_by || "",
        today,
        now,
      ];

      const existingRow = await findRow(token, account_id);
      if (existingRow) {
        await sheetsUpdate(token, `${SHEET_NAME}!A${existingRow}:I${existingRow}`, [rowValues]);
      } else {
        await sheetsAppend(token, `${SHEET_NAME}!A:I`, [rowValues]);
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE: eliminar override de una cuenta ────────────────────────────
    if (event.httpMethod === "DELETE") {
      const accountId = event.queryStringParameters?.accountId;
      if (!accountId) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "accountId param requerido" }) };
      }
      const row = await findRow(token, accountId);
      if (row) {
        await sheetsClear(token, `${SHEET_NAME}!A${row}:I${row}`);
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    console.error("overrides error:", err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
