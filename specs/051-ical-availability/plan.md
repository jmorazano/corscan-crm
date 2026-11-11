# Plan — 051 disponibilidad por calendarios iCal (Airbnb)

Spec: [spec.md](spec.md). Constitución **1.16.0** (categoría 7 de II,
aprobada por el dueño el 11-nov-2026). Sin dependencias npm nuevas: parser
propio, transporte protegido de 016, ticker in-process como 023/042/044.
Migración **0038**. Molde: Mercado Libre (025) — snapshot en la BD y el turno
del agente que nunca sale a la red.

## 0. Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | URL `.ics` cifrada con `lib/crypto` (es la llave del feed); la UI y los logs ven solo la publicación y «…últimos 4» del token; el texto de los eventos se descarta en el parser. |
| II Soberanía | Categoría 7 (1.16.0): allowlist fija de hosts de Airbnb, HTTPS, anti-SSRF sobre la IP resuelta, 3xx rechazados, timeout, tope de bytes, lecturas espaciadas. Solo lectura. |
| III Multi-tenancy | `organization_id` NOT NULL en las dos tablas; todo por `scoped()`. |
| IV Idempotencia | Lectura = reemplazo del snapshot (con `content_hash` no se reescribe si no cambió); alta de unidad única por (empresa, `listing_id`). |
| V/IX Verificación | Unitarios puros + E2E con ical-mock + prueba real desde producción con los enlaces de Bosque Douglas. |
| Sandbox | `is_test` lee el snapshot tal cual; jamás dispara una lectura. |

## 1. Datos (migración 0038)

- `ical_integration` (1 por empresa): `id` (`ici_`), `organization_id`
  UNIQUE, `agent_enabled boolean not null default true` («El agente consulta
  estos calendarios»), `booking_url text` (enlace propio general, puede
  llevar `{entrada}`/`{salida}`/`{huespedes}`), `created_at`, `updated_at`.
- `ical_unit`: `id` (`icu_`), `organization_id`, `name` (≤ 60), `capacity`
  int (1–30), `description` (≤ 300), `booking_url` (opcional, pisa el
  general), `ical_url_enc` (cifrada), `listing_id` text (sacado de la URL;
  UNIQUE por empresa), `token_last4`, `position` int, snapshot:
  `busy_ranges jsonb` (`[{from,to}]`, ISO, `to` exclusivo, fusionados y
  ordenados), `horizon_to` (último día que cubre el feed, o null),
  `fetched_at` (último intento), `last_ok_at`, `last_error` (código propio,
  nunca texto del proveedor), `content_hash`, `created_at`, `updated_at`.
  Índice `(organization_id, position)` y `(last_ok_at)` para el ticker.
- Tope: 50 unidades por empresa (en el servidor, no en la BD).

## 2. Núcleo puro — `src/lib/ical/` (+ tests)

- `parse.ts` — `parseIcal(text, { tz, maxEvents=2000 })` →
  `{ ok: true, busy: Range[] } | { ok: false, code }`:
  desplegado de líneas (RFC 5545 §3.1, CRLF y LF), solo bloques `VEVENT`
  dentro de `VCALENDAR`, `DTSTART`/`DTEND` con `VALUE=DATE` (fechas
  flotantes, sin conversión) o `DATE-TIME` (`Z` o `TZID` → día local en
  `tz`), `DURATION` si falta `DTEND`, evento sin fin = 1 noche, `STATUS:
  CANCELLED` se ignora, `RRULE` → `unsupported`. NO conserva `SUMMARY`,
  `DESCRIPTION` ni ningún otro texto. Códigos: `not_calendar`,
  `unsupported`, `too_many_events`.
- `nights.ts` — `mergeRanges`, `isFree(busy, from, to)` (toda noche
  `from ≤ n < to` libre), `freeUnits(units, range, guests, { now, staleMs,
  horizonDays })` → `{ free, busyUnits, unconfirmed }` (sin lectura OK en
  3 h = `unconfirmed`; rango más allá de `horizonDays`=365 o de
  `horizon_to` = `beyond`), `findAlternatives(units, range, guests, today)`
  → hasta 3 ventanas ±7 días con las mismas noches, la más cercana primero
  (reusa `candidateOffsets` y `addDays`, importados de `src/lib/minihotel/`:
  son puros).
- `airbnb-url.ts` — `checkAirbnbIcalUrl(raw)` → `{ ok, listingId,
  normalizedUrl, tokenLast4 } | { ok:false, code }`: HTTPS, sin userinfo
  ni puerto, host `airbnb.<tld>` o `www.airbnb.<tld>` (`com`, `com.ar`,
  `ae`, `co.uk`, `es`, … por regex acotada), ruta
  `/calendar/ical/<dígitos>.ics`; en modo mocks también el host del
  ical-mock. `AIRBNB_HOST_PATTERN` exportado para el transporte.
- `booking-link.ts` — `buildStayBookingLink(template, { from, to, guests })`:
  reemplaza los tres marcadores (ISO, `encodeURIComponent`), valida HTTPS.
  `checkBookingUrl(raw)` para el alta.
- `render.ts` — `renderStaysSection(ctx)` (sección del prompt),
  `renderStaysResult(outcome)` (`[HERRAMIENTA] …`), `staysClientSummary`
  (frase segura si el modelo se cuelga después). Nombres y descripciones son
  del dueño; igual pasan por el saneo de marcadores de 016.

## 3. Transporte

- `getGuardedText` en `src/lib/mcp/transport.ts`, hermano de
  `postGuardedText`: `send()` acepta `method: "GET" | "POST"` y cuerpo
  opcional; mismo `checkedUrl` (anti-SSRF sobre la IP resuelta, 3xx
  rechazados), `agent: false`, `acquire`, tope de bytes y `sandbox` →
  excepción antes de cualquier I/O. User-Agent `VoceroCRM-CalendarSync/1.0`
  (verificado desde producción). Tipos aceptados: `text/calendar`,
  `text/plain`.
- La URL completa nunca se loguea ni viaja en un error (`McpError` con
  código propio).

## 4. Servidor — `src/server/ical/`

- `integration.ts` — `getIcalView(org)` (sin URLs), `upsertIcalSettings`,
  `createUnit` (valida la URL, hace una lectura de prueba con
  `fetchUnitFeed`; si no es un calendario no guarda), `updateUnit` (cambiar
  la URL repite la prueba; vacía = se conserva la anterior),
  `deleteUnit`, `reorderUnits`, `hasAgentStays(org)`.
- `sync.ts` — `fetchUnitFeed(url)` (descifra en el momento del uso,
  `getGuardedText` 10 s / 256 KB, `parseIcal` con la zona de la empresa =
  `agent_profile.follow_up_timezone`), `syncUnit(unitId)` (guarda snapshot
  o solo `fetched_at`+`last_error`, conserva lo último bueno; 404/410 →
  `link_revoked`, 403/429 → `blocked`, timeout/red → `unreachable`,
  parse → `invalid`), `syncOrganization(org, { force })`,
  `startIcalTicker()` (cada 60 s: unidades con `fetched_at` > 15 min, a lo
  sumo 20 por vuelta, una a la vez con 1,5 s entre pedidos, lock en proceso
  por unidad) en `instrumentation.ts`. «Leer ahora»: una vez por minuto por
  empresa.
- `agent-tools.ts` — `loadStaysContext(org, { now })` (null sin
  integración, con el agente apagado o sin ninguna unidad leída alguna
  vez; NUNCA sale a la red, tampoco fuera del sandbox),
  `renderStaysPromptSection`, `executeStaysAction(ctx, action)` → `{
  toolText, clientSummary, link }`; nada lanza hacia el pipeline.

## 5. Agente

- `actions.ts` — acción `check_stays`: `ranges` 1–3 de `{check_in,
  check_out}` (ISO; se aceptan también `check_in`/`check_out` sueltos como
  en `search_stays`), `guests` (1–30, opcional), más `lead_note` y `stage`
  laxos (044). `isStaysAction()`. `isConcreteAvailabilityQuery` suma
  `check_stays` con entrada y salida → etapa de interesados.
- `pipeline.ts` — `loadStaysContext` junto a `loadListingsContext`; familia
  propia en el loop de herramientas (2 vueltas, `staysRounds` en los
  contadores de `usedTools`); la guarda de promesas (`stripBookingPromise`)
  corre también cuando hay contexto de calendarios aunque no haya MCP, con
  `link` = el enlace de la última consulta; `staysSection` en el prompt.
- `prompts.ts` — `staysSection` en el input: sección `DISPONIBILIDAD DE LAS
  UNIDADES` (unidades nombradas con capacidad y descripción, qué significa
  la consulta, cuándo se leyó), línea del menú de acciones con un ejemplo,
  y reglas: «si preguntan por fechas → PRIMERO check_stays; nombrá las
  unidades libres una por una; para reservar mandá el enlace que te
  devuelve la herramienta; nunca digas que quedó reservado; precios,
  mínimos y políticas solo de tu conocimiento; unidad sin confirmar → no la
  ofrezcas, derivá si no queda ninguna».
- Resultado de la herramienta (texto para el modelo): por rango, las libres
  que alcanzan la capacidad (nombre · capacidad · descripción · enlace con
  las fechas), las que no alcanzan por capacidad, «sin confirmar» y, sin
  lugar, las alternativas. Rango pasado o inválido → texto que pide fechas.

## 6. API y UI

- `/api/integrations/airbnb-calendars` — `GET` vista (withOwner), `PUT`
  ajustes (switch + enlace general).
- `/api/integrations/airbnb-calendars/units` — `POST` alta;
  `/units/[id]` `PATCH`/`DELETE`; `/units/order` `PUT`.
- `/api/integrations/airbnb-calendars/sync` — `POST` «Leer ahora».
- La grilla de 30 días por unidad viaja en el `GET` principal (sin ruta
  `/preview` aparte).
- Página `/integrations/airbnb-calendars` (`requireOwnerPage`) +
  `src/components/integrations/airbnb-calendars-client.tsx`: switch,
  enlace general con ayuda de los marcadores, lista de unidades (estado,
  «leído hace…», error en criollo), diálogo de alta/edición con la guía
  «Airbnb → Calendario → Disponibilidad → Conectar con otro sitio web →
  Paso 1 → Copiar», «Leer ahora», grilla de 30 días. Mobile-first con
  `Dialog` de 012.
- Tarjeta en el índice de Integraciones (`/api/integrations` +
  `integrations-index.tsx`): siempre disponible (no depende de env).

## 7. Mocks y E2E

- `src/app/api/dev/ical-mock/` tras `dev-guard`: `GET
  /api/dev/ical-mock/calendar/ical/[id].ics` sirve el feed de la unidad;
  `POST /state` con `setBusy {id, ranges}`, `failNext {id, status}`,
  `garbageNext`, `delayMs`, `redirectNext`, `withGuestData` (reserva con
  `DESCRIPTION` y teléfono para probar que se descarta).
- ai-mock: rama `[E2E_STAYS] <entrada> <salida> <huéspedes>` → `check_stays`
  y luego una respuesta que nombra las unidades del resultado; rama
  `[E2E_STAYS_PROMESA]` que afirma «te lo reservé» para la guarda.
- Guion `tests/e2e/us-051-ical-availability.md`.
- `POST /api/dev/ical-sync {now}` adelanta el reloj del ticker / marca
  snapshots viejos.

## 8. Riesgos

- **Doble venta por demora**: mitigado con «jamás confirmar» + enlace al
  sistema propio, que es quien valida de verdad.
- **Airbnb cambia el formato o bloquea**: parser tolerante, el último dato
  bueno se conserva y caduca a las 3 h (deja de ofrecerse), aviso en el
  panel. Verificado hoy desde Railway.
- **El dueño regenera el enlace en Airbnb**: el viejo da 404 → `link_revoked`
  con «Copiá el enlace nuevo del Paso 1».
- **Conviven con el conector de alojamientos (016/028)**: posible en teoría;
  el prompt muestra las dos secciones. No se bloquea, se documenta.
