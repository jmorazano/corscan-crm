# Tasks — 051 disponibilidad por calendarios iCal (Airbnb)

Constitución 1.16.0 ya enmendada en esta rama (categoría 7 de II).

## Fase A — Datos y núcleo puro
- [x] A1 `schema.ts` + migración 0038 (`pnpm db:generate`):
  `ical_integration`, `ical_unit` con snapshot, UNIQUE (`organization_id`,
  `listing_id`), índices; prefijos `ici_`/`icu_`.
- [x] A2 ~~Mover a `src/lib/stay-dates.ts`~~ — se importan directo de
  `src/lib/minihotel/dates.ts` y `alternatives.ts` (puros, sin I/O): mover
  tocaba 028 sin ganancia.
- [x] A3 `src/lib/ical/parse.ts` + tests: bloqueo de Airbnb (feed real
  anonimizado), reserva con `DESCRIPTION` y teléfono (se descarta), vacío,
  líneas plegadas, CRLF/LF, `DATE-TIME` con `Z` y con `TZID`, `DURATION`,
  `CANCELLED`, `RRULE` → `unsupported`, HTML/basura → `not_calendar`, tope
  de eventos.
- [x] A4 `src/lib/ical/nights.ts` + tests: fusión de rangos, `DTEND`
  exclusivo (entra el día que otro sale), capacidad, `unconfirmed` a las
  3 h, `beyond` del horizonte, alternativas ±7 días (orden, nunca antes de
  hoy, misma cantidad de noches, tope 3).
- [x] A5 `src/lib/ical/airbnb-url.ts` + tests: dominios de país, `www.`,
  `http:`, userinfo, puerto, host ajeno (`airbnb.com.evil.io`,
  `evilairbnb.com`), ruta distinta, sin id; `listingId` y `tokenLast4`.
- [x] A6 `src/lib/ical/booking-link.ts` + tests: marcadores, codificación,
  enlace sin marcadores intacto, no-HTTPS rechazado.
- [x] A7 `src/lib/ical/render.ts` + tests: sección del prompt, resultado
  con libres/ocupadas/sin confirmar/alternativas, resumen seguro; ningún
  texto del feed llega acá (solo fechas).

## Fase B — Transporte y servidor
- [x] B1 `getGuardedText` en `src/lib/mcp/transport.ts` (`send` con método
  y cuerpo opcional) + tests: sandbox sin I/O, 3xx rechazado, IP privada
  rechazada, tope de bytes, tipo de contenido, la URL no aparece en el
  error.
- [x] B2 `src/server/ical/integration.ts`: vista sin URLs, ajustes, alta con
  lectura de prueba, edición (URL vacía = se conserva), borrado, orden,
  tope de 50.
- [x] B3 `src/server/ical/sync.ts`: `fetchUnitFeed`, `syncUnit` (códigos de
  error, conserva lo último bueno, `content_hash`), `syncOrganization`,
  `startIcalTicker` (espaciado, lock, 20 por vuelta) + registro en
  `instrumentation.ts`.
- [x] B4 `src/server/ical/agent-tools.ts`: `loadStaysContext` (jamás red),
  `renderStaysPromptSection`, `executeStaysAction` (nunca lanza).

## Fase C — Agente
- [x] C1 `actions.ts`: `check_stays` (rangos 1–3, huéspedes, `lead_note`,
  `stage`), `isStaysAction`, `isConcreteAvailabilityQuery` + tests del
  contrato (formatos laxos del modelo).
- [x] C2 `prompts.ts`: `staysSection`, línea del menú y reglas (nombrar una
  por una, enlace propio, nunca confirmar, sin precios del feed).
- [x] C3 `pipeline.ts`: contexto, familia en el loop (2 vueltas, contadores),
  `stripBookingPromise` también sin MCP cuando hay calendarios, etapa de
  interesados.

## Fase D — API y UI
- [x] D1 Rutas `/api/integrations/airbnb-calendars{,/units,/units/[id],/units/order,/sync}`
  con `withOwner` y Zod (la grilla de 30 días viaja en el GET: sin `/preview`).
- [x] D2 Tarjeta en el índice de Integraciones.
- [x] D3 Página + `airbnb-calendars-client.tsx`: switch, enlace general,
  unidades con estado, diálogo con la guía del Paso 1, «Leer ahora»,
  grilla de 30 días; móvil primero.

## Fase E — Mocks, E2E y cierre
- [x] E1 ical-mock (`src/app/api/dev/ical-mock/`) con perillas + modo mocks
  en la allowlist + `POST /api/dev/ical-sync`.
- [x] E2 ai-mock: `[E2E_STAYS]`, `[E2E_STAYS_PROMESA]`.
- [x] E3 Guion `tests/e2e/051-ical-availability.md` (+ `fixtures/ical-e2e.mjs`) y corrida verde (44/44):
  alta (buena / host ajeno / no-calendario), lectura, consulta con lugar
  (unidades nombradas + enlace propio con fechas), sin lugar →
  alternativas, feed caído → se conserva y caduca → derivación, promesa
  suprimida, miembro sin acceso (403 + sin tarjeta), Laboratorio sin red,
  datos del huésped que nunca aparecen.
- [x] E4 Gate: `typecheck && lint && build && test`.
- [x] E5 CLAUDE.md (mapa del código 051 + feature activa) y memoria.
- [ ] E6 Producción: deploy, cargar las unidades de Bosque Douglas con
  Hernán, «Leer ahora», comparar la grilla contra su sistema y una
  consulta real por el Laboratorio.
