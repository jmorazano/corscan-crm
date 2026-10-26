# Implementation Plan: Claude le enseña al agente (041)

**Branch**: `041-assistant-teaching` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

## Summary

El servidor MCP de la 040 suma su primera escritura: cinco herramientas
(`get_agent_knowledge`, `teach_agent`, `edit_agent`, `list_agent_changes`,
`undo_agent_change`) que le permiten al propietario, desde Claude, enseñarle
al agente de cada empresa con las MISMAS operaciones, topes, auditoría y
deshacer del Entrenador (015). Los cambios se aplican en el acto con origen
«Claude» (`source = 'assistant'`), pasan antes por guardas deterministas del
CRM (enlaces, teléfonos y correos que el agente no conocía, datos de
contactos, marcadores internos, repetidos), quedan con un tope de 30 por
hora por empresa y se ven y deshacen en el panel del Entrenador. Mismo
switch y misma revalidación por llamada que la 040. Enmienda de la
constitución 1.14.0. **Sin migración y sin dependencias nuevas.**

## Technical Context

**Language/Version**: TypeScript estricto (`noUncheckedIndexedAccess`),
Next.js 15 App Router, React 19

**Primary Dependencies**: las de la 040 (Drizzle, `zod/v4` para el JSON
Schema de las herramientas, `node:crypto`); reutiliza
`src/server/trainer/changes.ts`, `src/server/kb/service.ts`,
`src/server/ai/profile.ts`, `src/lib/privacy-guard.ts`, `src/lib/linkify.ts`
y `src/server/mcp/markers.ts`. Sin paquetes nuevos.

**Storage**: PostgreSQL — **sin migración** (valores nuevos en enums TS de
columnas `text`; [data-model.md](data-model.md))

**Testing**: Vitest (guardas puras, normalización de herramientas,
anotaciones, motor con `source`), comando `teach` del cliente MCP de prueba
(`tests/e2e/fixtures/mcp-client.mjs`), guion `tests/e2e/041-assistant-teaching.md`
con verificación en el Browser pane, Claude Code real contra local, y prueba
en producción en la empresa del dueño

**Target Platform**: el contenedor actual (Railway)

**Project Type**: monolito web existente

**Performance Goals**: enseñar < 1 s p95 del lado del CRM (KB de decenas de
entradas); leer el conocimiento < 500 ms

**Constraints**: multi-tenant estricto (`scoped()`); nada fuera del perfil y
el KB del agente; guardas que no dependen de la confirmación del cliente;
transacción con lock por empresa; el Entrenador y la 040 no cambian de
comportamiento

**Scale/Scope**: una decena de propietarios; ≤ 30 cambios/h por empresa

## Constitution Check

*GATE pre-Phase 0 y re-chequeado después del diseño: PASA con la enmienda
1.14.0 (research D12).*

- **I Seguridad**: la condición (c) «solo lectura» de la regla de acceso
  entrante se amplía SOLO a enseñar al agente, con guardas deterministas
  (D3), tope (D5), auditoría y deshacer (D2/D6), anotaciones de escritura
  (D1) y revalidación por llamada (040). Ninguna credencial ni secreto entra
  ni sale. **Enmienda MINOR 1.14.0.** ✅ (con enmienda)
- **II Soberanía**: superficie ENTRANTE ya existente; el CRM no llama a nada
  nuevo. ✅
- **III Multi-tenancy**: todo pasa por `scoped()` con la empresa autorizada
  de la llamada; un `kb_…` o `chg_…` de otra empresa responde «no
  encontrado». `agent_change` y `kb_entry` ya tienen `organization_id` NOT
  NULL. ✅
- **IV Idempotencia**: deshacer es idempotente (015); repetidos rechazados
  (FR-007); lock por empresa contra reintentos concurrentes (D4). Enseñar no
  es idempotente por naturaleza y se declara así (`idempotentHint: false`). ✅
- **V / IX Verificación**: unit + E2E de comportamiento con cliente MCP real,
  caminos infelices (cada guarda, tope, switch, rol, revocación), un turno
  del agente que usa lo enseñado, Claude Code real, y prueba en producción
  en la empresa del dueño. ✅
- **VI Specs antes de código**: spec, plan, research, data-model, contrato,
  quickstart; tasks a continuación. ✅
- **Sandbox del Laboratorio**: no se toca; enseñar no dispara corridas ni
  turnos. ✅

Re-chequeo post-diseño: sin violaciones nuevas; no hace falta Complexity
Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/041-assistant-teaching/
├── plan.md
├── research.md          # D1–D13
├── data-model.md        # sin migración
├── quickstart.md
├── contracts/
│   └── mcp-tools.md     # herramientas 13–17 + anotaciones e instrucciones
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/lib/assistants/
└── teach-guard.ts                 # NUEVO, puro: enlaces/teléfonos/correos/contactos/marcadores/repetidos
src/lib/privacy-guard.ts           # exporta findUnknownContactData (mismo detector)
src/server/assistants/
├── teach.ts                       # NUEVO: transacción + lock + tope + guardas + applyTrainerChanges
├── server.ts                      # SERVER_INSTRUCTIONS nuevas
├── log.ts                         # reason "rejected"
└── tools/
    ├── common.ts                  # AssistantTool.annotations
    ├── index.ts                   # anotaciones por herramienta + agentTools
    └── agent.ts                   # NUEVO: las 5 herramientas
src/server/trainer/changes.ts      # ApplyCtx.source, ChangeDto.source
src/server/kb/service.ts           # KbSource += "assistant"
src/lib/db/schema.ts               # enums TS += "assistant" (sin migración)
src/app/oauth/authorize/consent-form.tsx       # texto: leer y enseñar
src/components/settings/assistants-client.tsx  # texto del switch, aviso, registro
src/components/agent/agent-client.tsx          # badge «desde Claude»
src/components/inbox/trainer-panel.tsx         # origen «desde Claude» en cambios
src/app/api/dev/ai-mock/…                      # rama [E2E_KB]
.specify/memory/constitution.md                # 1.14.0
docs/integraciones/claude-mcp.md               # ejemplos de enseñanza y deshacer
tests/unit/assistants-teach-guard.test.ts      # NUEVO
tests/unit/assistants-teach.test.ts            # NUEVO (motor + tope + source, DB mockeada)
tests/unit/assistants-tools.test.ts            # anotaciones y catálogo de 17
tests/e2e/fixtures/mcp-client.mjs              # comando teach
tests/e2e/fixtures/seed-assistant.mjs          # KB/perfil/contacto/cambio del Entrenador conocidos
tests/e2e/041-assistant-teaching.md            # NUEVO guion
```

**Structure Decision**: monolito existente; la lógica de escritura vive en
`src/server/assistants/teach.ts` (orquesta) sobre el motor del Entrenador, y
las reglas en un módulo puro testeable. Ningún cambio en rutas HTTP: todo
entra por `/api/mcp`.

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Un mensaje de cliente engaña a Claude para que enseñe un enlace/alias/teléfono ajeno | Guardas D3 sobre corpus del negocio + datos de contactos; el cliente pide confirmación (D1); deshacer (D6) |
| Claude borra o reescribe de más | Herramienta aparte destructiva (D1), auditoría antes/después, deshacer, tope por hora |
| Dos enseñanzas simultáneas duplican o pasan el tope | Lock por empresa en la transacción (D4) |
| Cambios del Entrenador se rompen | `source` con default `trainer`; tests del Entrenador sin cambios deben seguir verdes |
| El propietario no sabe que el switch ahora también enseña | Consentimiento, Ajustes con aviso a conexiones viejas, guía y privacidad (D10, D13) |
| Conflicto con la rama `metrics-conversations` (toca `tools/metrics.ts` y el contrato de la 040) | La 041 no toca `metrics.ts`; si mergea después, solo `index.ts`/contrato base pueden necesitar rebase trivial |

## Orden de entrega

1. Enmienda 1.14.0 + enums `source` + `ApplyCtx.source` (el Entrenador
   sigue igual).
2. Guardas puras + `teach.ts` + `get_agent_knowledge`/`teach_agent`/`edit_agent`
   (US1 + US3).
3. `list_agent_changes`/`undo_agent_change` + origen en el panel y el KB +
   registro (US2).
4. Textos de consentimiento, Ajustes, instrucciones del servidor, guía (US4).
5. E2E + Claude Code real; antes del deploy, privacidad publicada con OK.

## Complexity Tracking

Sin violaciones que justificar.
