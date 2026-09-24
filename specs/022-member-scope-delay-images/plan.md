# Plan — 022 Miembros sin configuración · espera por empresa · imágenes en el Entrenador

## Contexto técnico

Next 15 + Drizzle + Better Auth (roles `owner`/`member` en `member.role`).
La sesión ya trae `role` (`SessionContext`) y `AppShell`/`AppNav` ya lo
reciben. El debounce del agente vive en `src/server/ai/pipeline.ts`
(`scheduleAgentTurn`, `executeTurn`) y se dispara desde
`src/server/ai/trigger.ts` (`maybeRunAgentTurn`, único punto con
`organizationId`). El Entrenador (015) ya tiene el circuito de notas de voz
(`src/server/trainer/voice.ts` + `POST …/messages/audio`) que sirve de
molde para las imágenes; la visión (020) ya existe en `src/lib/ai`
(`describeImage`, `image_url` como data URI).

## Diseño

### A. Miembros

- `src/lib/roles.ts` (puro): `canManageConfig(role)`, `navItemsFor(role)`,
  `settingsTabsFor(role)`, `MEMBER_SETTINGS_PATHS`. Tests unitarios.
- `src/lib/auth/owner-page.ts`: `requireOwnerPage()` → sesión o redirect a
  `/login`; `member` → redirect `/inbox`. Se llama en cada página de
  configuración (agent, lab, integrations/*, settings/* salvo
  notifications) — explícito y sin middleware.
- `src/lib/api.ts`: `withOwner(handler)` = `withAuth` + 403 `forbidden`.
  Se aplica a las escrituras: agent/profile PUT · kb POST/PATCH/DELETE ·
  templates POST/DELETE/sync · settings/whatsapp PUT + test + recheck +
  embedded-signup · settings/sending PUT · lab/runs POST +
  suggestions/apply. Los que ya chequeaban `role !== "owner"` a mano quedan
  como están.
- Entrenador solo owner: `GET /api/conversations` devuelve `trainer: null`
  para `member` (y no crea la fila); `POST …/messages` a una conversación
  `trainer`, `…/audio`, `…/image` y `/api/trainer/*` → 403.
- UI: `AppNav` y `MobileTabBar` filtran por rol; `SettingsNav` recibe
  `role`; `/settings` redirige según rol.

### B. Espera por empresa

- Migración 0018: `agent_profile.reply_delay_ms integer NULL`.
- `src/lib/agent-timing.ts` (puro): `REPLY_DELAY_MAX_MS = 120000`,
  `resolveReplyDelayMs(profileMs, instanceDefaultMs)`, conversión s ↔ ms.
- `profileUpdateSchema.replyDelayMs` (int 0–120000 | null). `GET` agrega
  `replyDelayMs` y `defaultReplyDelayMs` (env).
- `scheduleAgentTurn(conversationId, delayMs)`: la entrada del coalesce
  guarda `delayMs` y lo reutiliza al re-esperar. `maybeRunAgentTurn` lee el
  perfil y resuelve la espera. El Laboratorio sigue llamando a
  `runAgentTurn` directo.
- UI: tarjeta «Espera antes de responder» en la página Agente (segundos,
  vacío = default con el valor mostrado, explicación del trade-off).

### C. Imágenes en el Entrenador

- Migración 0018: `ai_credentials.vision_model text NULL`.
  `AiConfig.visionModel?`, `DEFAULT_VISION_MODEL`, `getAiConfig` lo
  resuelve, `saveAiConfig`/`getAiSettings`/ruta/tarjeta lo exponen.
- `src/lib/ai`: `describeImage` usa `visionModel`; nueva
  `readTrainerImage(config, image)` con prompt de LECTURA (texto literal +
  descripción, marcador `[IMAGEN_ENTRENADOR]` para el mock), tope 3.000
  caracteres, mismos códigos de error que `describeImage`.
- `src/lib/trainer-image.ts` (puro): `TRAINER_IMAGE_MAX_BYTES`,
  `validateTrainerImage(bytes, declaredMime)` (usa `sniffImageMime` de
  020), `TRAINER_IMAGE_ERRORS`, `trainerImageContext(message)` → línea
  `[IMAGEN]` para el modelo (pendiente → null: la lee el turno forzado).
- `src/server/trainer/image.ts`: `createTrainerImage` (mensaje `out`
  `type=image` `media_state=pending` + `message_media` + SSE) y
  `readTrainerImageInBackground` (visión → `ready` con `media_summary` /
  `failed` con `error` → `forceTrainerTurn`).
- `src/server/ai/trainer.ts`: `trainerMessageContent(m)` reemplaza el
  filtro por `text` (texto, transcripción, imagen leída, imagen fallida);
  `forceTrainerTurn(conversationId)` pone la marca de cobertura en 0 y
  agenda (lo usan voz e imagen). Nota en el prompt sobre las imágenes.
- Ruta `POST /api/conversations/[id]/messages/image` (multipart `file`,
  `caption?` ≤ 1.000).
- Composer: `onSendImage`, clip visible siempre en modo trainer, `accept`
  audio+imagen, despacho por tipo, `onPaste` y drop de imágenes, el texto
  del composer viaja como epígrafe. `inbox-client`: `sendTrainerImage`.
- `message-thread`: `ImageAttachment` con copy para salientes del
  Entrenador y estados pending/failed/ready (lectura larga plegada).
- ai-mock: rama `[IMAGEN_ENTRENADOR]` → `MOCK_TRAINER_IMAGE_READING` (con
  «precio» para que el despacho del entrenador guarde una P/R); PNG →
  `[SIN_CONTENIDO]`.

## Verificación

- Unit: roles, agent-timing, trainer-image, mock.
- E2E `tests/e2e/022-member-scope-delay-images.md` con mocks: miembro
  (escritorio + móvil, páginas y API), espera 0 s / 5 s con ráfaga por
  wa-mock, imagen JPEG feliz + PNG fallida + archivo inválido + conversación
  real (409) + IA apagada (409).
- Gate: typecheck + lint + build + test.
