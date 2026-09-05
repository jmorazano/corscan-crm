# Data Model — 004 Contactos importados + Campañas

Convenciones del repo: `organization_id` NOT NULL + FK cascade en toda tabla
de dominio, índices org-first, ids nanoid con prefijo, acceso vía `scoped()`.
Migración: editar `src/lib/db/schema.ts` → `pnpm db:generate` → `drizzle/0004_*`.

## contact (columnas nuevas)

| Columna | Tipo | Notas |
|---|---|---|
| `tags` | text[] NOT NULL default `{}` | etiquetas libres saneadas (trim, lower, sin vacías, únicas); índice GIN para el filtro de segmento |
| `consent_source` | text NULL enum `import` \| `inbound` \| `manual` | NULL = sin consentimiento registrado → inelegible para campañas |
| `consent_at` | timestamp NULL | cuándo se registró |
| `opted_out_at` | timestamp NULL | NULL = activo; set-si-null desde la ingesta (BAJA/STOP) |
| `opt_out_reverted_at` / `opt_out_reverted_by` | timestamp / text NULL | auditoría de la última reversión (FR-011) |
| `is_test` | boolean NOT NULL default false | contacto del Laboratorio: jamás elegible, jamás desarchivable, el import lo rechaza; la migración marca los preexistentes por sus conversaciones is_test |

Reglas: la ingesta estampa `consent_source='inbound'` set-si-null cuando el
cliente escribe; los PREEXISTENTES los cubre el backfill de la migración
0004 (consent_source='inbound' + consent_at = fecha del primer inbound,
FR-007 completo). El teléfono se guarda SIEMPRE normalizado a formato wa_id
(research D3) y un paso re-ejecutable al boot normaliza los preexistentes;
la reconciliación post-send puede actualizar `phone` al `wa_id` devuelto si
está libre (con el guard anti-eco de D3).

## campaign

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `cmp_` |
| `organization_id` | text NOT NULL FK | cascade |
| `name` | text NOT NULL | |
| `template_id` | text NOT NULL FK template | debe estar `approved` al lanzar |
| `tag_filter` | text[] NOT NULL default `{}` | vacío = todos los elegibles; match = AL MENOS una |
| `variable_mode` | text NOT NULL enum `contact_name` \| `fixed` default `contact_name` | |
| `variable_text` | text NULL | requerido si `fixed` y la plantilla tiene {{1}} |
| `status` | text NOT NULL enum `draft` \| `running` \| `paused` \| `completed` \| `cancelled` default `draft` | transiciones finales con guard WHERE (monotónicas) |
| `paused_reason` | text NULL enum `manual` \| `daily_limit` \| `channel` \| `error` | solo con status `paused`; el ticker reanuda ÚNICAMENTE `daily_limit` |
| `runner_generation` | integer NOT NULL default 0 | anti doble-runner: pause/resume la incrementa; un runner con generación vieja se auto-termina |
| `launched_at` / `completed_at` / `cancelled_at` | timestamp NULL | |
| `created_at` / `updated_at` | timestamp NOT NULL defaultNow | |

Índice `(organization_id, created_at)`. Transiciones válidas:
`draft→running` (launch, congela destinatarios; rechaza segmento vacío),
`running→paused` (manual / daily_limit / channel / error),
`paused(daily_limit)→paused(manual)` (la pausa manual gana sobre la
automática — sin esto el ticker reanudaría contra la voluntad del
operador), `paused→running` (resume manual; automático solo daily_limit),
`running|paused→cancelled`, `running→completed` (sin pendientes NI sending
residuales). `cancelled` y `completed` son terminales.

## campaign_recipient

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `cr_` |
| `organization_id` | text NOT NULL FK | |
| `campaign_id` | text NOT NULL FK campaign cascade | |
| `contact_id` | text NOT NULL FK contact | |
| `status` | text NOT NULL enum `pending` \| `sending` \| `sent` \| `failed` \| `skipped` default `pending` | fuente de verdad anti-duplicados |
| `skip_reason` | text NULL enum `opted_out` \| `ineligible` \| `cancelled` | (la colisión de wa_id post-envío NO es skip: el mensaje ya salió — queda `sent` con aviso `wa_id_conflict` en `error`) |
| `error` | text NULL | motivo del fallo (redactado) |
| `conversation_id` / `message_id` | text NULL | seteados al enviar |
| `wa_message_id` | text NULL | persistido APENAS responde Graph. At-most-once (FR-018): al arrancar CUALQUIER corrida del runner, `sending` CON wamid → sent (reponiendo initiated_send si falta); SIN wamid = ambiguo → `failed("interrumpido por reinicio")`, jamás re-envío automático |
| `sent_at` / `replied_at` | timestamp NULL | replied set-si-null desde la ingesta |

UNIQUE `(campaign_id, contact_id)` · índice `(organization_id, campaign_id, status)`.

**Entregado/leído/fallo-de-entrega NO se duplican acá**: derivan de
`message.status` (ya monotónico vía webhook) con JOIN por `message_id` —
una sola máquina de estados de entrega en el sistema. El agregado "fallido"
de FR-017 fusiona ambos orígenes: `recipient.status='failed'` (fallo al
enviar) OR `message.status='failed'` (fallo de entrega asíncrono, p. ej.
número inexistente — el caso más común del mundo real), con
`message.error` como motivo.

## initiated_send (cupo de ventana móvil)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `is_` |
| `organization_id` | text NOT NULL FK | |
| `contact_id` | text NOT NULL FK | |
| `sent_at` | timestamp NOT NULL defaultNow | |

Índice `(organization_id, sent_at)`. Se inserta como **RESERVA, ANTES de
llamar a Graph** (dentro del mutex FIFO por org — research D4), en TODO
envío de plantilla con ventana de servicio cerrada (campaña,
POST /api/conversations, y el sender de plantillas existente); si Graph
falla, se compensa con DELETE. Cupo usado = `COUNT(DISTINCT contact_id)
WHERE sent_at > now() - 24h`, con exención por contacto ya iniciado en la
ventana (FR-015). El caso ambiguo de reinicio deja la reserva puesta =
sesgo genuinamente conservador.

## send_settings

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `ss_` |
| `organization_id` | text NOT NULL FK, UNIQUE | patrón ai_credentials |
| `daily_initiated_limit` | integer NOT NULL default 250 | 1..100000; upsert onConflictDoUpdate |
| `created_at` / `updated_at` | timestamp NOT NULL | |

## SseEvent (bus)

Variante nueva: `campaign.progress` →
`{ campaignId, status, pausedReason?, counts: { total, pending, sent, delivered, read, replied, failed, skipped } }`.
Se publica tras el commit de cada transición relevante (por envío puede
agrupar cada N para no inundar; el cliente hace catch-up por refetch).

## Elegibilidad de destinatario (congelado al lanzar)

`consent_source IS NOT NULL` AND `opted_out_at IS NULL` AND
`archived_at IS NULL` AND `is_test = false` AND (tag_filter vacío OR
`tags && tag_filter`). La exclusión del sandbox es por la columna
`is_test` REAL (no por archived_at, que es reversible con un click); el
guard vale también en POST /api/conversations (403 `sandbox_violation`) y
el PATCH no permite desarchivar contactos is_test. El opt-out posterior al
lanzamiento convierte filas `pending` en `skipped(opted_out)` desde la
ingesta.
