# Estructura de carpetas estándar — Blackwell

Para que el dashboard pueda leer correctamente la información, **todas las cuentas deben usar el mismo formato de subcarpetas**. La inconsistencia (que algunas tengan prefix de cuenta y otras no, o que tengan espacios después del punto) es lo que rompe la lectura.

Convención acordada: **prefix de cuenta en TODAS las subcarpetas**.

## Las 6 subcarpetas (reemplaza `[CUENTA]` con el nombre de cada cuenta)

| # | Nombre exacto | Qué guardar | Responsable | Frecuencia |
|---|---|---|---|---|
| 1 | `01.[CUENTA]_Contratos_OC` | Contratos firmados, órdenes de compra, adendums | Consultor Sr | Al inicio y al renovar |
| 2 | `02.[CUENTA]_Entregables` | Notas, comunicados, boletines, propuestas, insumos al cliente | Consultor Jr | Cada entrega; resumen los viernes |
| 3 | `03.[CUENTA]_Reportes_Avance` | Reportes mensuales / quincenales / Q al cliente | Consultor Sr | Quincenal o mensual según contrato |
| 4 | `04.[CUENTA]_Conversaciones_WA` | Exports de chats de WhatsApp con el cliente | Consultor Jr | Cada lunes antes de las 10h |
| 5 | `05.[CUENTA]_Transcripciones_Llamadas` | Transcripciones / minutas de calls con el cliente | Consultor Jr | Máximo 24h después de cada llamada |
| 6 | `06.[CUENTA]_Agenda_Trabajos` | Agendas, planes de trabajo, calendarios editoriales | Consultor Sr | Antes de cada semana o acción |

## Ejemplo concreto — MTV

```
12. MTV/
├── 01.MTV_Contratos_OC
├── 02.MTV_Entregables
├── 03.MTV_Reportes_Avance
├── 04.MTV_Conversaciones_WA
├── 05.MTV_Transcripciones_Llamadas
└── 06.MTV_Agenda_Trabajos
```

## Reglas críticas

- **Sin espacio** después del punto: `01.MTV_…` ✅, NO `01. MTV_…` ❌
- **Underscore** entre el nombre de cuenta y el sufijo: `MTV_Contratos_OC`
- **Plural en Contratos** y **Llamadas**, singular en lo demás: `Contratos_OC`, `Transcripciones_Llamadas`, `Agenda_Trabajos`, `Reportes_Avance`, `Entregables`, `Conversaciones_WA`
- **Sin acentos** ni caracteres especiales
- **Mismo nombre de cuenta** en las 6 subcarpetas (no mezclar `MTV_` con `Tello_` dentro de la misma)

## Variaciones que hay que corregir

Lo que está actualmente en MTV (ejemplo) y debería normalizarse:

| Está como | Debe ser |
|---|---|
| `01. Contratos_OC` (con espacio, sin prefix) | `01.MTV_Contratos_OC` |
| `04.Conversaciones_WA` (sin prefix) | `04.MTV_Conversaciones_WA` |
| `05. MTV_Transcripciones_Llamadas` (con espacio) | `05.MTV_Transcripciones_Llamadas` |

## Por qué importa

El sync diario lee Drive y mapea cada subcarpeta por **prefijo numérico** (`01.`, `02.`, etc.). Lo que viene después no afecta el match, pero la inconsistencia sí afecta:

- A veces el cron no enumera bien archivos cuando hay variaciones raras (espacio extra, etc.)
- En la lista de "Archivos leídos" del modal, los nombres salen mezclados feo
- Si el equipo abre dos cuentas en paralelo, no entienden cuál es cuál

Con prefix consistente en las 28 cuentas, todo se ve uniforme y el cron lee al 100%.

## Cómo verificar

Una vez normalizadas, en cada cuenta del dashboard hay un desplegable **"Ver checklist por item · fuente: subfolderActivity + análisis Drive"** donde se ve el conteo exacto de archivos por subcarpeta. Si dice "0 archivos en 01.MTV_Contratos_OC" es porque realmente está vacía, no por un nombre raro.
