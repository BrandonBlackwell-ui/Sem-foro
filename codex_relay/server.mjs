// codex_relay/server.mjs
// HTTP server local que recibe prompts del dashboard (vía Netlify Function + ngrok)
// y los pasa a Codex CLI usando la suscripción del usuario.
//
// Endpoints:
//   GET  /health         → diagnóstico (no requiere secret)
//   POST /ask            → { prompt, options? } → { answer, ms }
//
// Env vars:
//   PORT              (default 3411)
//   RELAY_SECRET      (REQUERIDO — compartido con la Netlify Function)
//   CODEX_CMD         (default 'codex')
//   CODEX_ARGS        (default 'exec --quiet' — ajusta según tu versión de CLI)
//   CODEX_TIMEOUT_MS  (default 60000)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT) || 3411;
const RELAY_SECRET = process.env.RELAY_SECRET;
const CODEX_CMD = process.env.CODEX_CMD || 'codex';
const CODEX_ARGS = (process.env.CODEX_ARGS || 'exec --quiet').split(/\s+/).filter(Boolean);
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS) || 60000;

if (!RELAY_SECRET) {
  console.error('[fatal] Falta RELAY_SECRET en env. Genera uno con: openssl rand -hex 32');
  process.exit(1);
}

function ts() { return new Date().toISOString(); }
function log(...args) { console.log(`[${ts()}]`, ...args); }

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

async function readBody(req, maxBytes = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runCodex(prompt) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CODEX_CMD, [...CODEX_ARGS, prompt], {
      env: process.env,
      timeout: CODEX_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      resolve({ ok: false, error: `spawn error: ${err.message}`, ms: Date.now() - t0 });
    });
    child.on('close', (code, signal) => {
      const ms = Date.now() - t0;
      if (signal === 'SIGKILL') {
        return resolve({ ok: false, error: `timeout (>${CODEX_TIMEOUT_MS}ms)`, ms });
      }
      if (code !== 0) {
        return resolve({
          ok: false,
          error: `codex exit ${code}: ${stderr.slice(0, 600) || '(sin stderr)'}`,
          ms,
        });
      }
      resolve({ ok: true, answer: stdout.trim(), ms });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8);
  const remote = req.socket.remoteAddress;

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      cmd: CODEX_CMD,
      args: CODEX_ARGS,
      timeout_ms: CODEX_TIMEOUT_MS,
      pid: process.pid,
    });
  }

  if (!(req.method === 'POST' && req.url === '/ask')) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  // Auth
  const provided = req.headers['x-relay-secret'];
  if (provided !== RELAY_SECRET) {
    log(`[${reqId}] 401 from ${remote} (bad/missing secret)`);
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: `bad JSON: ${e.message}` });
  }

  const prompt = body && body.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return sendJson(res, 400, { error: "Falta 'prompt'" });
  }

  log(`[${reqId}] POST /ask from ${remote} · prompt=${prompt.length}c`);
  const result = await runCodex(prompt);
  log(`[${reqId}] ${result.ok ? 'OK' : 'FAIL'} · ${result.ms}ms${result.ok ? '' : ' · ' + result.error.slice(0, 200)}`);

  if (!result.ok) {
    return sendJson(res, 502, { error: result.error, ms: result.ms });
  }
  return sendJson(res, 200, { answer: result.answer, ms: result.ms, model: 'codex' });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`codex relay listening on http://127.0.0.1:${PORT}`);
  log(`cmd=${CODEX_CMD} args=${JSON.stringify(CODEX_ARGS)} timeout=${CODEX_TIMEOUT_MS}ms`);
});

process.on('SIGTERM', () => { log('SIGTERM'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { log('SIGINT'); server.close(() => process.exit(0)); });
