# Tasks — 032 herramientas del conector sin deploy + reservas

## Fase 0 — Datos
- [x] T001 schema: `tool_policy`, `result_excerpt`, `write`; enum de evento `ai_tool_write`; migración 0026

## Fase A — Núcleo puro (+ tests)
- [x] T010 `src/lib/mcp/tool-policy.ts`
- [x] T011 `src/lib/mcp/json-schema.ts`
- [x] T012 `src/lib/mcp/consent.ts`
- [x] T013 `src/lib/mcp/generic-result.ts`
- [x] T014 `price-guard` `allowedAmounts` · `promise-guard` `claimsOnly`

## Fase B — Servidor
- [x] T020 handshake guarda la forma extendida + instrucciones 24 KB + reconcilia política
- [x] T021 `setToolDecision` + vistas con estado por herramienta
- [x] T022 `calls.ts`: allowlist ampliada, escrituras sin caché, sandbox genérico, bitácora
- [x] T023 `dynamic-tools.ts`: carga, memoria, sección, ejecución con barrera
- [x] T024 `agent-tools.ts` + `actions.ts` (`use_tool`) + `prompts.ts`
- [x] T025 Altos: regla de reservas e importes condicionales
- [x] T026 `pipeline.ts`: rama `use_tool`, importes permitidos, guarda de promesas, evento
- [x] T027 Entrenador: sección del conector

## Fase C — API + UI
- [x] T030 PUT empresa y super admin con `tools`
- [x] T031 Integraciones: lista con estado e interruptores + diálogo de aprobación
- [x] T032 Administración: lo mismo

## Fase D — Mocks + verificación
- [x] T040 mcp-mock: herramientas de reserva + knobs
- [x] T041 ai-mock: rama `use_tool`
- [x] T042 Gate (tsc, eslint, vitest, build)
- [x] T043 E2E de comportamiento + caminos infelices (`tests/e2e/032-mcp-dynamic-tools.md`)
- [x] T044 Constitución 1.12.0 + CLAUDE.md + memoria

## Estado
- 7-oct-2026: spec/plan/tasks escritos; decisiones del dueño registradas.
- 7-oct-2026: núcleo, servidor, API, UI y mocks implementados; 66 tests nuevos verdes (suite 1570 + nuevos). Hallazgo de los tests: la firma no incluía `readOnly` (una consulta que pasaba a escribir heredaba la aprobación) → corregido.
- 7-oct-2026: gate verde (tsc, eslint, 1596 tests, next build). E2E de comportamiento verde, 13 pasos (`tests/e2e/032-mcp-dynamic-tools.md`): reconectar suma herramientas sin deploy, reserva de punta a punta con enlace de pago, «no, esperá» no registra, doble confirmación no duplica, `no_longer_available`, herramienta nueva aparece y se usa, Entrenador las describe, filas pre-032 → «Verificá la conexión», permisos. Segundo hallazgo: filas guardadas antes de 032 habrían ofrecido las herramientas sin parámetros → estado `stale`.
- Pendiente (dueño): OK para commit + merge a `main` + deploy. Después del deploy, en Altos: «Verificar conexión», activar «Usar estas notas» (manual de 16,5 KB) y aprobar `confirm-booking`.
