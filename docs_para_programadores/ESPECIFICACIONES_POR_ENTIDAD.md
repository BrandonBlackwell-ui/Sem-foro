# Especificaciones del Dashboard por Entidad (Cuenta)

**Versión:** 1.0  
**Fecha:** Junio 2026  
**Proyecto:** Blackwell QO — Dashboard de Operaciones  

Este documento describe qué información se obtiene por cuenta, cómo se obtiene, y cómo se representa visualmente en el dashboard.

---

## 1. Fuentes de datos

El sistema combina tres fuentes para construir el perfil completo de cada cuenta:

| Fuente | Archivo / API | Qué aporta |
|--------|--------------|------------|
| **Google Drive** (crawler) | `accounts_status.json` | Estructura de carpetas, fechas de modificación, nombre de archivos, último entregable, última actividad |
| **Claude AI** (analizador) | `drive_intelligence.js` | Lectura real del contenido de documentos — contratos, entregables, reportes, transcripciones, WhatsApp |
| **Datos manuales** | `cells.json`, `account_segmentation.json`, `cadence_overrides.json`, `cadence_account_tags.json` | Célula responsable, tier estratégico, tipo de cadencia, overrides de score |

---

## 2. Ciclo de actualización

```
Google Drive
    │
    ▼
drive_crawler.py  ──►  accounts_status.json   (metadata + estructura)
    │
    ▼
drive_content.py  ──►  descarga hasta 20 archivos por cuenta en formato nativo
    │                   (PDF, DOCX, XLSX, Google Docs→PDF, Sheets→CSV, ZIP-WA)
    ▼
claude_analyzer.py ──► drive_intelligence.js  (super JSON por cuenta con IA)
    │
    ▼
dashboard/public/data/  ──►  El dev server o Netlify sirven los datos al browser
```

**Frecuencia de sync:**
- **Baseline:** corre manualmente cuando se quiere re-analizar todas las cuentas (costoso en tokens).
- **Hotfix:** corre sobre cuentas específicas para correcciones puntuales.
- **Delta:** detecta automáticamente carpetas con archivos modificados en los últimos N días.

---

## 3. Datos que se obtienen y muestran por cuenta

### 3.1 Identidad y metadatos básicos

| Campo | Fuente | Cómo se obtiene | Representación en UI |
|-------|--------|----------------|---------------------|
| Nombre de la cuenta | Drive → nombre de carpeta raíz | Se extrae quitando el número de prefijo y las etiquetas de estado (`/proyecto concluido`, etc.) | Título grande en el header del modal y en la tabla principal |
| Número de cuenta | Drive → prefijo numérico de la carpeta | Se lee directamente del nombre de carpeta (`01. TURBOFIN` → `"01"`) | Texto monoespacio en el header |
| Estado operativo | Drive → sufijo del nombre de carpeta | Se detecta por regex: `activo`, `onboarding`, `nueva`, `crisis`, `litigio`, `pausa`, `concluido`, `terminación anticipada`, `histórico`, `evento único` | Badge de color en el header y punto de color en la tabla |
| Título completo en Drive | Drive → nombre de carpeta sin procesar | Se guarda como `folderTitle` | Texto secundario en header del modal |
| Célula responsable | `cells.json` | Se hace match por ID de cuenta | Badge "Célula A/B/..." en header del modal y columna "Resp" en tabla |
| Tier estratégico | `account_segmentation.json` | Se asigna manualmente: `top`, `estrategica`, `otra`, `inactiva` | Agrupación de filas en la tabla principal (Top + Estratégicas / Otras activas / Concluidas) |
| Tipo de cadencia | `cadence_overrides.json` o Drive | `regular` (default) o `on-demand` | Badge `on-demand` si aplica; cambia fórmula de score global |

---

### 3.2 Scores de salud (CO, PQ, SC, Global)

Los tres indicadores se calculan a partir del **checklist de subcarpetas** y se ajustan con la IA.

#### CO — Cumplimiento Operativo (peso 37.5% en cuentas regulares)

| Aspecto | Detalle |
|---------|---------|
| **Qué mide** | Si Blackwell está cumpliendo con las entregas acordadas con el cliente |
| **Cómo se calcula** | Cada ítem del checklist de carpetas (`contrato`, `entregables`, `reporte`, `whatsapp`, `transcripciones`, `agenda`) tiene un peso `w_co`. Se suman los pesos × score (`ok=100`, `partial=50`, `missing=0`) |
| **Regla dura** | Si la carpeta `01_Contrato_OC` está vacía → CO = 0, sin excepción |
| **Ajuste IA** | Claude puede proponer un `co_delta` de -25 a +25 según lo que leyó |
| **Override manual** | Operaciones puede sobrescribir CO directamente desde el modal |
| **Representación** | Barra horizontal con color (verde ≥80, amarillo ≥65, naranja ≥45, rojo <45) + número |

#### PQ — Performance / Calidad (peso 25%)

| Aspecto | Detalle |
|---------|---------|
| **Qué mide** | Calidad y resultados del trabajo de PR entregado |
| **Cómo se calcula** | Checklist con peso `w_pq` + ajuste IA (`pq_delta`) |
| **Enriquecimiento IA** | La IA lee entregables y reportes y estima: número de placements, mezcla de tiers (T1/T2/T3), calidad de narrativa, resultado vs objetivo del contrato |
| **Representación** | Barra + número. En la sección de métricas operativas del modal se muestran badges con placements y tier_mix |

#### SC — Satisfacción del Cliente (peso 37.5%)

| Aspecto | Detalle |
|---------|---------|
| **Qué mide** | Señales de satisfacción o insatisfacción del cliente |
| **Cómo se calcula** | Checklist con peso `w_sc` + ajuste IA (`sc_delta`) |
| **Enriquecimiento IA** | Claude detecta señales en transcripciones, WhatsApp y reportes: aprobaciones, quejas, expansiones de scope, ausencias, calificaciones directas del cliente |
| **Representación** | Barra + número. Señales individuales listadas con fecha y color (verde = positiva, rojo = negativa) |

#### Score Global

| Cadencia | Fórmula | Umbral verde |
|----------|---------|-------------|
| Regular | `CO×0.375 + PQ×0.25 + SC×0.375` | ≥ 80 |
| On-demand | `contrato×0.30 + entregables×0.40 + WA×0.30` | ≥ 60 |

**Caps automáticos:** si CO < 45 o SC < 50, el global se topa en 64 (no puede ser verde aunque los números den más). Si el contrato está sin firmar o vencido, el global se topa en 64 o 79.

**Representación:** número grande con color en el modal, punto de color + número en la tabla principal.

---

### 3.3 Estado del contrato

| Campo | Cómo se obtiene | Representación |
|-------|----------------|----------------|
| Estado | Heurística sobre archivos en `01_Contrato_OC`: nombre del archivo, fecha de modificación, antigüedad | Badge naranja si no está firmado/vigente; badge verde si está firmado y actual |
| Evidencia | Nombre del archivo más reciente en la carpeta `01` | Texto monoespacio debajo del badge |
| Antigüedad | Meses desde la última modificación del archivo de contrato | Advertencia naranja si tiene >12 meses |
| Alert en tabla | Si `01` está vacía y hay entregables, se muestra una alerta roja en el modal | Banner rojo en la parte superior del modal |

---

### 3.4 Actividad en Drive

| Campo | Fuente | Cómo se obtiene | Representación |
|-------|--------|----------------|----------------|
| Última actividad | Drive crawler | Archivo modificado más recientemente en cualquier carpeta de la cuenta | Columna "Última actividad" en tabla principal (formato relativo: "hace 3d", "hoy") |
| Último entregable formal | Drive crawler | Archivo más reciente específicamente en carpetas `02` o `03` | Sección "Histórico" al fondo del modal |
| Actividad por carpeta | Drive crawler | Para cada subcarpeta: conteo de archivos, último archivo, fecha de última modificación | Cards de cuadrícula en sección "Actividad por carpeta Drive" del modal |

**Carpetas del Playbook:**

| Carpeta | Contenido esperado |
|---------|-------------------|
| `01` — Contrato/OC | Contrato firmado, Orden de Compra, propuesta aceptada |
| `02` — Entregables | Reportes de medios, clippings, evidencias de publicación |
| `03` — Reportes de avance | Seguimientos mensuales, reportes de actividad |
| `04` — WhatsApp | Exportación de chats de WhatsApp con el cliente |
| `05` — Transcripciones | Notas de llamadas, minutas de reuniones (generadas por Gemini/Otter) |
| `06` — Agenda / Briefs | Calendarios editoriales, briefs de campaña |

---

### 3.5 Análisis de IA (super JSON por cuenta)

Este es el bloque más rico. Claude lee el contenido real de hasta **20 archivos** por cuenta y produce un JSON estructurado. Se muestra en el modal bajo "Análisis Drive · evidencia leída".

#### Cómo se obtienen los archivos

1. El crawler recolecta todos los archivos de las carpetas del playbook.
2. `drive_content.py` selecciona hasta 20 archivos priorizando:
   - `01` (hasta 3 archivos) — primero, porque tiene los compromisos
   - `02` (hasta 5 archivos) — evidencia del trabajo
   - `03` (hasta 4 archivos) — reportes
   - `05` (hasta 3 archivos) — transcripciones
   - `04` (hasta 5 archivos) — WhatsApp
   - `06` (hasta 2 archivos) — agenda
3. Cada archivo se convierte al formato nativo que Claude puede leer:
   - PDF / imagen → se pasa directamente como `document block` o `image block`
   - Google Docs / Slides → se exporta a PDF
   - Google Sheets → se exporta a CSV
   - DOCX / XLSX / PPTX → se extrae el texto
   - ZIP (exportación WhatsApp) → se descomprime y lee el `_chat.txt`
4. Claude recibe el contenido real de todos los archivos + el dossier previo de la cuenta (contexto persistente de corridas anteriores)

#### Secciones del análisis IA y su representación

| # | Campo JSON | Etiqueta en UI | Descripción | Representación |
|---|-----------|----------------|-------------|----------------|
| 1 | `project_purpose` | 🎯 Propósito del proyecto | 1 frase: para qué contrató el cliente a Blackwell | Card azul destacada al inicio del análisis |
| 2 | `scope_of_service` | 🤝 Qué hacemos por el cliente | Lista de servicios concretos que Blackwell entrega | Bullets con ▸ |
| 3 | `content_summary` | *(sin encabezado)* | 2-3 frases ejecutivas del estado actual | Párrafo en cursiva, después del propósito |
| 4 | `client_promises` | 📋 Lo que prometimos al cliente | Lista numerada de compromisos del contrato/plan, cada uno con cadencia y status | Filas numeradas; chips de color por status: **Cumplido** (verde), **En proceso** (azul), **Pendiente** (naranja), **En riesgo** (rojo) |
| 5 | `fulfilled` + `pending` | ✅ Checklist de cumplimiento | Contraste entre lo prometido y la evidencia encontrada | Filas con ☑ verde (cumplido) o ☐ naranja (pendiente), borde de color izquierdo |
| 6 | `action_plan` | 🗺 Plan de acción | Pasos del plan de trabajo con status e involucrado | Filas con ☑/◐/☐ según status; tachar si está hecho |
| 7 | `current_status` | 📍 En qué punto vamos hoy | 1-2 frases de dónde está el proyecto hoy | Párrafo de texto |
| 8 | `risks` | ⚠ Riesgos | Lista de riesgos con severidad (alta/media/baja) | Card roja; punto de color por severidad |
| 8 | `opportunities` | 💡 Oportunidades | Lista de oportunidades accionables | Card verde; lado a lado con Riesgos |
| 9 | `urgent_actions` | ⚡ Acciones urgentes — esta semana | Acciones numeradas con responsable y fecha | Box amarillo; numeradas (1), (2), (3)... |
| 10 | `strategic_recommendations` | 🧭 Recomendaciones estratégicas | Recomendaciones de mediano plazo, numeradas | Lista numerada |
| 11 | `per_file_notes` | 🔍 Hallazgos por archivo | 1 frase por cada archivo leído: qué aporta | Cards compactas con nombre de archivo + badge de carpeta |
| 12 | `key_facts` | Hechos clave | Datos duros puntuales (número, fecha, nombre) leídos de los archivos | Bullets simples |
| 13 | `notes` | Notas del analista | Contexto o matices que no encajan en otra sección | Caja gris discreta al fondo |

#### Métricas operativas (sección separada en el modal)

| Campo JSON | Etiqueta en UI | Detalle |
|-----------|----------------|---------|
| `pq_assessment.placements` | Placements | Número de notas/menciones publicadas detectadas en los archivos |
| `pq_assessment.tier_mix` | Mezcla de tiers | Ej. "3×T1, 2×T2" — proporción de medios de alto/medio/bajo impacto |
| `pq_assessment.quality_narrative` | Calidad narrativa | Descripción de la calidad de los mensajes colocados |
| `pq_assessment.result_vs_objective` | Resultado vs objetivo | Contraste directo entre lo logrado y lo comprometido en el contrato |
| `co_assessment` | CO leído del contenido | Entregables comprometidos, entregados, a tiempo, tarde, no entregados |
| `sc_signals` | Señales del cliente | Cada señal con fecha, tipo (positiva/negativa), categoría y cita del cliente |
| `media_reconciliation` | Reconciliación de medios | Publicaciones reales vs documentadas en reportes; gap si no cuadra |

#### Campos de control y ajuste

| Campo JSON | Uso |
|-----------|-----|
| `score_adjustment_recommendation` | La IA puede proponer un delta (-25 a +25) para CO, PQ y SC con justificación. Se aplica automáticamente al score calculado. |
| `monday_ticket` | Si se detecta algo urgente, la IA genera un trigger para crear un ticket en Monday.com (tipo: `urgente`/`prioridad`/`normal`). |
| `business_risk` | Resumen de 1 frase del riesgo más grave para liderazgo. |
| `opportunity` | Resumen de 1 frase de la oportunidad más relevante para liderazgo. |
| `recommended_action` | La acción más urgente de todas, en 1 frase. |

---

### 3.6 Archivos leídos

| Campo | Representación |
|-------|----------------|
| Lista de hasta 20 archivos con título, carpeta de origen y tipo | Sección "Archivos leídos (N)" al fondo del modal; filas numeradas con pill de carpeta a la derecha |
| Archivos omitidos | Se muestran internamente en el análisis si Claude los menciona en `per_file_notes` |

---

### 3.7 Próxima acción

| Campo | Fuente | Representación |
|-------|--------|----------------|
| `nextAction.action` | Drive crawler (detectado de nombres de archivos o metadata) | Sección "Próxima acción" en modal |
| `nextAction.due` | Drive crawler | Fecha límite en monoespacio |
| `nextAction.owner` | Drive crawler | Responsable, si está disponible |

---

### 3.8 Override manual de scores

| Funcionalidad | Cómo funciona | Representación |
|--------------|--------------|----------------|
| Override de CO/PQ/SC | Desde el modal, el usuario puede escribir un valor de 0-100 para cualquiera de los tres scores. Se guarda en `localStorage` del browser. | Botón "Ajustar score manualmente" → inputs numéricos + botón "Limpiar". Muestra el valor automático como referencia. |

---

## 4. Vista de tabla principal (Briefing Tab)

La tabla principal agrega los datos de todas las cuentas en una sola vista.

| Columna | Campo | Descripción |
|---------|-------|-------------|
| Nombre | `name` | Nombre limpio de la cuenta |
| Estado | `color` (punto) + `status` | Punto de color + etiqueta de estado |
| Resp | `cellLead` | Primer nombre del líder de célula |
| CO | `co` | Score 0-100 |
| PQ | `pq` | Score 0-100 |
| SC | `sc` | Score 0-100 |
| Global | `global` | Score ponderado global |
| Última actividad | `lastActivity` | Fecha relativa del último archivo modificado en Drive |

**Agrupación (cuando el filtro es "Todas"):**
1. **Top + Estratégicas** — cuentas con tier `top` o `estrategica`
2. **Otras cuentas activas** — cuentas activas con tier `otra`
3. **Concluidas · Pausadas · Históricas** — cuentas no activas

---

## 5. Filtros disponibles en la tabla

| Filtro | Qué muestra |
|--------|-------------|
| Todas | Todas las cuentas agrupadas |
| Top + Estratégicas | Solo tier `top` o `estrategica` |
| Célula A / Célula B | Cuentas asignadas a esa célula |
| Rojo / Naranja / Amarillo / Verde | Por color de score global |
| Sin actividad (stale) | Cuentas sin actividad en Drive en los últimos 30 días |
| Sin entregable | Cuentas sin archivo en `02_Entregables` |
| On-demand | Cuentas con cadencia `on-demand` |
| Problema de contrato | Cuentas con contrato sin firmar, vencido o ausente |
| 💬 WhatsApp | Cuentas con al menos 1 archivo en la carpeta `04_WhatsApp` |
| Concluidas | Cuentas con estado no activo |

---

## 6. Radar WhatsApp

Sección debajo de la tabla principal que muestra específicamente el estado de la carpeta `04_WhatsApp` por cuenta.

| Columna | Descripción |
|---------|-------------|
| Cuenta | Nombre |
| Estado | **Al día** (archivo <7d), **Revisar** (7-30d), **Gap** (>30d), **Sin docs** (carpeta vacía) |
| Archivos | Conteo de archivos en la carpeta `04` |
| Última actividad | Fecha del último archivo en `04` |
| Último archivo | Nombre del archivo más reciente |

---

## 7. Briefing ejecutivo del portafolio (Pestaña Auditoría)

Generado por Claude Sonnet con el resumen de todas las cuentas analizadas.

| Campo | Descripción |
|-------|-------------|
| `executive_briefing` | 3-5 frases sobre el estado general del portafolio, prioridades de la semana y cuentas que requieren atención de liderazgo |
| `cross_account_findings` | Hasta 5 patrones o problemas que afectan a múltiples cuentas (con severidad y lista de cuentas afectadas) |
| `media_reconciliation` | Tabla de placements publicados vs reportados por cuenta |

---

## 8. Contexto persistente entre análisis

Cada vez que corre un análisis, el sistema le pasa a Claude el **dossier del análisis anterior** de esa cuenta, resumiendo:
- El propósito del proyecto
- Lo que se prometió al cliente
- Qué estaba cumplido y qué estaba pendiente la última vez
- El estado conocido del proyecto

Esto permite que la IA **actualice** el conocimiento existente en vez de releer todo desde cero, conservando contexto histórico entre corridas y mejorando la continuidad del análisis.

---

## 9. Limitaciones y pendientes

| Tema | Estado actual | Mejora planificada |
|------|--------------|-------------------|
| **Créditos Anthropic** | El análisis IA no corre sin saldo en la API | Cargar créditos y correr baseline completo |
| **Documentos sin texto** | PDFs escaneados e imágenes se analizan con visión de Claude | Ya implementado |
| **Archivos ZIP de WhatsApp** | Se descomprime y lee el `_chat.txt` automáticamente | Funcional |
| **Monday.com** | La IA genera el trigger pero la integración directa con la API de Monday no está activa | Pendiente |
| **Frecuencia de sync automático** | Hoy es manual | Se podría programar con un cron job o GitHub Action |
| **Secciones nuevas del modal** | `project_purpose`, `action_plan`, `client_promises`, `risks`, `urgent_actions` y `strategic_recommendations` aparecerán vacías hasta que se corra un nuevo análisis con el prompt actualizado | Requiere correr sync con créditos de Anthropic |
