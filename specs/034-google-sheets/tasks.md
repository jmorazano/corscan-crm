# Tasks — 034 Google Sheets

## Fase 0 — Datos y env
- [x] T001 schema: `sheets_integration`, `sheet_source`, `payment_receipt` + ids; migración 0027
- [x] T002 env: `GOOGLE_SHEETS_API_BASE_URL`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER` + `.env.example`

## Fase A — Núcleo puro (+ tests)
- [x] T010 `src/lib/sheets.ts` (encabezados, fila, anti-fórmula, dedup, recorte, búsqueda)
- [x] T011 `src/lib/google/oauth.ts` parametrizado por scopes/callback
- [x] T012 `src/lib/google/sheets-client.ts`
- [x] T013 `extractPaymentReceipt` en `src/lib/ai`

## Fase B — Servidor
- [x] T020 `src/server/sheets/integration.ts`
- [x] T021 `src/server/sheets/receipts.ts` + gancho en `src/server/inbox/media.ts`
- [x] T022 `src/server/sheets/sources.ts` (copia, contexto del turno, búsqueda)
- [x] T023 agente: `actions.ts` (`search_sheet`), `prompts.ts`, `pipeline.ts`

## Fase C — API + UI
- [x] T030 rutas `/api/integrations/google-sheets/*` + índice de integraciones
- [x] T031 página + cliente (conexión, comprobantes, planillas, selector)

## Fase D — Mocks + verificación
- [x] T040 google-mock: Sheets + selector simulado
- [x] T041 ai-mock: `[COMPROBANTE_PLANILLA]`
- [x] T042 Gate (tsc, eslint, vitest, build)
- [x] T043 E2E de comportamiento + caminos infelices (`tests/e2e/034-google-sheets.md`)
- [x] T044 Constitución 1.12.1 + guía GCP + CLAUDE.md + memoria

## Estado
- 8-oct-2026: decisiones del dueño (drive.file + selector · agente sin datos del comprobante · encabezados + KB); spec/plan/tasks escritos.
- 8-oct-2026: implementado todo. Gate verde (tsc, eslint, 1637 tests, next build). E2E de comportamiento verde, 23 pasos (`tests/e2e/034-google-sheets.md`). Hallazgo de la corrida: `USER_ENTERED` rompía n° de operación con ceros, CBU y teléfonos → van como texto.
- Pendiente (dueño): OK para commit + merge a `main` + deploy. En GCP: habilitar Sheets API + Picker API, sumar scope `drive.file`, redirect `/api/integrations/google-sheets/callback` + origen JS, API key del selector y número de proyecto en Railway.
