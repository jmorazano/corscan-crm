# Research — 005 Integraciones + Google Calendar

## D1 — Constitución: Google estaba PROHIBIDO en v1 (Principio II)

**Decisión**: enmienda MINOR 1.4.0 → 1.5.0. El Principio II gana una
categoría nueva: **integraciones opcionales POR EMPRESA vía OAuth**, con
condiciones duras: (a) sin ella el producto funciona completo, (b) la
habilita el operador de la instancia con sus propias credenciales de app,
(c) la conecta cada empresa con su consentimiento explícito, (d) tokens
cifrados en reposo, (e) aislada tras un adaptador dedicado, (f) el
instalador NO la necesita. Motivación: pedido explícito del dueño
(5-sep-2026) — el agente agenda turnos, lo cual es "convertir
conversaciones" (Principio VIII) y no un servicio de plataforma.
**Alternativas descartadas**: CalDAV genérico (Google lo desalienta y
exige contraseñas de app; no aporta OAuth), agenda interna propia (no
resuelve el calendario real que el negocio ya usa).

## D2 — OAuth 2.0: flujo de código de autorización server-side

- `GET https://accounts.google.com/o/oauth2/v2/auth` con `response_type=code`,
  `access_type=offline`, `prompt=consent` (garantiza refresh_token en cada
  conexión), `include_granted_scopes=true`, `state` firmado.
- Canje en `POST https://oauth2.googleapis.com/token` (code → access +
  refresh + id_token). Renovación con `grant_type=refresh_token`.
- Revocación best-effort en `POST https://oauth2.googleapis.com/revoke?token=`.
- **Scopes**: `https://www.googleapis.com/auth/calendar.readonly` (listar
  calendarios + leer ocupación) + `https://www.googleapis.com/auth/calendar.events`
  (crear/borrar eventos) + `openid email` (cuenta conectada para mostrar).
  Son scopes "sensibles" (no "restringidos"): no exigen auditoría de
  seguridad externa; en modo "Testing" del consent screen funcionan solo
  para usuarios de prueba y los refresh tokens CADUCAN A LOS 7 DÍAS —
  gotcha documentado en el paso a paso: publicar la app ("In production")
  aunque no esté verificada (Google muestra advertencia "app no
  verificada" pero el flujo funciona y el refresh token no caduca), o
  usar tipo "Internal" si el negocio tiene Google Workspace.
- **state**: HMAC-SHA256 (clave `BETTER_AUTH_SECRET`) sobre
  `{orgId, userId, nonce, exp}` en base64url; en el callback se verifica
  firma, expiración (10 min) y que el usuario/organización de la sesión
  coincidan → CSRF y "login CSRF" cubiertos sin cookie extra.
- El id_token se decodifica (payload base64url) SOLO para leer `email`:
  viene directo de Google por TLS en el canje server-to-server, no hace
  falta verificar firma para un dato de display.

## D3 — Credenciales de instancia vs. por empresa

La app de Google (client id/secret) es DEL OPERADOR (una por instancia,
como `META_APP_ID`): `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en env.
Redirect URI fija: `${APP_BASE_URL}/api/integrations/google-calendar/callback`.
La conexión (refresh token, calendario, reglas) es POR EMPRESA en la tabla
`calendar_integration` (UNIQUE por organization_id). Además, para el
self-test: `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_API_BASE_URL`
(defaults reales; el mock los apunta a `/api/dev/google-mock/...`), mismo
patrón que `OPENROUTER_BASE_URL`/`META_GRAPH_BASE_URL`.

## D4 — Ocupación: `freeBusy.query`, no `events.list`

`POST /calendar/v3/freeBusy` devuelve SOLO intervalos ocupados
(`busy: [{start,end}]`) del calendario pedido: es exactamente la garantía
de FR-008 ("sin detalles de turnos existentes") a nivel de API — el CRM
jamás recibe títulos ni asistentes. Se pide por ventana `[from, to]` del
horizonte (máx. 3 meses por consulta, sobra). Los turnos registrados en el
CRM que aún no estén en Google (carrera) también cuentan como ocupados.

## D5 — Cálculo de huecos: módulo puro, sin librería de zonas horarias

`src/server/calendar/slots.ts` es determinista: entradas = reglas +
zona + `now` + busy[] → huecos `[{start,end}]` en UTC con etiqueta local.
Conversión local→UTC con `Intl.DateTimeFormat` (offset por iteración
doble para bordes de DST) en `src/lib/time.ts`; sin `date-fns-tz`/`luxon`
(cero deps nuevas, Node 22 trae ICU completo). Reglas: para cada día del
horizonte, por cada franja `[HH:MM, HH:MM)` del día de semana en zona
local, huecos cada `slot + buffer` minutos; se descartan los que empiezan
antes de `now + minLeadHours` o se solapan con algún busy (solape estricto,
`start < busy.end && end > busy.start`).

## D6 — El agente: acciones "herramienta" con segunda vuelta acotada

El pipeline hoy es UNA acción por turno. Se agregan dos acciones:
`check_availability {date?}` y `book_appointment {start, note?, reply?}`.
Cuando el modelo devuelve `check_availability`, el servidor calcula los
huecos, agrega un mensaje `system` con marcador `[HERRAMIENTA]` y el
resultado, y vuelve a llamar al modelo (máx. **2 vueltas** por turno; a la
tercera se degrada a reply con los huecos crudos en texto). `book_appointment`
se valida server-side (formato, dentro de reglas, hueco libre AHORA vía
freeBusy + turnos CRM); si falla por ocupado → resultado de herramienta con
alternativas y una vuelta más; si falla por proveedor → handoff con
despedida "lo confirmo con el equipo". El modelo NUNCA decide la validez.
**Alternativa descartada**: tool-calling nativo de OpenAI (no todos los
modelos de OpenRouter lo soportan igual; el contrato JSON-acción existente
ya tolera formato inesperado con extracción + reintentos).

## D7 — Sandbox del Laboratorio

`is_test` → `check_availability` calcula huecos con reglas y busy=[] (sin
red); `book_appointment` responde confirmación y NO crea evento ni fila de
turno (persistir turnos de prueba ensuciaría la lista del negocio). Las
personas del Laboratorio no cambian en esta feature.

## D8 — Idempotencia y carreras

`appointment` UNIQUE (organization_id, contact_id, starts_at): la acción
repetida devuelve el turno existente (200 idempotente) y no crea otro
evento. Carrera entre dos clientes: se re-consulta freeBusy justo antes de
insertar; la ventana residual (ms) es aceptable para v1 (el propio Google
no ofrece reserva atómica sin appointment schedules de pago).

## D9 — Renovación de token y estado "requiere reconexión"

Access token cifrado + `access_token_expires_at`; se renueva si faltan
< 60 s. `invalid_grant` (revocado, caducado por modo Testing, contraseña
cambiada) → `status = reconnect_required`, la UI lo muestra con botón
Reconectar, el agente no ofrece turnos (FR-013). Errores 5xx/timeout NO
cambian el estado (transitorios): el turno degrada esa vez.

## D10 — Mock de Google para el self-test

`/api/dev/google-mock/*` tras `mockGuard()`: `auth` (GET → redirige al
redirect_uri con `code=mock-<nonce>` inmediato, sin pantalla), `token`
(POST: canje y refresh; refresh que termina en `-invalid` → 400
`invalid_grant`), `calendar/v3/users/me/calendarList`, `calendar/v3/freeBusy`,
`calendar/v3/calendars/{id}/events` (POST/GET) y `.../events/{eventId}`
(DELETE), más `state` (GET eventos/busy, POST agregar ocupado, DELETE
reset) para conducir carreras. Estado en memoria (`google-mock-state.ts`),
como el wa-mock. El ai-mock aprende a despachar: "turno"/"disponib" →
`check_availability`; con `[HERRAMIENTA]` presente y "dale"/"reserv"/
"el de las HH" → `book_appointment` del hueco elegido; si no, reply con
los huecos.

## D11 — Rol "admin de la compañía"

En Vocero el rol de empresa es `owner` (propietario) / `member`. El pedido
"usuario admin" mapea a `owner` — mismo criterio que Ajustes → IA y Equipo.
