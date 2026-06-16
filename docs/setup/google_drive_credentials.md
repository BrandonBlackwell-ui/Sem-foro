# Cómo conectar Google Drive — Service Account

## ¿Cuesta dinero?

**No.** Un Service Account es solo un par de credenciales, no un servidor ni un proceso que corre permanentemente. Google no cobra por crearlo ni por tenerlo existente.

- **Google Drive API** → gratis (hasta 20,000 requests/día, este proyecto usa ~100)
- **Service Account** → gratis, sin costo mensual ni por uso
- **Solo pagas** → Anthropic (Claude API) cuando el sync llama al análisis

El Service Account no hace nada por sí solo. Solo se activa cuando tu script lo llama, y termina en cuanto el script termina.

---

## Paso 1 — Crear un proyecto en Google Cloud

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Arriba a la izquierda, haz clic en el selector de proyecto → **Nuevo proyecto**
   - Nombre: `Blackwell Dashboard`
   - Clic en **Crear**

## Paso 2 — Habilitar la API de Google Drive

1. Dentro del proyecto, ve a **APIs y servicios → Biblioteca**
2. Busca `Google Drive API` → clic en ella → **Habilitar**

## Paso 3 — Crear el Service Account

1. Ve a **IAM y administración → Cuentas de servicio**
2. Clic en **+ Crear cuenta de servicio**
   - Nombre: `blackwell-sync`
   - Descripción: `Sync automático de Drive para el proyecto Blackwell`
3. Clic en **Crear y continuar** → omite los pasos de roles → **Listo**

## Paso 4 — Descargar la clave JSON

1. En la lista, haz clic en `blackwell-sync`
2. Pestaña **Claves → Agregar clave → Crear clave nueva**
3. Formato: **JSON** → **Crear**
4. Se descarga el archivo automáticamente — guárdalo en un lugar seguro

El archivo se ve así:
```json
{
  "type": "service_account",
  "project_id": "blackwell-dashboard",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "blackwell-sync@blackwell-dashboard.iam.gserviceaccount.com",
  ...
}
```

> ⚠ **Nunca subas este archivo a git.** Ya está en `.gitignore`.

## Paso 5 — Dar acceso a la carpeta de Drive

El Service Account es como un usuario nuevo — necesita que le compartas la carpeta explícitamente.

1. Ve a Google Drive con la cuenta que tiene los archivos de Blackwell
2. Clic derecho en la carpeta raíz **"PROYECTOS BLACKWELL"** → **Compartir**
3. En el campo de personas, pega el `client_email` del JSON:
   ```
   blackwell-sync@blackwell-dashboard.iam.gserviceaccount.com
   ```
4. Permiso: **Lector** (no necesita editar nada)
5. **Enviar** (ignora el aviso de que no tiene cuenta Gmail)

## Paso 6 — Conectar al proyecto

### Para uso local (tu Mac)

Coloca el archivo JSON descargado en:
```
blackwell_migration/Blackwell/service_account.json
```

Y actualiza el `.env`:
```env
GOOGLE_SERVICE_ACCOUNT_JSON=service_account.json
GOOGLE_CREDENTIALS_PATH=
GOOGLE_TOKEN_PATH=
```

### Para GitHub Actions

No copies el archivo al repo. En su lugar, ve a tu repo en GitHub →  
**Settings → Secrets and variables → Actions → New repository secret**

- Nombre: `GOOGLE_SERVICE_ACCOUNT_JSON`
- Valor: copia y pega **todo el contenido** del archivo JSON

El workflow lo escribe a disco temporalmente y lo borra al terminar.

---

## Verificar que funciona

```bash
cd blackwell_migration/Blackwell
python scripts/sync/main_sync.py --dry-run
```

Si la conexión es exitosa verás:
```
INFO  Autenticando con service account: service_account.json
INFO  Cliente Drive API listo
INFO  Crawleando cuentas desde carpeta raíz...
INFO  DRY RUN — no se escribirá nada
```
