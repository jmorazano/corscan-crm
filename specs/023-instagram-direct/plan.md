# Plan — 023 Instagram Direct en la Bandeja

**Spec**: [spec.md](spec.md) · **Constitución**: 1.8.0 (enmendada en esta feature)

## Constitution Check

| Principio | Cómo se cumple | ✓ |
|---|---|---|
| I. Seguridad | Token de Instagram cifrado AES-256-GCM (`instagram_integration`), jamás en DTOs ni logs (`redactValue` en todo error del adaptador); `state` OAuth firmado con secreto derivado propio; webhook con firma obligatoria | ✅ |
| II. Soberanía | Categoría 1 enmendada (1.8.0): Instagram Messaging API opcional por empresa, adaptador dedicado `src/lib/instagram/`, habilitado por env del operador, el instalador no lo necesita | ✅ |
| III. Multi-tenancy | Tabla nueva con `organization_id` NOT NULL + unique; todas las queries con `scoped()`; webhook enruta por `ig_user_id` unique de instancia; dedup de `mid` por tenant | ✅ |
| IV. Idempotencia | `message_org_wamid_uq` reutilizado con el `mid`; ecos y reintentos no duplican; «visto» monotónico; migración aditiva | ✅ |
| V/IX. Verificación | Unit de lo puro + guion E2E con ig-mock (feliz + infeliz) + prueba real con `@corscan.ing` en Standard Access | ✅ |
| VIII. Foco | Solo mensajes directos iniciados por el cliente; sin publicar, comentarios ni envíos iniciados | ✅ |
| Sandbox | `is_test` nunca es Instagram; `sendText` conserva la aserción dura | ✅ |

## Decisiones

- **D1 — Instagram Login** (graph.instagram.com, token de usuario de Instagram
  de 60 días). Sin Página de Facebook. Scopes: solo los 2 del App Review.
- **D2 — Identidad del contacto**: `contact.phone = 'ig:<IGSID>'` (patrón del
  contacto sintético del Entrenador) + `contact.channel` (`whatsapp`
  default | `instagram`) + `contact.ig_username`. `normalizeToWaId` ya
  rechaza `ig:…`, así que import, alta manual, backfill, API pública e
  historial quedan protegidos sin tocarlos. Las exclusiones explícitas:
  campañas (`eligibilityWhere`/`isStillEligible`), `sendTemplateCore` y el
  alta de conversación con plantilla.
- **D3 — Conversación**: `conversation.kind = 'instagram'` (texto, sin enum
  de BD). Una conversación real por contacto: el unique parcial existente
  alcanza porque el contacto de Instagram es otro contacto.
- **D4 — Mensaje**: `message.wa_message_id` guarda el `mid` (id del
  proveedor, unique por empresa). Ecos → `source='phone'` (la UI dice «Desde
  Instagram» cuando la conversación es de Instagram). Borrado →
  `type='deleted'`, texto/resumen/binario fuera.
- **D5 — Envío**: sale primero a Instagram y se inserta después (como
  WhatsApp), con status `sent` (Instagram no manda «entregado»). Si el eco
  llegó antes, el insert choca con el `mid` y se REASIGNA la fila a `cloud`
  (`message.updated`), así nunca queda duplicado ni mal etiquetado.
  Texto > 1.000 bytes → varios mensajes (`splitInstagramText`).
- **D6 — Ventana**: 24 h estándar; 24 h–7 d solo personas con
  `HUMAN_AGENT`; el agente de IA recibe `window_closed` → handoff
  «ventana» (camino existente de `deliverReply`).
- **D7 — Adjuntos**: `processInboundMedia` pasa a recibir una FUENTE
  (`{kind:'wa', mediaId}` | `{kind:'url', url}`); imagen y audio de
  Instagram reutilizan 020 completo; el binario se baja SIN token con
  allowlist de hosts de Meta/Instagram.
- **D8 — Token**: renovación si le quedan < 15 días y tiene ≥ 24 h, antes de
  cada envío y con un ticker diario en proceso (`instrumentation`). Error de
  autorización → `reconnect_required`.
- **D9 — Webhook**: ruta fija `/api/webhooks/instagram` (sin segmento
  secreto): la firma `X-Hub-Signature-256` es OBLIGATORIA (secreto de la app
  de Instagram; se acepta también el de la app de Meta). Handshake GET con
  `META_WEBHOOK_VERIFY_TOKEN`. Callbacks `…/instagram/deauthorize` y
  `…/instagram/data-deletion` con `signed_request`.
- **D10 — State OAuth**: helper extraído a `src/lib/oauth-state.ts`
  (compartido con Google); Instagram firma con `BETTER_AUTH_SECRET:instagram`
  para que un state de Google no sirva acá.

## Estructura

```
src/lib/instagram/client.ts       adaptador (OAuth, /me, suscripción, perfil, envío, CDN)
src/lib/instagram/webhook.ts      parseo Zod + normalización de eventos (puro)
src/lib/instagram/messaging.ts    ventana, partir texto, teléfono sintético, nombre (puro)
src/lib/instagram/signed-request.ts  signed_request de Meta (puro)
src/lib/oauth-state.ts            state firmado compartido
src/server/instagram/integration.ts  fila cifrada, conectar/desconectar, renovar, ticker
src/server/instagram/ingest.ts    eventos → embudo común (contacto, conversación, ecos, borrado, visto)
src/server/instagram/send.ts      envío por Instagram (ventana, partir, reasignar ecos)
src/app/api/integrations/instagram/{route,connect,callback}
src/app/api/webhooks/instagram/{route,deauthorize,data-deletion}
src/app/api/dev/ig-mock/…         OAuth + graph + CDN + inbound firmado + outbox + knobs
src/app/(app)/integrations/instagram/page.tsx + components/integrations/instagram-client.tsx
drizzle/0019_instagram_direct.sql
```

## Riesgos

- El formato real de `/me` (`user_id` vs `id`) y de la respuesta del token:
  el adaptador acepta ambas formas; se confirma en la prueba real (SC-003).
- Standard Access: el cliente que escribe también debe tener rol en la app
  (tester de Instagram) para la prueba real — lo hace el dueño.
