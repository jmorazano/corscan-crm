# Tasks: 048 — Quién atiende

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) · [data-model.md](data-model.md) · [contracts/api.md](contracts/api.md) · [quickstart.md](quickstart.md)

**Tests**: incluidos. La Definición de Hecho del proyecto (CLAUDE.md,
constitución V y IX) exige tests unitarios de la lógica pura y el self-test
E2E de comportamiento con mocks.

**Formato**: `- [ ] T### [P?] [US?] descripción con ruta`. `[P]` = se puede
hacer en paralelo (archivo distinto, sin dependencias pendientes).

---

## Phase 1: Setup

- [x] T001 Preparar el worktree `.claude/worktrees/048-team-attention/`:
  - copiar el `.env` del checkout principal;
  - instalar dependencias (si el pnpm de corepack falla, usar `node_modules/.bin` según la memoria `pnpm-corepack-roto`);
  - confirmar que `drizzle/` termina en `0034_quick_replies.sql`.

---

## Phase 2: Foundational (bloquea a todas las historias)

- [x] T002 Agregar los prefijos `attentionWait: "aw"` y `attentionSettings: "as"` en `src/lib/db/ids.ts`
- [x] T003 Agregar al schema las tablas `attentionWait` (columnas e índices de data-model.md, con el único parcial `attention_wait_open_uq` por `conversation_id` `WHERE status = 'open'`) y `attentionSettings`, más `member.lastSeenAt` y `message.sentByName`, en `src/lib/db/schema.ts`
- [x] T004 Generar la migración y renombrarla a `drizzle/0035_team_attention.sql`. Hacerla re-ejecutable (`IF NOT EXISTS`) y sumarle el backfill idempotente `UPDATE message … SET sent_by_name = u.name … WHERE sent_by_name IS NULL`. Aplicarla en la BD local con `pnpm db:migrate`
- [x] T005 Crear el núcleo puro en `src/lib/team-attention.ts`:
  - `ATTENTION_DEFAULT_MINUTES` y el Zod `attentionSettingsInput` (boolean + int 5–120);
  - `needsPerson` (derivación por `ventana` → null);
  - `opensWaitOnInbound`, con las exclusiones de R4: `is_test`, `kind`, `isCustomerTurnMessage`, baja por palabra clave;
  - `closeWait`: persona/celular → `answered`, agente → `agent`, 24 h → `expired`; difusiones y fallidos no cuentan; empate → persona;
  - `alertDue`, `isLate` (igual a los minutos → a tiempo), `median` y `summarizeTeamAttention`.
- [x] T006 [P] Tests de `src/lib/team-attention.ts` en `tests/unit/team-attention.test.ts`:
  - cada motivo de apertura y de exclusión;
  - difusión y fallido ignorados;
  - persona antes que agente;
  - vencimiento justo a las 24 h;
  - borde de «tarde»;
  - medianas pares e impares;
  - el resumen con las esperas de quickstart §2 (total 7; mediana de Lucía 5 min; del equipo 7,5 min).
- [x] T007 Exportar la detección de difusiones de 036 como `isTeamBroadcastMessage(org, conversationId, row)`, respetando `details.broadcast`, sin cambiar el comportamiento de `lastTeamMessageAt`, en `src/server/ai/events.ts`
- [x] T008 Crear `src/server/attention/waits.ts`:
  - `reconcileWait(org, waitId, now)`: lee los salientes con `created_at ≥ started_at` (tope 50) y `last_inbound_at`, marca difusiones con T007, aplica `closeWait` y escribe con CAS `WHERE status = 'open'`, copiando `responder_name`;
  - `reconcileOpenWaitFor(org, conversationId, now)`;
  - `openWaitForInbound(...)`: concilia primero; inserta con `ON CONFLICT DO NOTHING`; consulta `agent_profile.enabled` solo si hace falta;
  - `openWaitForHandoff(org, conversationId, at, reason)`.

  Todo con `scoped()` y sin abrir esperas para `is_test`.
- [x] T009 Enganchar la apertura en la ingesta: `void openWaitForInbound(...).catch(log "[atención]")` al final del camino feliz de `ingestInboundCore`, sin frenar el turno ni el push, en `src/server/inbox/ingest.ts`
- [x] T010 Enganchar la apertura en la derivación: `void openWaitForHandoff(...).catch(...)` después del UPDATE de `applyHandoff`, en `src/server/ai/pipeline.ts`

**Checkpoint**: entrar con un «humano» por el wa-mock crea una fila `open` con `start_reason = 'handoff'`. Una respuesta desde el CRM la cierra como `answered` en el próximo `reconcileWait`.

---

## Phase 3: User Story 1 — Aviso cuando un cliente espera (P1) 🎯 MVP

**Goal**: el propietario recibe un único push a los N minutos de una espera sin respuesta.

**Independent Test**: quickstart §1 (pasos 1–9) con `POST /api/dev/attention { now }` y el push-mock.

- [x] T011 [P] [US1] Crear `src/server/attention/settings.ts`: `getAttentionSettings(org)` devuelve el default si no hay fila; `putAttentionSettings(org, input)` hace un upsert por `organization_id`.
- [x] T012 [P] [US1] Agregar `buildWaitingPayload({ contactName, minutes, lastText, conversationId, icon, waitId })` en `src/server/push/payload.ts`: título «… espera hace N min», `url=/inbox?c=…`, `tag=wait-<id>` y body «Derivado por el agente» si no hay texto.
- [x] T013 [US1] Crear `src/server/attention/alert.ts`: `notifyWaiting(org, wait)` junta los propietarios (`member.role = 'owner'`) y envía con `notifyOrganization(org, payload, sub => owners.has(sub.userId))`, en segundo plano y sin lanzar.
- [x] T014 [US1] Crear `src/server/attention/sweep.ts`:
  - `runAttentionSweep(now)`: esperas `open` de a 200 → `reconcileWait` → si sigue abierta y `alertDue`, reserva con `UPDATE … SET alerted_at = now WHERE id = ? AND status = 'open' AND alerted_at IS NULL RETURNING` → solo quien gana llama `notifyWaiting`;
  - devuelve `{ reconciled, alerted }`; una espera que falla se loguea y no corta el barrido;
  - `startAttentionTicker()`: 60 s, `unref`, flag en `globalThis` para no correr en paralelo.
- [x] T015 [US1] Registrar `startAttentionTicker()` junto a los demás tickers en `src/instrumentation.ts`
- [x] T016 [P] [US1] Crear `POST /api/dev/attention` (body `{ now?: string }`, gate `dev-guard`, 404 en producción) que llama `runAttentionSweep`, en `src/app/api/dev/attention/route.ts`
- [x] T017 [US1] Crear `GET/PUT /api/settings/attention` (`withOwner`; Zod de T005; 422 `invalid_body`; `ownerHasPush` = la sesión tiene suscripciones en esta empresa) en `src/app/api/settings/attention/route.ts`
- [x] T018 [US1] Agregar la tarjeta «Aviso cuando un cliente espera» en `src/components/settings/team-client.tsx`: interruptor, minutos 5–120, guardar, y una advertencia con enlace a Notificaciones si `ownerHasPush` es falso.
- [x] T019 [US1] Escribir el guion E2E (sección Aviso, pasos 1–9 de quickstart §1, incluido el camino infeliz del push 410 y del aviso apagado) en `tests/e2e/us-048-team-attention.md`

**Checkpoint**: US1 se puede desplegar sola. Las esperas se registran y el dueño recibe avisos.

---

## Phase 4: User Story 2 — Atención del equipo en Métricas (P1)

**Goal**: sección «Equipo» con el resumen del período, «esperando ahora», «para revisar» y una fila por persona.

**Independent Test**: quickstart §2: las esperas sembradas cuadran en Día, Semana y Año, y contra SQL directo.

- [x] T020 [P] [US2] Crear `src/server/attention/last-seen.ts`: `touchLastSeen(org, userId)` con un freno en memoria de 5 min y `UPDATE member SET last_seen_at = now() WHERE … AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`, que nunca lanza.
- [x] T021 [US2] Llamar `touchLastSeen` al abrir el stream y en cada latido (el freno lo limita) en `src/app/api/events/route.ts`. Verificar que `AppShell` abre `/api/events` también en Métricas y Ajustes (riesgo de R7) y corregir donde no lo haga.
- [x] T022 [US2] Crear `getTeamAttention(org, range, tz, now)` en `src/server/metrics/team.ts`, con la ventana de `metricsWindow` (024):
  - esperas del período por `started_at`, tope 20.000 → `truncated`, unidas a conversación y contacto;
  - `waitingNow`: abiertas, conciliadas antes de mostrar, máx. 50;
  - `problems`: tarde o sin respuesta, máx. 100;
  - mensajes y conversaciones por persona con `GROUP BY sent_by_user_id, sent_by_name` (salientes con autor, no fallidos, no `is_test`);
  - `max(created_at)` por persona, miembros con `role` y `last_seen_at`, y `push_subscription` por `user_id` y `mode`;
  - clasificación de plataforma o de «ya no está» con `isSuperAdminEmail` (R11);
  - `summarizeTeamAttention` con los minutos de la empresa.
- [x] T023 [US2] Crear `GET /api/metrics/team` (`withOwner`, `parseMetricsQuery`, 400 `invalid_range`) en `src/app/api/metrics/team/route.ts`
- [x] T024 [P] [US2] Crear el sembrado `tests/e2e/fixtures/seed-attention.mjs`:
  - miembros Lucía y Pedro en la org principal, con contraseña de prueba guardada en el propio script;
  - Lucía con una suscripción al push-mock;
  - `--waits`: las 7 esperas de quickstart §2 con horas relativas a ahora.

  Re-ejecutable.
- [x] T025 [US2] Crear `src/components/metrics/team-section.tsx`:
  - tarjetas (esperas, a tiempo, tarde, sin respuesta, mediana);
  - «Esperando ahora» con «hace N min» y enlace;
  - «Para revisar»;
  - tabla por persona, que en móvil pasa a tarjetas;
  - «ya no está en el equipo» y «Soporte de la plataforma»;
  - duraciones con `formatDuration` de `src/lib/metrics.ts`.
- [x] T026 [US2] Montar `TeamSection` debajo del histograma, con el mismo rango y zona que la página, en `src/components/metrics/metrics-client.tsx`
- [x] T027 [US2] Sumar al guion la sección Métricas (quickstart §2 y §5: cifras en los 3 rangos, cruce SQL, `last_seen_at`) en `tests/e2e/us-048-team-attention.md`

**Checkpoint**: US1 + US2 = lo que pidió el dueño.

---

## Phase 5: User Story 3 — Firma en el hilo (P2)

**Goal**: cada mensaje del equipo dice quién lo mandó, aunque la persona ya no esté.

**Independent Test**: quickstart §3.

- [x] T028 [P] [US3] Crear el helper `authorName(userId)` (una consulta a `user.name`; null si no hay) en `src/server/inbox/author.ts`
- [x] T029 [US3] Llenar `sentByName` donde ya se pone `sentByUserId`:
  - `src/server/inbox/send.ts`
  - `src/server/inbox/send-media.ts`
  - `src/server/whatsapp/templates.ts`
  - `src/server/instagram/send.ts`

  Verificar también los reintentos (`retryMedia`, `retry_failed`), que no deben pisar el nombre.
- [x] T030 [US3] Exponer `sentByName` en `MessageDto` (`src/lib/types.ts`) y en `serializeMessage` (`src/server/inbox/ingest.ts`)
- [x] T031 [US3] Mostrar «Nombre · hora» en las burbujas salientes `team` con `sentByName`, sin tocar las marcas de IA, API y celular, en `src/components/inbox/message-thread.tsx`
- [x] T032 [US3] Sumar al guion la sección Firma (dos autores, SSE en vivo, Pedro eliminado conserva el nombre) en `tests/e2e/us-048-team-attention.md`

---

## Phase 6: User Story 4 — ¿Les llegan los avisos? (P2)

**Goal**: el estado de las notificaciones de cada persona, a la vista.

**Independent Test**: quickstart §2: Pedro aparece con «Sin avisos en ningún dispositivo» y Lucía con «1 dispositivo · …».

> Los datos ya salen en T022 (`push.devices`/`modes`). Esta fase es la presentación.

- [x] T033 [US4] Mostrar en cada persona de `src/components/metrics/team-section.tsx` el estado de avisos: «Sin avisos en ningún dispositivo» en ámbar; «N dispositivos · todos los mensajes / solo derivaciones».
- [x] T034 [US4] Agregar al guion el chequeo de avisos por persona en `tests/e2e/us-048-team-attention.md`

---

## Phase 7: User Story 5 — Cada persona ve sus números (P3)

**Goal**: el miembro ve solo su fila, en Ajustes → Mi atención.

**Independent Test**: quickstart §4: Lucía ve solo su fila; `/api/metrics/team` → 403; `/metrics` → `/inbox`.

- [x] T035 [US5] Agregar `getMyAttention(org, userId, range, tz, now)` en `src/server/metrics/team.ts`. Reutiliza las consultas de T022 con el filtro por `userId` dentro del SQL y sin resumen del equipo.
- [x] T036 [US5] Crear `GET /api/me/attention` (`withAuth`, solo la sesión, sin parámetro de usuario) en `src/app/api/me/attention/route.ts`
- [x] T037 [US5] Agregar `/settings/attention` a `MEMBER_SETTINGS_PATHS` en `src/lib/roles.ts` y la pestaña «Mi atención» para todos los roles en `src/components/settings/settings-nav.tsx`
- [x] T038 [US5] Crear la página `src/app/(app)/settings/attention/page.tsx` y `src/components/settings/my-attention-client.tsx`: selector de rango, la propia fila con el mismo formato que `team-section.tsx` (extraer la fila a un componente compartido si conviene) y el estado de avisos enlazado a Notificaciones.
- [x] T039 [US5] Sumar al guion la sección Mi atención (incluido el 403 y la redirección) en `tests/e2e/us-048-team-attention.md`
- [x] T040 [P] [US5] Agregar `/settings/attention` al test de `memberCanOpen` en el archivo existente de `tests/unit/` (o crear `tests/unit/roles-attention.test.ts`)

---

## Phase 8: Polish y verificación

- [x] T041 Gate técnico desde el worktree: `node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint . && node_modules/.bin/next build && node_modules/.bin/vitest run`. Antes de conducir el E2E: parar el dev server, `rm -rf .next` y reiniciar (memoria `next-build-vs-dev-server`).
- [x] T042 Correr `tests/e2e/us-048-team-attention.md` completo con Playwright y los mocks, con el dev server lanzado desde el worktree (memoria `worktree-preview-server`). Iterar hasta verde y adjuntar capturas de la sección «Equipo», la tarjeta del aviso, la firma y «Mi atención».
- [x] T043 [P] Actualizar `CLAUDE.md`: fila nueva en el mapa del código para 048 con todos los módulos de plan.md.
- [x] T044 [P] Actualizar la spec a «Estado: implementada», con el resumen de lo construido, en `specs/048-team-attention/spec.md`
- [x] T045 Guardar la memoria de la feature en `/Users/jmorazano/.claude/projects/-Users-jmorazano-Documents-drone-corscan-crm/memory/team-attention-048.md` y el índice en `MEMORY.md`: estado, migración 0035, aviso apagado por defecto, falta prenderlo en Altos, la próxima migración es la 0036.

---

## Dependencies & Execution Order

```text
Phase 1 ─▶ Phase 2 (T002→T003→T004; T005→T006; T007→T008→T009,T010)
            │
            ├─▶ US1 (T011,T012 ∥ → T013 → T014 → T015; T016 ∥; T017 → T018; T019)
            ├─▶ US2 (T020 → T021; T022 → T023; T024 ∥; T025 → T026; T027)
            ├─▶ US3 (T028 → T029 → T030 → T031; T032)      ← solo necesita T003/T004
            ├─▶ US4 (T033, T034)                            ← necesita T025 (US2)
            └─▶ US5 (T035 → T036; T037; T038; T039; T040)   ← necesita T022 (US2)
Phase 8 al final.
```

- US1, US2 y US3 son independientes entre sí una vez terminada la Fase 2.
- US4 y US5 se apoyan en las consultas y componentes de US2.
- US3 no depende de las esperas: puede ir antes si se quiere un primer
  entregable chico.

## Parallel Examples

- **Fase 2**: T006 (tests puros) en paralelo con T007 (difusiones) una vez
  escrito T005.
- **US1**: T011 (`settings.ts`), T012 (`payload.ts`) y T016 (ruta dev) a la
  vez.
- **US2**: T020 (`last-seen.ts`) y T024 (sembrado) en paralelo con T022.
- **Polish**: T043 y T044 a la vez.

## Implementation Strategy

1. **MVP = Fase 2 + US1.** Las esperas se registran y el dueño de Altos
   recibe el aviso. Ya responde «¿están atendiendo?» en el momento.
2. **+ US2**: Métricas «Equipo». Responde «¿quién y cuánto tardan?».
3. **+ US3 y US4**: firma y estado de avisos (baratos y visibles).
4. **+ US5**: «Mi atención» para el equipo.
5. Un solo deploy con todo, verificado en vivo (T041–T042). Después, el dueño
   prende el aviso en Altos.
