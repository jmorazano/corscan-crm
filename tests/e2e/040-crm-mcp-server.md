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

## Resultado (26-oct-2026)

A, B, C y unhappy: verdes (todas las verificaciones del cliente de prueba
OK). Paridad exacta con Métricas (los tres períodos) y con el detalle de la
campaña `cmp_pdelo2atnqdaohp6apw3`.

Pendiente fuera del self-test: Claude Code real contra `localhost`
(`claude mcp add --transport http …`, quickstart §2) y Claude Desktop real
contra producción (quickstart §4).
