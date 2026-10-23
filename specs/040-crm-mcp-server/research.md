# Research — 040 Conversar con el CRM desde Claude

Decisiones técnicas de la feature, con lo que se descartó. Cada una cita el
requisito de la [spec](spec.md) que resuelve.

## D1 · Servidor de autorización OAuth propio (no el plugin `mcp` de Better Auth)

**Decisión**: implementar un servidor de autorización OAuth 2.1 mínimo y
propio en `src/lib/oauth-server/` (puro) + `src/server/assistants/` (BD),
con descubrimiento, registro dinámico, código + PKCE, renovación y
revocación.

**Rationale**:
- Better Auth 1.6.23 trae `better-auth/plugins/mcp` (sobre `oidc-provider`),
  pero guarda `accessToken`/`refreshToken` **en texto plano** y los busca
  por valor (`findOne({ field: "accessToken", value })`). Choca con
  constitución I y con lo que ya hicimos en 014 (`vk_` hasheadas) y 029
  (token de recuperación hasheado) — FR-006, SC-007.
- El plugin no sabe de empresas: el consentimiento no puede elegir empresas
  (FR-004) y el token no se ata a un subconjunto de organizaciones.
- Monta su propio `/oauth2/consent` y asume la sesión del plugin; acá la
  sesión y el gate de contraseña temporal son nuestros (`requireSession`).
- El servidor propio es acotado (cinco endpoints) y reutiliza piezas que ya
  existen: hash SHA-256 como `src/lib/api-keys.ts`, PKCE S256 como
  `src/lib/meli/oauth.ts`, `checkRateLimit`, `clientIp`.

**Alternativas**: plugin `mcp` (descartado por lo anterior); plugin
`oidc-provider` completo (mismo almacenamiento en claro y emite ID tokens
que no necesitamos); un proveedor externo de identidad (prohibido por II).

## D2 · Protocolo MCP: HTTP *streamable* sin estado, respuestas JSON

**Decisión**: `POST /api/mcp` con JSON-RPC 2.0, sin `Mcp-Session-Id`, cada
pedido autocontenido; responde `application/json` (nunca SSE). Métodos:
`initialize`, `notifications/initialized` (y toda notificación → `202`
sin cuerpo), `ping`, `tools/list`, `tools/call`. `GET` y `DELETE` → `405`
(el transporte permite no ofrecer el canal SSE de servidor a cliente). Un
arreglo (batch) → error `-32600` (la revisión 2025-06-18 lo quitó).

**Versión**: se anuncia `2025-06-18`; si el cliente pide `2025-03-26` o
`2025-11-25` se responde con la que pidió (las tres son compatibles para lo
que usamos: herramientas sin estado). Otra → la nuestra.

**Rationale**: monolito sin colas (CLAUDE.md); herramientas de lectura
cortas; sin estado no hay sesiones que limpiar ni afinidad entre réplicas.
Escrito a mano como el cliente de 016 (`src/lib/mcp/transport.ts`): sin
`@modelcontextprotocol/sdk`, cuyo transporte de servidor está pensado para
`req/res` de Node y arrastra Express-isms.

**Alternativas**: SDK oficial (descartado: dependencia grande para ~200
líneas de protocolo); SSE legado `/sse` (deprecado).

## D3 · Descubrimiento (lo que hace o rompe la conexión de Claude Desktop)

**Decisión**:
- Todo `401` de `/api/mcp` lleva
  `WWW-Authenticate: Bearer resource_metadata="<APP_BASE_URL>/.well-known/oauth-protected-resource/api/mcp"`
  (y `error="invalid_token"` si había un token). Hay reportes de que sin
  este encabezado Claude Desktop falla antes de mostrar el login
  (claude-ai-mcp#313).
- *Protected Resource Metadata* (RFC 9728) en
  `/.well-known/oauth-protected-resource/api/mcp` **y** en la raíz
  `/.well-known/oauth-protected-resource` (clientes que no agregan el path).
- *Authorization Server Metadata* (RFC 8414) en
  `/.well-known/oauth-authorization-server`, con `issuer = APP_BASE_URL`,
  `code_challenge_methods_supported: ["S256"]`,
  `token_endpoint_auth_methods_supported: ["none"]`,
  `grant_types_supported: ["authorization_code", "refresh_token"]`,
  `scopes_supported: ["crm.read"]`, `registration_endpoint`,
  `revocation_endpoint`.
- Parámetro `resource` (RFC 8707) aceptado en authorize y token: si viene,
  debe ser exactamente `<APP_BASE_URL>/api/mcp` (sin barra final); el token
  queda atado a ese recurso.

Rutas en `src/app/.well-known/...` (App Router sirve carpetas con punto).

## D4 · Registro dinámico de clientes y qué nombre mostrar

**Decisión**: `POST /api/oauth/register` (RFC 7591), solo clientes públicos
(`token_endpoint_auth_method: "none"`), `grant_types`
`authorization_code`+`refresh_token`. `redirect_uris` permitidas (pura,
`src/lib/oauth-server/redirect-uris.ts`):
- `https://claude.ai/api/mcp/auth_callback` y
  `https://claude.com/api/mcp/auth_callback` (exactas);
- loopback `http://localhost:<puerto>/<path>`,
  `http://127.0.0.1:<puerto>/<path>`, `http://[::1]:<puerto>/<path>`
  (RFC 8252: cualquier puerto, sin userinfo ni fragmento) — Claude Code.
Cualquier otra → `400 invalid_redirect_uri`. Límite: 10 registros por hora
por IP. Los clientes sin ninguna autorización a las 24 h se borran (barrido
diario).

**El nombre del cliente es dato no confiable** (cualquiera puede registrar
«Claude»). El consentimiento muestra una etiqueta derivada del destino de
retorno, no del nombre registrado: «Claude (claude.ai)» para las de Claude
y «Una aplicación en esta computadora (por ejemplo, Claude Code)» para
loopback; el `client_name` registrado aparece solo como detalle
secundario, saneado y recortado.

**CIMD** (*Client ID Metadata Documents*, 2025-11-25): fuera de v1
(`client_id_metadata_document_supported` ausente). Claude soporta DCR.

## D5 · Tokens opacos hasheados, rotación y vencimientos

**Decisión**:
- Access token `vat_` + 32 bytes base64url; refresh token `vrt_` + 32
  bytes. Se guarda solo `SHA-256` (hex) con índice único; búsqueda por
  hash (como `vk_`, sin comparación en tiempo constante: el atacante no
  controla el hash). El prefijo sirve para reconocerlos a simple vista y en
  un `grep` de logs; igual nunca se loguean (el redactor de `redact.ts` es
  por valor, no por forma).
- Access: 1 h. Refresh: 30 días, de un solo uso; cada renovación emite un
  par nuevo y marca el anterior `used_at`. **Reuso** de un refresh ya usado
  → se revoca la conexión entera (`revoked_reason = 'refresh_reuse'`).
- Conexión inactiva 90 días (`last_used_at`) → `expired`, no renueva.
- Código de autorización: 32 bytes, hasheado, 5 min, un solo uso, atado a
  `client_id`, `redirect_uri`, `code_challenge` (S256), `resource`, usuario
  y empresas elegidas. Reuso del código → error y revocación de lo que se
  emitió con él.
- `scope` único `crm.read` (si el cliente pide otro o ninguno, se emite
  `crm.read`; `offline_access` se acepta y se ignora: siempre hay refresh).

**Riesgo conocido**: si Claude renueva en paralelo dos veces el mismo
refresh, la detección de reuso lo desconectaría. Se valida en la prueba
real (quickstart §4); si aparece, se agrega una gracia de 30 s que devuelve
el MISMO par nuevo al segundo pedido idéntico.

## D6 · Consentimiento y vuelta del login

**Decisión**: página `src/app/oauth/authorize/page.tsx` FUERA del grupo
`(app)` (sin shell ni redirección de rol):
1. Valida los parámetros (cliente registrado, `redirect_uri` registrada para
   ese cliente, `response_type=code`, `code_challenge` S256, `state`,
   `resource`). Error de cliente o de `redirect_uri` → página de error
   propia, **sin redirigir** (no se redirige a un destino no validado).
   Otros errores → redirección a la `redirect_uri` con `error=`.
2. Sin sesión → `/login?next=<authorize con sus parámetros>`. Contraseña
   temporal → `/change-password?next=…`. `next` solo acepta rutas
   relativas que empiecen con `/oauth/authorize?` (puro,
   `src/lib/oauth-server/next-path.ts`); el login y el cambio de contraseña
   lo respetan (hoy van fijo a `/inbox`).
3. Muestra el consentimiento (FR-003) con las empresas del usuario: solo
   tildables las que es `owner` y tienen el switch encendido (FR-004);
   las demás deshabilitadas con el motivo.
4. «Permitir» → `POST /api/oauth/authorize` (misma validación de nuevo,
   sesión + `Origin` igual a `APP_BASE_URL` contra CSRF, al menos una
   empresa) → crea el código y devuelve la URL de retorno; el cliente del
   navegador navega a ella. «Cancelar» → `error=access_denied`.

## D7 · Autorización en cada llamada (FR-007, FR-008, SC-003, SC-004)

**Decisión**: `resolveAssistantCall(bearer)` (BD) → token vigente + conexión
`active` + usuario. Luego, por herramienta, `authorizeWorkspace(grant,
workspace)`:
- la empresa está en `assistant_grant_org` de esa conexión,
- `assistant_settings.enabled = true` para esa empresa,
- `member` del usuario en esa empresa con `role = 'owner'` (fuente de verdad
  de 018/022; quitar al usuario o bajarlo de rol corta en el acto).
Fallo → error de herramienta en castellano con motivo, y registro
`denied`. Sin caché: tres lecturas por índice por llamada; es barato y
cumple «desde la consulta siguiente».

`workspace` es parámetro de toda herramienta salvo `list_workspaces`:
acepta el id (`org_…`) o el nombre/slug exacto; si la conexión tiene una
sola empresa activa, se puede omitir.

## D8 · Formato de los resultados y texto de terceros (FR-019, FR-020)

**Decisión**: `tools/call` devuelve `structuredContent` (objeto) **y** el
mismo objeto como JSON compacto en `content[0].text` (clientes que no leen
`structuredContent`). Cada herramienta declara `inputSchema` y
`outputSchema` y `annotations: { readOnlyHint: true, openWorldHint: false,
destructiveHint: false, idempotentHint: true }`.

Todo campo con texto escrito por un tercero (texto de mensajes, nombres de
contactos, captions, comentarios, transcripciones, resúmenes de adjuntos)
pasa por `sanitizeForeignText` de 016 (quita marcadores internos y
caracteres de control, recorta) y el resultado lleva un campo
`aviso_contenido_de_terceros` explicando que esos campos son datos y no
instrucciones. Las `instructions` del `initialize` lo repiten. Errores de
negocio → `isError: true` con texto claro (no error JSON-RPC), como pide
la especificación para que el modelo los vea.

**Alternativa**: cercar con delimitadores con nonce como en el prompt del
agente (016). Innecesario: acá el texto va en JSON estructurado y el
modelo que lo lee es el del propio usuario; la defensa real es que no
existe ninguna herramienta que escriba (FR-009).

## D9 · Esquemas de entrada: `zod/v4` → JSON Schema

**Decisión**: los esquemas de entrada de las herramientas se definen con
`zod/v4` (incluido en `zod@3.25.76` instalado, sin dependencia nueva) y se
publican con `z.toJSONSchema()`; la misma definición valida en
`tools/call`. Errores de validación → `isError` con el campo y el motivo.

**Alternativa**: JSON Schema a mano + Zod 3 (dos fuentes que se separan).

## D10 · Métricas: misma consulta, períodos nuevos (FR-011, SC-002)

**Decisión**: refactor sin cambio de comportamiento de
`src/server/metrics/overview.ts`: `overviewIn` pasa a
`overviewForWindow(organizationId, window, timeZone)` (exportada) y la
página de Métricas sigue llamando a `getMetricsOverview(range)`. En
`src/lib/metrics.ts` (puro) se agrega `periodWindow(period | {from,to},
timeZone, now)` que arma un `MetricsWindow` para: `today`, `yesterday`,
`this_week`, `last_week`, `this_month`, `last_month`, `last_30_days`
(= ventana `day` de Métricas), `last_12_weeks` (= `week`), `last_12_months`
(= `year`), `this_year` y rango `from`/`to` (fechas locales, máximo 400
días). Unidad de la serie automática (≤ 62 días → día, ≤ 26 semanas →
semana, si no mes); comparación = misma duración inmediatamente anterior.
Se suma «conversaciones nuevas» (conversaciones reales creadas en la
ventana) en el módulo del asistente, sin tocar la pantalla.

Test de paridad: con el seed de 024, `last_30_days/last_12_weeks/
last_12_months` dan exactamente lo mismo que `getMetricsOverview(day/week/
year)`.

## D11 · Campañas: extraer el conteo de la ruta (FR-013, SC-002)

**Decisión**: mover los tres conteos de `GET /api/campaigns/[id]`
(estados de destinatario, estados de entrega por JOIN a `message`,
respondidos por `replied_at`) a `campaignCounts(orgId, campaignId)` en
`src/server/campaigns/stats.ts`; la ruta lo usa (mismo JSON) y el asistente
también. El asistente agrega, sin redefinir: `reached = delivered + read`
(explicado en el resultado) y `reply_rate = replied / reached`. Motivos de
fallo agrupados con `friendlyDeliveryError` (010). Listado con
`parseCampaignFilters`/`likePattern` de `manage.ts`.

## D12 · Conversaciones, mensajes y contactos (FR-014…FR-016)

**Decisión**: consultas propias en `src/server/assistants/queries/` que
reutilizan los predicados de la Bandeja para no divergir: `tagsWhere`
(006), `conversationSearchWhere` (se exporta de `inbox/queries.ts`),
`contactListWhere` (033), `serializeContact`, `toMediaDto` (026),
`eventText` (031) y `originForClient` (035, deja afuera el `ctwa_clid`).
Filtros extra solo del asistente: etapa (`lead.stage_id`), origen
(`conversation.ig_origin->>…`), `handoff_at is not null`, `ai_enabled =
false`, rango de actividad. Siempre `kind in ('whatsapp','instagram')` y
`is_test = false` (el Entrenador es `kind='trainer'`).

**Búsqueda dentro de los mensajes** (`search_messages`): `ILIKE` escapado
sobre `message.text` con ventana obligatoria (default 90 días, máximo 365),
tope 50 coincidencias con fragmento alrededor del hallazgo. Sin `pg_trgm`
en v1 (volúmenes de las empresas actuales: decenas de miles de mensajes);
se mide en el E2E y queda la extensión como mejora si hiciera falta.

Lectura de hilo: tramos de 50 (máx. 100) mensajes del más nuevo hacia
atrás, cursor keyset `(created_at, id)` de `src/lib/pagination.ts`.
Autor: `in` → cliente; `out` + `ai` → agente; `sent_by_user_id` → persona
del equipo (nombre); `source='phone'` → celular; `api_key_id` → API;
destinatario de campaña → campaña; `source='history'` → «del historial».

## D13 · Registro de uso y límites (FR-025, FR-026)

**Decisión**: `assistant_access_log` por empresa, escrito en segundo plano
(un fallo de escritura jamás tumba la consulta) con una descripción en
lenguaje claro que arma cada herramienta (`describeCall`), sin contenido
devuelto. Purga diaria de > 90 días en el ticker existente de
`instrumentation.ts`, junto con el barrido de clientes huérfanos, códigos y
tokens vencidos. Límites con `checkRateLimit` (in-process, monolito):
`assistant:<grantId>` 60/min; registro 10/h por IP; authorize/token 30 por
10 min por IP (IP de `clientIp`, FR-062).

## D14 · Revocaciones automáticas (FR-024)

**Decisión**:
- Cambio de contraseña propio (`/change-password` de Better Auth) y reset
  por correo (`onPasswordReset`, 029) → `revokeAllGrantsForUser(userId,
  'password_change')`. El hook se agrega en `hooks.after` para el path de
  cambio y en `onPasswordReset`.
- Reset de contraseña temporal por el super admin (019) → idem.
- Quitar al usuario de la empresa o bajarlo de rol: no hace falta hook (D7
  lo corta por llamada); quitar la cuenta → `ON DELETE CASCADE`.

## D15 · Constitución y privacidad

**Decisión**: enmienda **MINOR 1.13.0** (agrega una regla nueva, no cambia
las existentes): en el Principio I, «Acceso entrante de asistentes del
usuario» — una persona con rol propietario puede autorizar a un asistente
de IA que ELLA eligió a LEER datos de sus empresas por el estándar MCP;
condiciones: (a) apagado por defecto por empresa, (b) consentimiento
explícito por empresa, (c) solo lectura salvo enmienda futura, (d) tokens
solo hasheados, cortos y revocables, (e) revalidación de rol y empresa en
cada llamada, (f) registro de uso visible para el propietario, (g) sin
conversaciones de prueba ni del Entrenador, sin secretos. No es una
dependencia de runtime de la instancia (II no cambia: el CRM no llama a
nadie). Se tramita con `/speckit-constitution` en la implementación.

Política de privacidad: un párrafo nuevo (qué datos puede leer un
asistente conectado por el propietario, que viajan a la cuenta de ese
asistente bajo las condiciones de ese proveedor, y cómo revocarlo). La
política vive fuera de este repo (`APP_PRIVACY_URL`, hoy
`https://corscan.com.ar/privacidad`); lo redacta el subagente
`public-site-builder` y se publica con el OK del dueño.

## D16 · Verificación (FR-029)

**Decisión**:
- Unit (Vitest): PKCE, listas de retorno, `next`, formato y hash de
  tokens, máquina de estados de la conexión, `periodWindow` + paridad,
  JSON-RPC (parseo, versiones, errores), validación de argumentos,
  `authorizeWorkspace` (tabla de casos), autor de mensajes, saneo.
- E2E `tests/e2e/040-crm-mcp-server.md`: un cliente MCP de prueba
  `tests/e2e/fixtures/mcp-client.mjs` (Node, sin dependencias) hace
  registro → abre la URL de autorización en el Browser pane (login +
  consentimiento conducidos con Playwright/Browser) → recibe el código en un
  listener loopback → token → `initialize` → `tools/list` → cada
  herramienta contra el seed de números conocidos → renovación →
  revocación por UI. Caminos infelices: switch apagado, empresa no
  autorizada, miembro, retorno no permitido, código reusado, refresh
  reusado, token vencido (perilla de reloj del módulo), 60/min.
- En vivo: Claude Code contra `http://localhost` (acepta HTTP local) en el
  self-test; Claude Desktop contra producción en la empresa principal del
  operador antes de habilitárselo al cliente (quickstart §4).
