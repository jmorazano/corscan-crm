# Data model — 015 Entrenador del agente

## conversation (extendida)

| Columna | Tipo | Notas |
|---|---|---|
| kind | text NOT NULL default 'whatsapp' | enum `whatsapp` \| `trainer` |
| is_test | boolean | pasa a significar «sandbox» (Laboratorio o entrenador): jamás toca WhatsApp |

Índice parcial único `conversation_org_trainer_uq (organization_id) WHERE
kind = 'trainer'` → una por empresa. El índice `(org, contact) WHERE
is_test = false` no la alcanza (is_test = true).

## contact sintético (sin cambio de esquema)

`{ phone: 'trainer', name: <agent_profile.name>, is_test: true,
archived_at: now(), consent_source: NULL }`. Único por `(org, phone)`.
`phone` no numérico a propósito: `normalizeToWaId` lo rechaza.

## kb_entry (extendida)

| Columna | Tipo | Notas |
|---|---|---|
| source | text NOT NULL default 'manual' | enum `manual` \| `lab` \| `trainer` — chip en Agente |

## agent_change (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `chg_…` |
| organization_id | text NOT NULL FK organization cascade | tenant |
| conversation_id | text NULL FK conversation set null | hilo del entrenador |
| message_id | text NULL FK message set null | respuesta del agente que lo reportó |
| source | text NOT NULL default 'trainer' | enum `trainer` \| `manual` \| `lab` (v1 solo escribe `trainer`) |
| op | text NOT NULL | enum `kb_add` \| `kb_update` \| `kb_delete` \| `profile_update` |
| target_id | text NULL | id de `kb_entry` o nombre del campo del perfil |
| before | jsonb NULL | fila/valor anterior (null en `kb_add`) |
| after | jsonb NULL | fila/valor posterior (null en `kb_delete`) |
| summary | text NOT NULL | generado por el servidor («Nueva P/R: …») |
| reverted_at | timestamp NULL | undo aplicado |
| reverted_by | text NULL | user id |
| created_at | timestamp NOT NULL default now | |

Índice `agent_change_org_created_idx (organization_id, created_at)`.

Undo por `op`: `kb_add` → borrar `target_id` (si ya no existe, igual se
marca revertido); `kb_update` → restaurar `before` (409 `target_conflict`
si no existe); `kb_delete` → reinsertar `before` con el mismo id y source
(409 si el id volvió a existir); `profile_update` → campo a `before`.

## message_media (nueva, US3)

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `mm_…` |
| organization_id | text NOT NULL FK cascade | |
| message_id | text NOT NULL UNIQUE FK message cascade | 1:1 |
| mime_type | text NOT NULL | normalizado (`audio/mp4`, `audio/ogg`, `audio/wav`, …) |
| size_bytes | integer NOT NULL | ≤ 8 MB |
| duration_ms | integer NULL | medido por el cliente |
| data | bytea NOT NULL | el audio |
| created_at | timestamp NOT NULL default now | |

## ai_credentials (extendida, US3)

| Columna | Tipo | Notas |
|---|---|---|
| transcription_model | text NULL | NULL = default del producto (modelo con entrada de audio) |

## message (uso, sin cambio de esquema)

En la conversación `trainer`: dueño → `direction='out'`, `status='sent'`,
`ai_generated=false`; agente → `direction='in'`, `status='delivered'`,
`ai_generated=true`; undo → `direction='in'`, `ai_generated=false`. Notas
de voz: `type='audio'`, `text` = transcripción, `status` = `pending` →
`delivered` | `failed` (motivo en `error`).
