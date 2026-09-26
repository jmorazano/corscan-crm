# Tasks — 023 Instagram Direct

Estado durable del loop. `[x]` hecho y verificado.

## Fase 0 — Base
- [x] T001 Enmienda constitución 1.8.0 (II cat. 1, VIII, restricciones)
- [x] T002 spec.md + plan.md
- [x] T003 env `INSTAGRAM_*` + `isInstagramConfigured`
- [x] T004 `src/lib/oauth-state.ts` extraído de Google
- [x] T005 Adaptador `src/lib/instagram/client.ts`
- [x] T006 Puros: `webhook.ts`, `messaging.ts`
- [x] T007 Puro: `signed-request.ts`

## Fase 1 — Datos
- [x] T010 Schema: `instagram_integration`, `contact.channel`, `contact.ig_username`, kinds; ids `igint`
- [x] T011 Migración 0019 + aplicar en local

## Fase 2 — Servidor
- [x] T020 `server/instagram/integration.ts` (conectar, vista, desconectar, renovar, ticker)
- [x] T021 `inbox/ingest.ts`: núcleo común `ingestInboundCore` + `getOrCreateConversation(kind)`
- [x] T022 `inbox/media.ts`: fuente `wa` | `url`
- [x] T023 `server/instagram/ingest.ts` (mensaje, eco, borrado, visto, reacción, postback)
- [x] T024 `server/instagram/send.ts` + rama en `sendText`
- [x] T025 Guardas: campañas, `sendTemplateCore`, POST /api/conversations, booking label, prompt por canal
- [x] T026 DTOs (`kind`, `channel`, `igUsername`) + filtro por canal en `/api/conversations`

## Fase 3 — Rutas
- [x] T030 `/api/integrations/instagram` (GET/DELETE), `/connect`, `/callback`; índice de integraciones
- [x] T031 `/api/webhooks/instagram` (GET verify, POST firmado) + deauthorize + data-deletion

## Fase 4 — UI
- [x] T040 Tarjeta + página Integraciones → Instagram
- [x] T041 Bandeja: ícono de canal, filtro, encabezado @usuario, composer por ventana de Instagram, hilo (eliminado, «Desde Instagram», adjuntos)
- [x] T042 Contactos/ficha/pipeline: handle en vez de teléfono; sin «Enviar plantilla» para Instagram

## Fase 5 — Mocks y pruebas
- [x] T050 ig-mock (OAuth, graph, CDN, inbound firmado, outbox, knobs)
- [x] T051 Unit: webhook, messaging, signed-request, oauth-state, client (errores/redacción), guardas
- [x] T052 Gate técnico verde
- [x] T053 Guion `tests/e2e/023-instagram-direct.md` conducido (feliz + infeliz)

## Fase 6 — Producción y Meta
- [x] T060 CLAUDE.md + `.env.example` + `docs/integraciones/instagram.md`
- [x] T061 Política de privacidad y eliminación de datos (dronebiz)
- [x] T062 Merge + deploy + migración aplicada
- [ ] T063 Panel de Meta: redirect URI, callbacks, webhook (el dueño pega el verify token), tester
- [ ] T064 Railway: `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` (el dueño pega el secreto)
- [ ] T065 Prueba real con `@corscan.ing` (llamadas exitosas de ambos permisos)
- [x] T066 Borrador del App Review (textos + guion del video) listo para que el dueño envíe

## Fase 7 — Feedback del dueño (26-sep-2026)
- [x] T070 Instagram es un CANAL: pasa de Integraciones a Ajustes → Instagram (al lado de WhatsApp); `/integrations/instagram` redirige; el callback OAuth vuelve a Ajustes (su URL en Meta no cambia)
- [x] T071 Historial: Conversations API (20 últimos por conversación, 60 días) con las reglas de 017; migración 0020 (`instagram_integration.history_*`); al conectar, botón y ticker para cuentas `idle`
- [x] T072 Unit + E2E del historial (guion pasos 20–24)
- [ ] T073 Deploy + importación automática del historial de @corscan.ing en producción
