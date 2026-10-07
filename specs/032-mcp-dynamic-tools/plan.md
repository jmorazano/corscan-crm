# Plan — 032 herramientas del conector sin deploy + reservas

## Idea central

Hasta 031 había dos niveles: el **perfil** (código) decidía qué herramientas
existían para el agente y cómo leerlas, y lo que el servidor publicaba era
solo información para la UI. Ahora son tres capas:

1. **Catálogo del servidor** (`tools/list` + `instructions`), congelado en
   cada handshake con esquema y anotaciones completos.
2. **Política por empresa** (`mcp_integration.tool_policy`): qué está
   activo. Consulta = activa por defecto; escritura = pendiente hasta que un
   humano la apruebe; un cambio de firma de una escritura la vuelve a
   pendiente. Sin deploy.
3. **Perfil** (opcional): condensa las herramientas que conoce (Altos:
   búsqueda y ficha). Todo lo demás va por el **camino genérico**
   (`use_tool`).

## Datos (migración 0026)

- `mcp_integration.tool_policy` jsonb NULL:
  `{ [tool]: { enabled: boolean, signature: string, by: string|null, at: iso } }`.
  Ausente = default según el tipo (consulta activa, escritura pendiente).
- `mcp_tool_call.result_excerpt` text NULL: extracto saneado (≤ 1.500
  caracteres) del resultado de una herramienta genérica, para la memoria de
  la conversación y la idempotencia de las escrituras.
- `mcp_tool_call.write` boolean NOT NULL default false.
- `mcp_integration.tools` (jsonb ya existente) suma por herramienta: `title`,
  `inputSchema` (saneado, ≤ 8 KB), `annotations`, `signature`. Las filas
  viejas sin `inputSchema` siguen andando: la herramienta se ofrece sin
  parámetros documentados hasta el próximo «Verificar».
- `conversation_event.kind` suma `ai_tool_write` (enum de TypeScript, sin DDL).

## Código

### Núcleo puro (`src/lib/mcp/`)

- `tool-policy.ts`: `toolSignature`, `classifyTool` (consulta o escritura
  según `readOnlyHint`), `effectiveTool` (perfil / activa / pendiente /
  apagada), `reconcilePolicy` (al handshake: invalida las aprobaciones de
  escrituras con firma nueva) y `applyToolDecision`.
- `json-schema.ts`: `validateToolArgs` (subconjunto de JSON Schema: object,
  properties, required, type —incluidas uniones con null—, enum, items;
  convierte "4"→4 cuando el tipo es integer o number; descarta claves
  desconocidas con aviso) y `describeParams` (líneas cortas para el prompt).
- `consent.ts`: `isExplicitConsent(texto)`, pura y conservadora.
- `generic-result.ts`: `renderGenericResult` (saneo profundo de strings,
  enlaces fuera de la allowlist → «[enlace omitido]», JSON compacto acotado)
  y `amountsIn` (importes de un resultado, para la excepción de precios).

### Servidor

- `integration.ts`: `recordHandshake` guarda la forma extendida e
  `instructions` hasta 24.000 caracteres, y reconcilia la política;
  `setToolDecision` (empresa o super admin); la vista expone por herramienta
  `title`, `kind`, `state` (`profile|active|pending|off`) y la cantidad de
  caracteres de las notas.
- `calls.ts`: la allowlist es la del perfil MÁS las herramientas genéricas
  activas (se re-evalúa contra la fila: nada de confiar en el caller). Las
  escrituras y las no idempotentes nunca salen de la caché; el sandbox de una
  genérica devuelve `{simulated:true}`; la bitácora guarda `write` y
  `result_excerpt`.
- `dynamic-tools.ts` (nuevo): `loadDynamicTools`, `readToolMemory`,
  `renderDynamicSection` (valla con nonce; descripciones ≤ 1.500 por
  herramienta; notas del proveedor si la empresa las activó) y
  `executeDynamicTool` (perfil → «usá search_stays»; validación; barrera de
  escritura: aprobada + conformidad + idempotencia + una por turno; render).
- `agent-tools.ts`: `loadMcpContext` ya no devuelve `null` para un perfil sin
  acciones si hay herramientas genéricas activas; el contexto suma
  `dynamic` (herramientas, memoria, `canWrite`, `wroteInConversation`).
- `profiles/types.ts` + `altos.ts`: `SectionInput.bookingTools` cambia la
  regla «no toma reservas» y la de importes; con herramientas genéricas, las
  notas del proveedor van en la sección genérica (no dos veces).
- `actions.ts`: `use_tool` (`tool`, `args`, `lead_note`) y `isMcpAction` la
  incluye.
- `prompts.ts`: línea de menú de `use_tool` y la sección genérica.
- `pipeline.ts`: rama `use_tool` dentro de la del conector (presupuesto
  propio de 3 vueltas); importes permitidos = los de resultados genéricos de
  este turno; guarda de promesas en modo «solo afirmaciones» con escritura
  activa, y apagada si ya salió bien una escritura en la conversación;
  evento `ai_tool_write` + nota del lead tras una escritura.
- `price-guard.ts`: `stripPrices(..., { allowedAmounts })`.
- `promise-guard.ts`: `stripBookingPromise(..., { claimsOnly, replacement })`.
- Entrenador: `trainer-prompts.ts` suma «TU CONECTOR» (estado, herramientas
  con su estado, notas resumidas a 4.000 caracteres); `trainer.ts` lo carga.

### API y UI

- `PUT /api/integrations/mcp` acepta `tools: { [nombre]: boolean }` (owner).
- `PUT /api/admin/organizations/[id]/mcp` acepta lo mismo (super admin).
- `mcp-client.tsx`: la lista de herramientas pasa a ser una tabla con estado
  e interruptor; las escrituras pendientes piden confirmación en un
  `Dialog`; aviso si hay genéricas activas y las notas del proveedor
  apagadas.
- Administración (`mcp-admin-client.tsx`): la misma lista con interruptores.

### Mocks

- mcp-mock: las 4 herramientas de reserva con borradores en memoria, sus
  errores estables, `instructions` largas, y knobs `bookingUnavailable`
  (`no_longer_available` al confirmar) y `extraTool` (publica una
  herramienta nueva para probar «reconectar y aparece»).
- ai-mock: rama `use_tool` que recorre el flujo (iniciar → datos → resumen →
  confirmar) leyendo la sección genérica y los `[HERRAMIENTA]`.

## Constitución 1.11.0 → 1.12.0 (MINOR)

Principio II, categoría 5, condición (f): de «SOLO LECTURA con allowlist
propia» a «consulta activa por defecto; escritura solo aprobada por
herramienta por el super admin o el propietario, re-aprobación si cambia su
definición, conformidad explícita del interesado verificada por el CRM, a lo
sumo una vez por conversación y argumentos, nunca pagos; el agente no afirma
una reserva que la herramienta no confirmó».

## Verificación

- Unit: política, esquema, conformidad, render genérico, guardas con las
  opciones nuevas, sección de Altos con y sin reservas, prompt del
  Entrenador.
- Gate: tsc + eslint + vitest + next build.
- E2E (Playwright + mocks): reconectar → aparecen las 4 → la de escritura
  pendiente → aprobar → conversación de WhatsApp de punta a punta hasta el
  enlace de pago; caminos infelices: «no, esperá» no confirma, doble
  confirmación no duplica, `no_longer_available`, herramienta nueva por
  `extraTool` aparece sin deploy, el Entrenador las describe.
