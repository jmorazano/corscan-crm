# Implementation Plan: API pública por empresa (014)

**Branch**: `014-public-api` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

## Summary

Superficie HTTP autenticada por clave de API POR EMPRESA (`/api/v1/*`) que
reutiliza el embudo único de envío de plantillas (`sendTemplateCore`), con
idempotencia por `Idempotency-Key`, consulta de estado, sección Ajustes →
API (claves + estado + guía con `curl` generados) y una regla de silencio
del agente ante acuses de recibo tras notificaciones transaccionales.

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15 App Router, React 19
**Primary Dependencies**: Drizzle ORM, Zod, Better Auth (sesión interna),
`node:crypto` (SHA-256, random) — sin dependencias nuevas
**Storage**: PostgreSQL — tablas `api_key`, `api_request`; columna
`message.api_key_id`; valor `api` en `contact.consent_source` (solo tipo)
**Testing**: Vitest (unit) + guion E2E `tests/e2e/014-public-api.md` con
wa-mock/ai-mock conducido desde el Browser pane + `curl`
**Constraints**: multi-tenant (`scoped()`), at-most-once (jamás dos envíos
por reintento), secretos hasheados, sandbox inalcanzable, sin colas
**Scale/Scope**: decenas de llamadas/minuto por empresa; rate limit
in-process 60/min por clave

## Constitution Check

- **I Seguridad**: la clave se guarda hasheada (SHA-256 de 256 bits de
  entropía); prefijo visible para identificarla; jamás en logs ni en
  respuestas posteriores a la creación. ✅
- **II Soberanía**: superficie entrante; ninguna dependencia externa nueva.
  ✅ (los webhooks salientes quedan fuera de v1 justamente para no abrir
  esta discusión ahora).
- **III Multi-tenancy**: `organization_id` NOT NULL en `api_key` y
  `api_request`; toda query por `scoped()`; la clave resuelve la empresa y
  nada más. ✅
- **IV Idempotencia**: `api_request` UNIQUE (org, idempotency_key) con
  reserva previa al envío; respuesta persistida solo si hubo mensaje. ✅
- **V/IX Verificación**: unit tests de lo puro + E2E con mocks incluyendo
  caminos infelices (Meta 5xx con knob nuevo del wa-mock, cupo, baja,
  clave revocada, rate limit). ✅
- **VIII Foco**: envíos transaccionales a clientes propios de la empresa
  con consentimiento declarado; guardrails de baja y cupo aplican. ✅

## Decisiones de diseño (research)

- **D1 Clave**: `vk_` + 32 bytes aleatorios en base64url (43 chars). Se
  busca por `key_hash` (índice único) — no hace falta comparación en tiempo
  constante porque el atacante no controla el hash buscado. Prefijo
  visible: primeros 11 caracteres.
- **D2 Idempotencia**: reserva-primero. Insertar `api_request` con
  `status_code = 0` (en curso) ANTES de enviar; conflicto → si la fila
  tiene respuesta, replay; si sigue en curso, 409. Al terminar con 2xx se
  completa la fila; ante cualquier error se borra la reserva (el cliente
  reintenta con la misma clave). `request_hash` = SHA-256 del JSON
  canónico (claves ordenadas) para detectar cuerpos distintos.
- **D3 Consentimiento**: `consent_source = 'api'` set-si-null, igual que
  el inbound; nombre del request solo si el contacto es nuevo o su nombre
  es el placeholder (teléfono).
- **D4 Marca en el mensaje**: `message.api_key_id` (sin FK) + nombre de la
  clave resuelto por LEFT JOIN al listar; en el evento SSE del envío el
  nombre viaja desde el propio envío. DTO: `via: { kind: "api", label }`.
- **D5 Silencio del agente**: dos capas. (a) Heurística pura
  `isPlainAcknowledgment` (lexicón de acuses en español + emojis, sin `?`)
  que corta ANTES del proveedor cuando el último saliente previo al inbound
  es una plantilla con `api_key_id`; (b) sección «NOTIFICACIÓN AUTOMÁTICA»
  en el system prompt para el resto de casos, pidiendo `none` si no hay
  pregunta ni pedido. El ai-mock implementa (b) determinísticamente.
- **D6 Validación de parámetros**: `validateParamValue` en
  `src/lib/template-body.ts` (puro) aplicada dentro de
  `resolveVariableValues` a los `free_text` → campañas y 1:1 la heredan.
- **D7 Rate limit**: `checkRateLimit("apikey:<id>", 60/min)` in-process
  (monolito); `last_used_at` se actualiza como máximo una vez por minuto.
- **D8 Errores de Meta**: `SendError`/`TemplateError`/`QuotaError` se
  mapean a HTTP en la capa `/api/v1` con la misma tabla que la API interna.
- **D9 Knob de fallo**: `failNextSend` en el wa-mock (500 en el próximo
  `POST …/messages`) para conducir el 503 y el reintento idempotente.

## Project Structure

```text
specs/014-public-api/{spec,plan,data-model,quickstart,tasks}.md · contracts/api.md
src/lib/db/schema.ts               # api_key, api_request, message.api_key_id, consent 'api'
src/lib/db/ids.ts                  # prefijos ak_, areq_
src/lib/template-body.ts           # validateParamValue + uso en resolveVariableValues
src/lib/api-keys.ts                # puro: generar/hashear/prefijo
src/lib/api.ts                     # withApiKey (401/429) + ApiKeyContext
src/server/api-keys/keys.ts        # crear/listar/revocar/verificar (BD)
src/server/public-api/templates.ts # serialización pública + resolución por nombre + params
src/server/public-api/send.ts      # flujo de envío + idempotencia
src/server/public-api/messages.ts  # estado
src/server/ai/acknowledgment.ts    # isPlainAcknowledgment (puro)
src/server/ai/pipeline.ts          # corte + sección transaccional
src/server/ai/prompts.ts           # sección «NOTIFICACIÓN AUTOMÁTICA»
src/server/dev/ai-mock.ts          # regla determinista
src/server/dev/wa-mock-state.ts + knobs/graph # failNextSend
src/server/whatsapp/templates.ts   # sendTemplateCore acepta `via`
src/server/inbox/ingest.ts|queries.ts # serializeMessage(via) + LEFT JOIN
src/app/api/v1/templates/route.ts
src/app/api/v1/messages/route.ts · [id]/route.ts
src/app/api/settings/api-keys/route.ts · [id]/route.ts
src/app/(app)/settings/api/page.tsx · src/components/settings/api-client.tsx
src/components/settings/settings-nav.tsx · src/components/inbox/message-thread.tsx
docs/api/v1.md · tests/e2e/014-public-api.md · tests/unit/*.test.ts
```

**Structure Decision**: monolito existente; módulo nuevo
`src/server/public-api/` como única frontera de la superficie externa.

## Complexity Tracking

Sin violaciones.
