# Tasks: Historial del celular (017)

**Input**: specs/017-whatsapp-history/spec.md + plan.md + contracts/api.md

## Phase 1: Fundaciones

- [x] T001 Tabla `history_import` + `message.source` + migración drizzle/0014; tipos de payload en src/server/inbox/webhook.ts
- [x] T002 [P] Puro: src/lib/history-import.ts (`mapHistoryMessage`, `isWithinDays`, `directionFor`, `statusFor`, `normalizePhoneDigits`) + tests/unit/history-import.test.ts

## Phase 2: US1 — Importar el historial

- [x] T003 [US1] src/server/whatsapp/history-sync.ts (`requestHistorySync`, `getHistoryImport`, transiciones de estado) + `GET/POST /api/settings/whatsapp/history-import`
- [x] T004 [US1] src/server/inbox/history.ts `processHistoryValue` (lotes, dedup, `greatest`, placeholders/detalle de media, progreso, rechazo) + dispatch en el webhook
- [x] T005 [US1] Auto-sync tras Embedded Signup en coexistence (embedded-signup.ts)
- [x] T006 [US1] Tarjeta «Historial del celular» en whatsapp-wizard.tsx (estado, progreso, botón, errores, polling)
- [x] T007 [US1] wa-mock: `smb_app_data` en graph mock + entrega de `history` (chunks desordenados, media, rechazo por knob) + `syncRequests` en outbox

## Phase 3: US2 — Ecos del celular

- [x] T008 [US2] `processEchoesValue` + dispatch + `MessageDto.source` + etiqueta «Desde el celular» + «Archivo del celular» en helpers
- [x] T009 [US2] `runAgentTurn` corta si el último mensaje es `out` + test
- [x] T010 [US2] wa-mock `POST /api/dev/wa-mock/echo`

## Phase 4: US3 — Nombres de agenda

- [x] T011 [US3] `processStateSyncValue` + dispatch + mock

## Phase 5: Docs, verificación y cierre

- [x] T012 Guion tests/e2e/017-whatsapp-history.md en verde el 23-sep-2026 (feliz + infeliz; sync real contra Meta pendiente de verificación humana)
- [x] T013 CLAUDE.md (fila + feature activa) + memoria
- [x] T014 Gate técnico completo (typecheck + lint + build + test)
