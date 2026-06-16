# Semáforo Blackwell — Contexto Técnico Completo

> Para handoff a otra herramienta o desarrollador. Documento de mayo 2026 que captura el estado actual del sistema, sus partes, decisiones y limitaciones conocidas.

---

## 1. Qué es esto

Un dashboard de una sola página HTML que muestra el estado de las 29 cuentas activas de Blackwell Strategy. Funciona contra el Drive del cliente (carpeta `PROYECTOS BLACKWELL 2026`) y contra un playbook operativo. La interfaz vive en `Semaforo_Blackwell.html`. Para presentaciones puntuales (como una junta de dirección) se genera una versión congelada `Semaforo_Blackwell_Lunes.html` que es autocontenida.

**Filosofía rectora del sistema:**

> "Drive es la fuente de verdad. Lo que no está en Drive no existió para el semáforo."

Esa frase viene del Playbook v1.0 de Fabiola y guía toda la arquitectura.

**Audiencia primaria:**

- **Humberto y Fabiola (Dirección)** — vista ejecutiva, score global, top riesgos, decisiones requeridas. Abren el dashboard semanalmente.
- **Daniel, Esteban (Liderazgo)** — operativo, vista por persona, alertas técnicas.
- **Consultores** — vista anonimizada de su cartera + checklist semanal. Ahora oculta en el snapshot estático del lunes.

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│              GOOGLE DRIVE (fuente de verdad)                │
│  PROYECTOS BLACKWELL 2026 / 29 cuentas / 6 subfolders ea.   │
│  01.Contrato_OC, 02.Entregables, 03.Reportes_Avance,        │
│  04.Conversaciones_WA, 05.Transcripciones, 06.Agenda        │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP de Drive
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  CRON DIARIO — blackwell-drive-sync-diario · 7:10 am local  │
│  Tarea programada (Cowork Scheduled). Claude la ejecuta.    │
│  Fases: enumerar → status → crawl 6 subfolders → PQ proxy   │
│  con Haiku → calcular deltas → escribir 3 archivos.          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Escribe en data/
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  data/accounts_status.json    (JSON, fuente humana)         │
│  data/accounts_status.js       (window.SYNC_DATA = {…})     │
│  data/sync_alerts.md           (bitácora del sync)          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Pipeline (Python local)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  generate_suggestions.py    (rule-based actions)            │
│  recalc_scores.py           (auto-promueve checklist)       │
│  build_static_snapshot.py   (HTML autocontenido)            │
└──────────────────────┬──────────────────────────────────────┘
                       │ Output
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Semaforo_Blackwell.html        (dashboard live)            │
│  Semaforo_Blackwell_Lunes.html  (snapshot congelado)        │
└─────────────────────────────────────────────────────────────┘
```

**Stack técnico:**

- HTML + CSS + JS plano (no React, no build step). 6500 líneas en un solo archivo.
- jsdom para verificación runtime (jsdom + Node.js en el sandbox).
- Python para pipeline (recalc, suggestions, snapshot build).
- Cron via la app Cowork (Anthropic) que dispara una sesión Claude con prompt fijo.
- Google Drive vía MCP (Model Context Protocol) — `search_files`, `read_file_content`, `list_recent_files`.

---

## 3. Estructura de carpeta esperada en Drive

Cada cuenta debe seguir esta estructura (del Playbook §1):

```
[##. NOMBRE DEL CLIENTE]
├── 01.Contrato_OC
├── 02.Entregables
│   ├── Semana_01
│   ├── Semana_02
│   └── Semana_NN
├── 03.Reportes_Avance
├── 04.Conversaciones_WA
├── 05.Transcripciones_Llamadas
└── 06.Agenda_Trabajos
```

**Sufijos de status en el nombre del folder raíz:**

- `15. ARMOR LIFE LAB` — activo (sin sufijo)
- `15. ARMOR LIFE LAB /Proyecto concluido` — cerrada
- `15. ARMOR LIFE LAB /Terminación anticipada` — cerrada anticipada
- `10. JACK LEVI/Detenido` — pausada
- `XX. NOMBRE/Evento único` — proyecto puntual

El sync detecta el sufijo y marca la cuenta como `historical/paused/event` automáticamente. Esos status quedan fuera del score del portafolio pero se conservan para patrones históricos.

**Naming convention de archivos:** `[CLIENTE]_[Tipo]_[YYYYMMDD].pdf` — ejemplo `AZVI_Nota_20260418.pdf`. El validador en pestaña Equipo del dashboard checa esto.

---

## 4. Score formula

```
Global = CO × 37.5%  +  PQ × 25%  +  SC × 37.5%
```

- **CO (Cumplimiento Operativo)** — entregables a tiempo vs comprometidos.
- **PQ (Performance / Calidad)** — tier de placements + narrativa + métricas.
- **SC (Satisfacción del Cliente)** — chats activos + transcripciones + señales.
- **SF (Salud Financiera)** — fuera del score desde v1.4. Se gestiona en Dirección, no es responsabilidad del área de consultoría.

**Cap rule:** si `CO < 45` o `SC < 50`, el global se capa a 64 (naranja). Una cuenta no puede ser verde con cumplimiento bajo aunque la calidad sea alta.

**Umbrales de color:**

- **Verde** ≥ 80 (saludable)
- **Amarillo** ≥ 65 (estable)
- **Naranja** ≥ 45 (zona de riesgo)
- **Rojo** < 45 (crítico)
- **Gris** = null (concluida / pausada / sin score)

**Cómo se calcula CO/PQ/SC** — desde el checklist semanal con pesos definidos en `CHECKLIST_DATA.schema.items`. Cada item del checklist (contrato, entregables, reporte, whatsapp, transcripciones, agenda) tiene un valor `ok` (100), `partial` (50), `missing` (0), `na` (null). El score por eje es la suma ponderada.

**Pesos vigentes** (tras rebalance del 30-abr-26 — el original tenía contrato pesando 80% del PQ, lo cual penalizaba injustamente cuentas con buenos placements pero sin contrato escaneado):

| Item | w_pq | w_co | w_sc |
|---|---|---|---|
| contrato | 0.0 | 0.10 | 0.0 |
| entregables | 0.5 | 0.40 | 0.2 |
| reporte | 0.4 | 0.20 | 0.2 |
| whatsapp | 0.0 | 0.10 | 0.3 |
| transcripciones | 0.0 | 0.05 | 0.3 |
| agenda | 0.1 | 0.15 | 0.0 |

Cada eje suma 1.0.

---

## 5. El sync diario (cron)

**Tarea Cowork:** `blackwell-drive-sync-diario`. Disparable manualmente con "Run now" desde el sidebar Scheduled.

**Cadencia:** cron `0 7 * * *` (7:10 am local). Tarda 15-25 minutos por la fase de PQ via Haiku.

**Prompt completo del cron:** `~/Documents/Claude/Scheduled/blackwell-drive-sync-diario/SKILL.md`. El prompt actual cubre 7 fases:

1. Lee snapshot anterior para tener referencia.
2. Enumera 29 cuentas top-level por `title contains '01.'…'30.'` con filtro `parentId == 1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_`.
3. Parsea status del título (concluded/paused/event/active).
4. Crawl 6 subfolders por cada cuenta: 01-Contrato, 02-Entregables, 03-Reportes, 04-Conversaciones_WA, 05-Transcripciones, 06-Agenda.
5. Computa 3 señales por cuenta:
   - **`latestDeliverable`** — archivo formal más reciente (PDF/PPTX/DOCX) en 02 o 03.
   - **`lastActivity`** — archivo más reciente en cualquiera de los 6 subfolders, incluyendo .zip de WhatsApp.
   - **`subfolderActivity`** — digest por subfolder con `latestModified`, `fileCount`, `latestFile`.
6. **PQ proxy via Haiku** — para cada cuenta con `status: active` y `latestDeliverable.fileId`, llama a `read_file_content` (lee primeros ~3000 chars), evalúa contra rúbrica:
   - **Tier de medios** (50%): Tier 1 (Reforma, Universal, Milenio, Excélsior, Financiero, La Razón, Animal Político, Aristegui, Proceso, López-Dóriga, Loret) · Tier 2 (Heraldo, Jornada, Reporte Indigo, Político Mx, regionales mayores) · Tier 3 (trades, blogs).
   - **Narrativa** (25%): claridad, estructura, mensaje principal.
   - **Métricas** (25%): alcance, tier mix, KPIs concretos.
   - Output: `score`, `tierMix`, `narrativaQuality`, `hasMetrics`, `evidence` (cita 1-2 frases del deck), `suggestion` (recomendación accionable).
7. Calcula deltas vs snapshot anterior (new_account, status_change, new_deliverable, stale).
8. Escribe `accounts_status.json`, `accounts_status.js` (wrapper), `sync_alerts.md`.

**Limitaciones honestas del cron:**

- Solo evalúa el `latestDeliverable` por cuenta, no todos los entregables. Para deeper PQ analysis ese mecanismo está post-roadmap.
- No descomprime los .zip de WhatsApp (el `read_file_content` no soporta .zip directo). Para sentiment analysis del chat, sería un paso aparte.
- A veces el cron pone `fileCount: null` cuando no contó archivos, en cuyo caso el recalc lo trata como "subfolder con contenido inferido por mtime reciente" para no penalizar.
- Cuentas como CIMA pueden quedar con flag de consistencia ("Subfolderes con modifiedTime sin archivo identificado") cuando hay subfolders sin contenido directo (los archivos viven en sub-subfolders Semana_NN).

**Conector de Drive:** ID del root `1lC48ni6Rg4e_uGtASQfC-QdBd3647LJ_`. Las queries usan title-prefix porque el MCP no soporta `parents in 'X'` directamente.

---

## 6. Pipeline post-sync (Python)

Tres scripts en `outputs/` (también disponibles si se mueven al workspace). Se corren en orden:

### 6.1 `recalc_scores.py`

Lee `accounts_status.json` + `checklist.json`, aplica reglas de promoción automática del checklist:

```
contrato      ← presencia binaria en 01.Contrato_OC          → ok / missing
entregables   ← archivo en 02.Entregables ≤30d ok ; ≤60 partial ; else missing
reporte       ← archivo en 03.Reportes_Avance ≤30d ok ; ≤60 partial
whatsapp      ← archivo en 04.Conversaciones_WA ≤14d ok ; ≤30 partial
transcripciones ← archivo en 05.Transcripciones ≤30d ok ; ≤90 partial
agenda        ← archivo en 06.Agenda_Trabajos ≤30d ok ; ≤60 partial
```

Output: `data/checklist_recalc.json` (mismo schema que el original con valores promovidos) + `data/recalc_audit.md` (audit log de qué cambió por cuenta).

Cuentas concluded/paused/event NO se modifican.

Robustez del matching de subfolders: maneja variaciones reales como `02. Entregables`, `02.Entregables`, `02. ULDIS_Entregables`, `02. RR_ENTREGABLES`. Las matchea por número + keyword.

### 6.2 `generate_suggestions.py`

Lee `accounts_status.json` + `cadence_overrides.json`. Para cada cuenta active genera un campo `nextAction` con prioridad 1-4:

- **P1 urgente** — escalas críticas (no aplicado todavía, reservado para casos extremos).
- **P2 prioritaria** — cuentas stale 60+ días, sin entregable formal en 02/03, decidir status.
- **P3 operativa** — usa `pqProxy.suggestion` (LLM del cron) o reglas tipo "subir export de WhatsApp".
- **P4 preventiva** — recordatorios suaves.

Cuentas con `cadenceType: on-demand` o `event` reciben `nextAction: null` (no se les empuja cadencia semanal).

Output: actualiza `accounts_status.json` con campo `nextAction` por cuenta + `suggestionsMeta`. También reescribe `accounts_status.js`.

### 6.3 `build_static_snapshot.py`

Lee el HTML live (`Semaforo_Blackwell.html`) + `accounts_status.json` + `checklist_recalc.json` + `cadence_overrides.json`. Produce `Semaforo_Blackwell_Lunes.html` autocontenido con:

1. `<script src="./data/accounts_status.js">` reemplazado por `<script>window.SYNC_DATA = {...}</script>` inline.
2. `CHECKLIST_DATA` reemplazado en el JSON inline con la versión recalculada.
3. Sync banner + sync strip removidos.
4. Role-switch entero removido (vista locked en leadership).
5. IPC eliminado del array de cuentas (es alias de Irugami).
6. Cadence overrides aplicados a cuentas (Casa Mata → on-demand).
7. Score overrides aplicados via JS al boot del documento.
8. Header reescrito a "Vista congelada para presentación".
9. Title actualizado.

Output: `outputs/Semaforo_Blackwell_Lunes.html`.

### 6.4 `verify_snapshot.js`

jsdom check del snapshot. Verifica 14 puntos: SYNC_DATA carga, CHECKLIST_DATA presente, role-switch removido, sync UI removido, header correcto, cuentas concluded preservadas, scores recalculados visibles, modal abre con citas Drive, etc.

---

## 7. El dashboard HTML — anatomía

### 7.1 Pestañas (6)

1. **Briefing** — landing. KPIs ejecutivos, "Decisiones requeridas", briefing-hero, master table.
2. **Cuentas** (consultor only) — listado anonimizado + Checklist Semanal sub-tab.
3. **Equipo** — vista de carga, validador de archivo, sub-tabs Cadencia y Señales.
4. **Metodología** — playbook reproducido verbatim.
5. **Señales** — taxonomía de SC del playbook §4.
6. **Dirección** (leadership only) — Needs Attention panel + métricas dirección.

### 7.2 Bloques principales del Briefing

- **Header** — título, corte, último sync, chip de estado del sync (verde/amarillo/rojo).
- **Tira ejecutiva de KPIs** — 6 métricas: Score global / Rojas / Naranjas / Verdes / Cambios semana / Alertas Drive.
- **Decisiones Requeridas** — cuentas con `nextAction.priority ≤ 2`. Si hay 0, muestra "Sin decisiones urgentes" en verde.
- **Briefing-hero** — frase ejecutiva del estado del portafolio + dots de distribución.
- **Master table** — todas las cuentas con CO/PQ/SC/Global, sparklines, dot de evidencia 🟢/🔵/⚪.

### 7.3 Modal por cuenta

Al hacer click en una fila de la master table o needs-attention, abre modal con:

- Header: nombre, color, score, badges de tier/fase/cadencia.
- **Indicadores numéricos** (CO/PQ/SC con barras de color) — solo leadership.
- **Override manual de calificación** (panel azul, leadership) — Fabiola/Humberto pueden poner CO/PQ/SC manuales que sobrescriben el cálculo automático. Guarda en `localStorage`. Re-renderiza master table tras guardar.
- **Acción Sugerida** (banner amarillo/naranja/rojo según prioridad) — `nextAction` o `pqProxy.suggestion`.
- Responsables (Sr / Jr).
- Scope, Entregables comprometidos, **Entregables realizados** (con fallback a sync data), **Calidad del trabajo** (con fallback a `pqProxy.evidence`), Satisfacción del cliente, Riesgo, Oportunidad.
- **CO Histórico por Semana** — tabla del playbook §5. Para cuentas con `cadenceType: on-demand`, se reemplaza por banner morado explicando que el modelo no opera por cadencia semanal.
- **Señales SC recientes** — del playbook §4.
- **Bitácora · Notas del equipo** — notas en localStorage que persisten por cuenta.

### 7.4 Override layer (3 capas)

1. **Score overrides** — Fabiola/Humberto editan CO/PQ/SC manualmente desde el modal. Persiste en `localStorage` por navegador. Aplica al boot del dashboard.
2. **Cadence overrides** — `data/cadence_overrides.json` flagéa cuentas como on-demand/event/etc. Modifica suggestions y oculta tabla CO histórico.
3. **Honesty banner / text overrides** (en versiones previas) — Fabiola podía editar texto de Entregables/Calidad/Satisfacción. La versión actual del HTML no tiene este banner activo, pero queda como deuda técnica para reactivar.

### 7.5 Selector de rol

Tres roles en el live dashboard: `consultor` / `liderazgo` / `leadership` (= management). Cada uno oculta secciones distintas. Determina qué ve cada usuario.

En el snapshot estático del lunes el role-switch está REMOVIDO y la vista queda fija en leadership.

---

## 8. Archivos en `/data/`

| Archivo | Producido por | Consumido por | Propósito |
|---|---|---|---|
| `accounts_status.json` | cron diario | recalc, suggestions, snapshot | Snapshot del estado de Drive: cuentas, latestDeliverable, lastActivity, subfolderActivity, pqProxy, deltas. |
| `accounts_status.js` | cron diario | dashboard live (HTML carga `<script src>`) | Wrapper del JSON: `window.SYNC_DATA = {...}`. |
| `sync_alerts.md` | cron diario | humanos | Bitácora del sync — deltas, alertas, recursos. |
| `checklist.json` | manual (Fabiola, abril) | recalc, dashboard | Schema de pesos PQ/CO/SC + estado por cuenta antes del recalc. |
| `checklist_recalc.json` | recalc_scores.py | snapshot | Checklist con valores auto-promovidos según evidencia Drive. |
| `recalc_audit.md` | recalc_scores.py | humanos / auditoría | Audit log: qué cambió, por qué. |
| `cadence_overrides.json` | manual (humanos) | suggestions, snapshot | Lista de cuentas con cadencia distinta a semanal (Casa Mata = on-demand). |
| `accounts.json` | manual (Fabiola) | dashboard | Asignaciones del equipo (Excel de abril). |
| `playbook.json` | manual | dashboard | Playbook operativo reproducido para la pestaña Metodología. |
| `industry.json` | manual | dashboard | Sector por cuenta. |
| `history.json` | manual | dashboard | Snapshots históricos para sparklines. **Importante:** valores `0/0/0/0` artefactos del checklist v1.3 fueron reescritos a `null` el 30-abr para evitar trampa de "caer a cero". |

---

## 9. Versiones del dashboard

Cada versión es incremental sobre la anterior. La versión vigente se pinta en el header.

- **v1.0** (Apr 21) — primer corte sintético, 28 cuentas.
- **v1.4** — SF fuera del score (decisión de Humberto). Pesos reescalados a 37.5/25/37.5.
- **v1.5** — gauge rediseñado, sparklines, master table con filtros, needs-attention panel, stale data indicator.
- **v2.0** — capa tri-density (briefing / detalle).
- **v2.2** — consolidación de 13 tabs a 6.
- **v2.3** — banner de honestidad + overrides en localStorage. SF fuera del display.
- **v2.4** — Aduanas marcada concluida tras Drive sync.
- **v2.5** — primer sync banner + ACCOUNTS merge desde JSON externo.
- **v2.6** — sync wiring por folderId (más robusto que por número).
- **v2.7** — header limpio + KPIs ejecutivos + Decisiones Requeridas como primer bloque del Briefing.
- **v2.8** — crawl de 5 subfolders (02-06) + lastActivityTime para resolver el caso STPRM (chats frescos pero folder mtime viejo).
- **v2.9** — pesos del checklist rebalanceados (PQ ya no depende de contrato), sugerencias accionables vía LLM, IPC alias removido.
- **v3.0** (mayo 2026) — score overrides manuales en modal, cadenceType para crisis-on-demand.

---

## 10. Decisiones de diseño importantes

### "Drive es la fuente de verdad"
Si una cuenta vive solo en correos o WhatsApp y no se sube a Drive, el sistema no la ve. El sync solo refleja Drive. Las cuentas del playbook sin workspace Drive (IPC, ER, etc.) se muestran con la nota "sin workspace Drive" pero no contribuyen al sync.

### Dual-signal: latestDeliverable vs lastActivity
Una cuenta puede tener lots of chat actividad pero ningún deck nuevo (ej. STPRM con chats WhatsApp frescos pero deck del 22-abr). El dashboard distingue:
- `latestDeliverable` — entregable formal (cliente lo recibe).
- `lastActivity` — cualquier movimiento (incluye chats, transcripciones, agenda).

La señal stale usa `lastActivity` no `folderModifiedTime` (Drive no propaga mtime hijo→padre en folders compartidos).

### PQ proxy via Haiku
Para 5-7 cuentas con reporte de resultados explícito, Haiku evalúa el contenido y produce un `pqProxy.score` que sobrescribe el del checklist. Para las demás, el checklist (presence-based) gobierna PQ. Esto es honest about the limitation: no todas las cuentas tienen un deck que podamos leer y evaluar.

### Cap rule preservada
Aunque el LLM diga PQ=85, si CO<45 o SC<50 el global se capa a 64. Es regla del playbook v1.4 — calidad sin cumplimiento es riesgo.

### Honestidad antes que score alto
Cuentas como Andy y Coast Oil quedan en rojo porque genuinamente no tienen workspace Drive estructurado. No los inflamos. La honestidad de la señal es prioridad.

### Override mechanisms
3 capas de override (texto, score, cadencia) porque ningún sistema automático va a leer perfectamente todo el contexto humano. Los humanos siempre pueden corregir.

### Pesos del checklist rebalanceados (v2.9)
El playbook original le daba 80% del PQ a presencia de contrato. Eso castigaba a cuentas con buenos placements pero contrato no escaneado (RR, Dalinde). Reescaleamos a entregables(50%) + reporte(40%) + agenda(10%) — refleja "qué tan bien hecho está el trabajo" en lugar de "tienes el papel firmado".

---

## 11. Cron task — prompt actual

El prompt completo del cron `blackwell-drive-sync-diario` vive en:
`~/Documents/Claude/Scheduled/blackwell-drive-sync-diario/SKILL.md`

Cuenta con 7 fases. Para verlo o modificarlo, abrir Cowork → Scheduled → click en el task → ver/editar prompt.

Para correrlo manualmente: "Run now" desde el sidebar.

---

## 12. Limitaciones honestas / debt técnico

1. **El sync no descomprime .zip de WhatsApp.** Para sentiment analysis del chat necesitaríamos download_file_content + bash unzip. Es un workflow más pesado que el cron diario actual no soporta.
2. **El PQ proxy LLM solo cubre ~5 cuentas.** Las que tienen reporte de resultados con tier mix evaluable. Para las otras (planes, propuestas, artículos pre-colocación), el score de PQ es presence-based del checklist.
3. **localStorage es por navegador.** Si Fabiola edita un override en su Chrome, Humberto no lo ve en el suyo. No hay sync compartido.
4. **El sandbox no permite sobre-escribir el HTML del workspace en algunos casos.** Por eso a veces el snapshot sale como `Semaforo_Blackwell_Lunes.html` al lado del live.
5. **El cron a veces deja `fileCount: null` cuando no cuenta archivos.** El recalc lo trata como "carpeta con contenido inferido" para no penalizar — pero no es ideal.
6. **CIMA flag de consistencia** — los subfolders tienen `modifiedTime` reciente sin archivo directo identificado, probablemente porque los archivos viven en sub-subfolders Semana_NN. Hay que decidir si recursar más profundo en el cron.
7. **Bitácora notes son texto plano.** No afectan scoring ni gatillan acciones automáticas.
8. **No hay export/import de overrides.** Si Fabiola corrige scores en Chrome y quiere compartir con el equipo, tiene que decirlo manualmente.
9. **`history.json` se mantiene a mano.** El cron no agrega snapshots históricos automáticamente. Cada nueva versión la curo manualmente.
10. **Cuentas long-tail sin Drive (Nuvoil, Andy en estado actual, etc.)** quedan en rojo o naranja por estructura, no por mala operación. Es un trade-off honesto.

---

## 13. Extensiones futuras propuestas

- **Sync compartido de overrides** — `data/score_overrides.json` que se versiona y todos lean, en lugar de localStorage por navegador.
- **PQ proxy más profundo** — leer múltiples archivos por cuenta (no solo latestDeliverable), agregar análisis de WhatsApp zips para SC.
- **Histórico automatizado** — el cron escribe snapshots históricos en `data/history/<timestamp>.json` para reconstrucción.
- **Validación formal en el JSON** — el cron expone `validation: {ok, errors, warnings}` que el dashboard muestra como banner.
- **Ticket Monday.com integration** — el playbook §8 prevé tickets automáticos cuando una cuenta cambia de color hacia abajo. Hoy no implementado.
- **Vista por persona enriquecida** — cartera por consultor con scores ponderados por su carga.
- **Export PDF ejecutivo** — un botón que genera el equivalente del snapshot del lunes en PDF formal.

---

## 14. Comandos útiles

### Correr el pipeline localmente (después de un sync)
```bash
cd /sessions/focused-zen-feynman/mnt/outputs
python3 recalc_scores.py
python3 generate_suggestions.py
python3 build_static_snapshot.py
node verify_snapshot.js
cp Semaforo_Blackwell_Lunes.html /sessions/focused-zen-feynman/mnt/Blackwell/
```

### Ver el último audit del recalc
```bash
cat /sessions/focused-zen-feynman/mnt/Blackwell/data/recalc_audit.md
```

### Verificar que SYNC_DATA carga en el browser
En consola del browser: `window.SYNC_DATA.syncedAt`. Debe devolver ISO timestamp.

### Inspección rápida de una cuenta
```js
window.ACCOUNTS.find(a => a.id === 'maja')
```

### Limpiar todos los overrides locales (Fabiola si quiere reset)
```js
Object.keys(localStorage).filter(k => k.startsWith('score:') || k.startsWith('override:')).forEach(k => localStorage.removeItem(k));
```

---

## 15. Quién es quién

- **Esteban Hernández** (`esteban.hernandez@blackwellstrategy.com`) — owner del dashboard, lo construyó.
- **Fabiola** — operativa diaria, define el playbook, valida calidad. Usa el dashboard cada mañana.
- **Humberto** — dirección, define umbrales y prioridades. Revisión semanal.
- **Daniel Menendez, Angel Alcantara, Uriel Ensástiga, Mariana Zamudio, Sandy Cortés** — equipo consultor. Vista anonimizada de su cartera.
- **Johanna Palacio, Marisol Guerrero** — operaciones, validación.
- **mIA** — agente paralelo (otra herramienta) que valida los archivos de output. Ha cazado bugs de consistencia repetidamente.

---

## 16. Estructura de archivos en `Blackwell/`

```
Blackwell/
├── Semaforo_Blackwell.html          ← live (mutable cada día)
├── Semaforo_Blackwell_Lunes.html    ← snapshot congelado (presentación)
├── Semaforo_Blackwell_v24.html      ← versiones previas
├── INSTRUCCIONES.md                  ← manual práctico para Fabiola/Humberto
├── README_Semaforo.md                ← notas técnicas (anterior)
├── CONTEXTO_COMPLETO.md              ← este documento
├── prompt_claude_design_3_overhauls.md
├── data/
│   ├── accounts_status.json          ← sync output (humano)
│   ├── accounts_status.js            ← sync output (browser)
│   ├── sync_alerts.md                ← bitácora del sync
│   ├── checklist.json                ← schema + estado pre-recalc
│   ├── checklist_recalc.json         ← post-recalc (auto-promoted)
│   ├── recalc_audit.md               ← qué cambió en recalc
│   ├── cadence_overrides.json        ← cuentas con cadencia distinta
│   ├── accounts.json                 ← asignaciones del equipo
│   ├── playbook.json                 ← playbook reproducido
│   ├── history.json                  ← snapshots históricos
│   ├── industry.json                 ← sector por cuenta
│   └── (otros artefactos del cron)
└── PROYECTOS BLACKWELL 2026/         ← mirror de Drive (read-only)
```

---

## 17. Si necesitas hacer cambios

### Cambio chico (color, label, copy)
Edita `Semaforo_Blackwell.html` directo. La verificación con `verify_snapshot.js` te dice si lo rompiste.

### Cambio en pesos del checklist
Edita `data/checklist.json` schema. Re-corre `recalc_scores.py`. El dashboard live también necesita el cambio inline en su `CHECKLIST_DATA` (busca `"items": {"contrato"...` en el HTML).

### Cuenta nueva en Drive
La cron la detecta y agrega como stub al siguiente run (ej. "29. COAST OIL" se agregó así). Después puedes curar narrativa en `V12_NARRATIVE` array del HTML.

### Cuenta cambia status
Renombra el folder en Drive con sufijo `/Proyecto concluido`, `/Pausa`, etc. El cron la detecta y actualiza `derivedStatus` automáticamente.

### Cuenta crisis-on-demand
Agregar entrada en `data/cadence_overrides.json` con `cadenceType: on-demand` + `note`.

### Score que el cron pone mal
Override manual desde el modal del dashboard (CO/PQ/SC inputs). Persiste en localStorage del navegador.

### Bug en el sync
Editar el prompt de `blackwell-drive-sync-diario` desde Cowork sidebar. Run now para validar antes de la próxima cadencia automática.

### Nueva pestaña / nuevo bloque de UI
Editar el HTML directamente. El sistema es plain JS, no hay framework. Buscar `<!-- v2.X -->` markers para entender qué se agregó cuándo.

---

## 18. Nota final

El sistema es deliberadamente **honesto** en lugar de **impresionante**. Cuando algo no se puede medir bien (PQ sin reporte de resultados, SC sin abrir el zip de WhatsApp), el dashboard lo dice explícitamente y deja al humano corregir. La tentación de inflar scores para que todo se vea verde fue rechazada repetidamente.

La mejor manera de mantener confianza con Fabiola y Humberto es no mentirles — mejor mostrar 8 verdes reales que 18 verdes inflados.

Si llegas aquí y vas a tocar el sistema: respeta esa filosofía.

---

*Última actualización: 4 de mayo de 2026, post-presentación del lunes.*
