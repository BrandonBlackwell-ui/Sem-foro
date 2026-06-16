# Cómo correr el sync manualmente

Guía de referencia rápida para ejecutar el pipeline de Proyecto Blackwell.

---

## Requisitos previos

Antes de correr cualquier comando, asegúrate de estar en la carpeta correcta:

```powershell
cd "C:\Users\Emiliano Guillen\Desktop\QO\Blackwell\blackwell_migration\Blackwell\scripts\sync"
```

---

## Comandos del sync

### Sync diario (uso normal)

```powershell
python main_sync.py
```

- Detecta solo las cuentas con archivos nuevos o modificados en Drive desde el último sync
- Llama a Claude solo para esas cuentas
- Rápido: ~2–5 minutos
- **Usar este todos los días**

---

### Sync completo (baseline)

```powershell
python main_sync.py --mode baseline
```

- Crawlea y analiza las 39 cuentas sin excepción
- Tarda ~8–10 minutos
- **Cuándo usarlo:**
  - Primera vez que se corre el sistema
  - Si el `accounts_status.json` se corrompió o se borró
  - Si pasaron más de 7 días sin correr el sync

---

### Hotfix — re-analizar cuentas específicas

```powershell
python main_sync.py --mode hotfix --accounts 19 20 21
```

- Crawlea y fuerza análisis con Claude **solo** para los números de cuenta indicados
- Ignora si hubo o no cambios en Drive (útil para recuperar cuentas que fallaron)
- Tarda ~1–3 minutos dependiendo de cuántas cuentas

**Cuándo usarlo:**

El caso más común es cuando el servidor de Anthropic falla durante el sync automático y algunas cuentas quedan sin análisis de Claude. Puedes verlo en la terminal: aparece `ERROR analizando XX. NOMBRE: Error code: 529`.

En ese caso, anota los números de las cuentas que fallaron y corre:

```powershell
python main_sync.py --mode hotfix --accounts 19 20 35
```

Reemplaza `19 20 35` con los números reales que fallaron.

> **¿Por qué existe esta opción?**
> El sync normal solo llama a Claude cuando detecta archivos nuevos en Drive.
> Si ya corriste el sync hace poco y Drive no cambió, el sistema diría "sin cambios"
> y no re-analizaría nada aunque le pidas cuentas específicas.
> El hotfix fuerza el análisis aunque no haya delta, precisamente para estos casos de rescate.

---

### Prueba sin escribir nada (dry-run)

```powershell
python main_sync.py --dry-run
```

- Simula todo el flujo pero no escribe ni guarda ningún archivo
- Útil para verificar que la conexión con Drive funciona

---

## Ver el dashboard en local

```powershell
cd "C:\Users\Emiliano Guillen\Desktop\QO\Blackwell\blackwell_migration\Blackwell\dashboard"
npm run dev
```

Abrir en el navegador: **http://localhost:5174**

> El dashboard se actualiza automáticamente cuando el sync copia los datos nuevos
> a `dashboard/public/data/`. No es necesario reiniciar el servidor de desarrollo.

---

## Flujo completo de un día normal

```
1. python main_sync.py          ← sync delta (~3 min)
2. Abrir http://localhost:5174  ← ver resultados
```

Si alguna cuenta falló con error 529:

```
3. python main_sync.py --mode hotfix --accounts XX YY ZZ
```

---

## Resumen de costos aproximados

| Operación | Tiempo | Costo Claude |
|---|---|---|
| Sync delta (sin cambios) | ~30 seg | $0.00 |
| Sync delta (con cambios, ~5 cuentas) | ~2–3 min | ~$0.01 USD |
| Hotfix (7 cuentas) | ~1–2 min | ~$0.02 USD |
| Baseline completo (39 cuentas) | ~8–10 min | ~$0.10 USD |

---

## Números de cuenta de referencia

| # | Nombre |
|---|--------|
| 01 | TURBOFIN |
| 02 | MAJA |
| 05 | CREDIX |
| 06 | RR |
| 07 | APOLLO |
| 08 | ULDIS |
| 09 | GRUPO AZVI |
| 12 | MTV |
| 13 | GRUPO CIMA |
| 14 | DALINDE |
| 17 | IRUGAMI |
| 18 | STPRM |
| 19 | Casa Mata |
| 20 | VERACRUZ |
| 21 | Nuvoil |
| 24 | GICSA |
| 25 | Andy |
| 26 | BERNARDO V |
| 27 | CUERNAVACA |
| 28 | QUERETARO |
| 29 | COAST OIL |
| 30 | ERICK RUBI |
| 31 | SASIL |
| 32 | COJAB |
| 33 | NEZA |
| 34 | SUPPLY_PAY |
| 35 | PEPE AGUILAR |
| 37 | LEADSALES |
| 38 | KARPOWERSHIP |
| 39 | ISMERELY |
| 40 | AUSTRIA |
