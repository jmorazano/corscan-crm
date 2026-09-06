# Tasks: Integraciones + Google Calendar

**Input**: specs/005-integrations-google-calendar/ (spec, plan, research D1–D11, data-model, contracts)

## Phase 1: Setup / Foundational

- [x] T001 Constitución 1.4.0 → 1.5.0 (D1) en `.specify/memory/constitution.md`
- [x] T002 Env: `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_API_BASE_URL` en `src/lib/env.ts` + `.env.example` (guía) + `.env` dev (mock)
- [x] T003 Schema `calendar_integration` + `appointment` en `src/lib/db/schema.ts`, ids `cint_`/`apt_`, migración `drizzle/0006_*`
- [x] T004 [P] `src/lib/time.ts` (zona horaria con Intl) + `src/server/calendar/rules.ts` (Zod + defaults) + `src/server/calendar/slots.ts` (huecos puros) + unit tests `tests/unit/calendar-slots.test.ts`, `calendar-rules.test.ts`
- [x] T005 [P] `src/lib/google/oauth.ts` (authUrl, state HMAC, exchange, refresh, revoke, decode id_token) + `src/lib/google/calendar-client.ts` + unit test `tests/unit/google-oauth-state.test.ts`

## Phase 2: US1 Conectar (P1)

- [x] T006 `src/server/calendar/integration.ts`: get/upsert/delete, tokens cifrados, `ensureAccessToken` (refresh + reconnect_required), `listCalendars` + unit test `calendar-integration.test.ts` (cifrado, scoping)
- [x] T007 Rutas `GET /api/integrations`, `GET|PUT|DELETE /api/integrations/google-calendar`, `connect`, `callback`, `calendars`
- [x] T008 UI: `Integraciones` en `app-nav.tsx`; `/integrations` (índice de tarjetas) y `/integrations/google-calendar` (tarjeta de conexión: estado, cuenta, calendario, zona, conectar/reconectar/desconectar)

## Phase 3: US2 Reglas (P1)

- [x] T009 `src/server/calendar/availability.ts` (reglas + freeBusy + turnos CRM) + `GET .../availability`
- [x] T010 UI reglas: grilla semanal, duración/margen/anticipación/horizonte, toggle agente, instrucciones; vista previa de huecos

## Phase 4: US3 Agente (P1)

- [x] T011 `src/server/ai/actions.ts` (+`check_availability`, `book_appointment`) + `src/server/calendar/booking.ts` (bookAppointment idempotente, re-check, evento, nota del lead) + `agent-tools.ts` (sección de prompt + ejecución)
- [x] T012 `pipeline.ts`: loop de herramienta (máx. 2 vueltas), sandbox D7, degradación (ocupado → alternativas; proveedor → handoff) + `prompts.ts` (sección agenda)
- [x] T013 Mocks: `src/server/dev/google-mock-state.ts` + rutas `/api/dev/google-mock/*` + despacho de turnos en `ai-mock.ts`
- [x] T014 Unit tests: acciones nuevas (`agent-actions-calendar.test.ts`), booking con DB mock (`calendar-booking.test.ts`)

## Phase 5: US4 Turnos (P2)

- [x] T015 `GET .../appointments` + `POST .../appointments/[id]/cancel` + lista en la UI con cancelar

## Phase 6: Polish + Verify

- [x] T016 Docs: `docs/integraciones/google-calendar-gcp.md` (paso a paso GCP), CLAUDE.md (mapa), quickstart
- [x] T017 Gate: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
- [x] T018 E2E conducido: `tests/e2e/us-gc-1-conectar.md`, `us-gc-2-reglas.md`, `us-gc-3-agente-turnos.md` (feliz + infeliz) con evidencia
