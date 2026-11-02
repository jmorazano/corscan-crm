# Data model — 048 Quién atiende (migración 0035)

Todas las tablas nuevas llevan `organization_id NOT NULL` y se consultan por
`scoped()` (constitución III). La migración es re-ejecutable (`IF NOT
EXISTS`, backfill idempotente).

## Tabla nueva `attention_wait`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `aw_` |
| `organization_id` | text NOT NULL → organization (cascade) | |
| `conversation_id` | text NOT NULL → conversation (cascade) | |
| `started_at` | timestamp NOT NULL | hora de la derivación o del mensaje del cliente |
| `start_reason` | text NOT NULL | `handoff` \| `ai_off` |
| `start_message_id` | text NULL → message (set null) | mensaje del cliente que la abrió (NULL en derivación) |
| `status` | text NOT NULL default `open` | `open` \| `answered` \| `agent` \| `expired` |
| `closed_at` | timestamp NULL | hora del mensaje que la cerró o del cierre de la ventana |
| `responder_user_id` | text NULL → user (set null) | primera persona que respondió |
| `responder_name` | text NULL | nombre copiado al cerrar (sobrevive a la salida) |
| `responder_via` | text NULL | `crm` \| `phone` |
| `response_ms` | integer NULL | `closed_at − started_at`, solo `answered` |
| `alerted_at` | timestamp NULL | reserva del aviso: no NULL = ya se avisó (o se intentó) |
| `created_at` / `updated_at` | timestamp NOT NULL | |

Índices:

- `attention_wait_open_uq`: UNIQUE `(conversation_id)` `WHERE status = 'open'`.
  Garantiza una espera abierta por conversación (FR-002).
- `(organization_id, started_at)`: período de Métricas.
- `(status, started_at)` `WHERE status = 'open'`: barrido.

Transiciones (monotónicas: una espera cerrada no se reabre):

```text
open ──(mensaje de una persona / celular)──▶ answered
open ──(mensaje del agente)───────────────▶ agent
open ──(now ≥ last_inbound_at + 24 h)─────▶ expired
```

Toda transición es compare-and-set: `WHERE id = ? AND status = 'open'`.

## Tabla nueva `attention_settings`

Una fila por empresa (patrón de `pipeline_settings`). Si no hay fila, vale
el default.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `as_` |
| `organization_id` | text NOT NULL UNIQUE → organization (cascade) | |
| `alert_enabled` | boolean NOT NULL default `false` | FR-007 |
| `alert_minutes` | integer NOT NULL default `15` | 5–120 (Zod), también define «tarde» |
| `created_at` / `updated_at` | timestamp NOT NULL | |

## Columnas nuevas

- `member.last_seen_at timestamp NULL`: última vez que la persona usó el CRM
  en esa empresa (FR-019). NULL = nunca desde el despliegue.
- `message.sent_by_name text NULL`: nombre de quien envió, copiado al
  insertar. Backfill:
  `UPDATE message m SET sent_by_name = u.name FROM "user" u WHERE m.sent_by_user_id = u.id AND m.sent_by_name IS NULL`.

## Tipos (TypeScript, sin BD)

- `MessageDto.sentByName: string | null`.
- `TeamAttention` (respuesta de `/api/metrics/team`): ver
  [contracts/api.md](contracts/api.md).
- `MemberAttentionRow`: la fila por persona (la misma forma en
  `/api/metrics/team` y en `/api/me/attention`).

## Relaciones

```text
organization 1─* attention_wait *─1 conversation
attention_wait *─0..1 user (responder)       message *─0..1 user (sent_by)
organization 1─0..1 attention_settings       member (org, user).last_seen_at
push_subscription (org, user, mode) → estado de avisos por persona (013, sin cambios)
```
