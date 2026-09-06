# Implementation Plan: Integraciones + Google Calendar

**Branch**: `005-integrations-google-calendar` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary

Nueva sección "Integraciones" en el sidenav con Google Calendar como
primera integración por empresa: OAuth server-side (app de Google del
operador, conexión por organización con refresh token cifrado), reglas de
turnos por empresa (franjas semanales, duración, margen, anticipación,
horizonte, instrucciones libres), cálculo de huecos libres puro (reglas +
`freeBusy` de Google, que solo expone ocupado/libre), y dos acciones nuevas
del agente (`check_availability`, `book_appointment`) resueltas por el
servidor con una segunda vuelta acotada al modelo. Sandbox del
Laboratorio intocable; mock completo de Google para el self-test.
Decisiones en [research.md](research.md) D1–D11.

## Technical Context

**Language/Version**: TypeScript estricto, Node 22, Next.js 15 App Router + React 19
**Primary Dependencies**: Drizzle + PostgreSQL, Better Auth, Zod, `fetch` nativo contra Google (sin `googleapis`: cero deps nuevas — el cliente es ~6 endpoints REST)
**Storage**: tablas nuevas `calendar_integration`, `appointment` (migración `drizzle/0006_*`)
**Testing**: Vitest (huecos, reglas, state OAuth, cifrado/scoping, acciones) + guion E2E `tests/e2e/us-gc-1..3.md` con google-mock + ai-mock + wa-mock
**Constraints**: constitución 1.5.0 (D1); sin colas; nada del calendario ajeno llega al modelo; tokens cifrados; sandbox offline

## Constitution Check

*Constitución v1.5.0 (enmendada en esta rama — ver D1).*

- **I Seguridad**: ✅ refresh/access tokens AES-256-GCM; la API solo expone
  email de cuenta y calendario; errores del proveedor se redactan; state
  OAuth firmado y ligado a sesión.
- **II Soberanía**: ⚠→✅ Google entra como **integración opcional por
  empresa vía OAuth** (enmienda 1.5.0): el instalador no la necesita, el
  operador la habilita con env, la empresa la conecta; aislada en
  `src/lib/google/` (adaptador) + `src/server/calendar/`.
- **III Multi-tenancy**: ✅ ambas tablas org-scoped con `scoped()`; UNIQUE
  por org en la integración.
- **IV Idempotencia**: ✅ turno UNIQUE (org, contacto, inicio); cancelación
  con guard; callback OAuth re-ejecutable (upsert).
- **V/IX**: ✅ gate técnico + E2E conducido con mocks (feliz + infeliz:
  cancelar en Google, token inválido, hueco ocupado, fecha malformada).
- **VI/VII**: ✅ este flujo; supuestos en spec/Assumptions.
- **VIII Foco vertical**: ✅ agendar turnos desde la conversación es
  "convertir"; nada de plataforma.
- **Sandbox**: ✅ D7.

**Post-diseño**: sin violaciones nuevas.

## Project Structure

```text
specs/005-integrations-google-calendar/{spec,plan,research,data-model,quickstart,tasks}.md
  contracts/integrations-api.md · checklists/requirements.md
docs/integraciones/google-calendar-gcp.md      # paso a paso GCP para el dueño

src/
├── lib/
│   ├── db/schema.ts (+ calendar_integration, appointment) · db/ids.ts (+cint_, apt_)
│   ├── env.ts (+ GOOGLE_CLIENT_ID/SECRET, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_API_BASE_URL)
│   ├── time.ts                      # NUEVO: zona horaria sin deps (Intl)
│   └── google/
│       ├── oauth.ts                 # NUEVO: authUrl, state firmado, canje, refresh, revoke
│       └── calendar-client.ts       # NUEVO: calendarList, freeBusy, insert/delete event
├── server/
│   ├── calendar/
│   │   ├── integration.ts           # CRUD + tokens cifrados + ensureAccessToken + estado
│   │   ├── rules.ts                 # Zod de reglas + defaults
│   │   ├── slots.ts                 # cálculo puro de huecos
│   │   ├── availability.ts          # reglas + freeBusy + turnos CRM → huecos
│   │   ├── booking.ts               # bookAppointment / cancelAppointment
│   │   └── agent-tools.ts           # sección del prompt + ejecución de acciones
│   ├── ai/actions.ts (+2 acciones) · ai/prompts.ts (+sección agenda) · ai/pipeline.ts (loop de herramienta)
│   └── dev/google-mock-state.ts · dev/ai-mock.ts (+despacho de turnos)
├── app/
│   ├── (app)/integrations/{page.tsx, google-calendar/page.tsx}
│   ├── api/integrations/route.ts
│   ├── api/integrations/google-calendar/{route,connect,callback,calendars,availability,appointments,appointments/[id]/cancel}
│   └── api/dev/google-mock/{auth,token,state,calendar/v3/...}
└── components/{app-nav.tsx (+Integraciones), integrations/*.tsx}
```
