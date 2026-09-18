# Implementation Plan: Notificaciones push en el celular

**Branch**: `013-push-notifications` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

## Summary

Web Push estándar con claves VAPID por empresa generadas al primer uso
(privada cifrada), suscripciones por dispositivo ligadas a empresa + usuario,
envío en segundo plano desde la ingesta y el handoff, service worker mínimo
(`/sw.js`), página Ajustes → Notificaciones y sincronización silenciosa al
iniciar. Verificable de punta a punta con un push-mock local.

## Technical Context

**Dependencies**: `web-push` 3.6.7 (firma VAPID + cifrado aes128gcm; el
envío HTTP lo hace `fetch` propio con timeout) · `@types/web-push` (dev).
`web-push` va en `serverExternalPackages` (usa módulos de Node).
**Storage**: dos tablas nuevas (`push_vapid_key`, `push_subscription`),
migración `drizzle/0010_*.sql`.
**Testing**: Vitest (payload puro, filtro por modo, poda de 404/410 con
transporte falso) + guion E2E `tests/e2e/013-push.md` con push-mock.
**Constraints**: cero configuración (sin env obligatoria; `VAPID_SUBJECT`
opcional, default `APP_BASE_URL` si es https o `mailto:` neutro); el push
jamás bloquea ni rompe la ingesta; `is_test` excluido.

## Constitution Check

- II Soberanía: nueva categoría 4 (Web Push estándar hacia el push service
  del navegador del usuario, VAPID propio, sin cuenta con terceros; el
  producto funciona completo sin activarla) — enmienda 1.6.0. ✅
- I Seguridad: privada VAPID cifrada (AES-256-GCM), nunca al cliente ni a
  logs; la pública solo a autenticados. ✅
- III Multi-tenancy: ambas tablas con `organization_id` NOT NULL; claves
  por empresa; envíos filtrados por empresa. ✅
- IV Idempotencia: alta por `endpoint` único (upsert); poda idempotente. ✅
- Sandbox: `is_test` no notifica. ✅

## Diseño

### Servidor (`src/server/push/`)

- `payload.ts` (puro): `buildInboundPayload`, `buildHandoffPayload`,
  `buildTestPayload`, `truncateBody` (120), `shouldNotifyInbound(mode,
  conversation)`, `isGoneStatus`.
- `keys.ts`: `getOrCreateVapidKeys(organizationId)` (generate → insert
  `onConflictDoNothing` → re-select; privada con `encryptSecret`).
- `subscriptions.ts`: `upsertSubscription`, `updateSubscriptionMode`,
  `removeSubscription`, `listSubscriptions(org, {userId?})`,
  `deleteByEndpoint(org, endpoint)`, `touchSubscriptions`.
- `notify.ts`: `sendPush(targets, keys, subject, payload, {transport})` con
  `webpush.generateRequestDetails` + `fetch` (10 s, sin `Content-Length`
  manual); `notifyOrganization(org, payload, filter)` poda 404/410.
- `events.ts`: `notifyInboundMessage` (background, filtro por modo, salta
  `is_test`), `notifyHandoff` (todas), `sendTestNotification(org, user)`.

### API

- `GET /api/push/vapid` · `GET/POST/PATCH/DELETE /api/push/subscriptions` ·
  `POST /api/push/test` (todas `withAuth`, Zod; endpoint `https:` salvo
  mocks).
- Dev: `POST/GET/DELETE /api/dev/push-mock` (`mockGuard`; `?status=410`).

### Cliente

- `public/sw.js`: `push` → `showNotification(title, {body, tag, renotify,
  data.url, icon})`; `notificationclick` → enfocar cliente + `postMessage`
  `{type:"push-navigate", url}` (o `openWindow`); `pushsubscriptionchange`
  → re-suscribir y `POST`.
- `src/lib/push-client.ts`: soporte, iOS/standalone, `urlBase64ToUint8Array`,
  registro del SW, suscribir/desuscribir.
- `src/components/push/use-push.ts`: estado + `enable(mode)` (pide permiso
  PRIMERO, en el gesto), `disable`, `setMode`, `sendTest`, `refresh`.
- `src/components/settings/notifications-client.tsx` + página
  `/settings/notifications`; pestaña en `settings-nav`; ítem
  «Notificaciones» en la hoja «Más».
- `AppShell`: registra el SW, re-sincroniza si hay permiso, escucha
  `push-navigate`, `setAppBadge(unread)`.

### Hooks de dominio

- `ingest.ts`: tras publicar `message.new` → `notifyInboundMessage(...)`.
- `pipeline.ts` `applyHandoff`: tras publicar → `notifyHandoff(...)`.

## Project Structure

```text
specs/013-push-notifications/{spec,plan,tasks}.md
src/lib/db/schema.ts (+2 tablas) · drizzle/0010_*.sql
src/server/push/{payload,keys,subscriptions,notify,events}.ts
src/server/dev/push-mock-state.ts · src/app/api/dev/push-mock/route.ts
src/app/api/push/{vapid,subscriptions,test}/route.ts
public/sw.js · src/lib/push-client.ts · src/components/push/use-push.ts
src/components/settings/notifications-client.tsx
src/app/(app)/settings/notifications/page.tsx
src/components/settings/settings-nav.tsx · src/components/app-shell.tsx
src/server/inbox/ingest.ts · src/server/ai/pipeline.ts
next.config.ts · src/lib/env.ts · .env.example
tests/unit/{push-payload,push-notify}.test.ts · tests/e2e/013-push.md
```

## Complexity Tracking

Sin violaciones tras la enmienda 1.6.0.
