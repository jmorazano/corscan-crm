# Tasks — 036 el agente no deja chats colgados

## Fase A — Núcleo puro
- [x] A1 `src/lib/send-retry.ts` + tests.
- [x] A2 `agent-presence.ts`: `pendingAfterTeam`, `isBroadcast` + tests.
- [x] A3 `conversation-events.ts`: texto de la retoma.

## Fase B — Servidor
- [x] B1 `graphRequest` con timeout (y cuerpo) + test.
- [x] B2 `deliverReply` con reintento.
- [x] B3 `lastTeamMessageAt` saltea difusiones y las marca (`message.details.broadcast`).
- [x] B4 `scheduleResumeCheck` + programación en el silencio `team_active`.
- [x] B5 Turno de retoma: acuses, ventana cerrada sin handoff, sección del prompt.
- [x] B6 `rescheduleTeamResumes()` al arrancar.

## Fase C — UI y mocks
- [x] C1 `inbox-client` no cuenta difusiones en `lastTeamAt`.
- [x] C2 wa-mock knob `failSends`; ai-mock responde la sección de retoma.

## Fase D — Verificación
- [x] D1 Gate: typecheck + lint + test + build.
- [x] D2 Guion E2E `tests/e2e/036-agent-resilience.md` conducido.
- [x] D3 CLAUDE.md (mapa + feature activa) y memoria.

## Estado

Todas completas (13-oct-2026) en el worktree `.claude/worktrees/036-agent-resilience`,
rama `036-agent-resilience` sobre `origin/main` f00f5cf. Gate verde: `tsc`,
`eslint`, `vitest` (165 archivos, 1696 tests; 19 nuevos) y `next build`.
E2E A–H verde (25/25 + reinicio). Sin migración. Pendiente: OK del dueño
para mergear y deployar.
