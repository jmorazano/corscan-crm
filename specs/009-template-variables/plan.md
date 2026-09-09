# Implementation Plan: Variables enriquecidas de plantillas

**Branch**: `009-template-variables` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-template-variables/spec.md`

## Summary

El cuerpo admite hasta 5 variables posicionales `{{1}}..{{5}}` (contiguas,
repetibles) y cada una queda atada en la creación a un origen del catálogo
(`contact_name` · `contact_phone` · `org_name` · `free_text`). Los bindings
viven en `template.variable_bindings` (jsonb, NULL = plantilla legada con el
flujo actual intacto); las campañas guardan los textos libres en
`campaign.variable_values`. La resolución por destinatario ocurre en el
embudo único `sendTemplateCore` (contacto + marca de la org + textos libres)
y el payload puro `buildTemplateSendPayload` pasa a recibir la lista de
parámetros del body. Reglas puras compartidas en `template-body.ts` (editor,
preview y server validan idéntico).

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15 App Router + React 19, Node 22

**Primary Dependencies**: Drizzle ORM (jsonb), Zod, catálogo puro en `src/lib/template-body.ts`, `formatPhone` de `src/lib/utils.ts`

**Storage**: PostgreSQL — columnas nuevas `template.variable_bindings` (jsonb, nullable) y `campaign.variable_values` (jsonb, nullable); migración Drizzle

**Testing**: Vitest (validación de cuerpo, resolución de valores, payload) + guion E2E `tests/e2e/009-template-variables.md` con mocks

**Target Platform**: monolito self-hosted (Railway)

**Project Type**: web app existente — extensión de módulos actuales

**Performance Goals**: sin metas nuevas; la resolución agrega a lo sumo UNA consulta liviana (nombre de la org) por envío

**Constraints**: compatibilidad estricta con plantillas/campañas legadas (bindings NULL ⇒ comportamiento actual byte-a-byte); convivencia con imagen 008; constitución completa

**Scale/Scope**: hasta 5 variables por plantilla; catálogo fijo de 4 orígenes (campos personalizados diferidos por decisión del dueño)

## Constitution Check

*GATE inicial: PASA. Re-check post-diseño: PASA.*

- **I (Secretos)**: sin secretos nuevos; los valores resueltos son datos que
  el mensaje ya iba a contener.
- **II (Soberanía)**: cero dependencias nuevas.
- **III (Multi-tenancy)**: bindings y valores viven en filas ya scoped;
  `org_name` se resuelve por la organización del envío.
- **IV (Idempotencia)**: alta con el mismo upsert; migración aditiva
  re-ejecutable; runner at-most-once intacto.
- **Sandbox**: guards de `sendTemplateCore` sin cambios (la resolución corre
  después de los guards).

## Project Structure

### Documentation (this feature)

```text
specs/009-template-variables/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md   (/speckit-tasks)
```

### Source Code (repository root)

```text
src/lib/template-body.ts                  # catálogo de orígenes, validación 0..5 contiguas, renderBody(values[]), resolveVariableValues() puro
src/lib/db/schema.ts + drizzle/00XX_*.sql # template.variable_bindings + campaign.variable_values (jsonb)
src/server/whatsapp/templates.ts          # alta con bindings + examples por origen; sendTemplateCore resuelve valores; buildTemplateSendPayload(bodyParams)
src/app/api/templates/route.ts            # POST multipart acepta `variables` (JSON de orígenes)
src/app/api/campaigns/route.ts            # POST acepta `freeTexts` para plantillas con bindings (legacy intacto)
src/server/campaigns/runner.ts            # pasa freeTexts de la campaña al embudo (resolución en el embudo)
src/app/api/conversations/[id]/messages/template/route.ts  # acepta `freeTexts` (legacy `variable` intacto)
src/components/settings/templates-client.tsx   # catálogo en el autocompletado, bindings visibles, preview resuelto
src/components/templates/template-preview.tsx  # valores por índice (`variableValues`)
src/components/campaigns/campaigns-client.tsx  # sección variables: automáticas informadas + inputs de texto libre (legacy: radios actuales)
src/components/inbox/template-sender.tsx       # ídem para el 1:1
tests/unit/template-variables.test.ts     # validación + resolución + payload
tests/e2e/009-template-variables.md       # guion E2E
```

**Structure Decision**: todo dentro de las fronteras existentes del mapa de
CLAUDE.md; cero módulos nuevos (solo un archivo de tests y el guion).

## Fases

- **Phase 0** → [research.md](research.md): D1 bindings en jsonb del template
  (no tabla aparte), D2 textos libres por campaña, D3 resolución en el
  embudo, D4 compat legacy por NULL, D5 examples por origen a Meta.
- **Phase 1** → [data-model.md](data-model.md), [contracts/api.md](contracts/api.md),
  [quickstart.md](quickstart.md); CLAUDE.md → Feature activa 009.
- **Phase 2** → `/speckit-tasks`.

## Complexity Tracking

Sin violaciones.
