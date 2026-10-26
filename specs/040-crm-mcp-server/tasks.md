# Tasks: Conversar con el CRM desde Claude (040)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) · [quickstart.md](quickstart.md)

**Tests**: SÍ. La spec los exige (FR-029) y la Definición de Hecho del
proyecto también: unit de todo lo puro (Vitest, `tests/unit/**/*.test.ts`)
+ guion E2E con un cliente MCP de prueba + Claude real.

**Organización**: por historia de usuario. US1, US2 y US3 son P1 y juntas
forman el MVP que se deploya y se prueba con Claude Desktop en la empresa
del operador; US4 (P2) y US5 (P3) se suman después.

Trabajo en el worktree `.claude/worktrees/040-crm-mcp-server` (rama
`040-crm-mcp-server` sobre `origin/main` b2bcf1f). Gate:
`node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint . && node_modules/.bin/vitest run && node_modules/.bin/next build`
(pnpm por corepack está roto en esta máquina). Antes de conducir E2E tras un
build: parar el dev server, `rm -rf .next` y volver a levantarlo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (otro archivo, sin depender de una
  tarea incompleta)
- **[Story]**: US1…US5 de la spec

---

## Phase 1: Setup

**Purpose**: esquema y migración que todo lo demás necesita.

- [ ] T001 Agregar las siete tablas `assistant_settings`, `assistant_client`, `assistant_grant`, `assistant_grant_org`, `assistant_auth_code`, `assistant_token` y `assistant_access_log` en `src/lib/db/schema.ts` exactamente como [data-model.md](data-model.md) (enums, FKs con cascade/set null, PK compuesta de `assistant_grant_org`, índices org-first e índice `(user_id, status)`)
- [ ] T002 Agregar los prefijos `assistantClient: "acl"`, `assistantGrant: "agr"`, `assistantAccessLog: "alog"` en `src/lib/db/ids.ts`
- [ ] T003 Generar la migración con `node_modules/.bin/drizzle-kit generate` y renombrarla a `drizzle/0029_assistant_access.sql` (ajustar `drizzle/meta/_journal.json`); verificar que es solo aditiva y re-ejecutable, y aplicarla en local con `drizzle-kit migrate`

---

## Phase 2: Foundational (bloquea todas las historias)

**Purpose**: piezas puras de OAuth y de JSON-RPC, y el andamiaje del
servidor MCP. Todo lo de esta fase es puro salvo T013–T015.

- [ ] T004 [P] `src/lib/oauth-server/tokens.ts`: `generateAccessToken()` (`vat_` + 32 bytes base64url), `generateRefreshToken()` (`vrt_`), `generateAuthCode()`, `hashSecret()` (SHA-256 hex), constantes `ACCESS_TTL_S=3600`, `REFRESH_TTL_S=30*86400`, `CODE_TTL_S=300`, `IDLE_EXPIRY_DAYS=90`, `looksLikeAccessToken()` (research D5)
- [ ] T005 [P] `src/lib/oauth-server/pkce.ts`: `isValidCodeVerifier()` (43–128, `[A-Za-z0-9-._~]`), `isValidCodeChallenge()`, `verifyS256(verifier, challenge)` con comparación en tiempo constante
- [ ] T006 [P] `src/lib/oauth-server/redirect-uris.ts`: `isAllowedRedirectUri()` (claude.ai y claude.com `/api/mcp/auth_callback` exactas + loopback RFC 8252 `localhost`/`127.0.0.1`/`[::1]` con cualquier puerto, sin userinfo ni fragmento), `redirectMatchesRegistered()` (exacta; loopback admite cambio de puerto como dice RFC 8252 §7.3) y `clientLabelFor(redirectUri)` → «Claude (claude.ai)» / «Una aplicación en esta computadora (por ejemplo, Claude Code)» (research D4)
- [ ] T007 [P] `src/lib/oauth-server/next-path.ts`: `safeNextPath(raw)` — solo rutas relativas que empiezan con `/oauth/authorize?`, sin `//`, sin esquema, sin `\`; si no, `null`
- [ ] T008 [P] `src/lib/oauth-server/params.ts`: esquemas Zod de register, authorize (query y POST), token (form y JSON, los dos `grant_type`) y revoke, según [contracts/oauth.md](contracts/oauth.md); `resource` opcional que debe igualar `<APP_BASE_URL>/api/mcp`
- [ ] T009 [P] `src/lib/oauth-server/metadata.ts`: `authorizationServerMetadata(base)`, `protectedResourceMetadata(base)` y `wwwAuthenticate(base, { invalidToken })` con el JSON y el encabezado exactos de [contracts/oauth.md](contracts/oauth.md) §1–2
- [ ] T010 [P] `src/lib/mcp-server/jsonrpc.ts`: `parseJsonRpc(body)` (objeto único; arreglo → `-32600`; JSON inválido → `-32700`; notificación sin `id`), `negotiateProtocolVersion(requested)` (`2025-06-18` por defecto; acepta `2025-03-26` y `2025-11-25`), constructores de resultado y error, `toolResult(obj)` (`structuredContent` + `content[0].text` con JSON compacto) y `toolError(text)` (`isError: true`) (research D2, D8)
- [ ] T011 [P] `src/lib/assistants/authorize.ts`: `decideWorkspaceAccess({ inGrant, enabled, role })` → `ok` | `not_authorized` | `disabled` | `not_owner`, y `resolveWorkspaceRef(ref, grantOrgs)` (id `org_…`, nombre o slug exacto sin distinguir mayúsculas; omitido con una sola empresa activa) (research D7)
- [ ] T012 [P] Tests unit de T004–T011 en `tests/unit/oauth-server.test.ts`, `tests/unit/mcp-jsonrpc.test.ts` y `tests/unit/assistants-authorize.test.ts` (PKCE con el vector de RFC 7636 apéndice B, retornos permitidos y rechazados incluyendo `https://claude.ai.evil.com/...` y `http://localhost@evil.com`, `next` maliciosos, versiones, batch, tabla completa de decisiones)
- [ ] T013 `src/server/assistants/settings.ts`: `getAssistantSettings(orgId)` (sin fila = apagado) y `setAssistantsEnabled(orgId, enabled, userId)` (upsert) usando `scoped()`
- [ ] T014 `src/server/assistants/access.ts`: `resolveAssistantCall(bearer)` (hash → `assistant_token` `access` vigente → `assistant_grant` `active` → usuario; actualiza `last_used_at` a lo sumo 1/min en segundo plano) y `authorizeWorkspace(call, ref)` que lee `assistant_grant_org`, `assistant_settings` y `member.role` del usuario y aplica `decideWorkspaceAccess` — sin caché (FR-007)
- [ ] T015 `src/server/assistants/tools/index.ts`: tipo `AssistantTool` (`name`, `title`, `description` en castellano, `input` con `zod/v4`, `outputSchema`, `annotations` de solo lectura, `describeCall(args, resolved)`, `run(ctx, args)`), registro vacío, `listToolsForMcp()` con `z.toJSONSchema()` y `callTool(ctx, name, rawArgs)` que valida, autoriza la empresa (T014) y convierte errores en `toolError`
- [ ] T016 `src/server/assistants/server.ts`: `handleMcpRequest(call, body)` — despacha `initialize` (con las `instructions` de [contracts/mcp-tools.md](contracts/mcp-tools.md)), notificaciones (`202`), `ping`, `tools/list`, `tools/call`; método desconocido `-32601`
- [ ] T017 Test de imports en `tests/unit/assistants-imports.test.ts`: ningún archivo de `src/server/assistants/` ni `src/lib/mcp-server/` importa `@/server/inbox/send*`, `@/server/whatsapp/`, `@/server/instagram/send`, `@/server/ai/pipeline`, `@/server/mcp/` ni `@/lib/meta/` (FR-009; plan «Structure Decision»)

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 — Conectar Claude a mis empresas (Priority: P1) 🎯 MVP

**Goal**: un propietario agrega el conector, inicia sesión, elige empresas
y el asistente lista exactamente esas.

**Independent Test**: el cliente MCP de prueba hace registro → autorización
con PKCE → consentimiento (Browser pane) → token → `list_workspaces` y
recibe solo la empresa tildada.

### Tests for User Story 1

- [ ] T018 [P] [US1] Cliente MCP de prueba sin dependencias en `tests/e2e/fixtures/mcp-client.mjs`: `--base`, registro DCR con retorno loopback, genera verifier/challenge, imprime la URL de autorización, levanta un listener `127.0.0.1:<puerto>` que recibe `code`/`state`, canjea, llama `initialize` + `tools/list` + `tools/call`, renueva, revoca; `--tools <lista|all>`, `--scenario happy|unhappy`, `--expect <json>`; sale ≠ 0 ante cualquier diferencia
- [ ] T019 [P] [US1] Guion `tests/e2e/040-crm-mcp-server.md` sección A (conexión): switch, consentimiento con una y con dos empresas, empresa con switch apagado deshabilitada, miembro sin empresas autorizables, contraseña temporal, «Cancelar», retorno no permitido, conexión de Claude Code separada (escenarios 1–8 de US1)

### Implementation for User Story 1

- [ ] T020 [P] [US1] Rutas de metadatos `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts` y `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts` (GET, `Cache-Control: public, max-age=3600`, con T009)
- [ ] T021 [US1] `src/server/assistants/clients.ts` + `src/app/api/oauth/register/route.ts`: registro DCR según contrato §3 (solo `none`, retornos validados con T006, `client_name` saneado con `sanitizeForeignText` a 80), límite 10/h por IP con `checkRateLimit` + `clientIp`
- [ ] T022 [US1] `src/server/assistants/codes.ts`: `createAuthCode({ clientId, userId, organizationIds, redirectUri, codeChallenge, resource })` (guarda hash, +5 min) y `redeemAuthCode(code, { clientId, redirectUri, codeVerifier })` con `used_at` atómico por guard en el WHERE; código ya usado → revoca el `grant_id` asociado (`code_reuse`)
- [ ] T023 [US1] `src/server/assistants/tokens.ts`: `issueTokens(grantId)` (par nuevo), `refreshTokens(refresh, clientId)` (guard `used_at is null`; reuso → revoca la conexión `refresh_reuse`; conexión inactiva 90 días → `expired`), `revokeByToken(token)`; `src/server/assistants/grants.ts`: `createGrant({ userId, clientId, clientLabel, organizationIds, resource })` (filas en `assistant_grant_org`), `revokeGrant(id, reason, byUserId)` monotónica
- [ ] T024 [US1] `src/app/api/oauth/token/route.ts`: form y JSON, los dos `grant_type`, respuestas y errores de contrato §5 (`401 invalid_client` si el cliente no existe), `Cache-Control: no-store`, 30/10 min por IP
- [ ] T025 [P] [US1] `src/app/api/oauth/revoke/route.ts`: RFC 7009, siempre 200 (contrato §6)
- [ ] T026 [US1] Página de consentimiento `src/app/oauth/authorize/page.tsx` + `src/app/oauth/authorize/consent-form.tsx` FUERA de `(app)`: valida parámetros (error de cliente/retorno → página propia sin redirigir; otros → redirección con `error`), sin sesión → `/login?next=…`, contraseña temporal → `/change-password?next=…`, lista de empresas del usuario con motivo de las no tildables, textos de FR-003 (solo lectura, incluye textos de conversaciones, revocable en Ajustes), etiqueta del cliente de T006 y el nombre registrado solo como detalle; mobile-first (012)
- [ ] T027 [US1] `src/app/api/oauth/authorize/route.ts` (POST): sesión con `requireSession`, `Origin` = `APP_BASE_URL` (si no, 403), revalida todo, recalcula empresas autorizables (owner + switch), `allow` → `createAuthCode` y `{ redirect }`; `deny` → `error=access_denied`; `422 no_workspaces`
- [ ] T028 [US1] Respetar `next` (con `safeNextPath`) en `src/app/(auth)/login/login-form.tsx` + `src/app/(auth)/login/page.tsx` y en `src/app/(auth)/change-password/page.tsx` (hoy van fijo a `/inbox`)
- [ ] T029 [US1] `src/app/api/mcp/route.ts`: POST → `resolveAssistantCall`; sin token o inválido → 401 con `wwwAuthenticate` (T009); límite 60/min por conexión (`assistant:<grantId>`) → `toolError`/429 según el punto; delega en `handleMcpRequest`; GET/DELETE → 405 `Allow: POST`; nunca loguea el bearer
- [ ] T030 [US1] Herramienta `list_workspaces` en `src/server/assistants/tools/workspaces.ts` (empresas de la conexión con `active`, `inactive_reason`, canales conectados —número con prefijo visible, @usuario—, `timezone`) y registrarla en `tools/index.ts`
- [ ] T031 [US1] Ajustes mínimo: `src/app/api/settings/assistants/route.ts` GET/PATCH (`withOwner`, contrato settings-api) y `src/app/(app)/settings/assistants/page.tsx` (`requireOwnerPage`) + `src/components/settings/assistants-client.tsx` con el switch, la dirección `<APP_BASE_URL>/api/mcp` con «Copiar» y los pasos de Claude Desktop y Claude Code (quickstart §3); entrada «Asistentes (Claude)» solo owner en `src/components/settings/settings-nav.tsx`
- [ ] T032 [US1] Conducir la sección A del guion con el cliente de prueba y el Browser pane hasta verde; luego conectar Claude Code real contra `http://localhost:3000/api/mcp` (quickstart §2) y preguntar «¿a qué empresas tenés acceso?»

**Checkpoint**: Claude Code local conecta y lista empresas.

---

## Phase 4: User Story 2 — Preguntar por los números (Priority: P1)

**Goal**: métricas de mensajes, origen y campañas idénticas a las pantallas
del CRM.

**Independent Test**: con `tests/e2e/fixtures/seed-metrics.mjs` y una
campaña sembrada, cada herramienta de cifras da lo mismo que Métricas y el
detalle de la campaña.

### Tests for User Story 2

- [ ] T033 [P] [US2] Tests de `periodWindow` en `tests/unit/metrics-period.test.ts`: cada preset en `America/Argentina/Buenos_Aires` y en otra zona, `from`/`to` inclusivo, tope de 400 días, unidad automática, comparación de igual duración, y paridad: `last_30_days`/`last_12_weeks`/`last_12_months` == `metricsWindow(day/week/year)`
- [ ] T034 [P] [US2] Tests de la forma de las herramientas de cifras en `tests/unit/assistants-tools.test.ts` (argumentos inválidos → `isError` con el campo; `definitions` y `reached = delivered + read` en `get_campaign`; nombre de campaña ambiguo → error con la lista)
- [ ] T035 [P] [US2] Guion sección B en `tests/e2e/040-crm-mcp-server.md`: cifras contra el seed y contra `/metrics` y `/campaigns/[id]` en la UI (escenarios 1–7 de US2)

### Implementation for User Story 2

- [ ] T036 [US2] `periodWindow(period | { from, to }, timeZone, now)` y unidades automáticas en `src/lib/metrics.ts` (puro, research D10); la página de Métricas no cambia
- [ ] T037 [US2] Refactor sin cambio de comportamiento en `src/server/metrics/overview.ts`: `overviewIn` → `overviewForWindow(organizationId, window, timeZone)` exportada; `getMetricsOverview` la usa con `metricsWindow`; correr los tests existentes de métricas
- [ ] T038 [P] [US2] Extraer `campaignCounts(organizationId, campaignId)` a `src/server/campaigns/stats.ts` y usarlo en `src/app/api/campaigns/[id]/route.ts` (mismo JSON; test de que la ruta responde igual)
- [ ] T039 [US2] `get_message_metrics` en `src/server/assistants/tools/metrics.ts` (con `overviewForWindow` + conteo de conversaciones nuevas reales del período, `notes` del historial del celular, fechas con offset; `src/lib/assistants/format.ts` para fechas y etiquetas de período)
- [ ] T040 [P] [US2] `get_conversation_origins` en `src/server/assistants/tools/origins.ts` (agrupa `conversation.ig_origin` por tipo — anuncio de WhatsApp (035), link de entrada, comentario y anuncio de Instagram (030), orgánico —, `top_ads` por título, sin `clickId`; usa `originForClient`)
- [ ] T041 [US2] `list_campaigns` y `get_campaign` en `src/server/assistants/tools/campaigns.ts` (`parseCampaignFilters`/`likePattern` de `manage.ts`, `campaignCounts`, `failure_reasons` con `friendlyDeliveryError`, `rates`, `definitions`, destinatarios paginados por estado incluido `replied`)
- [ ] T042 [US2] Registrar las cuatro en `tools/index.ts` con su `describeCall`, y conducir la sección B hasta verde

**Checkpoint**: las preguntas del cliente sobre números se responden bien.

---

## Phase 5: User Story 3 — Controlar y cortar el acceso (Priority: P1)

**Goal**: el propietario ve conexiones y consultas, revoca, apaga, y el
corte es inmediato.

**Independent Test**: conectar, consultar, revocar desde Ajustes y la
siguiente llamada del cliente falla; igual con el switch, quitando al
usuario y cambiando la contraseña.

### Tests for User Story 3

- [ ] T043 [P] [US3] Guion sección C en `tests/e2e/040-crm-mcp-server.md` y `--scenario unhappy` del cliente de prueba: revocar, switch apagado en una de dos empresas, usuario quitado y bajado a miembro, cambio y reset de contraseña, registro visible y aislado entre empresas, miembro sin sección, código reusado, refresh reusado, token vencido, 60/min (escenarios 1–7 de US3 + bordes)
- [ ] T044 [P] [US3] Tests en `tests/unit/assistants-grants.test.ts` de las transiciones monotónicas de la conexión y de qué motivo corresponde a cada revocación

### Implementation for User Story 3

- [ ] T045 [US3] `src/server/assistants/log.ts`: `logAssistantCall(...)` en segundo plano (nunca lanza) con `summary` de `describeCall` ≤ 200 caracteres y sin contenido devuelto; no registra en empresas inexistentes o ajenas; enganchar en `callTool` (T015) para `ok`, `denied` y `error`
- [ ] T046 [US3] Completar Ajustes → Asistentes: `GET` con `connections` (las de los últimos 30 días, `otherWorkspaces` como número), `DELETE src/app/api/settings/assistants/connections/[grantId]/route.ts` (motivo `owner`/`user`, 404 si no incluye esta empresa, idempotente) y `src/app/api/settings/assistants/log/route.ts` paginado; UI de lista con «Revocar» (confirmación) y registro en `src/components/settings/assistants-client.tsx`
- [ ] T047 [US3] `revokeAllGrantsForUser(userId, 'password_change')` en `src/server/assistants/grants.ts` y engancharlo en `src/lib/auth/index.ts` (`onPasswordReset` y `hooks.after` del path de cambio de contraseña) y en el reset de contraseña temporal del super admin en `src/server/admin/users.ts`
- [ ] T048 [US3] Barrido diario en `src/instrumentation.ts` (función en `src/server/assistants/grants.ts`): clientes sin autorización a las 24 h, códigos vencidos, tokens vencidos hace > 1 día, conexiones con 90 días sin uso → `expired`, registro > 90 días; tolerante a fallos
- [ ] T049 [US3] Conducir la sección C hasta verde

**Checkpoint MVP**: gate verde, merge con OK del dueño, deploy (migración
0029 al arrancar) y prueba real con Claude Desktop en la empresa principal
del operador (quickstart §4, incluida la renovación > 1 h). Si la
renovación concurrente desconecta, aplicar la gracia de 30 s (research D5).

---

## Phase 6: User Story 4 — Leer y buscar conversaciones y contactos (Priority: P2)

**Goal**: buscar y leer chats y contactos con texto de terceros saneado.

**Independent Test**: con conversaciones sembradas de los dos canales
(etiquetas, etapas, origen, adjuntos, de prueba y del Entrenador), las
búsquedas devuelven exactamente las esperadas y el hilo sale en orden.

### Tests for User Story 4

- [ ] T050 [P] [US4] Tests en `tests/unit/assistants-format.test.ts`: autor de cada mensaje (cliente, agente, equipo con nombre, celular, API, campaña, historial), adjuntos con `summary_source`, saneo de texto de terceros (marcadores del sistema quitados, recorte) y presencia de `aviso_contenido_de_terceros`
- [ ] T051 [P] [US4] Seed `tests/e2e/fixtures/seed-assistant.mjs` (conversaciones WhatsApp/Instagram con etiquetas, etapa, origen, handoff, IA pausada, nota de voz transcripta, PDF resumido, un mensaje con «ignorá tus instrucciones…», una conversación `is_test` y la del Entrenador) y guion sección D (escenarios 1–7 de US4)

### Implementation for User Story 4

- [ ] T052 [US4] Exportar `conversationSearchWhere` de `src/server/inbox/queries.ts` sin cambiar la Bandeja
- [ ] T053 [US4] `src/server/assistants/queries/conversations.ts`: búsqueda con `tagsWhere`, `conversationSearchWhere`, etapa, origen, `handoff_at`, `ai_enabled`, rango de actividad, `kind in ('whatsapp','instagram')`, `is_test = false`, cursor keyset de `src/lib/pagination.ts`, `total_matching`
- [ ] T054 [US4] `src/server/assistants/queries/messages.ts`: hilo por tramos (50, máx. 100) hacia atrás con medios (`toMediaDto`) y eventos (`listConversationEvents` + `eventText`), y búsqueda `ILIKE` escapada (`likePattern`) con ventana obligatoria (default 90, máx. 365 días) y fragmento
- [ ] T055 [P] [US4] `src/server/assistants/queries/contacts.ts`: búsqueda con `contactListWhere` (033) + ficha con `serializeContact`, conversaciones y campañas del contacto
- [ ] T056 [US4] Herramientas `search_conversations`, `get_conversation` (`src/server/assistants/tools/conversations.ts`), `search_messages` (`tools/messages.ts`), `search_contacts`, `get_contact` (`tools/contacts.ts`) con salida según contrato, texto de terceros por `sanitizeForeignText` y el aviso, ids de otra empresa = «no encontrado»; registrar con `describeCall`
- [ ] T057 [US4] Conducir la sección D; medir `search_messages` en la base local con el volumen más grande disponible y anotar el tiempo en el guion (si supera SC-005, crear la tarea de `pg_trgm`)

**Checkpoint**: «leeme la conversación con…» y «¿qué preguntaron los del anuncio…?» funcionan.

---

## Phase 7: User Story 5 — Pipeline y actividad del agente (Priority: P3)

**Goal**: leads por etapa y eventos del agente por período.

**Independent Test**: con leads y `conversation_event` sembrados, las
cantidades por etapa y por tipo coinciden y las listas traen el motivo.

- [ ] T058 [P] [US5] Ampliar `tests/e2e/fixtures/seed-assistant.mjs` con leads en varias etapas y eventos `ai_*`, y guion sección E
- [ ] T059 [P] [US5] `src/server/assistants/queries/pipeline.ts` + `get_pipeline` en `src/server/assistants/tools/pipeline.ts` (etapas en orden con tipo y cantidad, leads por etapa con `updated_from/to`, nota de que no hay historial de etapas)
- [ ] T060 [P] [US5] `src/server/assistants/queries/events.ts` + `get_agent_activity` en `src/server/assistants/tools/agent.ts` (conteo por tipo en el período, lista con `eventText`)
- [ ] T061 [US5] Registrar las dos herramientas y conducir la sección E

---

## Phase 8: Polish & Cross-Cutting

- [ ] T062 Enmienda de la constitución a 1.13.0 «acceso entrante de asistentes del usuario» con `/speckit-constitution` en `.specify/memory/constitution.md` (research D15)
- [ ] T063 [P] Guía del cliente `docs/integraciones/claude-mcp.md` (qué puede preguntar, pasos de Claude Desktop y Claude Code, cómo revocar, qué ve y qué no) y enlace desde Ajustes → Asistentes
- [ ] T064 [P] Borrador del párrafo de privacidad para la política externa (`APP_PRIVACY_URL`) con el subagente `public-site-builder`, en `specs/040-crm-mcp-server/privacy-paragraph.md`; se publica solo con OK del dueño
- [ ] T065 [P] Fila «Servidor MCP para asistentes del usuario (040)» en el mapa de `CLAUDE.md`
- [ ] T066 Revisión de seguridad (`/security-review`) del diff: tokens fuera de logs, `Origin` del consentimiento, retornos, aislamiento por empresa, saneo
- [ ] T067 Gate completo + guion E2E A–E completo después de `rm -rf .next`; marcar tareas y escribir «Estado» al final de este archivo
- [ ] T068 Prueba real de las diez preguntas de SC-006 con Claude Desktop en producción (empresa del operador); luego el dueño decide habilitar Altos de Calamuchita y Altos de la Ciudad

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → historias.
- **US1 (3)** bloquea US2–US5: sin conexión no hay cómo llamar
  herramientas (el cliente de prueba de T018 se reusa en todas).
- **US2 (4)** y **US3 (5)** dependen solo de US1; se pueden hacer en
  paralelo entre sí.
- **US4 (6)** y **US5 (7)** dependen de US1 (y del registro de US3 para
  que queden registradas, pero funcionan sin él).
- **Polish (8)** al final; T062 y T064 pueden adelantarse.

### Within Each User Story

- Tests y seeds primero (fallan), después consultas → herramientas →
  registro en `tools/index.ts` → conducir el guion.
- T022–T024 en orden (código → tokens → ruta de token).

### Parallel Opportunities

- Fase 2: T004–T011 son puros y en archivos distintos → todos [P]; T012
  junto con ellos.
- US1: T018, T019, T020 y T025 en paralelo con el resto.
- US2: T033–T035 y T038, T040 en paralelo; T039/T041 tras T036–T038.
- US2 ∥ US3 una vez terminada US1.
- US4: T050, T051, T055 en paralelo; US5 completa en paralelo con US4.

## Parallel Example: Foundational

```text
T004 tokens.ts · T005 pkce.ts · T006 redirect-uris.ts · T007 next-path.ts
T008 params.ts · T009 metadata.ts · T010 jsonrpc.ts · T011 authorize.ts
→ luego T012 (tests) y T013–T017 en orden
```

## Implementation Strategy

### MVP (US1 + US2 + US3)

1. Fases 1–2.
2. US1 → checkpoint con Claude Code local.
3. US2 y US3 → gate + E2E A–C.
4. Merge (OK del dueño), deploy y prueba real con Claude Desktop en la
   empresa del operador. Ya se le puede ofrecer al cliente para cifras.

### Incremental Delivery

5. US4 → deploy: conversaciones y contactos.
6. US5 → deploy: pipeline y agente.
7. Fase 8 y habilitación de Altos con el OK del dueño.

## Notes

- Nunca tocar `main` del checkout principal (otras sesiones commitean
  ahí); todo en este worktree, partiendo de `origin/main`.
- El sandbox del Laboratorio y el Entrenador quedan fuera de toda
  herramienta: si un test lo detecta, es un bug, no un caso a tolerar.
- Toda herramienta es de solo lectura: si una tarea necesita escribir algo
  que no sea el registro, la conexión o el switch, está fuera de alcance.
