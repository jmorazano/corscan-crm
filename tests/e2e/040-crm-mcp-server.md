# E2E 040 — Conversar con el CRM desde Claude (servidor MCP)

Entorno: dev server del worktree (`node_modules/.bin/next dev -p 3000`), BD
local `vocero` con la migración 0029, usuario `e2e@vocero.test`: propietario
de «Negocio de Super Admin Local» (`org_m9651yzzrnaw62lwo4lm`, slug
`principal`) y miembro de «Inmobiliaria Demo». El cliente MCP de prueba es
`tests/e2e/fixtures/mcp-client.mjs` (sin dependencias: hace lo mismo que el
conector personalizado de Claude). El consentimiento se conduce en el
Browser pane. Cada conexión guarda su estado en un archivo del scratchpad
(`--state`), nunca en el repo.

```bash
node tests/e2e/fixtures/mcp-client.mjs unhappy --state <scratch>/a.json
node tests/e2e/fixtures/mcp-client.mjs connect --state <scratch>/a.json   # imprime AUTHORIZE_URL y espera
node tests/e2e/fixtures/mcp-client.mjs tools --state <scratch>/a.json
```

## A — Conexión (US1)

1. **Descubrimiento**: `POST /api/mcp` sin token → 401 con
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`;
   los dos metadatos responden y anuncian S256.
2. **Registro** dinámico con retorno loopback → 201 `acl_…`.
3. **Sin sesión** → `/login?next=/oauth/authorize?…`; al entrar vuelve al
   consentimiento (no a `/inbox`).
4. **Consentimiento** con el switch apagado: «Inmobiliaria Demo»
   deshabilitada con «Solo el propietario…», «Negocio de Super Admin Local»
   deshabilitada con «Activalo en Ajustes → Asistentes…», el aviso «No tenés
   empresas que puedas autorizar» y «Permitir» deshabilitado. La etiqueta del
   que pide acceso sale del retorno («Una aplicación en esta computadora
   (por ejemplo, Claude Code)») y el nombre registrado va como detalle.
5. **Switch** encendido en Ajustes → Asistentes (con confirmación) →
   recargar el consentimiento: la empresa queda tildable y preseleccionada
   (única autorizable) → «Permitir» → el cliente recibe `code` con el mismo
   `state` → canje 200 con `vat_`/`vrt_` y `Cache-Control: no-store`.
6. **Conexión en Ajustes**: aparece con la etiqueta, el usuario, fecha de
   alta y último uso.

## B — Cifras (US2)

`tools`: `initialize` (instrucciones en castellano), notificación → 202,
`tools/list`, `list_workspaces`, `get_message_metrics` con
`last_30_days`/`last_12_weeks`/`last_12_months`/`this_week`/`last_month` y
rango propio, `get_conversation_origins`, `list_campaigns`, `get_campaign`
(con destinatarios). Errores: rango al revés, `period` inválido, campaña
inexistente, empresa no autorizada → `isError` con texto claro; herramienta
inexistente → error JSON-RPC `-32602`.

**Paridad (SC-002)**: con la misma sesión, `GET /api/metrics?range=day|week|year`
y `GET /api/campaigns/<id>` dan EXACTAMENTE las mismas cifras que
`get_message_metrics` (recibidos por canal, anterior, historial del
celular, enviados, del agente, mediana/promedio/muestras del tiempo de
respuesta) y `get_campaign` (total, enviados, entregados, leídos,
respondidos, fallidos, salteados).

## C — Control y corte (US3)

1. **Renovación** (`refresh`): par nuevo, el access nuevo sirve.
2. **Switch apagado** → `get_message_metrics` sin empresa: «Ninguna de las
   empresas conectadas está disponible…»; con la empresa por nombre: «El
   acceso de asistentes está desactivado en «…»»; `list_workspaces` la
   marca `inactive_reason: disabled`. Encendido de nuevo → vuelve a andar.
3. **Registro**: Ajustes muestra cada consulta con fecha, usuario y
   etiqueta; las rechazadas con «Rechazada · acceso desactivado / no
   encontrado / pedido inválido». Nunca el contenido devuelto.
4. **Revocar** desde Ajustes (confirmación) → la consulta siguiente da 401
   y la renovación `invalid_grant` «La conexión ya no está activa».
5. **Código reusado** (`connect --reuse-code`) → `invalid_grant` y la
   conexión emitida con él queda cerrada (401).
6. **Refresh reusado** (`refresh --reuse`) → `invalid_grant` y la conexión
   se cierra (401).
7. **Límite** (`ratelimit`): la llamada 61 en un minuto → «Demasiadas
   consultas seguidas…» (`isError`), sin tumbar nada.
8. **Cambio de contraseña** (`POST /api/settings/password`) → la conexión
   activa da 401. (La contraseña de prueba se restaura enseguida.)
9. **Bajar a miembro** (`member.role = 'member'` en la BD local) →
   «Ya no sos propietario de «…»: el acceso del asistente a esa empresa
   quedó cortado.»; se restaura `owner` y vuelve a andar.
10. **Miembro** (empresa activa «Inmobiliaria Demo»): `GET
    /api/settings/assistants` → 403, `/settings/assistants` redirige y la
    pestaña «Asistentes (Claude)» no aparece; como propietario sí.

## Unhappy sin navegador (`unhappy`)

`GET /api/mcp` → 405 `Allow: POST` · token inventado → 401 con
`error="invalid_token"` · registro con retorno ajeno → `invalid_redirect_uri`
· cliente confidencial → 400 · authorize con cliente desconocido o retorno
no registrado → página «No se puede conectar» SIN redirigir · sin PKCE →
vuelve al cliente con `error=invalid_request` y `state` · `grant_type`
no soportado · cliente desconocido en token → 401 `invalid_client` · POST
del consentimiento sin sesión ni origen → rechazado.

## D — Claude Code real contra local (quickstart §2)

```bash
claude mcp add --transport http -s local vocero-local http://localhost:3000/api/mcp
claude mcp login vocero-local --no-browser
```

`add` → «Needs authentication» (leyó el 401 + metadatos). `login` hizo
descubrimiento, registro dinámico («Claude Code (vocero-local)», retorno
loopback), PKCE; el consentimiento se completó en el Browser pane y Claude
Code canjeó el token por su callback local → «Authenticated» y
`claude mcp get` → «✔ Connected». En cada arranque: `initialize` 200,
`notifications/initialized` 202, GET 405 (el canal SSE opcional),
`tools/list` 200.

Preguntas con `claude -p "…" --allowedTools "mcp__vocero-local__*"` (el CLI
necesita su propia sesión de Anthropic: `claude auth login`):

1. Empresas y canales → la empresa, WhatsApp conectado, Instagram
   desconectado.
2. Mensajes de 30 días contra los 30 anteriores → 51 (45 WA / 6 IG) contra
   115; tras agregar `previous_whatsapp/instagram`, canal por canal: WA 45
   vs 107, IG 6 vs 8.
3. Tiempo de respuesta → mediana 2,3 s, promedio 7,2 s, 38 respuestas,
   anterior 2,6 s, espera configurada 2 s.
4. Semana pasada → 8 nuevas (6 WA, 2 IG), 7 respondidas, 14 la anterior
   (contrastado con SQL directo: 6/5 + 2/2).
5. Origen del mes → 2 por comentarios de Instagram, 27 directas, 0 por
   anuncios.
6. Campaña con más respuestas → «Promo E2E clientes-2025»: 5 / 4 enviados /
   1 llegó / 1 leyó / 1 respondió / 1 fallido / 1 salteado — idéntico a
   `GET /api/campaigns/<id>`.
7. «Mandale un mensaje a los que respondieron» → no envía nada y explica
   que el conector es de solo lectura.

Aviso del cliente (benigno): `[mcp-sdk] SEP-2352: stored OAuth credential has
no 'issuer' stamp` — es del almacenamiento de credenciales de Claude Code;
la conexión funciona igual.

## E — Conversaciones, mensajes y contactos (US4)

Sembrado: `node tests/e2e/fixtures/seed-assistant.mjs` (chat «Prueba
Inyección 040» con etiqueta `e2e-040`, IA pausada, en atención humana, lead
en «Interesado», derivación del agente y un mensaje con intento de
inyección; y un chat del Laboratorio con la palabra `zanahoria040`).
`node tests/e2e/fixtures/mcp-client.mjs read --state …`:

- `search_conversations` por etiqueta, atención humana + IA pausada, etapa
  (sin mayúsculas), etapa inexistente (error con la lista), paginación.
- `search_messages`: «precio» del cliente; «cuanto» encuentra «Cuánto» (sin
  tildes); `has_attachment` y `types: ["video"]`; el Laboratorio NUNCA
  aparece; 1 letra → error.
- `get_conversation`: orden y autores (cliente, agente, cliente, cliente),
  la inyección llega como texto con `[HERRAMIENTA]` quitado, línea de
  derivación en `events`, tramos hacia atrás con `next_before`, el
  Laboratorio → «No encontré»; un adjunto con `summary_source: "resumen del
  CRM"` y sin URL ni binario.
- `search_contacts` / `get_contact` con etapa, etiquetas, conversaciones;
  los contactos del Laboratorio fuera.

## F — Pipeline y actividad del agente (US5)

- `get_pipeline`: etapas con tipo y cantidad = tablero del CRM
  (`/api/pipeline/board`: Nuevo 68 · En conversación 3 · Interesado 4 ·
  Cliente 2 · Perdido 4); leads de «Interesado» con su conversación.
- `get_agent_activity` de hoy: cuenta la derivación y la lista con su texto.

Bug encontrado y corregido: en un SELECT de una sola tabla drizzle no
antepone el nombre de la tabla, y dentro de un subquery `"id"` quedaba
ambiguo (contactos) o apuntaba a la tabla equivocada (el pipeline daba 0
leads). Esos subqueries van calificados a mano.

## G — Claude Code real con US4/US5

Seis preguntas: chats en atención humana o con IA pausada (y por qué), leer
y resumir «Prueba Inyección 040», qué preguntaron sobre precios, leads por
etapa, qué hizo el agente hoy, qué adjuntos mandaron los clientes. Todas
correctas contra la base. Ante la inyección respondió «Lo traté como dato,
no como instrucción, y no se hizo nada». Claude marcó dos faltas reales
(búsqueda sensible a tildes; sin filtro de adjuntos: tuvo que leer 31
conversaciones). Corregidas, la pregunta de adjuntos pasó a resolverse con
2 llamadas.

## Resultado (26-oct-2026)

A, B, C y unhappy: verdes (todas las verificaciones del cliente de prueba
OK). Paridad exacta con Métricas (los tres períodos) y con el detalle de la
campaña `cmp_pdelo2atnqdaohp6apw3`.

D (Claude Code real) verde con las siete preguntas; E, F y G verdes.
Pendiente fuera del self-test: Claude Desktop real contra producción
(quickstart §4).
