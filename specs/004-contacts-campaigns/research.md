# Research — 004 Contactos importados + Campañas de plantillas

**Fecha**: 2026-09-05 · Fuentes: docs oficiales de Meta (developers.facebook.com),
npm/Snyk (estado al 5-sep-2026), y exploración del repo con evidencia archivo:línea.

## D1 — Parser de Excel en el navegador

**Decision**: `read-excel-file@9.3.10` (`pnpm add read-excel-file`), import
`read-excel-file/browser` sobre el `File` del input.

**Rationale**: browser-first (File/Blob directo), MIT, mantenida (releases
jul–ago 2026), 0 advisories en Snyk, types propios compatibles con `strict`,
y trae parseo por schema con errores por fila/columna — exactamente lo que
necesita la vista previa del import. Perf sobrada (~0.5s / 10MB).

**Alternatives**: SheetJS CE — el `xlsx` de npm quedó CONGELADO en 0.18.5 con
2 CVEs (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS); la 0.20.3
sana solo se instala como tarball desde cdn.sheetjs.com (invisible para
Renovate y fácil de instalar mal). exceljs — inactiva desde 2023, ~1MB de
bundle. Descartadas.

## D2 — Parser de CSV en el navegador

**Decision**: `papaparse@5.7.0` + `@types/papaparse` (dev).

**Rationale**: estándar de facto, MIT, sin deps de runtime, sin advisories
abiertos (el ReDoS histórico se corrigió en 5.2.0), maneja input malformado
y soporta workers si la lista crece.

## D3 — Normalización de teléfonos (la trampa argentina)

**Decision**: normalizar SIEMPRE al formato **wa_id** (dígitos solos,
`549 + área sin 0 + número sin 15`, 13 dígitos) con `libphonenumber-js`
(región AR para formatos nacionales) + post-procesos obligatorios: si el
E.164 empieza `+54` y no `+549`, insertar el `9`; espejo mexicano — si
empieza `52` + 10 dígitos, insertar el `1` (`521…`, el wa_id legacy que
llega en los webhooks; `normalizeRecipient` ya lo quita AL ENVIAR). Ese
valor es el `contact.phone` y la base del `to` del send. Además,
**reconciliar con `contacts[0].wa_id`** de cada respuesta de send (la doc
oficial dice que "may not match input") con este guard: NO reconciliar
cuando el wa_id devuelto es igual al phone almacenado NI cuando es igual a
`normalizeRecipient(phone)` — eso es el eco del `to` normalizado, no una
corrección de Meta (el wa-mock ecoa `to` tal cual y reescribiría el
canónico en cada E2E). Cuando difiere de ambos: si el wa_id está libre en
la org, actualizar el phone; si otro contacto ya lo tiene, dejar el envío
como está y registrar el conflicto (aviso `wa_id_conflict`) — el mensaje ya
salió, mentirle un "omitido" al operador sería falso.
**Prerequisito de plomería**: `callGraphSend` hoy tipa la respuesta solo
como `{ messages[{id}] }` y descarta `contacts[0].wa_id` — debe devolver
`{ waMessageId, waId }` y `sendTemplateCore` propagarlos (2 call sites:
send.ts:96, templates.ts:362).
**Backfill preexistente**: la BD puede contener phones no canónicos (el
POST /api/contacts viejo aceptaba `^\d{7,15}$` sin regla AR): un paso
re-ejecutable al boot normaliza los existentes con esta misma lib (si el
canónico colisiona con otra fila de la org, se deja como está y se loguea)
— sin esto, el import crearía duplicados de la población preexistente.

**Rationale**: verificado empíricamente — libphonenumber-js resuelve bien
"0351 15 688 2234" → +5493516882234 pero deja "+54 351 688 2234" SIN el 9;
la Cloud API suele normalizar sola (devuelve wa_id 549…) pero no está
documentado para AR (solo BR/MX) y en dev-mode la allowlist compara exacto
(error 131030). El wa_id del webhook SIEMPRE trae el 9: si el contacto
importado quedara como 54351…, su respuesta crearía un contacto duplicado
(ingest upserta por org+phone). El repo ya tiene `normalizeRecipient` con el
fix 521→52 de México (src/lib/meta/client.ts:152-157) — se extiende, no se
duplica.

**Alternatives**: confiar en la normalización de la API (rompe en
dev/allowlist y deja ventana de duplicados); clavear por E.164 (diverge del
wa_id justo en AR/MX). Descartadas.

## D4 — Semántica del cupo (messaging limit de Meta)

**Decision**: cupo por **ventana móvil de 24h sobre contactos únicos
iniciados**: tabla `initiated_send` (org, contact, sent_at) registrando cada
plantilla enviada con ventana de servicio CERRADA (dentro de ventana no
consume — semántica de Meta; se chequea `isWindowOpen(lastInboundAt)` en el
momento del envío, en LOS TRES caminos: runner, POST /api/conversations y
el sender existente). Cupo usado = `COUNT(DISTINCT contact_id) WHERE
sent_at > now()-24h`. Límite por empresa (default 250) en `send_settings`.
**Reserva, no chequeo**: la verificación y el INSERT de `initiated_send`
ocurren juntos ANTES de llamar a Graph, dentro de un mutex FIFO por org
(cadena de promesas — el patrón __agentCoalesce NO sirve: es un coalesce
que descarta trabajo, no un mutex); si Graph falla, se compensa (DELETE de
la reserva). Así no hay TOCTOU entre campañas y envíos individuales, y el
caso ambiguo de reinicio deja la reserva puesta = sesgo conservador REAL.
**Exención por contacto** (FR-015): `assertQuota(orgId, contactId)` pasa
aunque el cupo esté lleno si ESE contacto ya tiene un initiated_send en la
ventana (segunda plantilla al mismo contacto = gratis). El runner pausa la
campaña (`paused` motivo `daily_limit`) al agotarse; un ticker la reanuda
cuando la ventana libera cupo (solo las pausadas por `daily_limit` — la
pausa manual siempre gana, incluso aplicada SOBRE una pausa por límite).

**Rationale**: doc oficial literal: "unique WhatsApp user phone numbers …
within a moving 24-hour period", excluyendo mensajes dentro de ventana de
servicio. No hay código de error dedicado al exceso (aparece como 131048 o
como `failed` asíncrono por webhook) — hay que frenar ANTES, no reaccionar.
Tiers 2026: 250 → 2.000 (verificación) → 10K → 100K → ∞. Doble conteo en el
caso ambiguo de reinicio es aceptable: sesga el cupo a conservador.

## D5 — Pacing y errores de rate del canal

**Decision**: envío secuencial con pausa entre mensajes
(`CAMPAIGN_PACE_MS`, en el envSchema de `src/lib/env.ts` con default
4000ms + jitter; el E2E local lo baja). Máx. 1 mensaje por destinatario por
campaña (evita pair rate limit 131056). Manejo por destinatario: fallo
transitorio (130429 throughput, 5xx) → un solo reintento con backoff;
131049/131050 (tope de marketing por usuario / opt-out de Meta) → `failed`
con motivo, sin reintento; `reconnect_required` / `not_connected` → pausa
la campaña entera. **Circuit breaker de clase plantilla**: 3 fallos
CONSECUTIVOS con el mismo código de error → `paused(channel)` con el motivo
visible — sin esto, una plantilla pausada por Meta a mitad de una campaña
de días quemaría todo el segmento a `failed` durante la noche.

## D6 — Runner de campañas (in-process, revive al boot)

**Decision**: calcar el esqueleto del runner del Laboratorio
(src/server/lab/runner.ts) con UNA política invertida: en vez de "reinicio
= failed" (instrumentation-node.ts:8-29 marca huérfanas), el boot hace
**revive**: re-lanza `void executeCampaign(id)` para toda campaña
`running`. La fuente de verdad anti-duplicados es el estado POR DESTINATARIO
(patrón agent_test_case): `pending → sending → sent/failed/skipped`.

Garantías concretas (cada una cierra un agujero encontrado en analyze):

- **At-most-once (FR-018 manda)**: la fila ambigua — `sending` SIN
  wa_message_id al arrancar el runner — pasa a `failed` con motivo
  "interrumpido por reinicio", visible al operador, y JAMÁS se re-envía
  sola; `sending` CON wamid se promueve a `sent` (y repone el
  initiated_send faltante, idempotente). Esta resolución corre AL INICIO de
  `executeCampaign` (no solo en el revive del boot): cubre también la
  campaña que murió estando `paused` y se reanuda a mano.
- **Claim atómico por fila**: `UPDATE campaign_recipient SET
  status='sending' WHERE id=? AND status='pending'` — si no afectó 1 fila,
  otro runner la tiene; se salta. Ningún destinatario se procesa dos veces
  ni con dos runners vivos.
- **Generación de runner**: `campaign.runner_generation` se incrementa en
  pause/resume; el runner captura su generación al arrancar y ANTES de cada
  claim re-lee: si no coincide (pause+resume rápido, o solape de
  contenedores en deploy), se auto-termina sin publicar nada. El claim
  atómico es la red de seguridad si dos generaciones corren un instante.
- **Crash no manejado**: el `.catch` del fire-and-forget marca
  `running→paused('error')` + SSE (espejo de failRun del Lab) — sin esto la
  campaña queda zombie hasta el próximo reboot con resume devolviendo 409.
- Transiciones finales con guard `WHERE status='running'` (monotónicas).
- Varias campañas `running` por org permitidas: comparten el mutex FIFO de
  cupo (D4) — la sección crítica es reserva de cupo, no todo el envío.

**Rationale**: el Lab ya probó el patrón base (fire-and-forget con 202,
cancelación cooperativa, SSE tras commit); una campaña no es descartable,
así que reinicio ≠ failed — pero un mensaje de WhatsApp tampoco es
re-emitible: at-most-once es la única política compatible con FR-018.

## D7 — Envío saliente: reutilización y refactor mínimo

**Decision**: `sendTemplate` ya es server-side puro (recibe organizationId;
templates.ts:302-307) — el runner lo llama directo. Refactor: extraer un
núcleo que acepte plantilla y credenciales pre-resueltas (hoy re-consulta y
descifra por llamada) y que DEVUELVA `{ messageId, waMessageId, waId }`
(ver D3 — exige extender el retorno de callGraphSend); conservar INTACTOS
los guards (approved, variable, sandbox is_test, credenciales) y sumar dos:
`opted_out` cuando el contacto está de baja y la ventana de servicio está
cerrada (FR-010 — dentro de ventana responder sigue permitido, FR-012), y
`sandbox` cuando `contact.is_test` (el guard viejo mira conversation.is_test
y un contacto del Lab desarchivado lo esquivaba creando conversación real).
Para US2 (envío individual a contacto sin conversación): endpoint
`POST /api/conversations` que hace getOrCreateContact/getOrCreateConversation
(ingest.ts:23-93, idempotentes por índice único) + sendTemplateCore.
**Dedup del mensaje en reintentos (FR-009)**: si la conversación ya tiene
un saliente de la MISMA plantilla en las últimas 24h, responde 200 con el
messageId existente en vez de re-enviar (el timeout del navegador +
reintento del operador era doble plantilla). Matiz conocido: si el send de
Graph falla DESPUÉS de crear la conversación, queda una conversación vacía
visible en bandeja (listConversations no filtra por lastMessageAt) — se
acepta como transitorio y el guion us-cc-2 verifica que el retry la
reutiliza.

## D8 — Hook de side-effects del inbound (respondió + BAJA)

**Decision**: colgar `onInboundSideEffects(...)` en `ingestInboundMessage`
inmediatamente después del gate de idempotencia (`if (!message) return;`,
ingest.ts:181-182), junto a onLeadActivity: hereda gratis el
exactamente-una-vez por wamid. Opt-out: solo `type === "text"`, texto
normalizado (trim + upper) igual a "BAJA" o "STOP" → `opted_out_at`
set-si-null (re-ejecutable) + skip de `campaign_recipient` pendientes del
contacto. "Respondió": todo inbound marca `replied_at` set-si-null en los
recipient del contacto ya enviados.

## D9 — Ajustes de envío por empresa

**Decision**: tabla nueva 1:1 `send_settings` (organization_id UNIQUE,
`daily_initiated_limit` int NOT NULL default 250), upsert on-demand
(patrón ai_credentials, onConflictDoUpdate), endpoint
`GET/PUT /api/settings/sending` con withAuth + Zod + scoped(). El repo no
tiene tabla settings genérica; la convención es tabla por dominio
(agent_profile / ai_credentials / meta_credentials); organization.metadata
queda para presentación (branding).

## D10 — Import: transporte y validación

**Decision**: el archivo JAMÁS llega al server. El wizard parsea en el
navegador (D1/D2), normaliza teléfonos (D3, la misma función compartida en
`src/lib/phone.ts` usable client+server), muestra vista previa, y postea
`POST /api/contacts/import` con filas JSON (Zod: tope 5.000 filas, teléfono
ya canónico re-validado server-side, tags saneadas). Server: upsert por
org+phone reutilizando la semántica de getOrCreateContact + merge de tags;
respuesta con el reporte {created, updated, invalid[{index, phone?, reason}]}.
Consentimiento: el POST exige `consentDeclared: true` (checkbox) y estampa
consent_source='import' + consent_at en los afectados sin consentimiento
previo.

## D11 — wa-mock y guiones E2E

**Decision**: el mock cubre casi todo hoy — inbound arbitrario
(`POST /api/dev/wa-mock/inbound` con `text:"BAJA"`) y statuses de salientes
(`POST /api/dev/wa-mock/status` con el wamid, que el guion reconstruye como
`wamid.mock.out.<bootTag>.<n>` desde el outbox) existen. DOS cambios sí
hacen falta (tras el dev-guard, 404 en prod): (1) guardar el wamid literal
en cada OutboxEntry (ergonomía de guiones); (2) un knob de wa_id
divergente — el graph mock ecoa `wa_id = to` siempre, así que la rama de
reconciliación de D3 sería inconducible: emular la regla MX (to `52`+10 →
wa_id `521…`) permite conducirla en E2E. Verificación de reinicio SIN
outbox: el outbox vive en memoria y el restart lo borra — el guion de
SC-004 asierta sobre las filas `message` de la BD (1 saliente de plantilla
por conversación de destinatario), no sobre el outbox. Fixtures: `.xlsx` y
`.csv` chicos + un `.xlsx` de 5.000 filas para el paso cronometrado de
SC-001, en `tests/e2e/fixtures/`.

## D12 — SSE de progreso

**Decision**: variante nueva `campaign.progress` en la unión SseEvent
(bus.ts:9-25) con {campaignId, status, counts}; publish tras commit desde el
runner; handler en use-events.ts. El cliente hace catch-up por refetch (el
server no re-emite historia), igual que lab.run.
