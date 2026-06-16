# Semáforo Blackwell · Arquitectura del sistema

Documento de referencia técnica. No es necesario leerlo para usar el dashboard, pero ayuda a entender por qué los números son los que son y cómo se actualiza todo.

---

## Visión general en una imagen

```
   Google Drive (PROYECTOS BLACKWELL)
              │
              │   carpetas + archivos por cuenta
              ▼
   ┌──────────────────────────┐
   │  Cron diario (server)    │   lee Drive, analiza con LLM,
   │  blackwell-drive-sync    │   genera 3 archivos JSON/JS:
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │  data/                   │
   │  ├─ accounts_status.js   │   sync de carpetas (file counts, mtime)
   │  ├─ drive_intelligence.js│   análisis del LLM por cuenta
   │  ├─ checklist_recalc.js  │   checklist legacy (fallback)
   │  ├─ cells.json           │   división por células (A/B)
   │  ├─ accounts.json        │   metadata de owners + team
   │  └─ cadence_overrides.js │   overrides de cadencia (on-demand)
   └──────────────────────────┘
              │
              │   build_v36.py inlinea TODO en un solo HTML
              ▼
   ┌──────────────────────────┐
   │ Semaforo_Blackwell_v36   │   ← lo que abre Fabiola
   │      .html (~445KB)      │   con doble click. Funciona offline.
   └──────────────────────────┘
              │
              │   JS dentro del HTML reconstruye:
              ▼
   ┌──────────────────────────┐
   │  Vista interactiva:      │
   │  • Gauge / KPIs          │
   │  • Tabla maestra         │
   │  • Decisiones por célula │
   │  • Modal por cuenta      │
   │  • Tabs Equipo/Audit/etc │
   │  • Splash diario         │
   └──────────────────────────┘
```

---

## Backend · Cron diario

### Qué hace

Cada noche (configurable), el cron `blackwell-drive-sync-diario`:

1. **Crawlea Google Drive** desde la carpeta raíz `PROYECTOS BLACKWELL`.
2. **Por cada cuenta** (carpeta `01. TURBOFIN`, `02. MAJA`, …), lista las 6 subcarpetas del playbook (01.Contratos_OC, 02.Entregables, etc.) y registra:
   - `fileCount` — cuántos archivos hay
   - `latestModified` — fecha del archivo más reciente
   - `latestFile` — nombre del archivo más reciente
3. **Detecta status** de la cuenta (active, paused, concluded, active_litigation, active_new, active_crisis_high, onboarding) leyendo el sufijo del folder y/o el contenido.
4. **Llama al LLM** para analizar las cuentas que cambiaron desde el último corte. El LLM genera por cuenta:
   - `content_summary` — narrativa de qué está pasando
   - `recommended_action` — acción concreta para esta semana
   - `business_risk` y `opportunity`
   - `score_adjustment_recommendation` — deltas a CO/PQ/SC basados en evidencia
   - `monday_ticket` — ticket sugerido para el equipo
5. **Detecta hallazgos transversales** (`cross_account_findings`) — cosas que pasan entre varias cuentas a la vez.
6. **Escribe los 3 archivos** en `data/`:
   - `accounts_status.js` (sync de Drive — file counts, etc.)
   - `drive_intelligence.js` (análisis del LLM)
   - `checklist_recalc.js` se mantiene como fallback legacy (no se regenera diariamente)

### Costo aproximado

El LLM corre con Haiku (Anthropic). Cada cuenta cuesta ~$0.001 USD analizar; un sync diario completo de 36 cuentas ~$0.05 USD.

### Archivos auxiliares

- `cells.json` — división por células (A: Marisol, B: Johanna). Se edita a mano cuando cambia la asignación.
- `accounts.json` — metadata de owners (Sr/Jr/Director). Se edita a mano.
- `cadence_overrides.json` — qué cuentas son on-demand vs cadencia regular.

---

## Build · build_v36.py

Es un script Python (~1700 líneas) que toma todos los JSON/JS y los **inlinea dentro de un solo archivo HTML autocontenido**. Esto es necesario porque los navegadores bloquean cargar archivos JSON locales por seguridad cuando abres un HTML con doble click (CORS sobre `file://`).

### Qué hace

1. Lee los 6 archivos de `data/`.
2. Inserta cada uno dentro de `<script>` tags del HTML.
3. Aplica un alias de compatibilidad: el cron emite `window.ACCOUNTS_STATUS`, el dashboard lee `window.SYNC_DATA` — el alias hace que ambos funcionen.
4. Escribe `Semaforo_Blackwell_v36.html` listo para distribuir.

### Cómo correrlo

```bash
cd /sessions/.../outputs
python3 build_v36.py
```

Output: `Semaforo_Blackwell_v36.html` (~445KB).

---

## Frontend · El HTML

Aunque parece una página estática, dentro tiene ~3000 líneas de JavaScript que reconstruye todo en el navegador.

### Estructura del JS

1. **Carga de datos**:
   ```js
   const SD = window.SYNC_DATA;        // sync diario
   const DI = window.DRIVE_INTELLIGENCE; // análisis LLM
   const CHK = window.CHECKLIST_RECALC_DATA; // legacy
   const CELLS = window.CELLS;         // división A/B
   const ACCOUNTS_META = window.ACCOUNTS_META; // owners
   ```

2. **`buildAccounts()`** — construye el array `ACCOUNTS` combinando todas las fuentes. Por cada cuenta:
   - Mapea `number → id` con `NUMBER_TO_ID`
   - **Deriva el checklist** desde `subfolderActivity` del cron (más fresco que el legacy)
     - Match por prefijo numérico (`01.`, `02.`, etc.) para soportar variaciones de nombre
     - WhatsApp siempre cuenta como `ok` con cualquier archivo (chats son evidencia continua)
   - Computa CO/PQ/SC con la formula del playbook:
     - `CO = Σ(items[k].status × items[k].weight_co)` (renormalizado si hay items N/A)
     - Igual para PQ y SC con sus pesos respectivos
   - Aplica deltas del LLM (`score_adjustment_recommendation`)
   - Aplica overrides locales del usuario si los hay (localStorage)
   - Computa el global: `Global = CO×0.375 + PQ×0.25 + SC×0.375`
   - Aplica cap rule: `if (CO < 45 || SC < 50) → cap a 64`
   - Asigna color: ≥80 verde · ≥65 amarillo · ≥45 naranja · <45 rojo

3. **Render de cada sección**:
   - `renderHeader()` — título, fecha de corte, chip de alertas
   - `renderGauge()` — velocímetro SVG con aguja
   - `renderKPIs()` — conteos por color
   - `renderDecisions()` — todas las cuentas no-verdes divididas por célula
   - `renderMaster()` — tabla con sort, filtros, sparklines
   - `renderEquipo()` — tab de células
   - `renderAuditoria()` — tab con hallazgos transversales
   - `openModal(id)` — detalle de cuenta con análisis Drive, indicadores, histórico

4. **Splash screen** — modal de bienvenida 1ra vez al día, se persiste en localStorage como `v35:splash:lastShown`.

### Persistencia local (localStorage)

- `v35:splash:lastShown` — fecha del último splash visto
- `v35:override:<id>:<axis>` — override manual de score por cuenta+eje (CO/PQ/SC)
- `v35:theme` — tema claro/oscuro
- `v35:role` — rol seleccionado

Todos los overrides son por navegador / por usuario. No se sincronizan.

---

## Cómo se calcula el score

### La formula

```
CO (Cumplimiento Operativo)  · peso 37.5%
PQ (Performance / Calidad)   · peso 25%
SC (Satisfacción del Cliente) · peso 37.5%

Global = CO × 0.375 + PQ × 0.25 + SC × 0.375
```

### Los items del checklist

Cada uno de CO/PQ/SC se computa como suma ponderada de 6 items que mira el cron en Drive:

| Item | Peso CO | Peso PQ | Peso SC |
|---|---:|---:|---:|
| 01.Contratos_OC | 10% | 0% | 0% |
| 02.Entregables | 40% | 50% | 20% |
| 03.Reportes_Avance | 20% | 40% | 20% |
| 04.Conversaciones_WA | 10% | 0% | 30% |
| 05.Transcripciones_Llamadas | 5% | 0% | 30% |
| 06.Agenda_Trabajos | 15% | 10% | 0% |

Cada item puede estar en uno de 4 estados según lo que ve el cron:

- **`ok`** = 100 puntos (≥2 archivos en últimos 14 días, o WhatsApp con cualquier archivo)
- **`partial`** = 50 puntos (≥1 archivo o evidencia parcial)
- **`missing`** = 0 puntos (subfolder vacío o no existe)
- **`na`** = excluido del cálculo (no aplica para esta cuenta)

### Cap rule

Para evitar inflar el score con un solo item bueno:

```
if (CO < 45 OR SC < 50) → score capped a 64
```

Filosofía: si la operación o satisfacción del cliente está mal, no importa que el PR esté top — la cuenta no merece pasar de 64.

### Status no-puntuables

Cuentas en `concluded`, `historical`, o `paused` no tienen score (gris en el dashboard). Solo `active*` y `onboarding` puntúan.

---

## Cómo se actualizan datos

### Cuentas nuevas

Cuando aparece una cuenta nueva en Drive (ej: "37. LEADSALES"):

1. El cron la detecta automáticamente y la incluye en el siguiente sync.
2. Esteban tiene que:
   - Agregar el `id` corto a `NUMBER_TO_ID` en `build_v36.py`
   - Agregarla a `cells.json` (a qué célula pertenece)
   - Re-correr `build_v36.py`

### Cambios de célula

Editar `cells.json` directo. Si una cuenta es de asignación temporal, agregarla a `tentative_members` para que salga marcada con asterisco en el dashboard.

### Cambios en formula de score

Cambiar pesos en `checklist_recalc.js` schema (rara vez), o cambiar las constantes en `build_v36.py` (`co < 45 → cap 64`, etc.).

---

## Glosario rápido

- **CO** = Cumplimiento Operativo (¿el equipo está cumpliendo el playbook?)
- **PQ** = Performance / Quality (¿qué tan bien está saliendo el trabajo?)
- **SC** = Satisfacción del Cliente (¿el cliente está contento?)
- **Cron** = programa que corre solo cada cierto tiempo (en este caso, cada noche)
- **LLM** = Large Language Model (Claude Haiku, en este caso) que analiza el contenido del Drive
- **Sync diario** = ejecución del cron que lee Drive y genera los archivos
- **Baseline** = primera ejecución pesada del cron (toma ~3-4 hrs)
- **Delta** = ejecución diaria que solo procesa lo que cambió (toma ~10 min)
- **Tentative member** = cuenta asignada provisionalmente a una célula, pendiente de confirmar
- **isActive** = true para cuentas con status que empieza con `active` u `onboarding`

---

## Archivos importantes (para Esteban)

- `outputs/build_v36.py` — el build script
- `outputs/verify_v36.js` — pruebas jsdom para validar el HTML
- `Blackwell/data/*.js,*.json` — los archivos que come el build
- `Blackwell/Semaforo_Blackwell_v36.html` — el output final

---

## Si quieres saber más

Pregunta a Esteban. Todo el código está documentado y los tests jsdom validan que cada cambio no rompa nada.
