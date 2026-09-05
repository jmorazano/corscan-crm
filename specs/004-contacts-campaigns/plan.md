# Implementation Plan: Contactos importados + Campañas de plantillas

**Branch**: `004-contacts-campaigns` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-contacts-campaigns/spec.md`

## Summary

El CRM gana outbound con consentimiento: (1) alta manual + import Excel/CSV
de contactos con tags, consentimiento y normalización de teléfonos al
formato wa_id (la trampa del `9` argentino resuelta con libphonenumber-js +
post-proceso + reconciliación por `contacts[0].wa_id`); (2) envío de
plantilla aprobada a contactos sin conversación (POST /api/conversations
reusando getOrCreateContact/Conversation + sendTemplate); (3) campañas con
runner in-process calcado del Laboratorio pero con **revive al boot** y
estado por destinatario (`pending→sending(+wamid)→sent`) como fuente de
verdad anti-duplicados, cupo por **ventana móvil de 24h sobre contactos
únicos** (semántica oficial de Meta, default 250) y progreso por SSE;
(4) opt-out automático ("BAJA"/"STOP") colgado del punto idempotente de la
ingesta. Decisiones detalladas en [research.md](research.md) D1–D12.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22, Next.js 15 App Router + React 19

**Primary Dependencies**: Drizzle ORM + PostgreSQL, Better Auth (organization plugin), Zod, bus SSE in-process existente; NUEVAS (build, no servicios): `read-excel-file@9.3.10`, `papaparse@5.7.0` (+`@types/papaparse`), `libphonenumber-js` — las tres MIT, vigentes, sin advisories (research D1–D3)

**Storage**: PostgreSQL vía Drizzle; migraciones versionadas en `drizzle/` aplicadas al boot; tablas nuevas: `campaign`, `campaign_recipient`, `initiated_send`, `send_settings`; columnas nuevas en `contact`

**Testing**: Vitest (unit: normalización de teléfonos, cupo, parser de filas, opt-out) + guiones E2E conducidos con Playwright + mocks (wa-mock ya soporta inbound BAJA y statuses — research D11)

**Target Platform**: monolito Next.js standalone en Docker (Railway/Coolify); una instancia, N empresas

**Project Type**: web app monolítica (App Router + API routes + runners in-process)

**Performance Goals**: import de 5.000 filas < 2 min de punta a punta (SC-001); pacing de campaña ~1 msg/4s (bien por debajo del throughput de 80 msg/s del canal); SSE con heartbeat 25s existente

**Constraints**: sin colas externas ni servicios nuevos (Constitución II); el archivo del import nunca llega al server (se postea JSON validado); cupo compartido campañas+individuales; sandbox is_test intocable; máx. 1 variable de plantilla ({{1}})

**Scale/Scope**: listas de hasta 5.000 contactos por import; campañas de cientos-miles de destinatarios que atraviesan días por el cupo de 250

## Constitution Check

*Constitución v1.4.0 (enmendada en esta rama — ver nota VIII).*

- **I Seguridad de datos**: ✅ sin secretos nuevos; el archivo del dueño no
  se persiste ni viaja al server (solo filas estructuradas); teléfonos y
  tags son datos de dominio org-scoped; nada de esto llega a logs.
- **II Soberanía**: ✅ cero servicios externos nuevos: las tres librerías
  son dependencias de build (parseo/validación local); el único tráfico
  saliente sigue siendo la Cloud API vía el cliente propio.
- **III Multi-tenancy**: ✅ `organization_id` NOT NULL + índice org-first en
  las 4 tablas nuevas; todo acceso vía `scoped()`; el cupo es por empresa;
  el runner recibe organizationId explícito.
- **IV Idempotencia**: ✅ import re-ejecutable (upsert org+phone, merge de
  tags); `campaign_recipient` UNIQUE (campaign, contact) con estado por
  fila y wamid persistido para desambiguar reinicios; opt-out y "respondió"
  set-si-null tras el gate de dedup del webhook; transiciones de campaña
  con guard WHERE (monotónicas).
- **V/IX Calidad y verificación en vivo**: ✅ gate técnico + self-test E2E
  de comportamiento con mocks (guiones nuevos us-cc-1..4), caminos
  infelices incluidos; nada se delega al dueño.
- **VI Specs antes de código**: ✅ este flujo.
- **VII Trazabilidad**: ✅ defaults del agente registrados en Assumptions
  (vetables); decisiones D1–D12 con fuentes en research.md.
- **VIII Foco vertical**: ⚠→✅ la versión 1.3.0 excluía "broadcast masivo".
  El pedido explícito del dueño (5-sep-2026: importar su lista y enviar
  plantillas de marketing) motivó la **enmienda MINOR 1.4.0** (aplicada en
  esta rama): campañas de plantillas CON consentimiento a la cartera propia
  entran al alcance con guardrails obligatorios (opt-out automático, límite
  de volumen por empresa, exclusión del sandbox) — que esta feature
  implementa como requisitos (FR-010/014/015/019). Scraping y listas frías
  siguen FUERA: el import exige declaración de consentimiento (FR-004) y el
  producto no capta números.
- **Sandbox del Laboratorio**: ✅ intocable — el runner de campañas jamás
  incluye contactos/conversaciones is_test (FR-019) y sendTemplate conserva
  su guard.

**Post-diseño (re-check)**: sin violaciones nuevas; Complexity Tracking vacío.

## Project Structure

### Documentation (this feature)

```text
specs/004-contacts-campaigns/
├── spec.md
├── plan.md              # este archivo
├── research.md          # D1–D12
├── data-model.md
├── quickstart.md        # entorno E2E local + fixtures
├── contracts/
│   ├── contacts-import.md
│   ├── campaigns-api.md
│   └── settings-sending.md
├── checklists/requirements.md
└── tasks.md             # (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── db/schema.ts               # contact += tags/consent/opted_out; + campaign,
│   │                              #   campaign_recipient, initiated_send, send_settings
│   └── phone.ts                   # NUEVO: normalización wa_id (AR 9, MX 521) client+server
├── server/
│   ├── inbox/ingest.ts            # hook onInboundSideEffects (opt-out + replied)
│   ├── campaigns/                 # NUEVO dominio
│   │   ├── runner.ts              # executeCampaign (patrón lab + revive at-most-once)
│   │   ├── quota.ts               # mutex FIFO + reserva de cupo (initiated_send)
│   │   └── recipients.ts          # congelado de segmento + elegibilidad
│   ├── contacts-import.ts         # NUEVO: upsert masivo + merge tags + reporte
│   │                              #   (ojo: ya existe el MÓDULO src/server/contacts.ts —
│   │                              #    no crear un directorio homónimo)
│   └── whatsapp/templates.ts      # refactor: núcleo con template/creds pre-resueltos
│                                  #   que devuelve {messageId, waMessageId, waId}
├── app/
│   ├── api/
│   │   ├── contacts/import/route.ts       # POST import
│   │   ├── contacts/[id]/route.ts         # PATCH extiende (tags; bloquea desarchivar is_test)
│   │   ├── contacts/[id]/opt-out-revert/route.ts # POST revertir baja (auditada)
│   │   ├── conversations/route.ts         # + POST (iniciar con plantilla, US2)
│   │   ├── campaigns/route.ts             # GET/POST
│   │   ├── campaigns/segment-preview/route.ts # GET tamaño del segmento elegible
│   │   ├── campaigns/[id]/route.ts        # GET detalle + progreso + destinatarios
│   │   ├── campaigns/[id]/actions/route.ts# launch/pause/resume/cancel
│   │   └── settings/sending/route.ts      # GET/PUT límite
│   └── (app)/campaigns/page.tsx           # NUEVA sección
├── components/
│   ├── contacts/import-wizard.tsx  # NUEVO (modal patrón EditDialog)
│   ├── contacts/contacts-client.tsx# botón importar + alta manual + badges
│   ├── campaigns/*                 # NUEVO client de campañas
│   ├── app-nav.tsx                 # entrada "Campañas" en NAV
│   └── use-events.ts               # handler campaign.progress
├── instrumentation-node.ts         # revive de campañas running al boot
└── server/events/bus.ts            # variante campaign.progress en SseEvent

tests/
├── unit/ (phone, quota, import-rows, optout, runner-transitions)
└── e2e/us-cc-1..4.md + fixtures/ (.xlsx y .csv de prueba)
```

**Structure Decision**: monolito existente; dominio nuevo `src/server/campaigns/`
espejo de `src/server/lab/`; sin workers ni colas (Constitución II) — el
runner es fire-and-forget in-process con revive en instrumentation.

## Complexity Tracking

Sin violaciones que justificar.
