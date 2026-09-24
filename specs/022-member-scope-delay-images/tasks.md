# Tasks — 022 Miembros sin configuración · espera por empresa · imágenes en el Entrenador

## Fase 0 — Datos

- [x] T0 Migración 0018: `agent_profile.reply_delay_ms`,
      `ai_credentials.vision_model`.

## Fase A — Miembros

- [x] A1 `src/lib/roles.ts` puro + tests.
- [x] A2 `withOwner` en `src/lib/api.ts` y aplicación a las escrituras de
      configuración.
- [x] A3 `requireOwnerPage()` + llamada en páginas de Agente, Laboratorio,
      Integraciones y Ajustes (salvo Notificaciones).
- [x] A4 Navegación por rol: `AppNav`, `MobileTabBar`, `SettingsNav`,
      `/settings` redirige según rol.
- [x] A5 Entrenador solo owner (`trainer: null`, 403 en mensajes y
      `/api/trainer/*`).

## Fase B — Espera por empresa

- [x] B1 `src/lib/agent-timing.ts` + tests.
- [x] B2 Perfil: schema Zod, GET (`replyDelayMs`, `defaultReplyDelayMs`).
- [x] B3 Pipeline: `scheduleAgentTurn(id, delayMs)` + `maybeRunAgentTurn`
      resuelve la espera.
- [x] B4 Tarjeta «Espera antes de responder» en la página Agente.

## Fase C — Imágenes en el Entrenador

- [x] C1 Modelo de visión: `AiConfig`, credentials, ruta, tarjeta de Ajustes;
      `describeImage` lo usa.
- [x] C2 `readTrainerImage` en `src/lib/ai` + `src/lib/trainer-image.ts` +
      tests.
- [x] C3 `src/server/trainer/image.ts` + ruta `POST …/messages/image`.
- [x] C4 `trainer.ts`: contenido por mensaje + `forceTrainerTurn` (voz e
      imagen) + nota en el prompt.
- [x] C5 Composer (clip audio+imagen, pegar, arrastrar, epígrafe) +
      `inbox-client.sendTrainerImage`.
- [x] C6 `message-thread`: imagen saliente del Entrenador con estados.
- [x] C7 ai-mock: rama `[IMAGEN_ENTRENADOR]`.

## Fase D — Verificación

- [x] D1 Guion E2E `tests/e2e/022-member-scope-delay-images.md` conducido
      con mocks (feliz + infeliz, escritorio + móvil).
- [x] D2 Gate: `typecheck && lint && build && test`.
- [x] D3 CLAUDE.md (mapa del código + feature activa) y memoria.

## Estado

Todas completas (24-sep-2026). Guion `tests/e2e/022-member-scope-delay-images.md`
conducido y verde en el worktree con mocks (owner + member, escritorio +
móvil, feliz + infeliz). Gate: typecheck + lint + build + test.
