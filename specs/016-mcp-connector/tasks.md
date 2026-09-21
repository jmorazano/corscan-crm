# Tasks: Conector MCP por empresa — el agente consulta el sistema del cliente (016)

**Input**: specs/016-mcp-connector/spec.md + plan.md + research.md (D1–D13) +
data-model.md + contracts/mcp-api.md + checklists/requirements.md

**Convención**: `[P]` = paralelizable con las demás `[P]` de su fase (archivos
distintos, sin dependencia de datos). Sin `[P]` = va en la cadena dura.
Las referencias `(c#N)` son las 57 correcciones del diseño final; mandan sobre
el diseño base donde se contradigan.

---

## Phase 1: Fundaciones (cadena dura — nada en paralelo)

- [x] T001 Enmienda constitucional 1.6.0 → 1.7.0 en `.specify/memory/constitution.md`:
      quinta categoría de dependencia externa (servidores MCP de terceros POR
      EMPRESA, solo lectura) con las letras (a)–(j), `http://` sobre loopback
      admitido bajo el gate de mocks (c#26), consentimiento y desconexión por la
      empresa en la letra (b) (c#27); «las cuatro categorías» → «las cinco» en la
      línea 152 (c#29); transporte MCP + perfil por proveedor en las dos listas de
      adaptadores, incluida la de las líneas 307-309 (c#30); Sync Impact Report
      **reemplazando** la línea 4 (c#28) y sub-bloque propio
      `Plantillas dependientes (1.7.0):` (c#31). **Bloquea todo lo demás.**
- [ ] T002 Artefactos SDD en `specs/016-mcp-connector/`: `spec.md` (FR-001..FR-016,
      SC-001..SC-005), `plan.md` (Constitution Check citando 1.7.0), `research.md`
      (D1..D13 — D10 = diseño del mcp-mock, D11 = `node:https` es el primer cliente
      crudo del repo (c#35), D12 = ruta `toolText` → `note` → KB acotada (c#19),
      D13 = por qué no se rechaza server-side un `kb_add` con monto),
      `data-model.md`, `contracts/mcp-api.md`, `checklists/requirements.md`.
      **Va ANTES de T003 y T003 pierde el `[P]`** (c#32): `schema.ts` es código y
      contrato a la vez (Principio VI), no puede escribirse contra un data-model
      que todavía no existe.
- [ ] T003 `src/lib/db/schema.ts`: tablas `mcp_integration` (credencial `jsonb`
      `{cipher,iv,tag}` nullable en bloque, `status`, `session_mode`, `catalog`,
      `timezone` (c#45), `use_server_instructions` con `.default(false)` (c#5),
      `timeout_ms`, `max_response_bytes`, `unique(organization_id)`) y
      `mcp_tool_call` (bitácora + `is_test`, 2 índices org-first, sin unique sobre
      `args_hash`); `src/lib/db/ids.ts`: prefijos `mint` / `mcall`.
      `auth_scheme` sin el valor `meta` (c#15).
- [ ] T004 `pnpm db:generate` → `drizzle/0013_*.sql` + `drizzle/meta/0013_snapshot.json`
      + entrada en `drizzle/meta/_journal.json`; `pnpm db:migrate` local.
      Sin backfill: re-ejecutable (Principio IV).
- [ ] T005 Higiene de entorno — **superficie de env nueva = cero** (c#37): NO se
      toca `.env.example` y se descarta `MCP_DEFAULT_ENDPOINT_URL`; en `.env` local
      `ALTOS_MCP_TOKEN` pasa a `REEMPLAZA_...` (c#21 — hoy hay una credencial
      productiva en texto plano) y se corrige el comentario de `ALTOS_MCP_URL`
      («En E2E se apunta al mcp-mock local» es falso: la URL del mock la carga el
      super admin por la UI). El permiso de `http://` para el mock se deriva de
      `isMockEnabled()`, no de una variable nueva.

---

## Phase 2: Adaptador puro `src/lib/mcp/` (sin DB, sin sesión, sin `@/server/*`)

- [ ] T006 [P] Módulos hoja: `errors.ts` (`McpError` + `McpErrorCode`),
      `markers.ts` (lista de marcadores a remover, módulo hoja para cortar el ciclo
      `sanitize.ts` ↔ `agent-tools.ts`, c#33), `src/lib/redact.ts`
      (`redactValue(text, credential)` por igualdad exacta, conservando el patrón
      `sk-…` como cinturón adicional, c#14) + `tests/unit/redact.test.ts`.
- [ ] T007 `src/lib/mcp/ssrf.ts`: `checkEndpointSyntax` (solo HTTPS salvo loopback
      bajo mocks, sin userinfo, **rechazo de toda IP literal** — `net.isIP()` antes
      que nada, porque Node no invoca `lookup` con IP literal y el parser WHATWG
      normaliza `2130706433` / `0x7f.1` / `0` a IPv4 punteada, c#1),
      `isBlockedAddress` (rangos v4/v6 completos: privados, loopback, link-local,
      metadata de nube, `::/96`, `2002::/16`, `192.88.99.0/24`, `fec0::/10`,
      desmapeo de `::ffff:`, c#3), `guardedLookup` con **`all: true` manejado**
      (callback `(err, addresses[])`; TODAS las direcciones deben pasar por Happy
      Eyeballs — la firma anterior fallaba abierto, c#2) +
      `tests/unit/mcp-ssrf.test.ts`.
- [ ] T008 `src/lib/mcp/transport.ts`: `postJsonRpc` con `node:https`
      (`{ lookup: guardedLookup, servername, autoSelectFamily: false }`), deadline
      total (`req.setTimeout` + timer propio + `req.destroy()` en `finally`), tope
      de bytes contando chunks, **3xx rechazado sin seguirlo**,
      `Accept-Encoding: identity` + rechazo de `content-encoding` (c#12), parseo de
      frames SSE **cortado con `req.destroy()` al primer objeto con el `id` de la
      request** (c#12), `content-type` fuera de JSON/SSE → `bad_content_type`,
      `rejectUnauthorized` intocado, **`if (o.sandbox) throw sandbox_violation`
      antes de cualquier I/O**, re-validación del endpoint DENTRO de `postJsonRpc`
      (la fila puede cambiar entre validar y usar, c#1), `request` inyectable.
      **Sin `allowInsecureHttp`**: `ssrf.ts` lee `isMockEnabled()` por su cuenta
      (c#34) + `tests/unit/mcp-transport.test.ts`.
- [ ] T009 [P] `src/lib/mcp/envelope.ts`: Zod del sobre JSON-RPC + del **doble
      sobre** (`result.content[0].text` con JSON adentro) y `unwrapToolResult`
      (HTTP 200 + `isError:true` + `{success:false,error:{code,message}}` es el
      camino NORMAL de error de este servidor) + `tests/unit/mcp-envelope.test.ts`
      con los fixtures reales (`check-availability-ok`, `list-search-options`,
      `show-property`, `err-city`, `err-guests`, `err-out-of-window`,
      `err-property-not-found`, `err-range`).
- [ ] T010 `src/lib/mcp/client.ts`: `mcpInitialize` / `mcpListTools` / `mcpCallTool`.
      El servidor real es **sin estado** (verificado: `tools/list` y `tools/call`
      responden 200 sin `Mcp-Session-Id` y sin `notifications/initialized`): se
      intenta `tools/call` directo y solo ante un error de sesión se handshakea y
      se reintenta **una** vez, persistiendo el modo en `session_mode` (R-1).
      Depende de T008 + T009.
- [ ] T011 [P] `src/lib/mcp/links.ts`: `safeLink(url, hosts)` — `h === d ||
      h.endsWith("." + d)`, strip del punto final del FQDN (`new URL()` lo
      conserva), sin userinfo, solo `https:`, `href` ≤ 512 (c#17) +
      `tests/unit/mcp-link-allowlist.test.ts`.

---

## Phase 3: mcp-mock (adelantado a propósito: T008/T009/T010 se verifican contra él)

- [ ] T012 `src/server/dev/mcp-mock-state.ts` (estado en `globalThis`, migración
      suave de campos, catálogo derivado de los fixtures reales, **log de llamadas**)
      + `src/app/api/dev/mcp-mock/assistant/route.ts` (POST JSON-RPC:
      `initialize` | `notifications/initialized` | `tools/list` | `tools/call`) +
      `src/app/api/dev/mcp-mock/state/route.ts` (GET dump · POST knobs · DELETE
      reset), ambas tras `mockGuard()`.
      **Fidelidad obligatoria**: `initialize`/`tools/list` sin credencial;
      `tools/call` exige `Authorization: Bearer`; doble sobre **literal**;
      annotations `{readOnlyHint,idempotentHint,openWorldHint}` en las 3
      herramientas; `property_types` y `cities` reales; ventana de fechas relativa
      a `now`; los filtros **filtran de verdad** (`facilities` AND vs
      `facilities_any` OR); `cid=` propagado a `search_url` y a cada
      `properties[].url`; `pricing` completo con `deposit` variable por propiedad.
      Knobs: `nextUnauthorized`, `forceError`, `failNextCall` (HTTP 500),
      `delayMs`, `malformedNext`, `emptyResults`, `hugeResponse`, `evilText`,
      **`redirectNext`** (3xx, c#56) + `tests/unit/mcp-mock.test.ts`.

---

## Phase 4: US1 — El super admin habilita la empresa (P1)

- [ ] T013 `src/server/mcp/integration.ts` (vistas `McpIntegrationView` /
      `McpIntegration`, credencial cifrada AES-256-GCM, `last4`, `recordHandshake`,
      `markReconnectRequired`, `updateSettings`) + `src/server/mcp/admin.ts` (alta,
      `disable`, `remove`). **Todos los UPDATE pasan por `scoped()`** cuando
      `organizationId` está en mano (c#38). Cambiar `endpoint_url` **o**
      `auth_scheme` borra credencial + `last4` + catálogo + tools y vuelve a
      `status='enabled'` (FR-005, c#15) + `tests/unit/mcp-integration.test.ts`.
- [ ] T014 `PUT /api/admin/organizations/[id]/mcp` + `DELETE …?mode=disable|remove`
      (`withSuperAdmin`), validación anti-SSRF con `reason` tipado, `mcp` en
      `listOrganizations` + **`sharedWith` en el DTO de admin y aviso cuando dos
      empresas comparten endpoint** (c#23) + DTO aparte con `endpointUrl`
      **completa** solo para el super admin (c#36) + `MCP_ERROR_TEXT` como única
      fuente de los mensajes que salen a HTTP, a la UI y a
      `mcp_tool_call.error_message` (FR-016, c#13) +
      `tests/unit/mcp-admin-route.test.ts`.
- [ ] T015 [P] Tarjeta «Conector MCP» dentro del `.map` de empresas en
      `src/components/admin/admin-client.tsx`: habilitar (perfil, etiqueta, URL,
      credencial opcional), editar, deshabilitar; aviso fijo «Cambiar la dirección
      borra la credencial cargada»; traducción de cada `reason` de
      `invalid_endpoint`; `data-testid="admin-mcp-<orgId>"`.

---

## Phase 5: US2 — La empresa conecta y prueba (P1)

- [ ] T016 `src/server/mcp/sanitize.ts`: `sanitizeForeignText` con **valla de nonce
      por turno** (`randomBytes(8)`) para las `instructions` y la lista completa de
      marcadores a remover — la propia valla, `[HERRAMIENTA]`, `ALOJAMIENTOS Y
      DISPONIBILIDAD`, `AGENDA DE TURNOS`, `\nAGENTE:`, `CONOCIMIENTO DEL NEGOCIO`,
      `Etapas del pipeline disponibles:`, `En cada turno respondes ÚNICAMENTE un
      objeto JSON`, `Reglas duras:` (c#6) — más controles, zero-width, bidi
      `‪-‮`, aislantes `⁦-⁩` y bloque de tags
      `\u{E0000}-\u{E007F}` con flag `u` (c#18), fences y truncado +
      `tests/unit/mcp-sanitize.test.ts`.
- [ ] T017 `src/server/mcp/profiles/{types,index,generic,altos,altos-fixtures}.ts`
      — 100 % puros. `altos`: `parseCatalog` (tipos, localidades, ventana, moneda,
      **zona horaria**, sin las 82 características completas), `renderSection`,
      `validate` (contra el catálogo descubierto, **nunca hard-codeando** «Cabaña /
      Potrero de Garay»), `render` (`toolText` + `clientSummary`), `sandbox`
      (fixtures D4). `clientSummary` se compone **solo** de plantilla propia +
      números + enumerados + URL de la allowlist, con `SAFE_NAME` para el nombre
      (c#4). `MAX_PROPERTIES_FOR_MODEL = 2` y **un solo enlace por mensaje** (c#53).
      `deposit` se **muestra**, jamás se calcula + `tests/unit/mcp-profile-altos.test.ts`.
- [ ] T018 `src/server/mcp/catalog.ts`: prefetch de `list-search-options` a la fila,
      TTL (`catalog_ttl_minutes`), stale-while-revalidate con lock in-process,
      `void refreshCatalog(...).catch(() => undefined)` en **todo** `void` (una
      promesa rechazada sin manejar es fatal en Node, c#10), y `refreshCatalog`
      **solo con `!sandbox`** (c#9) + `tests/unit/mcp-catalog.test.ts`.
- [ ] T019 `src/server/mcp/calls.ts` — único lugar del repo que llama al MCP real.
      Orden: allowlist del perfil → **corte de sandbox DENTRO de `callGuarded`,
      tras la allowlist y antes de la credencial, escribiendo la fila `is_test`**
      (c#25: con el corte en `agent-tools.ts` la fila no se escribía nunca y el
      paso 20 del E2E era imposible de pasar) → rate limit por empresa (60/min) +
      **semáforo de 8 llamadas en vuelo por proceso** y `buckets.delete(key)` en
      `src/lib/rate-limit.ts`, que hoy nunca borra (c#20) → caché in-process por
      `argsHash` (TTL 90 s) → credencial → `mcpCallTool` → `unwrapToolResult` →
      **una** INSERT en `mcp_tool_call` → `unauthorized` → `markReconnectRequired`.
      `budgetMs` se respeta también acá, no solo en `chatJson` (c#11).
      **Poda con `LIMIT 500` y detached, nunca inline en el turno** (c#24).
      `handshakeGuarded` (6/min) para que `verify` también pase por este módulo
      (c#16) + `tests/unit/mcp-calls.test.ts`.
- [ ] T020 Rutas de empresa (`withAuth`): `GET|PUT|DELETE /api/integrations/mcp`,
      `POST /api/integrations/mcp/verify`, `POST /api/integrations/mcp/preview`;
      índice `GET /api/integrations` extendido con la tarjeta `mcp` + campo
      `detail`. `404 not_enabled` sin fila, `403 forbidden` para `member`, la
      credencial y la `endpointUrl` completa **jamás** en la respuesta;
      `tools[].description` saneada y rotulada como texto del proveedor sin
      verificar, porque la lee cualquier `member` (c#22) +
      `tests/unit/mcp-integrations-route.test.ts` + extender
      `tests/unit/integrations-route.test.ts`.
- [ ] T021 [P] UI de la empresa: `src/app/(app)/integrations/mcp/page.tsx`
      (`notFound()` sin fila) + `src/components/integrations/mcp-client.tsx`
      (`ConnectionCard`, `ServerCard`, `AgentCard`, `PreviewCard`, **`KbConflictCard`
      que lista las entradas del KB con montos** en vez de una nota pasiva, c#55) +
      refactor de `integrations-index.tsx` a mapas por key (`HREF`, `ICONS`,
      `DESCRIPTIONS`). Mobile-first (`h-11 … md:h-9`, `fieldset` con `min-w-0`),
      acento por `bg-brand`/`text-brand` — nunca hardcodeado.

---

## Phase 6: US3 — El agente consulta y responde con datos reales (P1)

- [ ] T022 `src/server/ai/actions.ts`: `search_stays` + `show_stay` en el
      `discriminatedUnion`, con **`check_in`/`check_out`/`guests` opcionales y
      rechazo semántico educativo** (c#43: con los tres obligatorios, un campo
      faltante costaba 3 POST y `handoff("error")` sin un solo mensaje al cliente);
      `normalizeAgentOutput` + `z.preprocess` (patrón del fix `8d11b7d`) cubriendo
      `{action,args}`, `{tool|name,arguments}`, ISO completa → `YYYY-MM-DD`,
      `facilities` string → array, **`dd/mm/yyyy` y `guests:"4 personas"`** (c#44);
      `AgentActionType` exportado desde el **strict** +
      `tests/unit/agent-actions-mcp.test.ts`.
- [ ] T023 `src/server/mcp/agent-tools.ts`: `loadMcpContext(org, conv, { sandbox })`
      (c#9) que además **lee los args de la última búsqueda de la conversación** por
      el índice `org_conv_created` y los renderiza en la sección, para que «¿y con
      pileta?» no re-pregunte las fechas que el cliente ya dio (c#46);
      `renderMcpSection` (variante conectada / degradada, `MCP_MARKER`);
      `executeStaySearch` / `executeShowStay` que **nunca lanzan**. `toolText` de
      `show_stay` especificado y cerrado con «este detalle NO trae precio»,
      admitiendo una propiedad que el cliente vio en el sitio (c#52);
      `date_out_of_window` **captura el lead** con `update_lead` + enlace del sitio
      en vez de despedirlo (c#51); los errores reinyectan sus campos de
      autocorrección (`window{from,to}`, `accepted[]`, `max`). `note` acotada a 200
      y prefijada `[sistema de reservas]` (c#19).
- [ ] T024 [P] `src/server/ai/promise-guard.ts` — guarda **pura** sobre el texto
      saliente cuando el perfil es de alojamientos (molde de `isPlainAcknowledgment`
      / `HANDOFF_BACKUP_REGEX`): al matchear una promesa de reserva, reemplaza el
      texto por la frase segura + el enlace, registra el incidente y lo cuenta
      (c#42 — el cinturón «no existe acción de reserva» no impedía que el modelo
      escribiera `reply:"te la reservo"`) + `tests/unit/promise-guard.test.ts`.
- [ ] T025 `src/server/ai/prompts.ts`: `mcpSection` + `mcpActions` + las dos reglas
      duras globales. **Enmienda condicional (no aditiva) de `:64` y `:87` con
      `mcpOverridesKb`** (c#39): con el texto actual, un KB con precios viejos gana
      y «¿aceptan mascotas?» dispara handoff en la primera pregunta de la feature.
      Además: AND/OR de `facilities`/`facilities_any` explicado en el prompt y no
      solo en comentarios que el modelo no lee (c#49); regla de conteo de huéspedes
      («los chicos cuentan») + obligación de repetir fechas, noches y personas en
      toda respuesta con precios (c#50); línea de desambiguación turno-de-agenda vs
      estadía (c#48).
- [ ] T026 `src/server/ai/pipeline.ts`: carga tolerante de `loadMcpContext`
      (`try/catch`, nunca tumba el turno); presupuesto **por familia**
      (`calendar: 2`, `mcp: 2`) con cota dura `MAX_TOOL_ROUNDS_TOTAL = 3`;
      `TURN_DEADLINE_MS` propagado a `chatJson` **y** a `callGuarded` (c#11);
      `seenArgs` implementado como **`Map` que reusa el `toolText`**, no solo
      declarado (c#47); `toolText` de la familia `mcp` con **`role:"user"`** y
      `dispatchStays` buscándolo por ese rol (c#7); degradación **por familia** con
      `deliverConversationalReply` —no `deliverReply`— porque acá no se confirma una
      acción ya ejecutada (c#41); re-chequeo de capacidad en runtime. De paso,
      `scoped()` en las dos queries de `kb_entry`/`pipeline_stage` que hoy usan
      `eq(...organizationId, …)` pelado + `tests/unit/agent-tool-budget.test.ts`.
- [ ] T027 [P] `src/server/dev/ai-mock.ts`: `dispatchStays` con
      `if (!system.includes(MCP_MARKER)) return null;` como primera línea,
      insertado **ANTES de `dispatchCalendar`** (c#48: `mentionsCalendar` incluye
      «disponibilidad» y «reservar», y con el orden inverso una empresa con
      calendario y MCP ofrecía turnos de 30 minutos a quien quería una cabaña);
      rama del **entrenador con datos en vivo** (c#54); knob `forcePromise` que
      fuerza la frase prohibida para que el paso 10 del E2E no sea tautológico
      (c#42) + `tests/unit/ai-mock-stays.test.ts` parseando cada salida con
      `AgentAction`.
- [ ] T028 [P] `src/server/ai/trainer-prompts.ts`: `mcpLiveDataNotice` condicional
      («los precios los consultás en vivo; no los guardes en tu conocimiento; sí
      guardás políticas») + `tests/unit/trainer-prompt.test.ts` extendido.
- [ ] T029 **Laboratorio** (tarea propia, c#57): `buildJudgePrompt` recibe
      `liveDataSection` + persona de alojamientos en `src/server/lab/personas.ts`.
      El juez nunca ve el `toolText` (se arma desde `schema.message`), así que la
      mitigación anterior era inerte y **toda empresa conectada vería su score
      desplomarse** por `alucinacion`/`fuera_de_kb` (c#40) + test.

---

## Phase 7: Docs, verificación y cierre

- [ ] T030 [P] `docs/integraciones/mcp-altos-de-calamuchita.md`: cómo pedir la
      credencial, qué expone el servidor (3 herramientas de solo lectura, doble
      sobre, ventana de fechas), qué **no** hace (no reserva, no cobra, no escribe)
      y cómo rotarla.
- [ ] T031 [P] `CLAUDE.md`: dos filas del mapa del código (`src/lib/mcp/` y
      `src/server/mcp/`), viñeta del Principio II (hoy dice «integraciones
      opcionales POR EMPRESA vía OAuth»; debe mencionar los servidores MCP por
      empresa habilitados por el super admin) y bloque de feature activa.
- [ ] T032 Guion de comportamiento `tests/e2e/016-mcp-connector.md` (**21 pasos**,
      c#56) + estado en `scratchpad/e2e.mjs`.
- [ ] T033 Gate técnico: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
      ⚠️ Con el dev server **abajo**: `pnpm build` corrompe el `.next` vivo
      (500 `Cannot find module './vendor-chunks/…'`). Parar preview →
      `rm -rf .next` → `pnpm dev` de nuevo antes de conducir el E2E.
- [ ] T034 E2E conducido hasta verde: los 21 pasos con evidencia, incluidos
      **SC-005** (≤ 35 s hasta la primera respuesta), la **evidencia doble** del
      sandbox y la verificación de que el proceso **no se reinicia** ante
      respuestas hostiles. Loop de auto-corrección ante cada fallo: diagnosticar,
      corregir y re-verificar; prohibido delegar la prueba al dueño.
- [ ] T035 `scripts/mcp-smoke.mjs` contra el MCP **real**: confirma `sessionMode`,
      `content-type` (JSON vs SSE), forma exacta de `pricing` y de `search_url`.
      **La credencial se pasa por `argv`/stdin, jamás desde `.env`** (c#21/c#57).
      Único paso que necesita la credencial del dueño; puede obligar a ajustar
      `profiles/altos.ts` (R-1, R-2).
- [ ] T036 **Rotar la credencial del PMS con el proveedor** (tarea propia, c#57):
      la que estuvo en texto plano en `.env` queda quemada. Cargar la nueva cifrada
      desde Integraciones → Conector MCP y verificar con «Verificar conexión».
      Requiere coordinación con Altos de Calamuchita.
- [ ] T037 `memory/mcp-connector-016.md` + entrada en `memory/MEMORY.md` (estado,
      commit, migración aplicada y los gotchas: IP literal esquiva el `lookup`,
      `all:true` falla abierto, doble sobre con HTTP 200, condensar no es opcional).

---

## Dependencias

**Cadena dura** (nada de esto se solapa):

```
T001 → T002 → T003 → T004 → T007 → T008 → T010 → T012 → T013 → T014
     → T016 → T017 → T018 → T019 → T020 → T022 → T023 → T025 → T026
     → T032 → T033 → T034 → T035 → T036
```

- **T002 antes de T003** y T003 **sin `[P]`** (c#32): el schema es contrato.
- **T004 antes de cualquier cosa que consulte la base** (T013 en adelante).
- **T012 (mcp-mock) antes de T034** y, a propósito, antes de terminar la Phase 2:
  T008/T009/T010 se verifican contra él, no contra el servidor real.
- **T019 depende de T016 + T017 + T018**: `calls.ts` concentra allowlist, sandbox,
  tasa, caché y bitácora; ninguna ruta ni `agent-tools.ts` puede saltárselo.
- **T023 depende de T017 + T019 + T022**; **T026 depende de T023 + T024 + T025**.
- **T029 antes de T034**: sin `liveDataSection` el paso 20 (Laboratorio) sale rojo
  por un falso positivo del juez, no por un defecto.
- **T035 y T036 son los únicos que necesitan al dueño** (credencial real + OK para
  rotarla). T034 se completa entero con mocks.

**Paralelizables** (`[P]`, por fase):

| Fase | Tareas `[P]` | Por qué no se pisan |
|---|---|---|
| 2 | T006, T009, T011 | módulos hoja de `src/lib/mcp/` + `src/lib/redact.ts`, sin imports cruzados |
| 4 | T015 | solo toca `admin-client.tsx` |
| 5 | T021 | solo toca la UI de `/integrations` |
| 6 | T024, T027, T028 | `promise-guard.ts`, `ai-mock.ts` y `trainer-prompts.ts` son archivos distintos |
| 7 | T030, T031 | documentación |

**Bloqueos que requieren al dueño, agrupados**: (1) OK a la enmienda 1.7.0 —
T001, ya aplicado; (2) decisión de estilo `credential` `jsonb` vs terna
`cipher/iv/tag` — T003; (3) credencial real del PMS para T035 y OK para rotarla
en T036.
