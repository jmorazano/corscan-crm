# Tasks: Notificaciones push en el celular

**Input**: specs/013-push-notifications/spec.md + plan.md (dos tablas nuevas,
migración 0010; dependencia `web-push`; enmienda constitucional 1.6.0).

## Phase 1: Fundaciones

- [x] T001 Enmienda II (categoría 4: Web Push estándar, v1.6.0) en .specify/memory/constitution.md
- [x] T002 [P] Tablas `push_vapid_key` y `push_subscription` en src/lib/db/schema.ts +
      migración drizzle/0010_solid_hitman.sql
- [x] T003 [P] `web-push` en package.json + `serverExternalPackages` en next.config.ts;
      `VAPID_SUBJECT` opcional en src/lib/env.ts y .env.example
- [x] T004 [P] Helpers puros en src/server/push/payload.ts + tests/unit/push-payload.test.ts (8)

## Phase 2: US1 — Activar avisos en este dispositivo

- [x] T005 [US1] Claves VAPID por empresa (privada cifrada, subject derivado) en src/server/push/keys.ts
- [x] T006 [US1] Suscripciones (upsert por endpoint, modo, baja, listar, poda, uso) en
      src/server/push/subscriptions.ts
- [x] T007 [US1] Rutas `GET /api/push/vapid`, `GET/POST/PATCH/DELETE /api/push/subscriptions`
      (endpoint https salvo mocks), `POST /api/push/test` en src/app/api/push/*/route.ts
- [x] T008 [US1] Service worker mínimo (push, notificationclick → postMessage/openWindow,
      pushsubscriptionchange) en public/sw.js + cliente en src/lib/push-client.ts
- [x] T009 [US1] Hook `usePush` (permiso primero, en el gesto) en src/components/push/use-push.ts +
      página en src/components/settings/notifications-client.tsx y
      src/app/(app)/settings/notifications/page.tsx + pestaña en settings-nav.tsx +
      ítem «Notificaciones» en la hoja «Más», registro del SW, re-sincronización
      silenciosa, `push-navigate` y badge del ícono en src/components/app-shell.tsx

## Phase 3: US2 — Aviso de entrante que abre la conversación

- [x] T010 [US2] `sendPush` (web-push firma/cifra, `fetch` propio con timeout, sin
      Content-Length manual, transporte inyectable) en src/server/push/notify.ts +
      tests/unit/push-notify.test.ts (2)
- [x] T011 [US2] `notifyOrganization` (poda 404/410 + uso), `notifyInboundMessage`
      (modo, `is_test`), `notifyHandoff`, `sendTestNotification` en src/server/push/events.ts +
      hooks en src/server/inbox/ingest.ts y src/server/ai/pipeline.ts (siempre en segundo plano)
- [x] T012 [US2] Push-mock (`src/server/dev/push-mock-state.ts` +
      src/app/api/dev/push-mock/route.ts, `?status=410`) tras `mockGuard`

## Phase 4: Polish & verificación reforzada

- [x] T013 Guion E2E tests/e2e/013-push.md ejecutado en verde (17-sep-2026): VAPID por
      empresa estable, alta/modo/baja por API con suscripción falsa (P-256 real) al
      push-mock, entrante → entrega aes128gcm + vapid, modo handoff 0 → 1, escalado
      «cliente» → aviso, 410 → poda, prueba 1/1, UI infeliz (permiso bloqueado), móvil
- [x] T014 Gate técnico completo + CLAUDE.md (fila del mapa) + memoria
