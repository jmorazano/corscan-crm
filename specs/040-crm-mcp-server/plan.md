# Implementation Plan: Conversar con el CRM desde Claude (040)

**Branch**: `040-crm-mcp-server` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Summary

Vocero pasa a ser también **servidor MCP**: `POST /api/mcp` (JSON-RPC 2.0,
HTTP streamable sin estado) con 12 herramientas de **solo lectura** sobre
métricas, campañas, conversaciones, mensajes, contactos, pipeline y
actividad del agente. La autorización es un **servidor OAuth 2.1 propio**
(descubrimiento RFC 9728/8414, registro dinámico RFC 7591, código + PKCE
S256, refresh rotativo, revocación) con tokens **solo hasheados**,
consentimiento en el CRM que elige empresas, switch por empresa apagado por
defecto, revalidación de rol y empresa en cada llamada, y Ajustes →
Asistentes con conexiones, «Revocar» y registro de consultas. Las cifras
reutilizan las consultas de Métricas (024) y Campañas (004/010) sin
redefinirlas.

## Technical Context

**Language/Version**: TypeScript estricto (`noUncheckedIndexedAccess`),
Next.js 15 App Router, React 19

**Primary Dependencies**: Drizzle ORM, Zod (y `zod/v4` del mismo paquete
para `toJSONSchema`), Better Auth (sesión del consentimiento),
`node:crypto` — **sin dependencias nuevas** (ni SDK de MCP ni proveedor
OAuth)

**Storage**: PostgreSQL — migración 0029 con siete tablas `assistant_*`
([data-model.md](data-model.md))

**Testing**: Vitest (unit de todo lo puro) + guion E2E
`tests/e2e/040-crm-mcp-server.md` con un cliente MCP de prueba en Node
(`tests/e2e/fixtures/mcp-client.mjs`) y el consentimiento conducido en el
Browser pane; Claude Code real contra local; Claude Desktop real contra
producción antes de habilitar al cliente

**Target Platform**: el contenedor actual (Railway), HTTPS pública

**Project Type**: monolito web existente

**Performance Goals**: cifras de un año < 3 s p95 del lado del CRM
(SC-005); listas y lecturas < 1 s

**Constraints**: multi-tenant estricto (`scoped()`), solo lectura,
secretos hasheados, sin colas ni estado de sesión MCP, límites in-process,
nada de esto puede afectar ingesta/envíos/agente

**Scale/Scope**: una decena de propietarios y conexiones; 60 llamadas/min
por conexión

## Constitution Check

*GATE pre-Phase 0 y re-chequeado después del diseño: PASA con la enmienda
D15 y una excepción justificada (Complexity Tracking).*

- **I Seguridad**: tokens y códigos solo como SHA-256 (más fuerte que
  cifrar: ni la instancia los puede recuperar); vencimientos cortos y
  rotación; jamás en logs ni en respuestas fuera del intercambio; el
  resultado de las herramientas excluye credenciales, tokens, el
  `ctwa_clid` y datos de prueba. Aislamiento: cada llamada se acota a UNA
  empresa autorizada y revalidada. **Enmienda MINOR 1.13.0** «acceso
  entrante de asistentes del usuario» (research D15), porque es una salida
  de datos nueva que la constitución debe regir. ✅ (con enmienda)
- **II Soberanía**: superficie ENTRANTE; el CRM no llama a ningún servicio
  nuevo; sin SDK ni proveedor de identidad externo; el instalador no
  configura nada. ✅
- **III Multi-tenancy**: `assistant_settings`, `assistant_grant_org` y
  `assistant_access_log` llevan `organization_id` NOT NULL e índice
  org-first; todas las consultas de las herramientas pasan por `scoped()`.
  `assistant_client`, `assistant_grant`, `assistant_auth_code` y
  `assistant_token` son de plataforma (de una persona/aplicación, como
  `user`/`session`) → ver Complexity Tracking. ⚠️ justificado
- **IV Idempotencia**: código y refresh de un solo uso con guard en el
  WHERE; transiciones monotónicas de la conexión; las herramientas no
  tienen efectos. ✅
- **V / IX Verificación**: gate técnico + E2E de comportamiento con cliente
  MCP real (no un mock del protocolo) y caminos infelices, más prueba con
  Claude Code y Claude Desktop reales (quickstart §2 y §4). ✅
- **VI Specs antes de código**: spec, plan, research, data-model,
  contratos y quickstart antes de tocar `src/`. ✅
- **VII Trazabilidad**: decisiones D1–D16 en [research.md](research.md);
  registro de consultas por empresa. ✅
- **VIII Foco vertical**: sirve a «organizar y convertir conversaciones»:
  el propietario entiende qué pasa en sus chats y campañas. No agrega
  canales, envíos ni marketing. ✅
- **Sandbox del Laboratorio**: conversaciones `is_test` y del Entrenador
  excluidas de toda herramienta. ✅

## Decisiones de diseño (resumen de [research.md](research.md))

- **D1** OAuth propio; el plugin `mcp` de Better Auth guarda tokens en
  claro y no sabe de empresas.
- **D2** MCP stateless JSON, `2025-06-18` (acepta 03-26 y 11-25), sin SDK.
- **D3** `WWW-Authenticate` con `resource_metadata` en todo 401; metadatos
  en `/.well-known/…` (con y sin path); `resource` RFC 8707.
- **D4** DCR solo públicos; retornos: Claude exactos + loopback; etiqueta
  del consentimiento derivada del retorno, no del nombre registrado.
- **D5** `vat_` 1 h · `vrt_` 30 días rotativo con detección de reuso ·
  código 5 min · inactividad 90 días.
- **D6** Consentimiento fuera de `(app)`; `next` seguro en login y cambio
  de contraseña; POST con `Origin` y empresas recalculadas.
- **D7** Por llamada: conexión activa + empresa autorizada + switch +
  `owner`.
- **D8** `structuredContent` + texto; texto de terceros saneado y avisado;
  errores de negocio como `isError`.
- **D9** Esquemas con `zod/v4` → `toJSONSchema`.
- **D10** `overviewForWindow` + `periodWindow` (paridad con Métricas).
- **D11** `campaignCounts` extraído de la ruta.
- **D12** Consultas propias reusando los predicados de la Bandeja;
  `search_messages` con `ILIKE` y ventana obligatoria.
- **D13** Registro en segundo plano + purga 90 días; límites in-process.
- **D14** Revocar todo al cambiar/restablecer contraseña.
- **D15** Constitución 1.13.0 + párrafo en la política de privacidad.
- **D16** Unit + E2E con cliente MCP de prueba + Claude real.

## Project Structure

### Documentation (this feature)

```text
specs/040-crm-mcp-server/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/oauth.md · contracts/mcp-tools.md · contracts/settings-api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
drizzle/0029_assistant_access.sql            # generada
src/lib/db/schema.ts                         # 6 tablas assistant_*
src/lib/db/ids.ts                            # acl, agr, alog

# Puros (sin BD ni Next)
src/lib/oauth-server/pkce.ts                 # verificar S256, formato del verifier
src/lib/oauth-server/redirect-uris.ts        # lista permitida + loopback RFC 8252 + etiqueta del cliente
src/lib/oauth-server/tokens.ts               # generar vat_/vrt_/código, hash, TTLs
src/lib/oauth-server/metadata.ts             # JSON de RFC 8414 / 9728, encabezado WWW-Authenticate
src/lib/oauth-server/params.ts               # Zod de authorize/token/register/revoke
src/lib/oauth-server/next-path.ts            # `next` seguro
src/lib/mcp-server/jsonrpc.ts                # parseo, errores, negociación de versión
src/lib/assistants/authorize.ts              # decisión pura por empresa (tabla de casos)
src/lib/assistants/format.ts                 # autor del mensaje, fechas con offset, aviso de terceros
src/lib/metrics.ts                           # + periodWindow (y unidades automáticas)

# Servidor (BD)
src/server/assistants/clients.ts             # registro, barrido de huérfanos
src/server/assistants/codes.ts               # crear/canjear código
src/server/assistants/tokens.ts              # emitir, renovar con rotación, revocar, resolver bearer
src/server/assistants/grants.ts              # conexiones: listar, revocar, revokeAllGrantsForUser, expirar
src/server/assistants/settings.ts            # switch por empresa
src/server/assistants/access.ts              # resolveAssistantCall + authorizeWorkspace
src/server/assistants/log.ts                 # registro en segundo plano + purga
src/server/assistants/server.ts              # despacho JSON-RPC → herramientas
src/server/assistants/tools/index.ts         # registro de las 12 (schema, describeCall, run)
src/server/assistants/tools/{workspaces,metrics,origins,campaigns,conversations,messages,contacts,pipeline,agent}.ts
src/server/assistants/queries/{conversations,messages,contacts,pipeline,events}.ts
src/server/metrics/overview.ts               # overviewIn → overviewForWindow (exportada), sin cambio de UI
src/server/campaigns/stats.ts                # campaignCounts extraído de la ruta
src/server/inbox/queries.ts                  # exportar conversationSearchWhere
src/instrumentation.ts                       # barrido diario (clientes, códigos, tokens, log, inactivas)

# Rutas
src/app/.well-known/oauth-authorization-server/route.ts
src/app/.well-known/oauth-protected-resource/route.ts
src/app/.well-known/oauth-protected-resource/api/mcp/route.ts
src/app/api/oauth/register/route.ts
src/app/api/oauth/authorize/route.ts         # POST del consentimiento
src/app/api/oauth/token/route.ts
src/app/api/oauth/revoke/route.ts
src/app/api/mcp/route.ts                     # POST JSON-RPC; GET/DELETE 405
src/app/api/settings/assistants/route.ts     # GET/PATCH (withOwner)
src/app/api/settings/assistants/connections/[grantId]/route.ts   # DELETE
src/app/api/settings/assistants/log/route.ts
src/app/api/campaigns/[id]/route.ts          # usa campaignCounts (mismo JSON)

# UI
src/app/oauth/authorize/page.tsx + consent-form.tsx   # fuera de (app)
src/app/(auth)/login/login-form.tsx          # respeta `next`
src/app/(auth)/change-password/*             # respeta `next`
src/app/(app)/settings/assistants/page.tsx   # requireOwnerPage
src/components/settings/assistants-client.tsx
src/components/settings/settings-nav.tsx     # entrada «Asistentes (Claude)» solo owner

# Auth
src/lib/auth/index.ts                        # hooks: revocar conexiones al cambiar/restablecer contraseña
src/server/admin/*                           # reset de temporal (019) también revoca

# Docs, legal y pruebas
docs/integraciones/claude-mcp.md             # guía para el cliente
.specify/memory/constitution.md              # 1.13.0 (vía /speckit-constitution)
# Privacidad: párrafo nuevo en la política EXTERNA (`APP_PRIVACY_URL`,
# hoy https://corscan.com.ar/privacidad, fuera de este repo) — public-site-builder
tests/unit/{oauth-server,mcp-jsonrpc,assistants-authorize,assistants-format,metrics-period,assistants-tools}.test.ts
tests/e2e/040-crm-mcp-server.md
tests/e2e/fixtures/mcp-client.mjs
CLAUDE.md                                    # fila nueva en el mapa del código
```

**Structure Decision**: monolito existente. Dos fronteras nuevas y
separadas: `src/lib/oauth-server/` + `src/server/assistants/{clients,codes,
tokens,grants}` (autorización) y `src/lib/mcp-server/` +
`src/server/assistants/{server,tools,queries}` (protocolo y datos). Las
herramientas solo LEEN mediante consultas `scoped()`; ninguna importa
módulos de envío (`inbox/send*`, `whatsapp/*`, `instagram/send`), del
agente (`ai/pipeline`) ni del conector de 016 — se fija con un test de
imports.

## Orden de implementación (para /speckit-tasks)

1. **Base** (bloquea todo): esquema + migración 0029, ids, puros de
   `oauth-server` y `mcp-server` con sus tests.
2. **US1 (P1) conectar**: metadatos, register, authorize (página + POST),
   token, revoke, `next` en login/cambio de contraseña, `/api/mcp` con
   `initialize`/`tools/list`, `list_workspaces`, switch en Ajustes (mínimo).
   Cliente de prueba E2E de punta a punta. **Checkpoint**: Claude Code
   local conecta y lista empresas.
3. **US2 (P1) números**: `periodWindow` + `overviewForWindow` (paridad),
   `campaignCounts` (paridad con la ruta), `get_message_metrics`,
   `get_conversation_origins`, `list_campaigns`, `get_campaign`.
4. **US3 (P1) control**: Ajustes → Asistentes completo (conexiones,
   revocar, registro), registro en segundo plano, límites, revocación por
   contraseña, barrido diario, caminos infelices del E2E. **Checkpoint
   MVP**: deploy + prueba con Claude Desktop en la empresa del operador.
5. **US4 (P2) conversaciones**: `search_conversations`, `search_messages`,
   `get_conversation`, `search_contacts`, `get_contact`; saneo de texto de
   terceros; medición de `search_messages` con volumen.
6. **US5 (P3)**: `get_pipeline`, `get_agent_activity`.
7. **Cierre**: enmienda de la constitución, privacidad, guía del cliente,
   CLAUDE.md, gate + E2E completo + prueba real con las diez preguntas
   (SC-006).

## Riesgos

- **Renovación concurrente de Claude** → reuso detectado y desconexión
  (research D5): se valida en el checkpoint MVP; mitigación lista.
- **Cambios del lado de Claude** (dirección de retorno a claude.com, CIMD
  en vez de DCR): ambas direcciones ya permitidas; CIMD queda como mejora.
- **`search_messages` lento** en una empresa grande: ventana obligatoria y
  tope; `pg_trgm` como plan B medido.
- **Exposición de datos de huéspedes a la cuenta de Claude del
  propietario**: decisión explícita del dueño; switch apagado por
  defecto, consentimiento claro, registro visible y párrafo de privacidad.

## Complexity Tracking

| Violación | Por qué hace falta | Alternativa más simple descartada porque |
|---|---|---|
| Cuatro tablas sin `organization_id` (`assistant_client`, `assistant_grant`, `assistant_auth_code`, `assistant_token`) | El cliente OAuth no pertenece a nadie y la conexión es de UNA persona que puede autorizar VARIAS empresas en un solo consentimiento (pedido explícito: Altos de Calamuchita + Altos de la Ciudad). Mismo caso que `user`/`session` de Better Auth. La pertenencia a empresas vive en `assistant_grant_org` (con `organization_id`) y toda consulta de datos se acota por `scoped()` | Una conexión por empresa obligaría a conectar Claude N veces (un conector por empresa en Claude Desktop) y duplicaría tokens; un `organization_id` «principal» en la conexión sería falso para las demás empresas |
