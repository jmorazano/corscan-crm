# Implementation Plan: Conector MCP por empresa (PMS del cliente)

**Branch**: `016-mcp-connector` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

## Summary

El agente de WhatsApp consulta **en vivo** el sistema que la empresa cliente ya
opera —el primer caso: el PMS de alojamientos de Altos de Calamuchita— a través
de un servidor **Model Context Protocol** remoto (JSON-RPC 2.0 sobre HTTP), y
responde con disponibilidad, precios y enlaces REALES en lugar de conocimiento
estático. El **super admin** habilita el conector empresa por empresa y es el
único que fija la URL; el **propietario de la empresa** pega su credencial, la
rota y la desconecta. El código se parte en dos fronteras que espejan
`src/lib/google/` + `src/server/calendar/`: un **transporte MCP puro**
(`src/lib/mcp/`, sin nada de Vocero adentro) y un **perfil por proveedor**
(`src/server/mcp/profiles/`) que sabe leer las tres herramientas de SOLO
LECTURA, condensar 19 KB de respuesta a ~1,5 KB y renderizar precios en pesos y
enlaces validados. Dos acciones-herramienta nuevas (`search_stays`,
`show_stay`) con presupuesto por familia, deadline de turno y degradación
propia. El sandbox del Laboratorio jamás toca el servidor real. Cero
dependencias nuevas y **superficie de variables de entorno exactamente cero**.
Decisiones en [research.md](research.md) D1–D22.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22, Next.js 15 App Router + React 19
**Primary Dependencies**: Drizzle + PostgreSQL, Better Auth, Zod — **cero paquetes nuevos**: el cliente MCP usa `node:https`, `node:dns`, `node:net` y `node:crypto` (sin `@modelcontextprotocol/sdk`, ver D5/D11)
**Storage**: tablas nuevas `mcp_integration` (1 por empresa, credencial cifrada) y `mcp_tool_call` (bitácora + evidencia del sandbox); migración `drizzle/0013_*`
**Testing**: Vitest (SSRF, transporte con `request` inyectado, doble sobre, saneo, allowlist de enlaces, perfil puro, presupuesto del agente, rutas) + guion E2E `tests/e2e/016-mcp-connector.md` (21 pasos) con mcp-mock + ai-mock + wa-mock
**Constraints**: constitución **1.7.0**, quinta categoría del Principio II (D1); el instalador no configura nada; la credencial nunca sale al cliente, a un log ni a un mensaje de error; todo lo que devuelve el servidor es DATO, nunca instrucción; una caída del PMS degrada la respuesta y jamás tumba el turno, la ingesta ni el envío
**Servidor real (verificado 21-sep-2026)**: sin estado (un POST por llamada, sin `Mcp-Session-Id`); errores con **HTTP 200 + `result.isError`** y detalle en un JSON anidado dentro de `result.content[0].text`; las 3 herramientas declaran `readOnlyHint:true`; ninguna publica `outputSchema`; latencia 0,66–1,31 s; ventana de fechas 2026-09-21 → 2027-04-19

## Constitution Check

*Constitución v1.7.0 — enmendada en esta rama (D1). El Principio II gana una
quinta categoría de dependencia externa en runtime: **servidores MCP de
terceros POR EMPRESA**, con diez condiciones no negociables. Se verifican una
por una porque son el gate de esta feature.*

### Principio II — quinta categoría, condición por condición

| | Condición (constitución, líneas 185-217) | Cómo la cumple el diseño |
|---|---|---|
| **(a)** | Sin el conector el producto funciona completo y el agente sigue atendiendo con su conocimiento propio | Sin fila `mcp_integration`, `GET /api/integrations` no lista la tarjeta, `/integrations/mcp` hace `notFound()`, `renderMcpSection()` devuelve `null`, el menú de acciones no incluye `search_stays`/`show_stay` y el pipeline re-chequea la capacidad en runtime. El agente atiende exactamente como hoy. ✅ |
| **(b)** | El SUPER ADMIN habilita empresa por empresa y es el ÚNICO que fija la URL; la empresa conecta su credencial con consentimiento y puede desconectarla cuando quiera | `PUT/DELETE /api/admin/organizations/[id]/mcp` bajo `withSuperAdmin`; la existencia de la fila **es** la habilitación (D2). El contrato de empresa (`PUT /api/integrations/mcp`) acepta `credential` y dos switches y **ninguna URL**; es `owner`-gated (FR-006). `DELETE /api/integrations/mcp` desconecta (borra credencial, `status='enabled'`) sin borrar la fila. ✅ |
| **(c)** | Credencial cifrada en reposo (AES-256-GCM); jamás al cliente, a un log ni a un mensaje de error; viaja solo al origen exacto validado, nunca por una redirección | `encryptSecret` de `src/lib/crypto` en `jsonb {cipher,iv,tag}` (D3). El DTO de empresa expone `endpointHost` + `credentialLast4`, nunca la URL completa ni el secreto; el DTO del super admin sí trae `endpointUrl` (es un destino, no un secreto). Los mensajes que salen a HTTP, a la UI y a `mcp_tool_call.errorMessage` vienen **solo** de `MCP_ERROR_TEXT`, un `Record<McpErrorCode,string>` fijo — nunca bytes del remoto (D14). `redactValue(text, credential)` por igualdad exacta antes de cualquier `console.error`. Todo 3xx → `unexpected_redirect` **sin seguirlo**; `authScheme:'meta'` (credencial en el cuerpo) queda fuera de v1. ✅ |
| **(d)** | Anti-SSRF al guardar y DE NUEVO en cada conexión, sobre la IP resuelta (HTTPS salvo loopback bajo el gate de mocks, sin userinfo, fuera de rangos privados/loopback/link-local/metadata de nube; 3xx rechazados), con timeout, tope de tamaño y límite de tasa por empresa | `checkEndpointSyntax` corre al guardar **y dentro de `postJsonRpc`** (la fila puede cambiar entre validación y uso) y **rechaza toda IP literal** —`net.isIP()`— porque Node no invoca `lookup` cuando el host ya es una IP (D9). `guardedLookup` va en `https.request({ lookup, autoSelectFamily:false })`, maneja `all:true` y bloquea si **cualquiera** de las direcciones resueltas cae en un rango prohibido: el chequeo ocurre dentro de la resolución que consume el socket, cerrando el TOCTOU de DNS rebinding. `timeoutMs` (2–30 s) y `maxResponseBytes` (16 KB–4 MB) son **por empresa**; `checkRateLimit` 60/min en `callGuarded` y 6/min en `verify` (ningún camino llama al MCP por fuera de esas puertas); semáforo de 8 llamadas en vuelo por proceso. `http://` solo sobre loopback y solo bajo `isMockEnabled()`, que la propia letra (d) admite para el self-test. ✅ |
| **(e)** | Se aísla tras un transporte MCP genérico más un perfil por proveedor, sin acoplar el dominio | `src/lib/mcp/` no importa `@/server/*` ni `@/lib/db` (solo `@/lib/env` para `isMockEnabled`, como ya hacen `src/lib/google/oauth.ts` y `calendar-client.ts`); `src/server/mcp/profiles/altos.ts` es 100 % puro. Agregar un segundo PMS = un archivo + una clave del enum, cero cambios en el pipeline. ✅ |
| **(f)** | Herramientas de SOLO LECTURA con allowlist propia: sin escrituras, reservas, pagos ni acciones irreversibles; el agente nunca promete una reserva | `profile.allowedTools` lista las tres herramientas y **no se deriva de `tools/list`** (lo que el servidor declara es dato no confiable); el servidor real las anota `readOnlyHint:true`, que se exige además como condición del handshake. No existe ninguna acción de escritura en el union del agente. Y sobre el texto saliente corre `promise-guard.ts`, una guarda pura que reemplaza la frase si el modelo escribe «te la reservo» — el único cinturón verificable de los cinco (D20). ✅ |
| **(g)** | El instalador NO lo necesita | **Superficie de env exactamente cero**: `.env.example` no recibe ninguna variable de 016 y se descarta `MCP_DEFAULT_ENDPOINT_URL`; `ALTOS_MCP_*` pasa a placeholder `REEMPLAZA_...` y solo la lee `scripts/mcp-smoke.mjs` por `argv`/stdin (D21). El build, el arranque y el healthcheck no dependen de nada nuevo. ✅ |
| **(h)** | El sandbox del Laboratorio JAMÁS lo toca: las `is_test` se responden con datos simulados | Dos cinturones y una evidencia: el corte vive **dentro de `callGuarded`** (después de la allowlist, antes de la credencial), devuelve los fixtures del perfil y **escribe la fila `is_test=true`**, que es lo que hace demostrable la promesa; `postJsonRpc` lanza `sandbox_violation` antes de cualquier I/O si el booleano llega en `true`; `loadMcpContext(org, conv, { sandbox })` no dispara el refresco de catálogo en sandbox (D12). El log del mcp-mock queda vacío tras una corrida completa del Laboratorio. ✅ |
| **(i)** | Todo lo que devuelve el servidor es DATO, nunca instrucción: no altera el contrato de acciones, se acota en tamaño, se le quitan los marcadores del sistema y los enlaces se validan contra los dominios del proveedor | `sanitizeForeignText` (controles, zero-width, bidi, aislantes, bloque de tags, marcadores del sistema exportados desde `markers.ts`, prefijos `CLIENTE:`/`AGENTE:` del transcript del juez); valla con **nonce por turno** para las `instructions`, que además vienen con `useServerInstructions` en **`false` por defecto**; el `toolText` de la familia `mcp` entra como `role:"user"`, no `system`; el `message` del proveedor no se propaga nunca; el `clientSummary` que puede llegar a un WhatsApp real se compone de plantilla propia + números + enumerados + una URL de la allowlist, con `SAFE_NAME` para el nombre; `safeLink` exige `h === d || h.endsWith("." + d)`; condensado a 2 propiedades y truncado por campo (D8, D14). ✅ |
| **(j)** | Un fallo o una caída degrada la respuesta —el agente lo dice y sigue— y jamás tumba el turno, la ingesta ni el envío | Ningún camino del conector lanza hacia afuera: todo `catch` degrada a `toolText`, como `executeCheckAvailability`. Todo `void` lleva `.catch(() => undefined)` (una promesa rechazada sin manejar es fatal en Node). La poda de `mcp_tool_call` va con `LIMIT 500` y detached, fuera del camino del turno. La degradación post-loop está **parametrizada por familia**: un cliente de cabañas ya no recibe «Te confirmo el turno con el equipo» (D15). ✅ |

**PROHIBIDO en v1** (S3/R2, email, Stripe/billing): intacto — un MCP de solo
lectura no es ninguno de esos, y no se agrega ningún servicio de esas familias.

**Cero dependencias nuevas de runtime**, contrastado contra `package.json`:
`node:https`, `node:crypto`, `node:dns`, `node:net` y `zod` ya presente. Es el
argumento más fuerte de la feature frente al Principio II.

### Los demás principios

- **I Seguridad**: ✅ credencial AES-256-GCM, a la UI solo los últimos 4; el
  header se arma por request dentro de `client.ts` y nunca queda colgado de un
  objeto que pueda loguearse; los cuerpos del remoto **no se persisten ni se
  devuelven** (solo `httpStatus` y `responseBytes`); `redactValue` por igualdad
  exacta en `src/lib/redact.ts`, compartido, sin que `src/lib/mcp/` importe a
  `src/lib/ai/` ni al revés (D14).
- **III Multi-tenancy**: ✅ `organization_id` NOT NULL en las dos tablas,
  `uniqueIndex` por org en la integración, índices org-first en la bitácora, y
  **todas** las queries por `scoped()` — incluidos los UPDATE: `organizationId`
  siempre está en mano, así que no se gasta la excepción del UPDATE-por-PK que
  usa `src/server/calendar/integration.ts:267`. De regalo, T019/T020 arreglan
  las dos lecturas de `src/server/ai/pipeline.ts:175-184` que hoy usan
  `eq(...organizationId, …)` pelado en vez de `scoped()`.
- **IV Idempotencia**: ✅ el principio rige lo **entrante** ("todo evento
  entrante de un sistema externo"); las llamadas salientes de solo lectura no
  están en su alcance, por eso `mcp_tool_call` **no** lleva unique sobre
  `args_hash` (el mismo pedido vuelve a hacerse y su resultado cambia). El
  `PUT` del super admin es upsert por `organization_id`, `DELETE` es
  idempotente, y la migración es re-ejecutable por el journal de Drizzle.
- **V Calidad verificable / IX Comportamiento en vivo**: ✅ gate técnico
  (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`) + **E2E conducido
  de 21 pasos** con mocks, feliz e infeliz: localidad desconocida que se
  autocorrige, fuera de ventana que captura el lead, sin disponibilidad,
  servidor caído, credencial rechazada, texto hostil, promesa de reserva
  forzada por knob, evidencia doble del sandbox, entrenador dictando un precio,
  móvil a 375 px, y **SC-005** (techo de tiempo hasta la primera respuesta).
  Ningún paso tautológico: cada falla que el guion afirma detectar tiene un
  knob del mock que la produce.
- **VI Specs antes de código**: ✅ la cadena dura es `T001 → T002 → T003 → …`:
  las specs entran **antes** de `src/lib/db/schema.ts`, que es código y es
  contrato. T003 pierde el `[P]`.
- **VII Trazabilidad**: ✅ 22 decisiones con alternativas en
  [research.md](research.md); Sync Impact Report 1.6.0 → 1.7.0 con la
  motivación escrita y la nota de por qué es categoría nueva y no una extensión
  de la 3 (el MCP no es OAuth y lo habilita el super admin, no el operador por
  entorno); riesgos residuales documentados (D22), no silenciados.
- **VIII Foco vertical**: ✅ contestar con la disponibilidad, el precio y el
  enlace reales en el minuto de mayor intención de compra es exactamente
  "atender y convertir conversaciones de WhatsApp". Nada de plataforma.
- **Sandbox del Laboratorio**: ✅ D12, con evidencia consultable.

**Post-diseño**: sin violaciones nuevas. Dos desviaciones conscientes, ambas
declaradas y acotadas: (1) `node:https` es el **primer cliente HTTP crudo del
repo** —verificado: `src/lib/google/calendar-client.ts:25-70` usa `fetch` +
`AbortController`— y por eso viene con su propio test de transporte con
`request` inyectado (D11); (2) el texto del PMS puede llegar al KB por la ruta
larga *toolText → `note` del modelo → `appendLeadNote` → el dueño se lo dicta
al entrenador*, que se acota (nota de 200 caracteres prefijada `[sistema de
reservas]`) pero no se elimina — riesgo aceptado y documentado en D22.

## Arquitectura en capas

Cinco capas, cada frontera con una razón que no es estética. El molde es el que
ya existe para Google (`src/lib/google/` protocolo + `src/server/calendar/`
dominio), porque es el que la constitución exige en la letra (e).

```
  pipeline del agente  ──►  src/server/mcp/agent-tools.ts   (contrato [HERRAMIENTA], nunca lanza)
                                   │
                                   ▼
                            profiles/altos.ts               (PURO: validate · render · sandbox)
                                   │
                                   ▼
                            src/server/mcp/calls.ts         (allowlist · tasa · caché · sandbox · bitácora)
                                   │
                                   ▼
                            src/server/mcp/integration.ts   (fila scopeada · credencial cifrada)
                                   │
                                   ▼
                            src/lib/mcp/{client,transport,ssrf,envelope,errors}.ts   (protocolo PURO)
                                   │
                                   ▼
                              el servidor del cliente
```

| Frontera | Por qué está exactamente ahí |
|---|---|
| **`src/lib/mcp/` puro** (cero imports de `@/server/*` y `@/lib/db`) | Constitución II letra (e): adaptador dedicado. Es el único código del repo que habla HTTP con el tercero, igual que `src/lib/google/` y `src/lib/meta/`. Mantenerlo puro es lo que permite testear el transporte con un `request` falso, sin base, sin sesión y sin entorno — obligatorio porque es el primer `node:https` del repo (D11). |
| **`ssrf.ts` dentro de `lib/`, no del server** | El chequeo de IP tiene que vivir **pegado** a la resolución DNS que consume el socket: `guardedLookup` se pasa a `https.request({ lookup })`. Separarlo (validar primero, conectar después) reintroduce el TOCTOU de DNS rebinding, que es el fallo clásico de las implementaciones caseras. Por la misma razón `checkEndpointSyntax` se ejecuta **también** dentro de `postJsonRpc` y no solo en el caller. |
| **`markers.ts` como módulo hoja** | `sanitize.ts` tiene que quitar el marcador `ALOJAMIENTOS Y DISPONIBILIDAD`, que lo declara `agent-tools.ts`, que a su vez consume `sanitize.ts`. El ciclo se corta con un módulo sin dependencias que ambos importan. Los otros cuatro marcadores ya son hojas (`calendar/agent-tools.ts`, `ai/prompts.ts`, `trainer-prompts.ts`) y se importan, nunca se reescriben a mano. |
| **`calls.ts` separado de `agent-tools.ts`** | Concentra los **cinco** guardrails transversales —allowlist del perfil, límite de tasa, caché por `argsHash`, corte de sandbox con su fila de evidencia, y la única escritura en la bitácora— para que ninguna ruta HTTP ni ninguna rama futura del agente pueda olvidarse de uno. Es el chokepoint que hace cierta la frase «`calls.ts` es el único lugar que llama al MCP»: por eso `verify` también pasa por una puerta con límite de tasa. |
| **`profiles/` 100 % puro** | Lo específico del proveedor (qué herramientas existen, cómo se condensa la respuesta, qué enlaces se permiten, qué fixtures usa el sandbox) cambia por su cuenta y es lo único que hay que escribir para el segundo PMS. Puro = testeable como `src/server/calendar/slots.ts`, sin levantar nada. El registro `PROFILES` y el enum de la columna `profile` son la misma lista. |
| **`profiles/generic.ts` con superficie cero** | Un servidor MCP sin perfil conocido se conecta, hace el handshake y **muestra** lo que expone, pero no le da nada al agente: `allowedTools: []`, `agentActions: []`, `renderSection: () => null`. Exponerle a un LLM una herramienta arbitraria exigiría validar un JSON Schema desconocido en runtime, renderizar una salida sin contrato y confiar en que es de solo lectura — y lo único que lo afirma es la descripción que escribe el propio servidor, que es dato no confiable. `generic` es honesto: sirve para diagnosticar antes de que exista un perfil. |
| **`agent-tools.ts` calcado de `src/server/calendar/agent-tools.ts`** | Mismo contrato, para que el pipeline trate las dos familias igual: `loadMcpContext` → `renderMcpSection` → `executeStaySearch`/`executeShowStay`, cada ejecución devolviendo texto marcado con `[HERRAMIENTA]` y **nunca lanzando**. Es lo que hace que la letra (j) sea estructural y no una promesa. |
| **`promise-guard.ts` aparte** | Guarda pura sobre el texto saliente (molde de `isPlainAcknowledgment` y `HANDOFF_BACKUP_REGEX`): es el único cinturón anti-promesa-de-reserva que no depende de que el modelo obedezca el prompt, y al ser puro el E2E puede forzarlo con un knob del ai-mock. |
| **`src/lib/redact.ts` compartido** | `redactSecrets` no está exportada y solo cubre `sk-…`. Extraer la redacción a un módulo propio permite que `src/lib/ai/` y `src/lib/mcp/` la usen sin importarse entre sí — dos adaptadores que deben ignorarse. |

## Project Structure

```text
specs/016-mcp-connector/{spec,plan,research,data-model,quickstart,tasks}.md
  contracts/mcp-api.md · checklists/requirements.md
docs/integraciones/mcp-altos-de-calamuchita.md   # cómo pedir la credencial, qué expone, qué NO hace
scripts/mcp-smoke.mjs                            # smoke manual contra el MCP real; credencial por argv/stdin

src/
├── lib/
│   ├── db/schema.ts (+ mcp_integration, mcp_tool_call) · db/ids.ts (+ mint_, mcall_)
│   ├── redact.ts                   # NUEVO: redactValue por igualdad + el patrón sk- heredado
│   └── mcp/                        # NUEVO: protocolo PURO (cero imports de @/server/*, @/lib/db)
│       ├── errors.ts               #   McpError tipado + MCP_ERROR_TEXT (única fuente de mensajes)
│       ├── ssrf.ts                 #   checkEndpointSyntax · isBlockedAddress · guardedLookup
│       ├── transport.ts            #   POST JSON-RPC con node:https: tope de bytes, sin 3xx,
│       │                           #   Accept-Encoding: identity, SSE cortado al primer objeto,
│       │                           #   aserción dura de sandbox antes de cualquier I/O
│       ├── envelope.ts             #   Zod del sobre JSON-RPC + del doble sobre content[0].text
│       └── client.ts               #   mcpInitialize · mcpListTools · mcpCallTool · unwrapToolResult
├── server/
│   ├── mcp/                        # NUEVO: integración por empresa + puente con el agente
│   │   ├── markers.ts              #   módulo HOJA (corta el ciclo sanitize ↔ agent-tools)
│   │   ├── integration.ts          #   fila cifrada, vistas (empresa vs super admin), estado
│   │   ├── admin.ts                #   alta/baja por el super admin (URL, perfil, límites)
│   │   ├── catalog.ts              #   prefetch de list-search-options, TTL, stale-while-revalidate
│   │   ├── calls.ts                #   callGuarded: allowlist · tasa · caché · sandbox · bitácora
│   │   ├── sanitize.ts             #   texto ajeno → DATO (marcadores, controles, bidi, truncado)
│   │   ├── promise-guard.ts        #   guarda pura anti «te la reservo» sobre el texto saliente
│   │   ├── agent-tools.ts          #   loadMcpContext · renderMcpSection · executeStaySearch/ShowStay
│   │   └── profiles/
│   │       ├── types.ts            #   contrato del perfil (allowedTools, linkHosts, 6 funciones puras)
│   │       ├── index.ts            #   registro PROFILES
│   │       ├── generic.ts          #   superficie cero: conecta y muestra, el agente no ve nada
│   │       ├── altos.ts            #   PURO: parseCatalog · renderSection · validate · render · sandbox
│   │       └── altos-fixtures.ts   #   datos simulados del Laboratorio
│   ├── ai/
│   │   ├── actions.ts              # + search_stays, show_stay + normalizeAgentOutput (z.preprocess)
│   │   ├── prompts.ts              # + mcpSection/mcpActions; enmienda CONDICIONAL de :64 y :87;
│   │   │                           #   buildJudgePrompt + liveDataSection
│   │   ├── pipeline.ts             # presupuesto por familia, deadline, seenArgs, degradación por
│   │   │                           #   familia con deliverConversationalReply, re-chequeo de capacidad
│   │   └── trainer-prompts.ts      # + mcpLiveDataNotice condicional
│   ├── lab/personas.ts             # + persona de alojamientos
│   └── dev/
│       ├── mcp-mock-state.ts       # NUEVO: estado en globalThis + catálogo + knobs + log de llamadas
│       └── ai-mock.ts              # + dispatchStays ANTES de dispatchCalendar; rama del entrenador
│                                   #   con datos en vivo; knobs forcePromise / redirectNext
├── app/
│   ├── (app)/integrations/mcp/page.tsx         # server, async, notFound() sin fila
│   ├── api/integrations/route.ts               # extendido: ítem "mcp" solo con fila + campo detail
│   ├── api/integrations/mcp/{route.ts, verify/route.ts, preview/route.ts}
│   ├── api/admin/organizations/[id]/mcp/route.ts
│   └── api/dev/mcp-mock/{assistant/route.ts, state/route.ts}   # tras mockGuard(): 404 en producción
└── components/
    ├── integrations/integrations-index.tsx     # refactor a mapas por key (href, icono, descripción)
    ├── integrations/mcp-client.tsx             # NUEVO: Connection · Server · Agent · Preview · KbConflict
    └── admin/admin-client.tsx                  # + tarjeta «Conector MCP» dentro del .map de empresas

drizzle/0013_<adjetivo>_<sustantivo>.sql + meta/0013_snapshot.json + meta/_journal.json
tests/
├── unit/  mcp-ssrf · mcp-transport · mcp-envelope · mcp-sanitize · mcp-link-allowlist ·
│          mcp-promise-guard · mcp-integration · mcp-admin-route · mcp-integrations-route ·
│          mcp-profile-altos · mcp-catalog · mcp-calls · agent-actions-mcp · agent-tool-budget ·
│          mcp-mock · ai-mock-stays   (+ extender integrations-route.test.ts)
└── e2e/   016-mcp-connector.md      # 21 pasos, conducido con mocks
```

**Fuera de este árbol**: `.env.example` **no recibe nada** (letra g) y
`src/lib/env.ts` tampoco — la superficie de entorno de 016 es cero. Las
entradas `ALTOS_MCP_URL` / `ALTOS_MCP_TOKEN` de `.env` pasan a placeholders
`REEMPLAZA_...` con guía inline y quedan solo para el smoke manual.
