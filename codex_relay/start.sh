#!/bin/bash
# Lanza server.mjs + ngrok juntos. launchd lo invoca al boot/login.
# Manualmente: bash start.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$SCRIPT_DIR/relay.log"

# Carga .env si existe (RELAY_SECRET, NGROK_DOMAIN, CODEX_CMD, etc.)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/.env"
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "=== start.sh launched ==="

# Validaciones rápidas
if ! command -v node >/dev/null 2>&1; then
  log "FATAL: node no encontrado en PATH"
  exit 1
fi
if ! command -v ngrok >/dev/null 2>&1; then
  log "FATAL: ngrok no encontrado en PATH (instala: brew install ngrok/ngrok/ngrok)"
  exit 1
fi
if [ -z "${RELAY_SECRET:-}" ]; then
  log "FATAL: RELAY_SECRET no seteado (¿olvidaste el .env?)"
  exit 1
fi

# Mata procesos viejos (idempotente cuando launchd nos reinicia)
pkill -f "node.*server.mjs" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
sleep 1

# Lanza server (logs van a relay.log)
log "Lanzando server.mjs"
node "$SCRIPT_DIR/server.mjs" >> "$LOG" 2>&1 &
SERVER_PID=$!
log "server pid: $SERVER_PID"

# Espera a que el server esté listo
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -m 2 "http://127.0.0.1:${PORT:-3411}/health" >/dev/null 2>&1; then
    log "server healthy"
    break
  fi
  sleep 1
done

# Lanza ngrok (con dominio reservado si NGROK_DOMAIN está seteado)
if [ -n "${NGROK_DOMAIN:-}" ]; then
  log "Lanzando ngrok con dominio reservado: $NGROK_DOMAIN"
  ngrok http --domain="$NGROK_DOMAIN" "${PORT:-3411}" --log=stdout >> "$LOG" 2>&1 &
else
  log "Lanzando ngrok con URL efímera (mete NGROK_DOMAIN en .env para uno estable)"
  ngrok http "${PORT:-3411}" --log=stdout >> "$LOG" 2>&1 &
fi
NGROK_PID=$!
log "ngrok pid: $NGROK_PID"

# Espera a que ngrok exponga su API local (para conocer la URL)
sleep 5
URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*' | head -1)
if [ -n "$URL" ]; then
  log "Tunnel up at: $URL"
else
  log "WARN: no pude obtener URL del túnel (ngrok puede estar todavía iniciando)"
fi

# Espera a que cualquiera de los dos muera
wait -n $SERVER_PID $NGROK_PID
log "Uno de los procesos murió. Saliendo para que launchd nos reinicie."
kill $SERVER_PID $NGROK_PID 2>/dev/null
exit 1
