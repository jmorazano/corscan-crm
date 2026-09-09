# Tasks: Variables enriquecidas de plantillas

**Input**: Design documents from `/specs/009-template-variables/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: self-test E2E obligatorio (Definición de Hecho REFORZADA) + unit de reglas puras.

**Organization**: US1 alta con bindings (P1), US2 envío resuelto (P1, depende de US1), US3 compatibilidad legada (P2, transversal verificada al final).

## Phase 1: Setup

- [x] T001 Columnas `template.variable_bindings` y `campaign.variable_values` (jsonb nullable) en src/lib/db/schema.ts + migración `drizzle-kit generate` (drizzle/)

## Phase 2: Foundational

- [x] T002 Reglas puras en src/lib/template-body.ts: catálogo `VARIABLE_ORIGINS` (4 orígenes con label/sample), `countVariables` → índices distintos, `validateBodyVariables` 1..5 contiguas sin huecos, `renderBody(body, values[])`, `resolveVariableValues(bindings, ctx)` y `freeTextCount(bindings)`
- [x] T003 [P] Unit tests de las reglas puras (contiguas, huecos, >5, repetidas, resolución con/sin freeTexts, render posicional) en tests/unit/template-variables.test.ts

## Phase 3: US1 — Alta con bindings (P1) 🎯 MVP

- [x] T004 [US1] `createTemplate` acepta `variables` (orígenes), valida longitud == N y catálogo, manda `example.body_text` con muestras por origen y persiste bindings; `serializeTemplate`/`listTemplates` exponen `variableBindings` en src/server/whatsapp/templates.ts
- [x] T005 [US1] `POST /api/templates` parsea el campo multipart `variables` (JSON string → Zod) en src/app/api/templates/route.ts; `TemplateDto` suma `variableBindings` en src/lib/types.ts
- [x] T006 [US1] Editor: autocompletado con el catálogo de orígenes (inserta próximo índice y agrega binding), lista de bindings visible con quitar-última, validación en vivo y preview resuelto con muestras en src/components/settings/templates-client.tsx
- [x] T007 [P] [US1] `template-preview.tsx` acepta `variableValues?: string[]` (valor por índice; fallback al comportamiento actual) en src/components/templates/template-preview.tsx

## Phase 4: US2 — Envío resuelto (P1)

- [x] T008 [US2] `sendTemplateCore`: si hay bindings, resuelve valores (contacto + `formatPhone` + nombre de la org consultado solo si hace falta + `freeTexts` validados) vía `resolveVariableValues`, y `buildTemplateSendPayload` pasa a `bodyParams: string[]`; texto persistido con `renderBody(values)`; camino legacy (bindings null) byte-a-byte igual, en src/server/whatsapp/templates.ts
- [x] T009 [US2] `POST /api/campaigns` acepta/valida `freeTexts` (por plantilla con bindings; legacy intacto) y persiste `variable_values`; detalle expone `variableValues`, en src/app/api/campaigns/route.ts (+ manage.ts si serializa)
- [x] T010 [US2] Runner pasa `freeTexts` de la campaña al embudo para plantillas con bindings (legacy `variableMode` intacto) en src/server/campaigns/runner.ts
- [x] T011 [US2] `POST /api/conversations/[id]/messages/template` acepta `freeTexts` (legacy `variable` intacto) en src/app/api/conversations/[id]/messages/template/route.ts
- [x] T012 [US2] UI campañas: sección variables (automáticas informadas + input por texto libre; radios actuales solo para legacy) en src/components/campaigns/campaigns-client.tsx
- [x] T013 [US2] UI 1:1: diálogo muestra automáticas y pide solo textos libres (legacy intacto) en src/components/inbox/template-sender.tsx
- [x] T014 [P] [US2] Unit tests del payload multi-parámetro y de la validación de freeTexts en tests/unit/template-variables.test.ts (ampliar)

## Phase 5: Polish & verificación reforzada

- [x] T015 Guion E2E tests/e2e/009-template-variables.md (quickstart completo: 2 destinatarios con valores propios, 1:1, huecos/>5, campaña sin texto libre, regresión legacy, convivencia con imagen 008) ejecutado hasta verde
- [x] T016 Gate técnico completo (typecheck, lint, build, tests)
- [x] T017 CLAUDE.md: fila del mapa (variables de plantillas → template-body.ts catálogo/resolución, jsonb bindings/values)

## Dependencies

T001 → T002 → US1 (T004–T007) → US2 (T008–T014) → Polish. T003 en paralelo con US1.

## Implementation Strategy

MVP = alta con bindings + preview (US1). El valor completo llega con US2
(resolución por destinatario). La regresión legada (US3 de la spec) se
verifica dentro del guion E2E (T015) — no requiere código propio, requiere
NO romper.
