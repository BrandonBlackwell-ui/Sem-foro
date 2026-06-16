# Semáforo Blackwell — Guía rápida para almas perdidas

> Para quien herede este proyecto (incluido tú-mismo dentro de tres semanas).
> Última actualización: 24 de abril de 2026 · v2.4

## Qué es esto

Un dashboard de una sola página HTML (`Semaforo_Blackwell_v24.html`) que muestra el estado de las 28 cuentas activas de Blackwell Strategy contra los KPIs definidos en el playbook operativo de Fabiola. Vive en tu computadora — sin servidor, sin login, sin build step. Se abre con doble click en el navegador.

La idea de fondo: que Humberto y Fabiola en quince minutos vean *qué cuentas están bien, qué cuentas necesitan atención esta semana, y por qué*. Y que un consultor en su primera semana pueda mirar el modal de su cuenta y entender el contexto sin tener que leer 200 mensajes de WhatsApp.

## Por qué existe

Blackwell crecía sin un sistema único de evaluación de cuentas. La info estaba dispersa en Drive, WhatsApp, decks, y la cabeza de Fabiola. Esto generó tres problemas concretos:

- Cuentas en crisis se detectaban tarde (a veces demasiado tarde).
- Cuentas saludables no recibían oportunidad de upsell.
- Onboarding de consultores nuevos era artesanal — cada cuenta era un universo aparte.

El semáforo es la respuesta: una vista unificada con score, riesgo, oportunidad y bitácora por cuenta.

## Cómo está armado

El dashboard tiene 6 pestañas principales:

1. **Briefing** — gauge global, top riesgos, top oportunidades, master table con filtros.
2. **Cuentas** (sólo consultor) — listado anonimizado, con una pestaña hija "Checklist Semanal".
3. **Equipo** — vista de carga del staff, validador de nombres de archivo.
4. **Metodología** — reproduce el playbook verbatim.
5. **Señales** — taxonomía de SC (satisfacción del cliente).
6. **Dirección** (sólo liderazgo) — needs-attention panel con cuentas en peligro.

El selector de rol (arriba a la derecha) cambia entre `consultor`, `liderazgo` y `leadership`. Cada rol oculta cosas que no le tocan ver.

## Cómo se calcula el score

Pesos vigentes (v1.4 en adelante, salud financiera fuera del cálculo hasta tener plantilla canónica de facturación):

```
Global = CO × 0.375 + PQ × 0.25 + SC × 0.375
```

Donde CO es Cumplimiento Operativo, PQ es Performance/Calidad, SC es Satisfacción del Cliente. Umbrales:

- ≥80 verde · ≥65 amarillo · ≥45 naranja · <45 rojo · null gris (cuenta pausada / concluida / evento único)

## Honestidad de datos (v2.3+)

Cada modal de cuenta tiene un banner amarillo arriba que indica, campo por campo, de dónde vino el texto:

- **REAL** — verificado en un PDF/deck/reporte específico de Drive (citado por nombre de archivo).
- **INFERIDO** — texto generado a partir de WhatsApp + nombres de archivo. Útil pero no canónico.
- **FALTA** — sin fuente documental capturada.
- **ACTUALIZADO** — tú pegaste el dato correcto y se guardó local.

Click en cualquier etiqueta abre un campo de texto. Pegas el dato real, le das Guardar, y queda almacenado en localStorage de tu navegador. El texto inferido original se conserva colapsado por si quieres compararlo.

Esto fue la respuesta a la falla de MAJA: el dashboard mostraba "cero Tier A documentadas" cuando el reporte real era 20 publicaciones, 50% Tier 1, +84M alcance. La inferencia se hizo sobre chats; el deck con los KPIs reales nunca se leyó. Ahora cualquier inferencia es visible y editable.

## Sync con Drive

**Estado actual: manual con apoyo de búsqueda en Drive en cada actualización.**

El proceso al hacer una nueva versión:

1. Buscar en Drive todas las carpetas con sufijo `/proyecto concluido`, `/Pausa`, `/Evento único`, `/terminanción anticipada`.
2. Comparar contra el JS array `ACCOUNTS` en el HTML (función `id`, `status`, `phase`).
3. Para cada discrepancia, actualizar el código.

A 24-abr-26 hay 2 cuentas con sufijo `/proyecto concluido` (Aduanas e IDlayr) y ambas están reflejadas. Fabiola flaggeó que Aduanas estaba mal — la causa fue que la reclasificación en Drive del 22-23 abril no se había sincronizado al tablero.

**Pendiente:** automatizar este sync. La forma natural sería un script que lee la API de Drive una vez al día y emite un JSON `accounts_status.json` que el HTML carga. No está hecho.

## Versiones — qué cambió cuándo

- **v1.0** — primer corte sintético, 28 cuentas, score con SF dentro.
- **v1.4** — SF fuera del score por decisión de Humberto; pesos reescalados a 37.5/25/37.5.
- **v1.5** — gauge rediseñado, sparklines, master table con filtros, needs-attention panel.
- **v2.0** — capa tri-density (briefing / detalle).
- **v2.2** — consolidación de 13 tabs a 6, density switcher fuera, layout editorial.
- **v2.3** — banner de honestidad, datos reales de PDFs, overrides en localStorage, SF fuera del display del modal.
- **v2.4** — Aduanas marcada concluida, Drive re-verificado, header con corte 24-abr.

## Limitaciones conocidas

- **No hay sync automático con Drive**. Cualquier cambio de status en una carpeta hay que reflejarlo manualmente en el código.
- **localStorage es por navegador**. Si Esteban edita un override en su Chrome, Fabiola no lo ve en el suyo. Si necesitan compartir overrides, hay que exportar/importar manualmente o subir un nuevo HTML.
- **El sandbox no permite sobre-escribir el archivo en sitio**. Cada nueva versión sale como `Semaforo_Blackwell_vN.html` al lado del anterior. Tú decides cuál borrar.
- **No hay export del estado**. Lo que ves es lo que hay; no se persiste a Drive ni a un backend.

## Archivos en este folder

```
Blackwell/
├── Semaforo_Blackwell_v24.html  ← versión actual (úsala)
├── Semaforo_Blackwell.html       ← versión anterior, déjala o bórrala
├── README_Semaforo.md            ← este archivo
├── PROYECTOS BLACKWELL 2026/     ← raíz Drive sincronizada
└── data/                          ← assets internos del dashboard
```

## Cómo extender

Para agregar una cuenta nueva:

1. Crear el folder `XX. NombreCuenta` dentro de Drive `PROYECTOS BLACKWELL 2026`.
2. En el HTML, agregar entrada en el array `ACCOUNTS` (alrededor de la línea 2870) con `id`, `name`, `status`, `phase`, `tier`, scores `co/sf/pq/sc`, y los campos narrativos `scope/committed/delivered/quality/satisfaction/risk/opportunity`.
3. Añadir `dataSource` con qué campos están REAL/INFERIDO citando archivos de Drive específicos.
4. Verificar con `node verify_v23.js` que la cuenta abre, muestra banner de honestidad, y el override round-trip funciona.

Para corregir un dato erróneo sin tocar código: abrir el modal, click en la etiqueta del campo (REAL/INFERIDO), pegar el texto correcto, Guardar. Queda local.

## Quién contestar si algo se rompe

- Esteban Hernández — `esteban.hernandez@blackwellstrategy.com` — owner del dashboard.
- Fabiola — operativa diaria, define playbook.
- Humberto — dirección, define umbrales y prioridades.

---

*Si esto te pareció útil, déjale el favor pagado a la siguiente alma.*
