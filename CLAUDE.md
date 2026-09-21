# Vocero CRM — Guía para Claude

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. Una instancia = un operador con una o más
empresas (multitenancy real desde la feature 003). Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio —
el caso típico: una agencia adaptando Vocero para un cliente.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (tema oscuro propio,
acento `#25D366`) · **PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp (Graph API) | `src/lib/meta/` (cliente único) + `src/server/whatsapp/` |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| UI | `src/components/` + `src/app/(app)/` |
| Administración (super admin: empresas/usuarios) | `src/server/admin/` + `src/app/api/admin/` + `src/app/(app)/admin/` (gate: `SUPER_ADMIN_EMAILS` + `withSuperAdmin`) |
| Config de IA por empresa (token cifrado + modelos) | `src/server/ai/credentials.ts` + `/api/settings/ai` + Ajustes → Inteligencia artificial |
| Campañas (runner, cupo 24h, elegibilidad) | `src/server/campaigns/` (runner at-most-once + quota con reserva + recipients) + `/api/campaigns` + `src/components/campaigns/` |
| Import de contactos / tags / opt-out | `src/server/contacts-import.ts` + `src/lib/phone.ts` (wa_id, regla AR del 9) + `src/lib/import-columns.ts` + wizard en `src/components/contacts/` |
| Plantillas de WhatsApp (alta, sync, borrado, preview/variables) | `src/server/whatsapp/templates.ts` + `src/lib/template-body.ts` (reglas puras compartidas con el editor) + `/api/templates` + `src/components/settings/templates-client.tsx` + `src/components/templates/template-preview.tsx` |
| Imagen de encabezado de plantillas (008) | `src/lib/template-header.ts` (validación magic bytes/5MB) · `uploadResumable` en `src/lib/meta/client.ts` (ejemplo a Meta) · tabla `template_media` (blob 1:1, cascade) · `GET /api/template-media/[id]` (binario PÚBLICO — Meta lo baja en cada envío) · `POST /api/templates` es multipart · header en `sendTemplateCore`/`buildTemplateSendPayload` |
| Variables de plantillas con origen (009) | catálogo `VARIABLE_ORIGINS` + validación contiguas ≤5 + `resolveVariableValues`/`renderBody(values[])` en `src/lib/template-body.ts` (puro, compartido con previews) · `template.variable_bindings` y `campaign.variable_values` (jsonb; NULL = flujo legado INTACTO) · resolución por destinatario en `sendTemplateCore` (contacto/`formatPhone`/nombre de la org) · `freeTexts` en `/api/campaigns`, `/api/conversations` y `/api/conversations/[id]/messages/template` |
| Agente paciente + baja visible (011) | debounce que RE-espera tras cada turno (`executeTurn`) y `AGENT_COALESCE_MS` default 20s · guardas `conversationalReplyDecision`/`deliverConversationalReply` (descarta contexto viejo, nunca repite el último saliente; confirmaciones de turno exentas) · BAJA → lead a etapa `kind='lost'` (side-effects) + badge «Dado de baja» en la bandeja + agente mudo (ingest + guard en runAgentTurn) |
| Motivo de fallo y reintento de fallidos (010) | `src/lib/meta-errors.ts` (`friendlyDeliveryError`, traducciones de 131042/131049/131026/131047) · `MessageDto.error` + línea «No entregado…» en `message-thread.tsx` · `retryFailedRecipients` en `campaigns/manage.ts` (única excepción guardada a la monotonicidad: fallido→pendiente, ambas clases de fallo) · acción `retry_failed` en `/api/campaigns/[id]/actions` · botón «Reintentar fallidos (N)» en el detalle |
| Gestión de campañas (filtros status/q en la URL, borrado, elegibles en vivo del borrador, ciclo de vida en la UI) | `src/server/campaigns/manage.ts` (filtros puros, `deleteCampaign` guardado por estado) · `GET /api/campaigns?status=&q=` (+ `settings` ritmo/cupo, `eligibleNow`) · `DELETE /api/campaigns/[id]` · `src/components/campaigns/campaigns-client.tsx` (panel «cómo funciona», acciones por fila con confirmación, stepper del detalle) · el 409 `in_use` de plantillas devuelve `campaigns` para enlazarlas |
| Cupo de envíos por empresa | `src/server/campaigns/quota.ts` + `/api/settings/sending` + Ajustes → Envíos y campañas (`CAMPAIGN_PACE_MS` de instancia) |
| Roles de plataforma y contraseñas temporales | `src/server/auth/super-admin.ts` (FR-016) · `must_change_password` gate en `src/lib/auth/session.ts` (FR-017) |
| Integraciones (sección del sidenav) | `src/app/(app)/integrations/` + `src/components/integrations/` + `/api/integrations` (índice de tarjetas; agregar una integración = tarjeta + módulo en `src/server/<integración>/`) |
| Google Calendar: OAuth, tokens cifrados, reglas de turnos, huecos, reservas | `src/lib/google/` (adaptador OAuth + cliente REST de Calendar, única frontera con Google) · `src/server/calendar/` (`integration.ts` tokens/estado, `rules.ts` Zod, `slots.ts` cálculo puro, `availability.ts` reglas+freeBusy, `booking.ts` reserva idempotente, `agent-tools.ts` puente con el agente) · `/api/integrations/google-calendar/*` · env de instancia `GOOGLE_CLIENT_ID/SECRET` (guía: `docs/integraciones/google-calendar-gcp.md`) |
| Conector MCP por empresa (PMS del cliente) (016) | `src/lib/mcp/` (transporte JSON-RPC + guard anti-SSRF + `MCP_ERROR_TEXT`; único adaptador del protocolo) · `src/server/mcp/` (`integration.ts` fila cifrada/handshake, `catalog.ts` prefetch con TTL, `calls.ts` **único** punto que llama al MCP y donde viven los 5 guardrails en orden, `agent-tools.ts` puente con el agente, `sanitize.ts`+`markers.ts` texto ajeno como DATO) · `src/server/mcp/profiles/` (allowlist, condensado y enlaces por proveedor; `generic` = sin herramientas) · `/api/integrations/mcp/*` (empresa) + `/api/admin/organizations/[id]/mcp` (el super admin habilita y es el ÚNICO que fija la URL) · `src/lib/promise-guard.ts` (el agente jamás promete una reserva) · mcp-mock en `src/app/api/dev/mcp-mock/` |
| Etiquetas (contactos y conversaciones), filtros en la URL, bulk y paginación | `src/lib/tags.ts` (saneo + `applyTagOps`) · `src/lib/pagination.ts` (page/limit + cursor keyset) · `src/server/tags.ts` (`tagsWhere`, catálogo, bulk scoped) · `/api/tags` · `/api/contacts` (`tags`,`mode`,`page`) + `/api/contacts/bulk-tags` · `/api/conversations` (`tags`,`mode`,`q`,`filter`,`cursor`) + `/api/conversations/bulk-tags` + `GET /api/conversations/[id]` · hook `src/components/use-query-filters.ts` (estado en query params vía `history.replaceState`) · `src/components/tags/*` (chip, filtro, picker, barra bulk, editor) · evento SSE `conversations.updated` |
| Acciones-herramienta del agente (agenda) | `check_availability` / `book_appointment` en `src/server/ai/actions.ts`; loop acotado (2 vueltas) en `pipeline.ts`; sección "AGENDA DE TURNOS" en `prompts.ts` (solo con calendario conectado); sandbox `is_test` jamás toca Google |
| Notificaciones push (013) | Web Push estándar (constitución II, cat. 4): claves VAPID POR EMPRESA generadas al primer uso (`src/server/push/keys.ts`, privada cifrada) · suscripciones por dispositivo (`subscriptions.ts`, `organization_id`+`user_id`, `endpoint` único, modo `all`/`handoff`) · envío con `web-push` para firmar/cifrar y `fetch` propio (`notify.ts`, transporte inyectable, poda 404/410) · eventos de dominio en `events.ts` (`notifyInboundMessage` desde `ingest.ts`, `notifyHandoff` desde `pipeline.ts`, siempre en segundo plano; `is_test` nunca) · `/api/push/{vapid,subscriptions,test}` · SW mínimo `public/sw.js` (sin caché) + `src/lib/push-client.ts` + `usePush` + Ajustes → Notificaciones · `AppShell` registra el SW, re-sincroniza y pone el badge · push-mock `/api/dev/push-mock` (`?status=410`) |
| API pública por empresa (014) | claves `vk_…` hasheadas (`src/lib/api-keys.ts` puro + `src/server/api-keys/keys.ts`) · `withApiKey` en `src/lib/api.ts` (401 `invalid_api_key`, 60/min → 429) · `/api/v1/templates`, `POST /api/v1/messages` (idempotencia reserva-primero en `api_request`, `Idempotency-Key`), `GET /api/v1/messages/[id]` · `src/server/public-api/` (`templates.ts` nombre/idioma + `resolveApiParams`, `send.ts` orquesta normalizar→contacto consent `api`→conversación→baja→cupo→`sendTemplateCore({via})`→reconciliar, `messages.ts`) · `src/lib/public-templates.ts` (variables `crm`/`caller` + curl, compartido con Ajustes → API) · `message.api_key_id` + `MessageDto.via` («Enviado por API · clave») · agente: `transactionalContext` + `isPlainAcknowledgment` (calla ante acuses tras notificación por API; sección `NOTIFICACIÓN AUTOMÁTICA` en el prompt) · `/api/settings/api-keys` + `src/components/settings/api-client.tsx` · referencia `docs/api/v1.md` · knob wa-mock `failNextSend` |
| Entrenador del agente en la Bandeja (015) | conversación fija `kind='trainer'` + contacto sintético `phone='trainer'` `is_test` (`src/server/trainer/conversation.ts`, `ensureTrainerConversation` lazy en `GET /api/conversations` → `page.trainer`, fuera del keyset; visibilidad pura en `src/lib/trainer.ts`) · turno propio `src/server/ai/trainer.ts` (dueño = `out`/`user`, agente = `in`/`assistant` + no leídos; debounce 2,5 s + lock + marca de cobertura; fallo del proveedor → respuesta amable, jamás handoff) · contrato `TrainerAction` (`trainer-actions.ts`, separado de `AgentAction`) + prompt con ids `[kb_…]` y marcador `[ENTRENADOR]` (`trainer-prompts.ts`) · aplicación + auditoría `agent_change` con before/after y undo idempotente (`src/server/trainer/changes.ts`, `/api/trainer/changes`, `/revert`, `/clear`) · servicios compartidos `src/server/kb/service.ts` (+ `kb_entry.source`, fix `kind_mismatch` del PATCH) y `src/server/ai/profile.ts` · UI: `trainer-row.tsx` (fila fija), `trainer-panel.tsx` (estado, tamaño, cambios con «Deshacer», vaciar), composer modo trainer, «está pensando…» · guards: `runAgentTurn` ignora trainer, `sendText` rechaza `kind !== whatsapp`, DELETE 409 · notas de voz: `message_media` privada con `Range` (`/api/message-media/[id]`), `POST …/messages/audio` multipart (8 MB, magic bytes, sin WebM: `src/lib/voice-note.ts`), `transcribeAudio` por OpenRouter `input_audio` (`src/lib/ai`, `ai_credentials.transcription_model`, default `google/gemini-2.5-flash`), grabador `use-voice-recorder.ts` (mp4/ogg o WAV vía `public/pcm-recorder-worklet.js`), SSE `message.updated` · ai-mock: rama `[ENTRENADOR]` + transcripción fija |
| Móvil / PWA / gestos (012) | Mobile-first: base = móvil, `md:` = escritorio (768). Shell `src/components/app-shell.tsx` (tab bar inferior + hoja «Más» + `useHideTabBar`, alto real con teclado iOS) · `Dialog`/`ActionSheet` en `src/components/ui/` (hoja inferior en móvil, modal en escritorio, atrás cierra) · gestos puros en `src/lib/gestures.ts` + hooks/`SwipeRow` en `src/components/gestures.tsx` · bandeja apilada por URL (`?c=` hilo, `d=1` ficha; push en móvil, replace en escritorio) + atajos (⌘K, Alt+↑/↓, Esc, ⌘⇧U) + `/` respuestas rápidas + `markUnread` en `PATCH /api/conversations/[id]` · pipeline `MouseSensor`+`TouchSensor` con «Mover a…» · PWA: `src/app/manifest.ts` + `/api/pwa/icon/[size]` (ImageResponse) + `generateViewport` en `src/app/layout.tsx` · reglas globales móviles en `globals.css` (16px en campos, safe-area) |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock + google-mock) tras un gate único (`src/lib/dev-guard.ts`): 404
incondicional en producción.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida, v1.7.0)**: dependencias de runtime SOLO (1)
  WhatsApp Cloud API, (2) proveedor LLM OpenRouter-compatible opcional, (3)
  **integraciones opcionales POR EMPRESA vía OAuth** (hoy: Google Calendar;
  las habilita el operador por env, las conecta cada empresa, tokens
  cifrados, adaptador dedicado, el instalador no las necesita), (4) **Web
  Push estándar** (VAPID propias, sin cuenta con terceros) y (5) **servidores
  MCP de terceros POR EMPRESA** (016; SOLO LECTURA con allowlist propia, los
  habilita el SUPER ADMIN empresa por empresa y es el único que fija la URL,
  credencial cifrada, validación anti-SSRF sobre la IP resuelta, el sandbox
  jamás los toca, y lo que devuelven es DATO y nunca instrucción). PROHIBIDO
  en v1 introducir S3/R2, email, Stripe u otros servicios externos fuera de
  esas cinco categorías. Auth y BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`.
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(opcional, firma), `SUPER_ADMIN_EMAILS` (emails con acceso a Administración,
separados por coma). **La IA ya NO se configura por env**: el token de
OpenRouter y los modelos son POR EMPRESA, cifrados, desde Ajustes →
Inteligencia artificial (las viejas `OPENROUTER_API_TOKEN/MODEL/JUDGE_MODEL`
son no-ops; `OPENROUTER_BASE_URL` sigue siendo de instancia — la intercepta
el ai-mock).

Para el self-test local existe además el modo de pruebas interno (mocks) —
ver `specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Memoria de archivos en `memory/` (índice `memory/MEMORY.md`, cargado por
sesión). Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.claude/agent-memory/`.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).

<!-- SPECKIT START -->
## Feature activa (Spec Kit)

Feature en curso: **016-mcp-connector** (conector MCP por empresa: el agente
consulta el PMS del propio cliente —el primero, Altos de Calamuchita— por
Model Context Protocol y responde con disponibilidad, precios y enlaces
REALES en vez de conocimiento estático; el servicio SOLO informa y la reserva
se completa en el sitio del proveedor; constitución 1.7.0) — spec, plan y
tasks en [specs/016-mcp-connector/](specs/016-mcp-connector/spec.md).
Anterior: 015-agent-trainer-chat (en producción, 8d11b7d).
<!-- SPECKIT END -->
