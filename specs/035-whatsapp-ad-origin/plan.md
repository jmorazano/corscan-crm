# Plan — 035 origen de anuncios en WhatsApp

## Datos (sin migración)

- `conversation.ig_origin` (jsonb, de 030) pasa a tiparse con
  `ConversationOrigin` (`src/lib/conversation-origin.ts`, sin imports: lo
  carga drizzle-kit). Campos nuevos, todos opcionales: `channel`,
  `sourceType`, `sourceUrl`, `clickId`, `body`, `mediaType`, `welcome`.
  `IgOrigin`/`IgOriginKind` quedan como alias en `src/lib/instagram/types.ts`.
  `drizzle-kit generate` → «No schema changes».
- DTO: `ConversationOriginDto` = todo menos `clickId` (`originForClient` en
  `serializeConversation`).

## Código

- `src/lib/whatsapp-ad-origin.ts` (PURO): `WA_AD_TAG = "wa-anuncio"`;
  schema Zod tolerante (`.catch(null)` por campo, `passthrough`);
  `parseWhatsAppReferral(raw)` → `WhatsAppReferral | null` (nunca lanza);
  `adText(raw, max)` (saneo de 016 `sanitizeForeignText` + una línea + sin
  «» + tope); ids ASCII visibles con tope; `sourceUrl` solo https sin
  credenciales; `whatsAppAdOrigin(referral, at)`; `decideAdOrigin(current,
  next)` → `apply | duplicate | stale` (última atribución idempotente).
- `src/server/inbox/ad-origin.ts`: `applyWhatsAppAdOrigin` — sandbox fuera,
  decisión, `update` scoped (`organization_id` + id + `is_test = false`) con
  `ig_origin` + etiqueta sin duplicar (misma expresión que 030) y SSE
  `conversations.updated`.
- `src/server/inbox/webhook.ts`: `WebhookMessage.referral?: unknown` (crudo).
- `src/server/inbox/ingest.ts`: `processMessagesValue` parsea el referral;
  `ingestInboundMessage` aplica el origen después de resolver la
  conversación y ANTES de `ingestInboundCore` (el turno del agente ya lo ve),
  con `.catch` (un fallo no bloquea la ingesta). Historial/ecos (017) no
  pasan por acá.
- `src/server/ai/prompts.ts`: `renderOriginSection(origin, channel?)` — el
  canal de la conversación manda, después el del origen, después Instagram;
  `renderWhatsAppOrigin` con encabezado propio y título/texto/bienvenida
  entre «» como DATO (re-saneados con `adText`) + recordatorio de que no
  reemplaza el conocimiento. Instagram, idéntico.
- `src/server/ai/pipeline.ts`: la sección también para `kind = whatsapp`.
- UI: `contact-panel.tsx` — «· Ver anuncio» (`adLink`: solo https,
  `target=_blank`, `rel="noopener noreferrer"`). La línea «Origen:» y los
  chips/filtro de etiquetas ya existían.
- Mocks: `wa-mock/inbound` acepta `referral` crudo (`buildInboundPayload`);
  ai-mock `dispatchWhatsAppOrigin` («¿de dónde vengo?»).

## Constitution Check

- **I Seguridad**: sin secretos nuevos. El `ctwa_clid` no es secreto, pero se
  queda en el servidor (fuera del DTO y del prompt).
- **II Soberanía**: sin dependencias nuevas — el dato viene en el webhook de
  la WhatsApp Cloud API (categoría 1). La Conversions API queda fuera de
  alcance (requiere revisar II).
- **III Multi-tenancy**: la escritura va por `scoped()`; la empresa sale del
  `phone_number_id` como el resto de la ingesta.
- **IV Idempotencia**: reentregas sin efectos (`decideAdOrigin` + dedup del
  mensaje por `(organization_id, wa_message_id)`); orden monotónico por la
  fecha del clic.
- **Sandbox**: `is_test` nunca se marca (guarda explícita + la ingesta solo
  resuelve conversaciones reales).
- **V/IX Verificación**: unit (parseo, origen, decisión, DTO, prompt,
  ingesta con BD stub, historial/ecos) + E2E de comportamiento con mocks.

## Verificación

Gate `tsc --noEmit && eslint . && vitest run && next build` + guion
`tests/e2e/035-whatsapp-ad-origin.md` conducido con Playwright (Chrome)
contra el dev server del worktree (puerto 3035, wa-mock + ai-mock, base
local compartida — sin migración), usuario `e2e@vocero.test`.
