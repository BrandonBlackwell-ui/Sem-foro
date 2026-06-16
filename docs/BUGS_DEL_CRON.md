# Bugs del cron — Lista priorizada de fixes

Documento para quien mantiene `blackwell-drive-sync-diario` y el pipeline de baseline. Cada item tiene: descripción, ejemplo concreto, y output esperado.

---

## P0 · Bloqueadores de credibilidad del dashboard

### 1. Cron no enumera archivos en subcarpetas con prefijo de cuenta

**Síntoma:** Para CIMA, el cron reporta:
```json
"01.Contrato_OC": { "latestModified": "2026-04-23T16:58:16Z", "fileCount": 0, "latestFile": null }
```

Pero en Drive existe `01.CIMA_Contrato_OC` (con prefijo de cuenta) con un archivo dentro: `Contrato 2026 Cima firma autografa LS.pdf` modificado el 7-may.

**Diagnóstico:** El cron normaliza el nombre del folder (quita prefijo) PERO falla en enumerar los archivos adentro. Para las demás subcarpetas de CIMA (`02.CIMA_Entregables`, `03.CIMA_Reportes_Avance`, etc.) el cron SÍ enumera archivos correctamente con el prefijo. Solo la 01 está rota.

**Esperado:**
```json
"01.CIMA_Contrato_OC": {
  "latestModified": "2026-05-07T...",
  "fileCount": 1,
  "latestFile": "Contrato 2026 Cima firma autografa LS.pdf"
}
```

**Probable causa:** lógica de match para 01 distinta a las otras, o permisos del service account no incluyen esa subcarpeta específica.

**Impacto:** afecta el banner "Sin contrato u OC en Drive" en N cuentas que sí tienen contrato subido.

---

### 2. `subfolderMissing: true` cuando la carpeta SÍ existe

**Síntoma:** Para CUERNAVACA, accounts_status reporta:
```json
"02.Entregables": { "subfolderMissing": true }
```

Pero drive_intelligence.files muestra 3 archivos analizados en `02.Entregables` y `02. CUERNAVACA_Entregables`.

**Diagnóstico:** Inconsistencia entre lo que ve el sync (subfolderActivity) y lo que analizó el LLM (drive_intelligence.files). Uno de los dos está leyendo data correcta y el otro no.

**Esperado:** ambas fuentes deben estar alineadas. Si drive_intelligence leyó archivos, subfolderActivity debe reportar `fileCount > 0`.

---

### 3. `fileCount: null` en folders con sub-subcarpetas

**Síntoma:** Para TURBOFIN:
```json
"02.Entregables": { "latestModified": "2026-04-29T22:49:25Z", "fileCount": null, "latestFile": null }
```

Y para Nuvoil con nota explícita:
```json
"02.Entregables": {
  "fileCount": 0,
  "note": "Contiene sub-subcarpetas — sin archivos directos confirmados"
}
```

**Diagnóstico:** El cron no está haciendo crawl recursivo cuando hay sub-subcarpetas dentro de las 6 carpetas del playbook (TURBOFIN tiene `02.Entregables/ABRIL 2026/file.pdf`, Nuvoil tiene varias).

**Esperado:** crawl recursivo y `fileCount` = total de archivos en todos los niveles. Si decides no contarlos por política, marca `fileCount: 0` con `subfolderMissing: false` y un campo explícito tipo `nestedFilesPresent: true`.

---

### 4. `latestModified` no refleja la fecha real del archivo más reciente

**Síntoma:** Para CIMA:
- Drive UI muestra `01.CIMA_Contrato_OC` modificado el 7-may
- Cron reporta `latestModified: 2026-04-23T16:58:16Z`

**Diagnóstico:** El cron está usando la fecha de creación del folder en lugar de la fecha del archivo más reciente, O tiene cache obsoleto.

**Esperado:** `latestModified` debe ser el `modifiedTime` más reciente de cualquier archivo dentro del folder (recursivo).

---

## P1 · Estabilidad del schema

### 5. `cross_account_findings` cambió de formato

**Antes:**
```json
[{"finding": "...", "detail": "...", "accounts_affected": ["MAJA", "RR"]}, ...]
```

**Ahora:**
```json
["MAJA expone nueva ventana reputacional vía nota EMEEQUIS...", ...]
```

**Esperado:** mantener el formato estructurado (objetos), no strings. Si quieres mantener strings narrativos, ponlos en `narrative` y conserva los campos estructurados.

**Impacto:** el dashboard tuvo que detectar ambos formatos para no romperse.

---

### 6. `last_delta_accounts_affected` cambió formato

**Antes:** `['02. MAJA', '07. APOLLO', ...]` (folder titles completos)
**Ahora:** `['02', '07', ...]` (solo números)

**Esperado:** uno solo, no mezclar entre syncs.

---

### 7. `window.SYNC_DATA` renombrado a `window.ACCOUNTS_STATUS`

**Síntoma:** un sync emitía `window.SYNC_DATA`, el siguiente `window.ACCOUNTS_STATUS`. El dashboard rompió hasta que metí un alias.

**Esperado:** nombre estable. Si necesitas migrar, hazlo con anuncio.

---

### 8. `baseline_finished` nunca se actualiza

**Síntoma:** `baseline_finished: 2026-05-04T18:30:00Z` lleva varios deltas siendo el mismo valor.

**Diagnóstico:** Para cuentas que NO fueron afectadas por un delta, su análisis es del 4-may y nunca se refresca. El dashboard ancla las fechas de análisis a esto cuando no hay delta reciente para esa cuenta.

**Esperado:** o (a) regenerar el baseline completo cada N días, o (b) por cuenta tener un campo `last_analyzed_at` que se actualice cada vez que el cron toca esa cuenta (con o sin delta).

---

### 9. `checklist_recalc.js` no se regenera

**Síntoma:** archivo último update: 4-may-2026. El cron diario emite `accounts_status.js` y `drive_intelligence.js` pero NO regenera `checklist_recalc.js`.

**Esperado:** o (a) eliminar `checklist_recalc.js` y que el dashboard solo use subfolderActivity (lo que ya hago), o (b) regenerarlo daily con el delta.

---

### 10. Nombres de subcarpetas inconsistentes entre cuentas

**Síntoma:**
- STPRM: `01.Contrato_OC`, `02.STPRM_Entregables`, `04.Conversaciones_WA`, `06.STPRM_Agenda_Trabajos` (mix)
- CIMA: `01.Contrato_OC` (reportado, real es `01.CIMA_Contrato_OC`), `02.CIMA_Entregables`, etc.
- MTV: con espacios después del punto en algunos folders
- Otros: variaciones plural/singular (`Contrato` vs `Contratos`)

**Esperado:** una convención canónica documentada en `Estructura_carpetas_Blackwell.md`. El cron debería detectar la versión real en Drive y reportarla TAL CUAL existe (no normalizar). Si quieres normalizar para consistency, hazlo en una sola dirección.

---

## P2 · Sería bueno tener

### 11. Verificación de permisos del service account

Auditar globalmente: ¿el service account del cron tiene acceso a TODAS las cuentas y todos los archivos? Si CIMA's `01.CIMA_Contrato_OC` tiene permisos restrictivos, eso explicaría por qué no se enumera.

### 12. Validar contra el playbook

Que el cron emita un campo `playbook_violations` por cuenta listando qué subcarpetas no cumplen el naming canónico. Ejemplo:
```json
"playbook_violations": [
  "02. CIMA_Entregables tiene espacio después del punto (debería ser 02.CIMA_Entregables)",
  "06.STPRM_Agenda_Trabajos tiene prefix mientras otras no (consistencia)"
]
```

### 13. Indicador de confianza del análisis del LLM

Que el LLM emita un campo `confidence` (alta/media/baja) basado en cuánto contenido pudo leer realmente. Si solo leyó 2 archivos y los demás están vacíos, marcar confidence: baja.

### 14. Trazabilidad de claims del LLM

Para cada claim específico (ej: "6 publicaciones T1 / 15.6M reach"), idealmente el LLM debería decir de qué archivo lo sacó. Esto evita la sensación de "se está inventando cosas" cuando el equipo no puede verificar.

---

## Prioridad sugerida para arreglar primero

1. **#1 (enumeración de archivos en folders con prefijo)** — afecta directamente el indicator de contrato, que es lo más visible
2. **#2 y #3 (subfolderMissing y fileCount inconsistentes)** — afecta scores en varias cuentas
3. **#4 (latestModified)** — afecta percepción de "data fresca"
4. **#10 (nombres consistentes)** — pero esto es coordinado con Fabiola del lado de Drive

El resto son mejoras pero no urgentes para credibilidad.

---

## Cómo el dashboard se defiende mientras tanto

- Match por prefijo numérico (`01.`, `02.`, etc.) — tolera variaciones de nombre
- Si `subfolderMissing: true` pero drive_intelligence tiene archivos del mismo prefijo, ignora `subfolderMissing` y usa los archivos
- Alias `SYNC_DATA = ACCOUNTS_STATUS` por compatibilidad
- Soporta tanto strings como objetos en `cross_account_findings`
- Si `fileCount: null`, usa `latestModified` para inferir actividad

Pero esto son hacks. La fuente de verdad debería estar limpia.
