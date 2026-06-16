# Setup — GitHub Actions: Sync diario automático

El workflow `.github/workflows/daily-sync.yml` corre automáticamente cada día a las 8am (hora Ciudad de México) y hace:

1. Crawlea Google Drive → actualiza `data/*.json`
2. Construye el dashboard React (`npm run build`)
3. Despliega a Netlify

---

## Paso 1 — Subir el proyecto a GitHub

Si aún no tienes el repo en GitHub:

```bash
cd C:\Users\Emiliano Guillen\Desktop\QO\Blackwell
git init
git add .
git commit -m "Initial commit — Proyecto Blackwell"
git remote add origin https://github.com/TU_USUARIO/blackwell.git
git push -u origin main
```

> **Importante:** asegúrate de que `.env`, `service_account.json` y `data/*.json` estén en `.gitignore`
> para no subir credenciales ni datos privados.

---

## Paso 2 — Crear un Service Account en Google Cloud

El sync en GitHub Actions necesita credenciales que funcionen sin abrir un navegador.
Un **Service Account** es una cuenta de máquina (no personal) que Google Cloud te da para esto.

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Selecciona el proyecto donde tienes habilitado Google Drive API
3. Menú → **IAM y administración → Cuentas de servicio**
4. Clic en **Crear cuenta de servicio**
   - Nombre: `blackwell-sync`
   - ID: `blackwell-sync`
   - Clic en **Crear y continuar** → omite roles → **Listo**
5. Haz clic en la cuenta recién creada → pestaña **Claves**
6. **Agregar clave → Crear clave nueva → JSON** → se descarga el archivo
7. Guarda ese archivo como `service_account.json` (no lo subas a git)

### Dar acceso al Drive

Para que el Service Account pueda leer la carpeta de Blackwell:

1. Abre Google Drive
2. Clic derecho en la carpeta raíz **"PROYECTOS BLACKWELL"** → **Compartir**
3. Agrega el email del Service Account (termina en `@...iam.gserviceaccount.com`)
4. Permiso: **Lector** (solo necesita leer, no escribir)

---

## Paso 3 — Agregar los Secrets en GitHub

Ve a tu repositorio en GitHub → **Settings → Secrets and variables → Actions → New repository secret**

Agrega estos 4 secrets:

| Secret | Valor | Dónde obtenerlo |
|--------|-------|----------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido completo del archivo JSON del Service Account | El archivo descargado en el paso 2 — copia y pega todo el contenido |
| `DRIVE_ROOT_FOLDER_ID` | `1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_` | Ya lo tienes en `.env` |
| `ANTHROPIC_API_KEY` | Tu API key de Claude | [console.anthropic.com](https://console.anthropic.com) |
| `NETLIFY_AUTH_TOKEN` | Tu token personal de Netlify | [app.netlify.com/user/applications](https://app.netlify.com/user/applications) → Personal access tokens |

El `NETLIFY_SITE_ID` ya está hardcodeado en el workflow (`092d05d8-44eb-4b1a-86ce-a2c1f8231aaa`), pero puedes moverlo a Secret también si prefieres.

---

## Paso 4 — Verificar que funciona

Una vez configurados los secrets, prueba el workflow manualmente:

1. Ve a tu repo → pestaña **Actions**
2. Selecciona **"Blackwell · Sync diario + Deploy"**
3. Clic en **Run workflow** → modo: `delta` → **Run workflow**
4. Observa los pasos en tiempo real

Si todo va bien, verás Netlify actualizado y los datos frescos en el dashboard.

---

## Horario exacto

El cron está configurado a las `13:00 UTC`:

- **Verano (CDT, abril–oct):** 13:00 UTC = **8:00 AM CDT** ✓
- **Invierno (CST, nov–mar):** 13:00 UTC = **7:00 AM CST** (una hora antes)

Para ajustar en invierno, cambia el cron a `0 14 * * *` en el archivo del workflow.

---

## Correr manualmente (bypass del horario)

Desde la pestaña Actions → Run workflow, puedes elegir:
- **Modo:** `delta` (solo cambios desde último sync) o `baseline` (recrawl completo)
- **Dry run:** simula sin escribir nada, útil para diagnosticar

---

## ¿Qué pasa si el sync falla?

GitHub te envía un email automáticamente si el workflow falla. También puedes ver el log completo en la pestaña Actions para identificar el error.
