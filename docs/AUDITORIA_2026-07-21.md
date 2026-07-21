# Auditoría de integridad de datos — 21 jul 2026

Auditoría sistemática de la clase de bugs encontrada en la operación: llaves que no
empatan entre escritor y lector, atribución equivocada, fallbacks que fabrican datos,
dedup débil y mapeos desincronizados. 4 pasadas paralelas (contratos de datos,
crosswalks/atribución, fallbacks, dedup/idempotencia) + verificación contra prod.

Los ítems marcados [RESUELTO] se corrigieron el mismo día (ver commits de la rama
feat/semaforo-tipos-entregable). Los marcados [NEGOCIO] requieren decisión del equipo.

## Críticos

1. [RESUELTO] `account_publications` llaveada por posición de fila del Sheet
   (`source_row_number`) y sin DELETE: insertar/borrar filas a la mitad del Sheet
   recorre todas las de abajo y deja huérfanas al final. Fix: reconciliación por URL
   + limpieza de filas que ya no están en el Sheet.
2. [RESUELTO] `publication_quality_analyses` upsert por `url` global: dos clientes con
   la misma URL se pisan (2 casos reales en el Sheet). Fix: llave (url, account_id)
   (migración 018) + lookup por cuenta en el dashboard.
3. [RESUELTO] Fallback del import de Meet fabricaba sesión 80 + survey 80/80 permanente
   (28% de los correos caían ahí). Fix: ya no se inserta análisis fabricado (queda
   reintentable); el dashboard filtra `model='regex_fallback'` y el survey solo cuenta
   con respuesta real.
4. [RESUELTO] 71 publicaciones con link descartadas por crosswalk incompleto (incluía
   Pepe Aguilar y LCH, cuentas existentes; Ceron-Toluca = LUCA según Cuentas.csv).
   Fix: crosswalk ampliado + el sync ahora loguea la LISTA de clientes no mapeados.
   [RESUELTO-NEGOCIO 2026-07-21] Ceron-Acapulco (27 notas), Ceron-Paz, GGS, Gabriel
   Castañeda, Crisol, Freemium, Cruzalo, etc.: el equipo confirmó que NO se rastrean
   y los van a quitar del Sheet. No se agregan al crosswalk (se quedan descartados; el
   sync ya loguea la lista para visibilidad).
5. [RESUELTO] `api/account_aliases.json` con claves slug pero lookup por número: los
   aliases nunca aplicaban y "interno blackwell" no podía reclamar juntas internas
   (causa raíz de la junta interna atribuida a CIMA). Fix: claves numéricas + el
   alias interno participa + stopwords en el matcher difuso.
6. [RESUELTO] El survey de WhatsApp se perdía si el analizador corría 2 veces el mismo
   día (el merge lo anidaba en `previous_raw_analysis`). Fix: el survey se conserva
   en el nivel superior del merge.

## Altos

7. [RESUELTO parcial] Tablas número↔slug duplicadas y desincronizadas (topes 38/39 con
   prod en 46). Fix: NUMBER_TO_ID y SLUG_TO_NUMBER extendidos a 45; tiers default en
   publication_quality_config para cuentas sin config propia.
   [PENDIENTE] Unificar en una sola fuente de verdad (tabla o JSON compartido).
8. [RESUELTO parcial] Duplicación de tareas: `import-gemini-tasks.js` insertaba sin
   llave; el dedup de tareas del import de correos era por día y sin cuenta. Fix:
   dedup con ventana de 7 días + scope por cuenta; email_subject en raw_action.
   [PENDIENTE] Atomicidad create-then-patch hacia Monday (pre-check por sync_key).
9. [RESUELTO parcial] Meta de CO por regex del contrato: "anuales" producía meta
   mensual x12. Fix: se agrega manejo de anual/semestral. [NEGOCIO] "Hasta N" se
   trata como meta exigible; contratos por fases usan la fase 1.
10. [RESUELTO parcial] Defaults creíbles en el SC: sesión→40 y WA→50 sin marcar; el
    desglose omitía la línea de WA pero sumaba sus puntos. Fix: el desglose siempre
    imprime la línea y marca "(base, sin dato)". [PENDIENTE] cuentas sin seed nacen
    con WA base 70 (`DEFAULT_BASE_SCORE`); global rellena componentes faltantes con 0
    sin re-normalizar (decisión de producto).
11. [RESUELTO] Enums de metodología en español ("crisis", "riesgo", "positivo",
    "alerta") caían al gris en `badgeClass`.

## Medios

- [RESUELTO] "Sí:" con acento se pintaba como ✗ en 2 vistas.
- [RESUELTO] `monday-sync.js` podía archivar TODAS las tareas si Monday devolvía
  página vacía (guard agregado).
- [RESUELTO] `task_sync.py` truncaba a 1000 filas al leer existentes (revivía tareas
  hechas): límite explícito alto.
- [RESUELTO] PQ fabricado ante paywall/soft-404 (fetch 200 sin artículo): detección de
  marcadores de paywall → fila reintentable.
- [RESUELTO] `media-publications.js` no validaba mes ≤ 12 (fechas US → mes 25).
- [RESUELTO] `drive_contract_intel.py` nunca escribía `renovacion` (el dashboard la lee).
- [PENDIENTE] `wa_monday_tasks._client_label_for_row` solo etiqueta 7 clientes.
- [PENDIENTE] Reglas AUTO del listener WA faltan para ~13 cuentas (grupos nuevos caen a
  00_UNMAPPED).
- [PENDIENTE] `session_quality_analyses` (herramienta manual) se escribe y nadie la lee.
- [PENDIENTE] Milestones dedupean por título redactado por el LLM (posible duplicado
  con reformulación).
- [RESUELTO-NEGOCIO 2026-07-21] "Grupo Cimarrón" = Grupo CIMA: confirmado por el equipo.
  Las 33 publicaciones se atribuyen bien a CIMA; el alias pasó a status `confirmado`.

## Patrón transversal

(a) Tres convenciones de account_id (slug / número / sentinela) con traducciones
duplicadas a mano; (b) fallbacks con valores en rango creíble (40/50/70/80) en vez de
null + status; (c) fallas silenciosas (contadores agregados, catch que tragan errores).
Regla para código nuevo: ante falla → null + status + reintento posible; ante descarte
→ loguear la lista, no el conteo.
