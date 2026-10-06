# Tasks — 031 agente a la vista

## Fase 0 — Datos
- [x] T0 Schema + migración 0025 (evento, autor, ventana).

## Fase A — Núcleo puro
- [x] A1 `src/lib/agent-presence.ts` + tests.
- [x] A2 `src/lib/conversation-events.ts` + tests.
- [x] A3 `src/lib/lookup-promise.ts` + tests.

## Fase B — Servidor
- [x] B1 `src/server/ai/events.ts` (registrar/listar/último del equipo) + SSE.
- [x] B2 `chatJson` con `status`; MCP `failure`.
- [x] B3 Pipeline: presencia + reactivación + eventos + handoff con detalle.
- [x] B4 Pipeline: `lead_note` + guarda de promesas + nota de intervención.
- [x] B5 Autor en los envíos del CRM (texto, adjuntos, plantilla, alta).
- [x] B6 PATCH conversación: evento con actor.
- [x] B7 GET mensajes con eventos; perfil con `teamSilenceMs`.
- [x] B8 Prompt (anti-promesa, `lead_note`, `none.reason`, comprobantes,
      intervención).

## Fase C — UI
- [x] C1 Líneas de evento en `MessageThread` + estado/SSE en `inbox-client`.
- [x] C2 Panel: cuándo vuelve la IA.
- [x] C3 Tarjeta «Cuando alguien del equipo interviene» en `/agent`.
- [x] C4 Enlaces clicables en el hilo (`src/lib/linkify.ts` + tests).
- [x] C5 Aclaración del dueño: switch fijo; atención humana espera a una
      persona (sin `ai_paused_at`; migración regenerada).

## Fase D — Verificación
- [x] D1 ai-mock: promesa vacía, `none` con motivo, 402.
- [x] D2 Guion E2E conducido (feliz + infeliz, escritorio + móvil).
- [x] D3 Gate: typecheck + lint + build + test.
- [x] D4 CLAUDE.md + memoria.

## Estado

Todas completas (6-oct-2026) en el worktree `031-agent-resume` (BD local
`vocero_031`, recreada tras regenerar la 0025). Guion
`tests/e2e/031-agent-presence.md` conducido y verde (A–J con las reglas
aclaradas + UI escritorio/móvil + enlaces). Ajustes tras el E2E: la regla
del comprobante manda lo que diga el conocimiento del negocio (Altos ya tiene
su respuesta) y no deriva; el switch no vence y la atención humana espera a
una persona.
