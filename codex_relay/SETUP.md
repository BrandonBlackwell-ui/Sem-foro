# Codex Relay · setup

Levanta un microservicio local que recibe prompts del dashboard y los pasa a Codex CLI usando tu suscripción de ChatGPT. El relay se expone por ngrok para que la Netlify Function pueda alcanzarlo.

**Flujo:** browser → Netlify Function → ngrok → tu Mac → Codex CLI → suscripción.

## Pre-requisitos

- Codex CLI ya instalado y autenticado (puedes probar: `codex exec "hola"` en una terminal y debe responder).
- Node.js (probablemente ya lo tienes, si no: `brew install node`).
- Cuenta gratis en ngrok.com.

---

## 1. Instala ngrok

```bash
brew install ngrok/ngrok/ngrok
```

Crea cuenta en https://dashboard.ngrok.com/signup, copia tu authtoken desde "Getting Started → Your Authtoken", y registralo:

```bash
ngrok config add-authtoken <tu-token>
```

Verifica con un test rápido:
```bash
ngrok http 3411 &
# Espera 3 segundos, debería imprimir algo como "Forwarding https://xxxxx.ngrok-free.app → http://localhost:3411"
# Mátalo con: pkill -f "ngrok http"
```

## 2. Reserva un dominio ngrok (recomendado)

Sin esto, cada restart de ngrok genera URL nueva y tienes que actualizar `CODEX_RELAY_URL` en Netlify cada vez. Con dominio reservado el URL es persistente y gratis.

- Ve a https://dashboard.ngrok.com/domains
- Click "+ Create Domain"
- Te asigna algo tipo `prestamo-blackwell.ngrok-free.app` (o eliges nombre custom)
- Cópialo

## 3. Genera el secret compartido

```bash
openssl rand -hex 32
# salida ejemplo: 9f8a3...
```

Guárdalo, lo vas a meter en dos lados (tu Mac y Netlify).

## 4. Configura `.env` local

```bash
cd ~/Desktop/Blackwell/blackwell_migration/Blackwell/codex_relay
cp .env.example .env
nano .env   # o tu editor
```

Pon:
```
RELAY_SECRET=<el secret que generaste>
NGROK_DOMAIN=<el dominio reservado, sin https://>
PORT=3411
CODEX_CMD=codex
CODEX_ARGS=exec --quiet
CODEX_TIMEOUT_MS=60000
```

> **Importante con `CODEX_ARGS`**: cada versión de Codex CLI tiene flags ligeramente distintos. Antes de seguir, prueba a mano qué te da una respuesta limpia:
> ```bash
> codex exec --quiet "¿cuánto es 2+2?"
> ```
> Si te imprime puro "4" sin ANSI codes ni prompts interactivos, perfecto. Si te muestra un menú o pregunta confirmaciones, busca en `codex --help` los flags equivalentes a "no-interactive / quiet / print-only" y ajusta `CODEX_ARGS` en el `.env`.

## 5. Smoke test local

```bash
chmod +x start.sh
bash start.sh
```

En otra terminal:
```bash
# Health (no requiere secret)
curl http://127.0.0.1:3411/health
# Deberías ver: {"ok":true,"cmd":"codex","args":["exec","--quiet"],"timeout_ms":60000,"pid":...}

# Endpoint real (necesita secret)
curl -X POST http://127.0.0.1:3411/ask \
  -H "Content-Type: application/json" \
  -H "X-Relay-Secret: <tu-secret>" \
  -d '{"prompt":"En una frase: ¿qué es Drive?"}'
```

Si te devuelve `{"answer":"...","ms":...,"model":"codex"}` → server local OK.

Ahora prueba el túnel:
```bash
curl https://<tu-dominio-ngrok>/health
```

Si responde igual → túnel OK.

Cuando todo verifique, mata con Ctrl+C.

## 6. Activa launchd para que arranque solo

```bash
cp ~/Desktop/Blackwell/blackwell_migration/Blackwell/codex_relay/com.blackwell.codex-relay.plist \
   ~/Library/LaunchAgents/

launchctl load ~/Library/LaunchAgents/com.blackwell.codex-relay.plist
```

Verifica:
```bash
launchctl list | grep codex-relay
# Esperado: <PID>  0  com.blackwell.codex-relay
```

Si ves `-` en PID y un código ≠ 0, revisa `launchd.err.log` y `relay.log` en el mismo folder.

## 7. Configura Netlify para preferir el relay

En tu terminal (ya logueada con `netlify login`):

```bash
netlify env:set CODEX_RELAY_URL "https://<tu-dominio-ngrok>" --site 092d05d8-44eb-4b1a-86ce-a2c1f8231aaa
netlify env:set CODEX_RELAY_SECRET "<el-secret>" --site 092d05d8-44eb-4b1a-86ce-a2c1f8231aaa
```

(Los env vars de OpenRouter siguen ahí como fallback automático si el relay falla.)

## 8. Re-deploy la función

```bash
rm ~/Desktop/Blackwell/blackwell_migration/Blackwell/netlify_deploy/.last_deploy_hash 2>/dev/null
cd ~/Desktop/Blackwell/blackwell_migration/Blackwell/netlify_deploy
bash deploy.sh
```

## 9. Prueba end-to-end

Hard reload del dashboard (Cmd+Shift+R) y pregunta algo. En la línea de meta del chat debe decir:

```
Respuesta IA (Netlify) · modelo: codex
```

(el `source: relay` se nota porque pone `modelo: codex` en lugar de el slug de OpenRouter)

Mira `relay.log` mientras: deberías ver una línea `[<ts>] [<reqId>] POST /ask from ... · OK · NNNms`.

---

## Operación diaria

Nada. El launchd job se queda corriendo. Si el server o ngrok mueren, launchd los relanza en 10s. Si Codex CLI deja de funcionar (sesión expirada), revisa con `codex exec "test"` y re-loguéate si hace falta — el relay se recupera solo cuando vuelve a funcionar.

## Troubleshooting

### El chat siempre cae a OpenRouter (no usa el relay)
- Revisa que `CODEX_RELAY_URL` esté seteada en Netlify: `netlify env:list --site 092d05d8-...`
- Revisa que el túnel esté arriba: `curl https://<dominio>/health`
- Revisa `relay.log` y `launchd.err.log`

### `codex exit 1` en relay.log
- Codex CLI no está respondiendo correctamente al modo no-interactivo. Ajusta `CODEX_ARGS` en `.env` (ej. prueba `--print` o `--no-tools`) y reinicia: `launchctl unload ... && launchctl load ...`

### "Unauthorized" del relay
- El `CODEX_RELAY_SECRET` en Netlify no matchea el `RELAY_SECRET` del `.env` local. Re-genera y re-setea en ambos lados.

### Quiero pausar el auto-deploy/relay
```bash
launchctl unload ~/Library/LaunchAgents/com.blackwell.codex-relay.plist
```

### Quiero cambiar el modelo/comando de Codex
Edita `.env`, después:
```bash
launchctl unload ~/Library/LaunchAgents/com.blackwell.codex-relay.plist
launchctl load   ~/Library/LaunchAgents/com.blackwell.codex-relay.plist
```

## Riesgo de seguridad (lectura obligada)

El relay expone tu Mac a internet vía ngrok. La protección es **el secret de 32 bytes que metiste**. Sin ese header, todas las requests reciben 401. Lo razonable:

- **Nunca commitees el `.env`** (ya está en .gitignore implícito porque no hay .gitignore aquí; igual no lo subas).
- **Rota el secret cada cierto tiempo** (genera otro, actualiza `.env` y Netlify, recarga el launchd).
- Si algún día notas latencia rara o tráfico inesperado, revisa `relay.log` para ver qué IPs están pegando.

El comando `codex exec` que va a correr literalmente lo que diga el prompt — alguien con el secret podría hacer que tu Codex CLI ejecute prompts arbitrarios usando tu cuota. Mientras el secret esté privado y rotado, riesgo bajo.

## Cambio de Mac

Repite los pasos 4-6 (Mac nueva). El dominio ngrok es portable (asociado a tu cuenta ngrok, no a la Mac).
