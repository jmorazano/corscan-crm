# US-CC-1 — Contactos: alta manual + import Excel/CSV (feature 004, US1)

Entorno: quickstart 004 (Docker Postgres + mocks + dev server; fixtures en
`tests/e2e/fixtures/`). Conducido con Playwright como
superadmin@vocero.test sobre "Negocio de Super Admin Local".

## Pasos

1. Contactos → **Nuevo contacto**: nombre "Alta Manual Uno", teléfono en
   formato LOCAL "0351 15 400 0001", etiqueta "manual-test", consentimiento
   tildado → Crear. ✔ queda `5493514000001` (regla AR del 9), tag saneada,
   consent `manual`.
2. Alta duplicada con el MISMO número en OTRO formato ("+54 351 400 0001")
   → ✔ 409 "Ya existe un contacto con ese teléfono".
3. **Importar** → `contactos.xlsx` → vista previa: mapeo por encabezados,
   los 3 formatos AR ya convergidos a `5493516882200`, 10 válidas / 2
   inválidas con motivo. Botón deshabilitado SIN la declaración de
   consentimiento (✔). Tildar → confirmar → reporte **7 creados / 3
   actualizados / 2 rechazados** (fila y motivo).
4. Re-importar el MISMO archivo → ✔ **0 creados / 10 actualizados** — y
   antes se editó el nombre de Cliente Uno ("Nombre Editado Por Operador"):
   ✔ el re-import NO lo pisó; tags fusionadas de las 3 filas
   (clientes-2025 + vip) en UN solo contacto (total=1).
5. Import `contactos.csv` (mismos datos) → ✔ 0/10/2 — cross-formato
   idempotente.
6. Camino infeliz: `corrupto.xlsx` (texto plano renombrado) → ✔ "No se
   pudo leer el archivo…", el wizard sigue usable. (Hoja vacía y
   encabezados en fila 2: cubiertos por unit tests de import-columns.)
7. **SC-001 cronometrado**: `contactos-5000.xlsx` de punta a punta
   (selección → preview → confirmación → reporte 4995/0/5) en
   **23,9 segundos** (límite: 2 minutos). ✔

## Evidencia

Conducido VERDE el 5-sep-2026. Backfills de la migración 0004 verificados
sobre la BD del E2E 003: 6 contactos del Lab marcados `is_test`, 21 con
consentimiento `inbound` histórico, 0 sin clasificar fuera del Lab.
