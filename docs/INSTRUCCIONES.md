# Semáforo Blackwell · Instrucciones de uso

Hola Fabiola, este zip tiene todo lo que necesitas para usar el dashboard del Semáforo en tu computadora. No necesitas instalar nada — el dashboard es un archivo HTML autocontenido que se abre con doble click.

---

## 1. Cómo abrir el dashboard

1. **Descomprime el zip** en una carpeta de tu computadora (por ejemplo, `Documentos/Blackwell_Dashboard/`).
2. Encontrarás el archivo **`Semaforo_Blackwell_v36.html`**.
3. Haz **doble click** sobre él.
4. Tu navegador (Chrome, Safari, Edge, Firefox — cualquiera) lo abrirá automáticamente.

Eso es todo. No hay servidor, no hay login, no hay internet requerido. El archivo tiene toda la información del último corte ya integrada adentro.

---

## 2. Qué verás al abrir

- **Splash screen** la primera vez del día con resumen rápido del portafolio + frase del día. Se cierra con el botón "Ver dashboard →" o presionando Escape.
- **Velocímetro** con el score global del portafolio.
- **Decisiones requeridas** divididas por célula (A: Marisol · B: Johanna).
- **Master table** con las 36 cuentas. Click en cualquier fila abre el detalle.
- **Tabs** en la parte de abajo: Briefing · Equipo · Metodología · Auditoría.
- **Filtros rápidos** arriba de la tabla (Rojas, Naranjas, Célula A, Célula B, etc.).

---

## 3. Tu día a día

**Cada mañana** abres el HTML y revisas:
1. El splash con el resumen.
2. La tabla maestra con los colores actualizados.
3. Las decisiones requeridas por célula (lo más urgente).

**Click en cualquier cuenta** abre un modal con:
- Análisis del Drive (lo que el cron leyó la última vez)
- Indicadores CO/PQ/SC con el detalle por item
- Histórico de actividad reciente
- Botón "Ver checklist por item" que muestra archivo por archivo lo que el cron encontró

---

## 4. ¿Cuándo se actualiza?

El dashboard se regenera automáticamente cuando el cron diario lee el Drive (Esteban lo configura). Cuando hay datos frescos, recibirás un nuevo archivo `Semaforo_Blackwell_v36.html` por WhatsApp o Slack. **Lo único que tienes que hacer es reemplazar el archivo viejo por el nuevo en tu carpeta.**

Mientras no se reemplace, el dashboard sigue mostrando los datos del último corte. La fecha del último sync aparece en el header arriba ("Sync: hace X horas").

---

## 5. Si algo no se ve bien

- **No abre / página en blanco**: verifica que abriste el archivo `.html`, no algún otro. Doble click directo desde el explorador de archivos.
- **No carga la información**: el archivo puede estar corrupto, pídele a Esteban que te mande otro.
- **El score está raro / cuenta perdida**: revisa la sección "Cómo funciona" más abajo para entender por qué.

---

## 6. Personalización

Arriba a la derecha hay un botón **⚙ Config** que te permite:
- Cambiar entre tema **claro y oscuro**.
- Cambiar la **vista** entre Liderazgo / Resumen ejecutivo / Consultor.
- Volver a mostrar el splash del día (botón "Mostrar resumen del día").
- Borrar overrides locales si llegaste a sobrescribir algún score manualmente.

Lo que cambies se guarda en tu navegador, no afecta a nadie más.

---

## 7. Documentación adicional

- **`ARQUITECTURA.md`** — Cómo funciona el sistema completo (frontend + backend). Léelo si quieres entender qué pasa atrás del telón.
- **`Estructura_carpetas_Blackwell.md`** — La convención de nombres para las subcarpetas en Drive. Importante para que el cron pueda leer todo correctamente.

---

## 8. Quién mantiene esto

**Esteban Hernández** — esteban.hernandez@blackwellstrategy.com

Si algo no funciona o necesitas un cambio, mándame mensaje. El dashboard sigue evolucionando.
