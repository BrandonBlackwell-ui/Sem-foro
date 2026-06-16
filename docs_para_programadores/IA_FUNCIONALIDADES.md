# Funcionalidades de IA — Cómo funcionan y qué agregan al dashboard

**Versión:** 1.0  
**Fecha:** Junio 2026  
**Proyecto:** Blackwell QO

Este documento describe todas las funcionalidades de inteligencia artificial implementadas en el sistema: qué problema resuelve cada una, cómo funciona técnicamente y cómo se ve en la pantalla.

---

## El problema que resuelve la IA

El sistema sin IA solo cuenta archivos y revisa fechas de modificación en Google Drive. Sabe que hay 5 PDFs en la carpeta de entregables, pero no sabe qué dicen. No puede responder: ¿se cumplió lo que se prometió al cliente? ¿Hay riesgos? ¿Qué hay que hacer esta semana?

La IA lee el contenido real de los documentos y convierte esa información en un reporte estructurado, accionable y fácil de entender — como si un analista senior revisara el expediente completo de cada cuenta antes de cada junta.

---

## 1. Lectura real de documentos (no solo metadata)

### Qué hace
En lugar de solo contar archivos, el sistema **descarga y lee el contenido** de hasta 20 documentos por cuenta directamente desde Google Drive.

### Formatos soportados
| Formato | Cómo se procesa |
|---------|----------------|
| PDF (con texto) | Se pasa directamente a Claude como `document block` |
| PDF escaneado / imagen | Se pasa como imagen; Claude lo lee con visión artificial |
| Google Docs / Slides | Se exporta a PDF y se pasa a Claude |
| Google Sheets | Se exporta a CSV; se pasa como texto estructurado |
| Word (.docx) | Se extrae el texto con alta fidelidad |
| Excel (.xlsx) | Se extrae el contenido de las celdas a texto |
| PowerPoint (.pptx) | Se extrae el texto de las diapositivas |
| ZIP (exportación WhatsApp) | Se descomprime; se lee el archivo `_chat.txt` interno |
| Texto plano / CSV / Markdown | Se pasa directamente como texto |

### Prioridad de lectura
Los archivos no se leen en orden aleatorio. Se priorizan según las carpetas del Playbook:

```
01 Contrato/OC/Plan     → hasta 3 archivos  (PRIMERO — define los compromisos)
02 Entregables          → hasta 5 archivos  (evidencia del trabajo)
03 Reportes de avance   → hasta 4 archivos
05 Transcripciones      → hasta 3 archivos
04 WhatsApp             → hasta 5 archivos
06 Agenda / Briefs      → hasta 2 archivos
──────────────────────────────────────────
Total                   → máximo 20 archivos por cuenta
```

**¿Por qué este orden?** El contrato y el plan de trabajo van primero porque sin ellos no se puede saber qué se prometió. Todo lo demás se evalúa contra esa promesa.

### Dónde se ve en el dashboard
En el modal de cada cuenta, sección **"Archivos leídos (N)"** al fondo — lista numerada con nombre del archivo y carpeta de origen.

---

## 2. El "Super JSON" — estructura del análisis por cuenta

Después de leer los documentos, Claude produce un JSON estructurado que el dashboard consume directamente. Este JSON tiene 20 campos y es la base de todo lo que aparece en el modal de análisis.

### El flujo de pensamiento que sigue la IA

La IA no responde al azar. Se le instruye a seguir 4 pasos mentales en orden:

```
PASO 1 — Entender el proyecto
         Lee el contrato y el plan de trabajo.
         Pregunta: ¿para qué nos contrató el cliente? ¿qué prometimos?

PASO 2 — Leer la evidencia
         Para cada archivo adjunto, escribe 1 frase de qué aporta.
         Sin relleno, solo datos concretos.

PASO 3 — Comparar promesa vs realidad
         Cruza lo prometido (Paso 1) con la evidencia (Paso 2).
         Clasifica cada compromiso: cumplido / en proceso / pendiente / en riesgo.

PASO 4 — Recomendar como profesional
         Riesgos con severidad, oportunidades, recomendaciones estratégicas,
         acciones urgentes para esta semana con responsable y fecha.
```

### Reglas de redacción que se le imponen a la IA
- Bullets cortos y concretos — máximo ~20 palabras por bullet
- Empieza con la acción o el hecho, no con preámbulo
- Prohibido el estilo "acta" (nada de "se reportó que en la reunión del...")
- Datos duros siempre que existan: medio, fecha, número, nombre, monto
- Si no hay dato, no inventa — escribe `null` o lista vacía
- Español neutro, profesional, directo

---

## 3. Los 20 campos del análisis y cómo se muestran

### Bloque 1 — Contexto del proyecto

#### `project_purpose`
**Qué es:** Una frase que responde "¿para qué nos contrató este cliente?"  
**Cómo lo obtiene la IA:** Lo extrae del contrato o plan de trabajo. Si no hay contrato, lo deduce del conjunto de archivos.  
**Regla:** Este campo SIEMPRE se llena — es obligatorio.  
**Cómo se ve:** Card azul destacada al inicio del análisis, con ícono 🎯.

```
Ejemplo:
🎯 Propósito del proyecto
"Posicionamiento mediático de GRUPO AZVI como consorcio de infraestructura
responsable ante la crisis del tren interurbano México-Toluca."
```

---

#### `scope_of_service`
**Qué es:** Lista de los servicios concretos que Blackwell entrega a este cliente.  
**Cómo lo obtiene la IA:** Del contrato o propuesta — los servicios acordados.  
**Cómo se ve:** Sección "🤝 Qué hacemos por el cliente" con bullets ▸.

```
Ejemplo:
▸ Gestión de cobertura mediática en crisis ferroviaria
▸ Colocación de notas T1 mensuales (objetivo: 3 por mes)
▸ Monitoreo y contención de narrativa adversa
▸ Press trips regionales para vinculación con medios norte
```

---

#### `content_summary`
**Qué es:** Resumen ejecutivo de 2-3 frases del estado actual.  
**Cómo lo obtiene la IA:** Síntesis después de leer todos los archivos.  
**Cómo se ve:** Párrafo en cursiva, sin encabezado, después del propósito.

---

### Bloque 2 — Lo que prometimos

#### `client_promises` — La lista de compromisos con semáforo de status
**Qué es:** Cada promesa que Blackwell hizo al cliente, con su estado actual.  
**Cómo lo obtiene la IA:** Lee el contrato y el plan de trabajo y extrae cada compromiso individual.  
**Regla:** NUNCA vacío si hay contrato o plan en los archivos.  
**Cómo se ve:** Sección "📋 Lo que prometimos al cliente" — lista numerada con chips de color:

| Status | Color del chip | Significado |
|--------|---------------|-------------|
| `cumplido` | Verde | Hay evidencia de que se entregó |
| `en_proceso` | Azul | Se está trabajando en ello |
| `pendiente` | Naranja | Aún no hay evidencia |
| `en_riesgo` | Rojo | Hay riesgo de no cumplirse |

```
Ejemplo:
#1  3 publicaciones T1 mensuales · mensual              [En proceso]
#2  Reporte de cobertura mensual · mensual               [Cumplido]
#3  Press trip Monterrey-Saltillo con medios norte       [Pendiente]
#4  Colocación Forbes Mexico · único                     [En riesgo]
```

---

### Bloque 3 — El checklist de cumplimiento

#### `fulfilled` + `pending` — El checklist visual
**Qué son:** Dos listas que contrastan lo prometido contra la evidencia real.  
**Cómo lo obtiene la IA:** Compara `client_promises` (Paso 1) contra los archivos leídos (Paso 2). Si hay un entregable prometido y hay un archivo en Drive que lo confirma, va a `fulfilled`. Si no hay evidencia, va a `pending`.  
**Cómo se ve:** Sección "✅ Checklist de cumplimiento" con filas de colores:

```
☑  Reporte de medios mayo entregado — Testigo trabajo Blackwell_AZVI.xlsx (2026-05-13)
☑  3 notas T1 colocadas en abril — Informe Vinculación V3.docx confirma Reforma, El Universal, Milenio
☑  Aclaración publicada en Reforma <12h tras incidente

☐  Press trip Monterrey-Saltillo — sin fecha confirmada ni logística resuelta
☐  Forbes pending — no hay evidencia de publicación ni avance
☐  Agenda vinculación medios norte — reuniones de feb sin reporte de resultado
```

Las filas verdes con ☑ = compromisos con evidencia.  
Las filas naranjas con ☐ = lo que falta, lo vencido, lo que no tiene evidencia.

---

#### `action_plan` — El plan de trabajo con estados
**Qué es:** Los pasos del plan de trabajo real, con su estado de avance.  
**Cómo lo obtiene la IA:** Del plan de trabajo o contrato — los pasos acordados con el cliente.  
**Cómo se ve:** Sección "🗺 Plan de acción" con íconos de progreso:

| Ícono | Status | Estilo visual |
|-------|--------|--------------|
| ☑ | hecho | Verde, texto tachado |
| ◐ | en_proceso | Azul |
| ☐ | pendiente | Gris |

```
Ejemplo:
☑  Onboarding y definición de mensajes clave · Fabiola · 2026-02-01
◐  Colocación mensual T1 (ciclo continuo) · Equipo editorial
☐  Press trip Monterrey-Saltillo · Mónica León · TBD
☐  Colocación Forbes Mexico · Fabiola
```

---

#### `current_status` — Dónde estamos hoy
**Qué es:** 1-2 frases muy concretas del punto actual del proyecto.  
**Cómo se ve:** Sección "📍 En qué punto vamos hoy".

---

### Bloque 4 — Riesgos y oportunidades

#### `risks` — Lista de riesgos con severidad
**Qué es:** Riesgos detectados en los documentos, con nivel de severidad.  
**Cómo lo obtiene la IA:** Identifica situaciones de riesgo en contratos vencidos, compromisos no cumplidos, señales negativas del cliente, o situaciones externas (ej. una nueva crisis de medios).  
**Cómo se ve:** Card roja con ícono ⚠, con punto de color por severidad:
- 🔴 Alta  
- 🟠 Media  
- 🟡 Baja

```
Ejemplo:
⚠ Riesgos
● (alta)  Sin reporte post-agenda febrero — no se sabe si las reuniones ocurrieron
● (media) Forbes pending sin avance documentado desde hace 2 meses
● (baja)  Cotización chofer Saltillo sin respuesta del cliente
```

#### `opportunities` — Oportunidades accionables
**Qué es:** Oportunidades detectadas en los documentos.  
**Cómo se ve:** Card verde con ícono 💡, lado a lado con Riesgos.

```
Ejemplo:
💡 Oportunidades
▸ Press trip Monterrey-Saltillo abre vinculación con medios norte
▸ Socios Recal e Indie podrían amplificar narrativa de consorcio
▸ Forbes Mexico pendiente = oportunidad T1 cualitativa de alto impacto
```

---

### Bloque 5 — Acciones

#### `urgent_actions` — Lo que hay que hacer esta semana
**Qué es:** Acciones concretas para los próximos 7 días, con responsable y fecha límite.  
**Regla:** Siempre ≥ 1 acción si la cuenta está activa y tiene pendientes.  
**Cómo se ve:** Box amarillo "⚡ Acciones urgentes — esta semana" con numeración (1), (2), (3):

```
(1) Enviar Word editable plan ajustado a Elena Crespo · Fabiola · hoy
(2) Mandar cotización chofer Saltillo/Monterrey por correo · Mónica León
(3) Coordinar hotel y vuelo regreso press trip cuando Elena confirme
(4) Activar gestión Forbes — contactar editor esta semana · Fabiola
```

#### `strategic_recommendations` — Recomendaciones de mediano plazo
**Qué es:** Recomendaciones profesionales de 1-3 meses de horizonte.  
**Regla:** Siempre ≥ 1 si la cuenta está activa.  
**Cómo se ve:** Sección "🧭 Recomendaciones estratégicas" con lista numerada.

---

### Bloque 6 — Evidencia por archivo

#### `per_file_notes` — Hallazgo de cada documento leído
**Qué es:** Para cada uno de los archivos que la IA leyó, una frase concreta de qué contiene.  
**Regla:** Una entrada por CADA archivo adjunto, sin excepción.  
**Cómo se ve:** Sección "🔍 Hallazgos por archivo" — cards con nombre del archivo y carpeta de origen.

```
Ejemplo:
Informe de Vinculación Grupo Azvi México_V3.docx  [02]
→ Reporte de cobertura abril-mayo: 9.2M impactos digitales, 3 notas T1,
  aclaración publicada en Reforma. Calificación cliente: 10/10.

Agenda con medios febrero 2026_v3.docx  [02]
→ Agenda de 7 reuniones con medios para feb 2026; sin reporte de resultados post-agenda.

ESTATUS AZVI_BLACKWELL_2026-05-12.docx  [05]
→ Transcripción de llamada 12-may. Pivote estratégico acordado: de gestión
  de crisis a posicionamiento permanente. Press trip Saltillo en preparación.
```

---

### Bloque 7 — Métricas del Playbook (lectura de contenido)

Estas métricas son para uso interno de Blackwell — alimentan o ajustan los scores CO, PQ y SC.

#### `pq_assessment` — Métricas de Performance/Calidad
| Campo | Qué contiene |
|-------|-------------|
| `placements` | Número de notas publicadas detectadas en los archivos |
| `tier_mix` | Ej. "3×T1, 2×T2" — mezcla de nivel de medios |
| `quality_narrative` | Evaluación de la calidad de los mensajes colocados |
| `result_vs_objective` | Contraste entre lo logrado y lo comprometido |
| `score_estimate` | Estimación 0-100 del PQ según los documentos |

#### `co_assessment` — Métricas de Cumplimiento Operativo
| Campo | Qué contiene |
|-------|-------------|
| `committed` | Entregables comprometidos en el periodo |
| `delivered` | Entregables efectivamente entregados |
| `on_time` | Cuántos se entregaron a tiempo |
| `late` | Cuántos se entregaron tarde |
| `missed` | Cuántos no se entregaron |

#### `sc_signals` — Señales del cliente
Cada señal del cliente detectada en los documentos (aprobaciones, quejas, expansiones de scope, ausencias) con:
- Fecha
- Tipo (positiva / negativa)
- Categoría: `approval`, `praise`, `scope_expand`, `referral`, `complaint`, `no_response`, `no_show`
- Cita o paráfrasis del cliente

#### `media_reconciliation` — Reconciliación de medios
Contrasta las publicaciones reales detectadas en los entregables contra las documentadas en los reportes. Si no cuadran, se marca el `gap`.

#### `score_adjustment_recommendation` — Ajuste automático de scores
La IA puede proponer un ajuste al CO, PQ o SC calculado automáticamente:
- Rango: -25 a +25 puntos
- Solo se aplica si la evidencia lo justifica
- Incluye una razón escrita

---

### Bloque 8 — Alertas y operaciones

#### `business_risk`
Resumen de 1 frase del riesgo más grave — para liderazgo.  

#### `opportunity`  
Resumen de 1 frase de la oportunidad más relevante — para liderazgo.

#### `recommended_action`
La acción más urgente de todas, en 1 frase — para liderazgo.  

#### `monday_ticket`
Si la IA detecta algo que requiere seguimiento, genera el trigger para crear un ticket en Monday.com con tipo `urgente`, `prioridad` o `normal`.

---

## 4. Memoria entre análisis (contexto persistente)

### El problema que resuelve
Sin memoria, cada vez que corre un análisis la IA empieza desde cero. Re-analiza todo sin saber qué ya se había concluido en la corrida anterior. Esto es ineficiente y puede perder contexto histórico importante.

### Cómo funciona
Antes de enviar los archivos a Claude, el sistema extrae del análisis anterior un **dossier compacto** con:
- El propósito del proyecto
- Los compromisos con el cliente y su status anterior
- Qué estaba cumplido y qué estaba pendiente la última vez
- El resumen ejecutivo del estado conocido

Este dossier se incluye en el prompt como contexto:

```
DOSSIER PREVIO (lo que ya sabíamos, analizado 2026-05-13) — ACTUALÍZALO, no empieces de cero:
  Propósito: Posicionamiento mediático de GRUPO AZVI...
  Lo que prometimos:
    · 3 publicaciones T1 mensuales [en_proceso]
    · Reporte mensual de cobertura [cumplido]
  Ya cumplido:
    · 9.2M impactos digitales en abril
  Pendiente:
    · Press trip Monterrey-Saltillo sin fecha
  Estado conocido: El cliente calificó 10/10 en mayo. Pivote a posicionamiento permanente...
```

### Qué hace la IA con esto
La IA actualiza el dossier con los nuevos archivos — conserva lo que sigue vigente, corrige lo que cambió, y acumula el historial del proyecto. Así el análisis mejora con cada corrida en lugar de repetirse.

### Dónde se ve
El encabezado del análisis muestra la fecha del último análisis:  
`Análisis generado el 4 jun. 2026 · hoy — las referencias relativas se anclan a esa fecha.`

---

## 5. Briefing ejecutivo del portafolio

### Qué es
Un resumen de toda la cartera de cuentas generado por Claude Sonnet (el modelo más capaz) después de analizar todas las cuentas individuales.

### Cómo funciona
1. Se recogen los resúmenes (`content_summary`, `business_risk`, `recommended_action`) de todas las cuentas analizadas.
2. Se envían a Claude Sonnet en un solo prompt.
3. Claude genera:
   - **Executive briefing:** 3-5 frases sobre el estado del portafolio, prioridades de la semana y cuentas que requieren atención de liderazgo.
   - **Cross-account findings:** Hasta 5 patrones o problemas que afectan a múltiples cuentas.

### Dónde se ve
Pestaña **Auditoría** del dashboard.

---

## 6. Gestión de rate limits y costos

La API de Anthropic tiene límites de tokens por minuto (ITPM). El sistema maneja esto automáticamente:

### Token budgeting
Antes de enviar un análisis, el sistema cuenta los tokens reales del payload (incluyendo PDFs e imágenes). Si el payload supera el 70% del límite, descarta archivos de menor prioridad hasta entrar en presupuesto — siempre preservando los de la carpeta 01.

### Pacing automático
Después de cada llamada, el sistema calcula cuánto tiempo esperar para que el bucket de tokens se recupere y no rechace la siguiente llamada.

### Reintentos con backoff exponencial
Si la API devuelve un error 429 (rate limit) o 529 (sobrecarga), el sistema reintenta hasta 6 veces con esperas progresivas: 10s, 20s, 40s, 80s, 160s, 320s.

### Dos modelos según la tarea
| Tarea | Modelo | Por qué |
|-------|--------|---------|
| Análisis por cuenta | Claude Haiku 4.5 | Más rápido, más barato, más margen de ITPM en Tier 1 (50k vs 30k) |
| Briefing del portafolio | Claude Sonnet 4.5 | Más capacidad de síntesis para el resumen ejecutivo completo |

---

## 7. Resumen visual de todo el flujo

```
Google Drive (archivos reales)
         │
         ▼
  drive_content.py
  ├── Selecciona hasta 20 archivos (priorizando carpeta 01)
  ├── Descarga PDFs, Word, Excel, Google Docs, ZIP-WhatsApp...
  └── Convierte todo al formato que Claude puede leer
         │
         ▼
  claude_analyzer.py
  ├── Arma el prompt: contexto del proyecto + dossier previo + archivos
  ├── Aplica token budgeting (recorta si excede el límite)
  ├── Envía a Claude Haiku con el JSON schema del "super JSON"
  ├── Claude sigue los 4 pasos: entender → leer → comparar → recomendar
  └── Produce el super JSON con los 20 campos
         │
         ▼
  drive_intelligence.js  (archivo de datos del dashboard)
         │
         ▼
  AccountModal.tsx  (modal de la cuenta en el dashboard)
  ├── 🎯 Propósito del proyecto
  ├── 🤝 Qué hacemos por el cliente
  ├── Resumen ejecutivo
  ├── 📋 Lo que prometimos (chips de status por promesa)
  ├── ✅ Checklist (☑ cumplido / ☐ pendiente)
  ├── 🗺 Plan de acción (☑/◐/☐ por paso)
  ├── 📍 En qué punto vamos hoy
  ├── ⚠ Riesgos  +  💡 Oportunidades  (lado a lado)
  ├── ⚡ Acciones urgentes esta semana  (numeradas)
  ├── 🧭 Recomendaciones estratégicas
  ├── 🔍 Hallazgos por archivo
  └── Hechos clave / Notas del analista
```

---

## 8. Estado de implementación

| Funcionalidad | Estado |
|--------------|--------|
| Lectura real de documentos (PDF, Word, Excel, etc.) | ✅ Implementado |
| Lectura de PDFs escaneados e imágenes con visión | ✅ Implementado |
| Lectura de exportaciones ZIP de WhatsApp | ✅ Implementado |
| Super JSON con los 20 campos | ✅ Implementado (prompt escrito) |
| Checklist visual ☑/☐ en el dashboard | ✅ Implementado |
| Chips de status por promesa (cumplido/pendiente/en riesgo) | ✅ Implementado |
| Plan de acción con estados (hecho/en proceso/pendiente) | ✅ Implementado |
| Riesgos con severidad + Oportunidades (lado a lado) | ✅ Implementado |
| Acciones urgentes numeradas con responsable y fecha | ✅ Implementado |
| Contexto persistente (dossier previo entre corridas) | ✅ Implementado |
| Token budgeting + pacing + reintentos automáticos | ✅ Implementado |
| Briefing ejecutivo del portafolio | ✅ Implementado |
| Cross-account findings | ✅ Implementado |
| Ajuste automático de scores (co/pq/sc delta) | ✅ Implementado |
| Trigger para Monday.com | ✅ Implementado (sin integración directa con la API de Monday) |
| **Ejecución del análisis con datos actuales** | ⏸ **Bloqueado — sin créditos en Anthropic** |
