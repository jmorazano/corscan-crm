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
  sin esperar; default de producción 4000; declarada en el envSchema de
  `src/lib/env.ts`).
- Fixtures en `tests/e2e/fixtures/` (generados por `generate.py`,
  commiteados): `contactos.xlsx` y `contactos.csv` (12 filas: AR en 3
  formatos del MISMO número, duplicado interno, 2 inválidos, fila sin
  nombre) + `contactos-5000.xlsx` para el paso cronometrado de SC-001.

## Recetas wa-mock (con 2 mejoras de esta feature, tras dev-guard)

- Inbound "BAJA": `POST /api/dev/wa-mock/inbound` con
  `{ phoneNumberId, from, text: "BAJA" }` (sin cambios).
- Statuses de un saliente (incluida plantilla): `POST /api/dev/wa-mock/status`
  con `{ waMessageId, status: "delivered"|"read"|"failed" }`. Mejora 004:
  el outbox guarda el wamid literal por entrada (`GET /api/dev/wa-mock/outbox`);
  fallback: reconstruir `wamid.mock.out.<bootTag>.<n>`.
- Aprobar plantilla: `POST /api/dev/wa-mock/template-status` con
  `{ wabaId, name, language, event: "APPROVED" }` (el campo es `event`, y
  `wabaId` es obligatorio) + `POST /api/templates/sync`.
- Mejora 004 — wa_id divergente (conduce la reconciliación de research D3):
  el graph mock responde `contacts[0].wa_id = "521" + resto` cuando el `to`
  es `52` + 10 dígitos (emula el legacy MX); para el resto ecoa el `to`.
- ⚠️ El outbox vive en memoria: un reinicio del dev server LO BORRA. La
  verificación anti-duplicados post-reinicio se hace contra la BD (filas
  `message` salientes tipo template por conversación), no contra el outbox.

## Guiones (tests/e2e/)

- `us-cc-1-contactos-import.md`: alta manual + segundo intento duplicado
  avisa; import .xlsx con vista previa → confirmar sin consentimiento
  (bloquea) → con declaración → reporte {creados/actualizados/inválidos};
  re-import idempotente; editar el nombre de un contacto → re-importar →
  nombre intacto y tags unidas; los 3 formatos AR convergen al MISMO
  contacto 549…; import .csv equivalente; paso cronometrado con
  contactos-5000.xlsx (< 2 min, SC-001); camino infeliz: archivo corrupto,
  hoja vacía y encabezados en fila 2.
- `us-cc-2-saliente.md`: plantilla aprobada a contacto importado sin
  conversación → conversación en bandeja, ticks delivered/read vía mock;
  reintento inmediato → 200 con el MISMO messageId (dedup, no re-envía);
  plantilla no aprobada rechaza; contacto del Lab → 403 sandbox_violation;
  respuesta del cliente entra al MISMO contacto (sin duplicado); inbound de
  un número NUEVO deja consentSource='inbound' (visible en GET
  /api/contacts); rama wa_id divergente: contacto MX 52… → tras el envío el
  phone queda 521… (reconciliación).
- `us-cc-3-optout.md`: inbound "BAJA" (y "stop  ") marca la baja y se ve en
  la UI; "me quiero dar de baja" NO la marca; envío individual a dado de
  baja rechaza (y también el sender de plantillas de la conversación con
  ventana cerrada); el dado de baja vuelve a escribir → responderle desde
  la bandeja funciona normal (FR-012) pero sigue excluido; revertir con
  confirmación.
- `us-cc-4-campanas.md`: crear campaña (segmento por tag, preview del
  tamaño; lanzar con segmento vacío → error claro; un contacto SIN
  consentimiento con la tag NO entra al congelado), lanzar, throttling
  observable (pacing) + progreso SSE en vivo; inbound "BAJA" de un
  destinatario pending a MITAD de campaña → skipped(opted_out) y su wamid
  no aparece en el outbox; cupo compartido: con límite 2, un envío
  individual (US2) + campaña de 2 → pausa `daily_limit` tras el primero;
  subir el límite → reanuda; pausa manual SOBRE paused(daily_limit) → el
  ticker no la resucita; cancelar; reinicio del dev server a mitad de
  campaña → retoma sin duplicar (verificado contra la BD: 1 saliente de
  plantilla por conversación; el destinatario ambiguo queda failed
  "interrumpido por reinicio", no re-enviado); fallo de un destinatario
  (mock status failed asíncrono) figura como fallido en el reporte y no
  frena al resto; "respondió" al inyectar inbound del destinatario.
- Regresión: us1 (bandeja), us6 (plantillas ahora con cupo y guard de
  baja), us-mt-2 EXTENDIDO (aislamiento con 2 empresas: campañas, cupo y
  ajustes de envío de A invisibles/inafectables desde B — GET/acciones
  sobre ids ajenos → 404).

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```
(con el dev server APAGADO para el build).
