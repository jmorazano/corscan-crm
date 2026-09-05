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
(región AR para formatos nacionales) + post-proceso obligatorio: si el E.164
empieza `+54` y no `+549`, insertar el `9`. Ese valor es el `contact.phone`
y el `to` del send. Además, **reconciliar con `contacts[0].wa_id`** de cada
respuesta de send (la doc oficial dice que "may not match input"): si
difiere y está libre, actualizar el phone del contacto; si otro contacto ya
lo tiene, omitir con motivo (duplicado) — nunca clavear por el número
tipeado.

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
plantilla enviada fuera de ventana de servicio; cupo usado =
`COUNT(DISTINCT contact_id) WHERE sent_at > now()-24h`. Límite por empresa
(default 250) en tabla de ajustes de envío. El runner verifica ANTES de
cada envío y pausa la campaña (`paused` motivo `daily_limit`) al agotarse;
un ticker la reanuda cuando la ventana libera cupo.

**Rationale**: doc oficial literal: "unique WhatsApp user phone numbers …
within a moving 24-hour period", excluyendo mensajes dentro de ventana de
servicio. No hay código de error dedicado al exceso (aparece como 131048 o
como `failed` asíncrono por webhook) — hay que frenar ANTES, no reaccionar.
Tiers 2026: 250 → 2.000 (verificación) → 10K → 100K → ∞. Doble conteo en el
caso ambiguo de reinicio es aceptable: sesga el cupo a conservador.

## D5 — Pacing y errores de rate del canal

**Decision**: envío secuencial con pausa entre mensajes
(`CAMPAIGN_PACE_MS`, default 4000ms + jitter; el E2E local lo baja). Máx. 1
mensaje por destinatario por campaña (evita pair rate limit 131056). Manejo
por destinatario: fallo transitorio (130429 throughput, 5xx) → un solo
reintento con backoff; 131049/131050 (tope de marketing por usuario /
opt-out de Meta) → `failed` con motivo, sin reintento; `reconnect_required`
/ `not_connected` → pausa la campaña entera.

## D6 — Runner de campañas (in-process, revive al boot)

**Decision**: calcar el esqueleto del runner del Laboratorio
(src/server/lab/runner.ts) con UNA política invertida: en vez de "reinicio
= failed" (instrumentation-node.ts:8-29 marca huérfanas), el boot hace
**revive**: re-lanza `void executeCampaign(id)` para toda campaña
`running`. La fuente de verdad anti-duplicados es el estado POR DESTINATARIO
(patrón agent_test_case): `pending → sending → sent/failed/skipped`, y el
caso ambiguo (`sending` al morir el proceso) se resuelve persistiendo el
`wa_message_id` de Graph en la fila apenas llega: `sending` CON wamid =
enviado; SIN wamid = re-intentable. Transiciones finales con guard
`WHERE status='running'` (estados monotónicos, runner.ts:187-197).
Se permiten varias campañas `running` por org (el cupo es compartido); un
mutex in-process por org (Map en globalThis, patrón __agentCoalesce de
pipeline.ts:24-80) serializa la verificación de cupo + envío.

**Rationale**: el Lab ya probó el patrón completo (fire-and-forget con 202,
cancelación cooperativa, SSE tras commit, lock 23505→409); solo la política
de reinicio difiere porque una campaña no es descartable.

## D7 — Envío saliente: reutilización y refactor mínimo

**Decision**: `sendTemplate` ya es server-side puro (recibe organizationId;
templates.ts:302-307) — el runner lo llama directo. Refactor mínimo:
extraer un núcleo que acepte plantilla y credenciales pre-resueltas (hoy
re-consulta y descifra por llamada) para no pagar N descifrados; conservar
INTACTOS los guards (approved, variable, sandbox is_test, credenciales).
Para US2 (envío individual a contacto sin conversación): endpoint
`POST /api/conversations` que hace getOrCreateContact/getOrCreateConversation
(ingest.ts:23-93, idempotentes por índice único) + sendTemplate — la
conversación aparece en bandeja recién al enviar (lastMessageAt lo setea el
send), que es el comportamiento deseado.

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
respuesta con el reporte {created, updated, invalid[{row, reason}]}.
Consentimiento: el POST exige `consentDeclared: true` (checkbox) y estampa
consent_source='import' + consent_at en los afectados sin consentimiento
previo.

## D11 — wa-mock y guiones E2E

**Decision**: el mock NO necesita cambios funcionales — inbound arbitrario
(`POST /api/dev/wa-mock/inbound` con `text:"BAJA"`) y statuses de salientes
(`POST /api/dev/wa-mock/status` con el wamid que sendTemplate ya persiste)
existen hoy. Única mejora de ergonomía: guardar el wamid literal en cada
OutboxEntry (hoy el guion lo deriva como `wamid.mock.out.<n>`). Fixture:
generar un `.xlsx` de prueba chico (válidas + inválidas + duplicadas) y un
`.csv` equivalente en `tests/e2e/fixtures/`.

## D12 — SSE de progreso

**Decision**: variante nueva `campaign.progress` en la unión SseEvent
(bus.ts:9-25) con {campaignId, status, counts}; publish tras commit desde el
runner; handler en use-events.ts. El cliente hace catch-up por refetch (el
server no re-emite historia), igual que lab.run.
