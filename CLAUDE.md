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
| Gestión de campañas (filtros status/q en la URL, borrado, elegibles en vivo del borrador, ciclo de vida en la UI) | `src/server/campaigns/manage.ts` (filtros puros, `deleteCampaign` guardado por estado) · `GET /api/campaigns?status=&q=` (+ `settings` ritmo/cupo, `eligibleNow`) · `DELETE /api/campaigns/[id]` · `src/components/campaigns/campaigns-client.tsx` (panel «cómo funciona», acciones por fila con confirmación, stepper del detalle) · el 409 `in_use` de plantillas devuelve `campaigns` para enlazarlas |
| Cupo de envíos por empresa | `src/server/campaigns/quota.ts` + `/api/settings/sending` + Ajustes → Envíos y campañas (`CAMPAIGN_PACE_MS` de instancia) |
| Roles de plataforma y contraseñas temporales | `src/server/auth/super-admin.ts` (FR-016) · `must_change_password` gate en `src/lib/auth/session.ts` (FR-017) |
| Integraciones (sección del sidenav) | `src/app/(app)/integrations/` + `src/components/integrations/` + `/api/integrations` (índice de tarjetas; agregar una integración = tarjeta + módulo en `src/server/<integración>/`) |
| Google Calendar: OAuth, tokens cifrados, reglas de turnos, huecos, reservas | `src/lib/google/` (adaptador OAuth + cliente REST de Calendar, única frontera con Google) · `src/server/calendar/` (`integration.ts` tokens/estado, `rules.ts` Zod, `slots.ts` cálculo puro, `availability.ts` reglas+freeBusy, `booking.ts` reserva idempotente, `agent-tools.ts` puente con el agente) · `/api/integrations/google-calendar/*` · env de instancia `GOOGLE_CLIENT_ID/SECRET` (guía: `docs/integraciones/google-calendar-gcp.md`) |
| Etiquetas (contactos y conversaciones), filtros en la URL, bulk y paginación | `src/lib/tags.ts` (saneo + `applyTagOps`) · `src/lib/pagination.ts` (page/limit + cursor keyset) · `src/server/tags.ts` (`tagsWhere`, catálogo, bulk scoped) · `/api/tags` · `/api/contacts` (`tags`,`mode`,`page`) + `/api/contacts/bulk-tags` · `/api/conversations` (`tags`,`mode`,`q`,`filter`,`cursor`) + `/api/conversations/bulk-tags` + `GET /api/conversations/[id]` · hook `src/components/use-query-filters.ts` (estado en query params vía `history.replaceState`) · `src/components/tags/*` (chip, filtro, picker, barra bulk, editor) · evento SSE `conversations.updated` |
| Acciones-herramienta del agente (agenda) | `check_availability` / `book_appointment` en `src/server/ai/actions.ts`; loop acotado (2 vueltas) en `pipeline.ts`; sección "AGENDA DE TURNOS" en `prompts.ts` (solo con calendario conectado); sandbox `is_test` jamás toca Google |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock + google-mock) tras un gate único (`src/lib/dev-guard.ts`): 404
incondicional en producción.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida, v1.5.0)**: dependencias de runtime SOLO
  WhatsApp Cloud API + proveedor LLM OpenRouter-compatible opcional +
  **integraciones opcionales POR EMPRESA vía OAuth** (hoy: Google Calendar;
  las habilita el operador por env, las conecta cada empresa, tokens
  cifrados, adaptador dedicado, el instalador no las necesita). PROHIBIDO en
  v1 introducir S3/R2, email, Stripe u otros servicios externos fuera de esas
  categorías. Auth y BD self-hosted.
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

Feature en curso: **009-template-variables** (hasta 5 variables posicionales
con origen atado en la creación — nombre/teléfono del contacto, empresa,
texto libre — resueltas solas al enviar; legacy intacto vía bindings NULL) —
spec, plan y tasks en [specs/009-template-variables/](specs/009-template-variables/spec.md).
Anterior: 008-template-images (en producción, 4b1cf23).
<!-- SPECKIT END -->
