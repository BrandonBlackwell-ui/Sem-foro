# Auto-deploy a Netlify · setup en la Mac

Este folder contiene todo lo necesario para que el dashboard del Semáforo se publique automáticamente cada día en Netlify después de que el cron diario de Drive corra en Claude.

**Sitio:** https://bw-61ac8a57-fab.netlify.app
**Site ID:** `092d05d8-44eb-4b1a-86ce-a2c1f8231aaa`

## Cómo funciona el flujo completo

```
7:10 AM  →  Claude scheduled task `blackwell-drive-sync-diario` arranca
            • Lee Drive vía MCP
            • Reescribe data/*.js y data/*.json
            • Corre build_v36.py → regenera Semaforo_Blackwell_v36.html

7:30 AM  →  launchd en tu Mac dispara este `deploy.sh`
            • Compara el HTML actual contra el hash del último deploy
            • Si cambió: lo sube con `netlify deploy --prod`
            • Si no cambió: skip (no quema build minutes)
```

Las dos partes son independientes — si Claude no corre, launchd intenta deployar lo último que haya. Si launchd falla, el sync no se pierde, lo deployas a mano corriendo `bash deploy.sh`.

## Setup (una sola vez)

### 1. Instalar Node + netlify-cli

Si no tienes Node:
```bash
brew install node
```

Después:
```bash
npm install -g netlify-cli
```

Verifica:
```bash
netlify --version
```

### 2. Autenticar netlify-cli con tu cuenta

```bash
netlify login
```

Te abre el navegador → loguéate con la cuenta de "Blackwell AI" → autoriza el CLI. Los credentials quedan en `~/.netlify/config.json`.

### 3. Probar el deploy a mano

```bash
cd ~/Desktop/Blackwell/blackwell_migration/Blackwell/netlify_deploy
bash deploy.sh
```

Deberías ver al final algo como:
```
[2026-05-13T18:55:00Z] OK · deploy completo · Website URL: https://bw-61ac8a57-fab.netlify.app
```

Abre la URL en el navegador y confirma que el dashboard se vea.

### 4. Activar el launchd job

```bash
cp ~/Desktop/Blackwell/blackwell_migration/Blackwell/netlify_deploy/com.blackwell.dashboard-deploy.plist \
   ~/Library/LaunchAgents/

launchctl load ~/Library/LaunchAgents/com.blackwell.dashboard-deploy.plist
```

Para verificar que esté cargado:
```bash
launchctl list | grep blackwell
```

Debe aparecer `com.blackwell.dashboard-deploy`.

### 5. Forzar un run ahora mismo (opcional, para probar)

```bash
launchctl start com.blackwell.dashboard-deploy
```

Revisa `deploy.log`, `launchd.out.log` y `launchd.err.log` en este folder.

## Operación diaria

No tienes que hacer nada. El job corre a las 7:30 AM. Si la Mac está dormida o apagada a esa hora, launchd lo ejecuta cuando despierte (catch-up automático).

## Troubleshooting

### "netlify: command not found" en el log
- El PATH del launchd no encontró el CLI. Edita la plist y agrega el path correcto a `EnvironmentVariables → PATH`. Para saber dónde está:
  ```bash
  which netlify
  ```

### "Not authorized" o "you need to login"
- Los tokens de `netlify login` expiran si pasa mucho tiempo. Vuelve a correr `netlify login`.

### Deploy ejecuta pero el sitio se ve viejo
- Cache del navegador. Cmd+Shift+R para hard reload.

### Quiero pausar el auto-deploy
```bash
launchctl unload ~/Library/LaunchAgents/com.blackwell.dashboard-deploy.plist
```

Para reactivar: `launchctl load ...`

### Quiero cambiar la hora
- Edita `~/Library/LaunchAgents/com.blackwell.dashboard-deploy.plist` (las keys `Hour` y `Minute`).
- Luego: `launchctl unload ... && launchctl load ...` para que recoja el cambio.

## Cambio de Mac

Repite los pasos 1-4 en la Mac nueva. No hace falta crear un nuevo sitio en Netlify — el site_id se queda igual.

## Cambiar a contraseña en lugar de URL ofuscada

Cuando upgradees a Pro:
1. Avísame y configuro `requirePassword: true` en el proyecto desde el MCP de Netlify.
2. La URL puede volver al nombre lindo (ej. `semaforo-blackwell`) sin perder seguridad.
