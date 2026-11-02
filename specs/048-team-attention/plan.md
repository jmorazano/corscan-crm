# Implementation Plan: 048 — Quién atiende

**Branch**: `048-team-attention` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/048-team-attention/spec.md`

## Summary

El propietario se entera cuando un cliente espera a una persona y nadie
responde, y ve en Métricas quién atiende y cuánto tarda. Cada espera
(derivación del agente o IA apagada) es una fila de `attention_wait`:

- **Se abre** en dos ganchos: la ingesta y la derivación.
- **Se cierra** conciliando los mensajes posteriores (persona, celular,
  agente o vencimiento de la ventana).
- **El aviso** sale de un barrido de 60 s con reserva-primero: uno por
  espera.

Métricas suma una sección «Equipo» calculada en TS puro. El hilo muestra el
nombre de quien envió cada mensaje. Los miembros ven su propia fila en
Ajustes → Mi atención. Sin dependencias nuevas. Migración **0035**.
Decisiones y alternativas en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node ≥ 20

**Primary Dependencies**: Next.js 15 (App Router) + React 19, Drizzle ORM, Better Auth, Zod, `web-push` (013). Ninguna nueva.

**Storage**: PostgreSQL. Migración 0035: `attention_wait`, `attention_settings`, `member.last_seen_at`, `message.sent_by_name` + backfill.

**Testing**: Vitest (lógica pura en `src/lib/team-attention.ts`) + guion E2E `tests/e2e/us-048-team-attention.md` con Playwright, wa-mock, ai-mock y push-mock.

**Target Platform**: contenedor Linux en Railway; la PWA (012) en el teléfono del equipo.

**Project Type**: web (monolito Next.js).

**Performance Goals**:
- aviso a ≤ 1 min de cumplirse los minutos (SC-001);
- la sección «Equipo» responde en < 1 s para un año de Altos (miles de
  esperas, ~100 k mensajes).

**Constraints**:
- at-most-once del aviso (IV);
- `scoped()` en toda consulta (III);
- `is_test` nunca abre esperas;
- ningún fallo de este módulo bloquea la ingesta ni el turno del agente
  (todo con `.catch`, en segundo plano).

**Scale/Scope**: por empresa, decenas de esperas por día; una o dos decenas de personas.

## Constitution Check

*GATE: antes de Phase 0 y de nuevo después del diseño.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Seguridad | Sin secretos nuevos. El push reutiliza las VAPID cifradas de 013. El contenido del aviso va solo a dispositivos de propietarios. | ✅ |
| II. Soberanía | Solo Web Push estándar (categoría 4), ya habilitado. Sin servicios externos. | ✅ |
| III. Multi-tenancy | `organization_id NOT NULL` en `attention_wait` y `attention_settings`. Consultas por `scoped()`. `/api/me/attention` limitado a la sesión. | ✅ |
| IV. Idempotencia | Única espera abierta por conversación (índice único parcial). Transiciones CAS monotónicas. Reserva del aviso por `alerted_at IS NULL`. Migración re-ejecutable. | ✅ |
| V / IX. Verificación en vivo | Guion E2E con mocks, incluido el camino infeliz (push 410, aviso apagado, reinicio). Tests puros. | ✅ (plan) |
| VI. Specs antes de código | spec + plan + tasks antes de implementar. | ✅ |
| VII. Trazabilidad | Decisiones en research.md; CLAUDE.md y memoria al cerrar. | ✅ |
| VIII. Foco vertical | Operación del equipo sobre las conversaciones de WhatsApp/Instagram: es el núcleo del CRM. | ✅ |
| Sandbox del Laboratorio | `is_test` y `trainer` excluidos en la apertura y en Métricas. | ✅ |

Sin violaciones: no hace falta *Complexity Tracking*.

## Project Structure

### Documentation (this feature)

```text
specs/048-team-attention/
├── spec.md
├── plan.md              # este archivo
├── research.md          # decisiones R1–R12
├── data-model.md        # migración 0035
├── quickstart.md        # self-test de punta a punta
├── contracts/api.md     # rutas, DTO y push
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
drizzle/0035_team_attention.sql              # tablas, columnas, índices, backfill
src/lib/db/schema.ts                          # attentionWait, attentionSettings, member.lastSeenAt, message.sentByName
src/lib/db/ids.ts                             # prefijos aw_ / as_
src/lib/team-attention.ts                     # PURO: ¿abre?, cierre, tarde, aviso vencido, resumen, medianas, Zod de la config
src/lib/roles.ts                              # MEMBER_SETTINGS_PATHS += /settings/attention
src/lib/types.ts                              # MessageDto.sentByName
src/server/attention/
├── waits.ts                                  # openWaitForInbound, openWaitForHandoff, reconcileWait(s)
├── sweep.ts                                  # startAttentionTicker, runAttentionSweep(now): concilia + avisa
├── alert.ts                                  # owners + notifyOrganization + payload «espera hace N min»
├── settings.ts                               # get/put attention_settings
└── last-seen.ts                              # touchLastSeen con freno de 5 min
src/server/metrics/team.ts                    # getTeamAttention(org, range, tz, now) y getMyAttention(...)
src/server/ai/events.ts                       # exporta isTeamBroadcastMessage (036)
src/server/inbox/ingest.ts                    # gancho de apertura en ingestInboundCore + sentByName en serializeMessage
src/server/ai/pipeline.ts                     # gancho de apertura en applyHandoff
src/server/inbox/send.ts, send-media.ts, whatsapp/templates.ts, instagram/send.ts  # sent_by_name al insertar
src/server/push/payload.ts                    # buildWaitingPayload
src/app/api/events/route.ts                   # touchLastSeen al conectar y con el latido
src/app/api/metrics/team/route.ts             # withOwner
src/app/api/me/attention/route.ts             # withAuth, solo la sesión
src/app/api/settings/attention/route.ts       # withOwner GET/PUT
src/app/api/dev/attention/route.ts            # dev-guard
src/instrumentation.ts                        # startAttentionTicker()
src/components/inbox/message-thread.tsx       # firma «Nombre · hora»
src/components/metrics/team-section.tsx       # sección «Equipo» (resumen, esperando ahora, problemas, personas)
src/components/metrics/metrics-client.tsx     # monta la sección con el mismo rango
src/components/settings/team-client.tsx       # tarjeta «Aviso cuando un cliente espera»
src/app/(app)/settings/attention/page.tsx     # «Mi atención»
src/components/settings/my-attention-client.tsx
src/components/settings/settings-nav.tsx      # pestaña «Mi atención»
tests/unit/team-attention.test.ts
tests/e2e/us-048-team-attention.md
tests/e2e/fixtures/seed-attention.mjs
```

## Design

### 1. Núcleo puro — `src/lib/team-attention.ts`

- `ATTENTION_DEFAULT_MINUTES = 15`, `attentionSettingsInput` (Zod: boolean
  + int 5–120).
- `needsPerson({ handoffAt, aiEnabled, agentEnabled, handoffReason })` →
  `"handoff" | "ai_off" | null`. `ventana` → null.
- `opensWaitOnInbound({ conversation, message, contact, agentEnabled })`:
  aplica R4 (test, kind, turno del cliente, baja por palabra clave) y
  devuelve el motivo o null.
- `closeWait(wait, afterMessages, lastInboundAt, now)`: recibe los salientes
  posteriores al inicio, en orden y ya marcados (`isBroadcast`), y devuelve
  `{ status: "open" }` o el cierre con `closedAt`, `responder*` y
  `responseMs` (R3). Si un mensaje de persona y uno del agente caen en el
  mismo instante, gana la persona.
- `alertDue(wait, settings, now)`: abierta, `alerted_at` nulo, aviso
  encendido y `now ≥ started_at + minutos`.
- `summarizeTeamAttention(waits, lateMinutes)` y `median(ms[])`: totales,
  a tiempo o tarde, celular, plataforma y la fila de esperas por persona.

Los tests cubren: cada motivo de apertura y de exclusión, difusión ignorada,
fallido ignorado, persona antes que agente, vencimiento a las 24 h justas,
medianas pares e impares, «tarde» en el borde (= minutos → a tiempo).

### 2. Apertura (ganchos)

- **Ingesta**: `ingestInboundCore`, después de insertar el mensaje y
  actualizar la conversación.
  - Llama `void openWaitForInbound(...).catch(log)`, que concilia la espera
    abierta de esa conversación y, si sigue habiendo motivo, inserta con
    `ON CONFLICT DO NOTHING` (índice único parcial).
  - `agent_profile.enabled` se consulta solo si la conversación no está ya
    derivada ni con la IA apagada.
  - La historia de 017 y los ecos no pasan por aquí: no abren esperas.
- **Derivación**: en `applyHandoff` de `pipeline.ts`, después del UPDATE.
  Llama `void openWaitForHandoff(org, conversationId, at, reason).catch(log)`,
  con el mismo insert idempotente y `started_at` = hora de la derivación.
  Si ya había una abierta (por IA apagada), se conserva la existente.

### 3. Cierre y aviso — `src/server/attention/sweep.ts`

- `startAttentionTicker()` en `instrumentation.ts`: cada 60 s, `unref`, un
  barrido a la vez (flag en `globalThis`, como 042).
- `runAttentionSweep(now)`:
  1. Esperas `open` de todas las empresas, por `started_at`, de a 200 por
     barrido.
  2. `reconcileWait` para cada una:
     - lee los salientes de la conversación con `created_at ≥ started_at`
       (tope 50) y el `last_inbound_at`;
     - marca difusiones con `isTeamBroadcastMessage`;
     - aplica `closeWait`;
     - escribe con CAS `WHERE status = 'open'`.
  3. Si sigue abierta y `alertDue`, reserva con
     `UPDATE … SET alerted_at = now WHERE id = ? AND status = 'open' AND alerted_at IS NULL RETURNING`.
     Solo quien gana la reserva envía, con `notifyWaiting` (en segundo plano).
  4. Devuelve `{ reconciled, alerted }` (lo usa la ruta dev).
- `alert.ts`: propietarios = `member.role = 'owner'` de la empresa. Envía
  con `notifyOrganization(org, buildWaitingPayload(...), sub => owners.has(sub.userId))`.
  El texto usa el nombre del contacto y el último mensaje del cliente.

### 4. Firma

- `message.sent_by_name` se llena en los 4 inserts que ya ponen
  `sent_by_user_id`. El nombre sale de `user.name`, con una consulta por
  envío manual vía el helper `authorName(userId)` en
  `src/server/inbox/author.ts`.
- `serializeMessage` expone `sentByName`.
- `message-thread.tsx`: en las burbujas salientes `team` con `sentByName`,
  la línea de hora pasa a «Nombre · 14:32». Las marcas existentes (IA, API,
  celular) no cambian.

### 5. Última vez en el CRM

`touchLastSeen(org, user)`: un `Map` en memoria con el último toque, más un
`UPDATE member SET last_seen_at = now WHERE organization_id = ? AND user_id = ? AND (last_seen_at IS NULL OR last_seen_at < now − 5 min)`.
Se llama al abrir `/api/events` y desde el latido, con el mismo freno.

### 6. Métricas — `src/server/metrics/team.ts`

- La ventana sale de `metricsWindow(range, tz, now)` de 024.
- Esperas del período: `started_at` en la ventana, tope 20.000 (marca
  `truncated`), unidas a la conversación y al contacto para el nombre y el
  canal. Las abiertas se concilian antes de mostrarlas (como mucho 50, las
  de «esperando ahora»).
- Mensajes por persona, en un `GROUP BY sent_by_user_id, sent_by_name`:
  `count(*)` y `count(DISTINCT conversation_id)` de salientes con autor, no
  fallidos, de conversaciones no `is_test`, en la ventana.
- Otras consultas: `max(created_at)` por persona sin límite de período, los
  miembros con `role` y `last_seen_at`, y `push_subscription` agrupada por
  `user_id` y `mode`.
- Cuentas de plataforma por `isSuperAdminEmail` (R11).
- `getMyAttention(org, userId, ...)` reutiliza lo mismo con un filtro por
  `userId` desde el SQL. No calcula el resumen del equipo.

### 7. UI

- **Métricas** → `TeamSection`, debajo del histograma y con el mismo
  selector de rango:
  - tarjetas: esperas, a tiempo, tarde, sin respuesta, mediana;
  - «Esperando ahora» con «hace N min» y enlace;
  - «Para revisar»: tarde o sin respuesta, con enlace;
  - tabla por persona, que en móvil pasa a tarjetas apiladas (012);
  - avisos: «Sin avisos en ningún dispositivo» en ámbar; «2 dispositivos ·
    solo derivaciones».

  Duraciones con `formatDuration` de 024.
- **Ajustes → Equipo**: tarjeta «Aviso cuando un cliente espera», con
  interruptor, minutos (5–120) y una advertencia si `ownerHasPush` es
  `false`, enlazada a Notificaciones.
- **Ajustes → Mi atención** (todos): la propia fila en el mismo formato, con
  el selector de rango y el estado de avisos enlazado a Notificaciones.

### 8. Fallas y bordes

- Toda la apertura y el barrido van con `.catch` y log `[atención]`: nunca
  frenan la ingesta, el agente ni el envío.
- El barrido no corre en paralelo consigo mismo. Si una espera falla al
  conciliar, se loguea y sigue con la próxima.
- Reinicio: el ticker retoma las esperas abiertas. `alerted_at` impide el
  doble aviso.
- Cambio de minutos: aplica al próximo barrido. Las ya avisadas no se
  vuelven a avisar.

## Riesgos

- **Esperas por una IA apagada a propósito**: algunas empresas apagan la IA
  por conversación para atenderla ellas. Ahí cada mensaje del cliente es una
  espera, y eso es correcto: es justo lo que el dueño quiere medir. Como el
  aviso viene apagado por defecto, nadie recibe avisos sin pedirlos.
- **Empresas sin agente** (`agent_profile.enabled = false`): todo entrante
  es una espera. Es correcto, y el aviso es opcional.
- **Backfill de `sent_by_name`**: un UPDATE sobre los mensajes con autor
  (pocos miles en producción) dentro de la migración, que es aceptable.

## Post-design Constitution Check

El diseño no introdujo dependencias, servicios ni escrituras fuera de la
empresa. La única red nueva es el push de 013 a los propietarios. ✅
