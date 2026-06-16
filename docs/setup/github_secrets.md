# Configurar GitHub Secrets para el sync automático

El workflow de GitHub Actions necesita 5 secrets para funcionar.
Se configuran una sola vez en GitHub y nunca se suben al código.

---

## Dónde agregarlos

1. Ve a **https://github.com/orwellbw/Sem-foro**
2. Haz clic en **Settings** (pestaña superior derecha del repo)
3. En el menú izquierdo: **Secrets and variables → Actions**
4. Haz clic en **New repository secret**
5. Agrega cada uno de los siguientes:

---

## Los 5 secrets requeridos

### 1. `GOOGLE_SERVICE_ACCOUNT_JSON`
El contenido completo del archivo `service_account.json` (copia y pega todo el JSON).

```
{
  "type": "service_account",
  "project_id": "blackwell-semaforo",
  ...
}
```

### 2. `DRIVE_ROOT_FOLDER_ID`
El ID de la carpeta raíz de Google Drive donde están las carpetas de cuentas.

```
1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_
```

### 3. `ANTHROPIC_API_KEY`
Tu API key de Anthropic (empieza con `sk-ant-`).

Obtenla en: https://console.anthropic.com/settings/keys

> **IMPORTANTE — Ask Drive también la necesita en Netlify**
>
> La feature **Ask Drive** del dashboard corre como Netlify Function (`netlify_deploy/netlify/functions/ask.js`) y necesita la misma key como variable de entorno **en Netlify** (no solo en GitHub):
>
> 1. Ve a https://app.netlify.com → tu sitio → **Site configuration → Environment variables**
> 2. Agrega `ANTHROPIC_API_KEY = sk-ant-...`
> 3. (Opcional) Agrega `ANTHROPIC_BASE_URL` solo si usas un proxy custom; default `https://api.anthropic.com`.
> 4. Redeploy del sitio para que la función la vea.

### 4. `NETLIFY_AUTH_TOKEN`
Token personal de Netlify para autorizar el deploy desde GitHub Actions.

Pasos para obtenerlo:
1. Ve a https://app.netlify.com/user/applications
2. Haz clic en **New access token**
3. Ponle nombre: `blackwell-github-actions`
4. Copia el token generado (solo se muestra una vez)

### 5. `NETLIFY_SITE_ID`
El ID de tu sitio en Netlify.

```
092d05d8-44eb-4b1a-86ce-a2c1f8231aaa
```

---

## Cómo verificar que están correctos

Una vez agregados los 5 secrets, ve a:
**GitHub → Actions → Sync diario Blackwell → Run workflow → Run workflow**

Si el workflow corre sin errores en ~10 minutos, todo está configurado correctamente.

---

## Conexión de Netlify con GitHub (primer deploy)

Para que Netlify sepa que este repositorio existe:

1. Ve a https://app.netlify.com
2. Entra a tu sitio (ID: `092d05d8-44eb-4b1a-86ce-a2c1f8231aaa`)
3. **Site configuration → Build & deploy → Continuous deployment**
4. Desactiva el auto-deploy de Netlify ("Stop auto publishing") — el deploy lo hace GitHub Actions, no Netlify directamente

> Así evitas deploys dobles: uno de GitHub Actions y otro de Netlify al mismo tiempo.

---

## Resumen del flujo automático

```
Cada día a las 8:00 AM (hora CDMX)
        ↓
GitHub Actions se activa
        ↓
1. Conecta a Google Drive con service_account.json
2. Detecta cuentas con actividad nueva
3. Llama a Claude API para análisis
4. Copia datos a dashboard/public/data/
5. Corre npm run build
6. Sube dashboard/dist/ a Netlify
        ↓
Sitio actualizado en producción
```
