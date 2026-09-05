# Quickstart E2E — 004 Contactos importados + Campañas

El entorno local es el MISMO de la feature 003
([specs/003-multitenancy/quickstart.md](../003-multitenancy/quickstart.md)):
Docker Postgres (`docker-compose.dev.yml`), bloque dev de `.env` (mocks
WA/IA activados, `SUPER_ADMIN_EMAILS=superadmin@vocero.test`), dev server
vía `.claude/launch.json` (`vocero-dev`, puerto 3000). Gotcha vigente:
JAMÁS correr `pnpm build` con el dev server vivo (memoria
next-build-vs-dev-server).

## Extra de esta feature

- Deps nuevas: `pnpm add read-excel-file papaparse libphonenumber-js && pnpm add -D @types/papaparse`
- `.env` dev: `CAMPAIGN_PACE_MS=200` (pacing corto para observar throttling
  sin esperar; default de producción 4000).
- Fixtures en `tests/e2e/fixtures/`: `contactos.xlsx` y `contactos.csv`
  (mismas ~12 filas: válidas AR en 3 formatos — "0351 15 x", "+54 351 x",
  "549351x" —, un duplicado interno, un teléfono inválido, una fila sin
  nombre). El `.xlsx` se genera una vez con el script
  `tests/e2e/fixtures/generate.mjs` y se commitea (binario chico).

## Recetas wa-mock (ya existentes, sin cambios del mock)

- Inbound "BAJA": `POST /api/dev/wa-mock/inbound` con
  `{ phoneNumberId, from, text: "BAJA" }`.
- Statuses de un saliente (incluida plantilla): `POST /api/dev/wa-mock/status`
  con `{ waMessageId: "wamid.mock.out.<bootTag>.<n>", status: "delivered"|"read"|"failed" }`
  (el wamid sale del outbox: `GET /api/dev/wa-mock/outbox`).
- Aprobar plantilla: `POST /api/dev/wa-mock/template-status`
  `{ name, language, status: "APPROVED" }` + `POST /api/templates/sync`.

## Guiones (tests/e2e/)

- `us-cc-1-contactos-import.md`: alta manual; import .xlsx con vista previa
  → confirmar sin consentimiento (bloquea) → con declaración → reporte
  {creados/actualizados/inválidos}; re-import idempotente; los 3 formatos AR
  convergen al MISMO contacto 549…; import .csv equivalente.
- `us-cc-2-saliente.md`: plantilla aprobada a contacto importado sin
  conversación → conversación en bandeja, ticks delivered/read vía mock;
  reintento no duplica; plantilla no aprobada rechaza; respuesta del
  cliente entra al MISMO contacto (sin duplicado).
- `us-cc-3-optout.md`: inbound "BAJA" (y "stop  ") marca la baja y se ve en
  la UI; "me quiero dar de baja" NO la marca; envío individual a dado de
  baja rechaza; revertir con confirmación; pendientes de campaña →
  skipped.
- `us-cc-4-campanas.md`: crear campaña (segmento por tag, preview del
  tamaño), lanzar, throttling observable (pacing) + progreso SSE en vivo;
  bajar el límite a 2 → pausa automática `daily_limit` → subirlo →
  reanuda; pausa/reanudar manual; cancelar; reinicio del dev server a
  mitad de campaña → revive sin duplicar (verificar outbox: 1 mensaje por
  destinatario); fallo de un destinatario (mock status failed) no frena al
  resto; "respondió" al inyectar inbound del destinatario.
- Regresión: us1 (bandeja), us6 (plantillas), us-mt-2 (aislamiento con 2
  empresas — campañas de la empresa A invisibles e inafectables desde B).

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```
(con el dev server APAGADO para el build).
