# Migración a otra laptop — Pasos

Guía para mudar todo el setup del Semáforo Blackwell a otra Mac con Claude desktop ya instalado.

## Qué se migra

| Componente | Dónde vive ahora | Cómo se migra |
|---|---|---|
| Workspace (data, dashboard, scripts, docs) | `~/Desktop/Blackwell/` | Copiar la carpeta entera |
| Scheduled tasks (cron diario + baseline) | `~/Documents/Claude/Scheduled/` | Copiar carpetas + re-registrar en Claude |
| Build scripts (`build_v36.py`, `verify_v36.js`) | Ahora dentro de `Blackwell/scripts/` | Viaja con el workspace |
| MCP de Google Drive | Configuración local de Claude | **Re-configurar manualmente** (no portable) |
| `cells.json`, `accounts.json` | `Blackwell/data/` | Viaja con el workspace |

---

## Paso 1 — En la laptop VIEJA, prepara el bundle

Ya está empacado en el zip:

```
Semaforo_Blackwell_v36_paquete_full.zip
```

Contiene:
- `Blackwell/` — toda la carpeta de trabajo (data, dashboard, scripts, docs)
- `Scheduled/` — los SKILL.md de los 2 scheduled tasks
- Esta guía (`MIGRACION.md`)

Sólo súbelo a Drive/Dropbox/iCloud o cópialo por USB.

---

## Paso 2 — En la laptop NUEVA, descomprime y coloca

1. Descomprime el zip.
2. Copia la carpeta `Blackwell` a **`~/Desktop/Blackwell/`** (mismo path para evitar romper referencias absolutas).
3. Copia la carpeta `Scheduled` a **`~/Documents/Claude/Scheduled/`** (este path lo crea Claude la primera vez que abres). Si no existe, créalo manualmente.

Verifica con:

```bash
ls ~/Desktop/Blackwell/
ls ~/Documents/Claude/Scheduled/
```

Deberías ver `blackwell-drive-sync-diario/SKILL.md` y `blackwell-drive-intelligence-baseline/SKILL.md`.

---

## Paso 3 — Abre Claude desktop y apunta al workspace

1. Abre Claude.
2. Cuando te pida una carpeta de trabajo (o desde el menú), selecciona `~/Desktop/Blackwell/`.
3. Verifica que ves los archivos al teclear "ls" en una conversación.

---

## Paso 4 — Re-conecta el MCP de Google Drive

Esta es la parte que NO se migra automático. El MCP de Drive tiene OAuth tokens locales que no son portables.

1. En Claude, ve a **Settings → Connectors / MCP** (depende de la versión).
2. Agrega/conecta el MCP de Google Drive.
3. **Usa la misma cuenta de Google** que se autenticó antes (la que tiene acceso a `PROYECTOS BLACKWELL` con folder ID `1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_`).
4. Confirma permisos read-only o read-write según haya estado antes.

Sin esto el cron no puede leer Drive.

---

## Paso 5 — Re-registra los scheduled tasks

Aunque los `SKILL.md` ya están en `~/Documents/Claude/Scheduled/`, Claude no los carga automático — necesitas registrarlos.

En una conversación con Claude:

```
Crea un scheduled task llamado "blackwell-drive-sync-diario" que corra todos los días a las 7:10 AM
(cron expression: 10 7 * * *) usando las instrucciones del archivo
~/Documents/Claude/Scheduled/blackwell-drive-sync-diario/SKILL.md
```

Claude debería usar el tool `mcp__scheduled-tasks__create_scheduled_task` automáticamente.

Repite para el segundo:

```
Crea un scheduled task de tipo one-shot llamado "blackwell-drive-intelligence-baseline"
(no programado para fecha futura — solo registrado para correrse manualmente cuando se necesite)
con las instrucciones de ~/Documents/Claude/Scheduled/blackwell-drive-intelligence-baseline/SKILL.md
```

Verifica con: "lista los scheduled tasks que tengo".

---

## Paso 6 — Smoke test

1. Pídele a Claude: "corre el scheduled task `blackwell-drive-sync-diario` ahora mismo".
2. Debería:
   - Leer Drive (vía el MCP que reconectaste)
   - Actualizar `~/Desktop/Blackwell/data/accounts_status.js` y `drive_intelligence.js`
   - Tomar ~10-20 min
3. Cuando termine, pídele: "regenera el HTML con `python3 ~/Desktop/Blackwell/scripts/build_v36.py`".
4. Abre `Semaforo_Blackwell_v36.html` con doble click → debería verse el dashboard con data fresca.

---

## Paso 7 — Limpieza opcional en la laptop vieja

Cuando confirmes que todo corre bien en la nueva:

1. Desactiva el scheduled task `blackwell-drive-sync-diario` en la laptop vieja (para que no haya dos cron corriendo simultáneamente):
   ```
   En Claude (laptop vieja): "deshabilita el task blackwell-drive-sync-diario"
   ```
2. Mueve la carpeta `Blackwell` vieja a Archive o bórrala.

---

## Troubleshooting

**El cron no encuentra el folder de Drive**
→ Revisa que el MCP esté conectado con la cuenta correcta. Folder ID a usar: `1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_`.

**`build_v36.py` falla por path**
→ El script tiene `ROOT = pathlib.Path('/sessions/focused-zen-feynman/mnt/Blackwell')` hardcoded para el ambiente de Claude. Si lo corres fuera de Claude, edita ese path a `~/Desktop/Blackwell` (línea ~22).

**`subfolderMissing` saliendo en cuentas que sí tienen archivos**
→ Es el bug ya documentado en `BUGS_DEL_CRON.md`. Versión v4.1 del SKILL.md ya lo arregla con re-verificación stale. Confirma que el SKILL.md que copiaste sea v4.1.

**El dashboard se ve viejo después de correr el cron**
→ Falta correr `build_v36.py` después del cron. El cron solo actualiza los .js/.json; el build_v36.py los inlinea en el HTML.

---

## Archivos críticos (no perder)

| Archivo | Por qué importa |
|---|---|
| `Blackwell/data/cells.json` | División por células (A/B), edición manual |
| `Blackwell/data/accounts.json` | Owners, team, metadata |
| `Blackwell/data/cadence_overrides.json` | Cuentas on-demand (Casa Mata) |
| `Blackwell/scripts/build_v36.py` | El que arma el HTML autocontenido |
| `Scheduled/blackwell-drive-sync-diario/SKILL.md` | El cron diario (v4.1) |

Si solo respaldas estos 5 archivos, puedes reconstruir el resto.

---

## Contacto

Esteban Hernández — esteban.hernandez@blackwellstrategy.com
