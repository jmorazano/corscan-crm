# Tasks — 035 origen de anuncios en WhatsApp

## Fase A — Núcleo puro
- [x] A1 `src/lib/conversation-origin.ts`: `ConversationOrigin` (campos de
      WhatsApp opcionales), `ConversationOriginDto`, `originForClient`;
      `IgOrigin` como alias; schema con el tipo nuevo (sin migración).
- [x] A2 `src/lib/whatsapp-ad-origin.ts`: parseo Zod tolerante + saneo,
      `whatsAppAdOrigin`, `decideAdOrigin`, `WA_AD_TAG`.
- [x] A3 Tests `tests/unit/whatsapp-ad-origin.test.ts` (parseo, origen,
      última atribución, DTO, sección del prompt).

## Fase B — Servidor
- [x] B1 `src/server/inbox/ad-origin.ts` (`applyWhatsAppAdOrigin`: scoped,
      sin sandbox, etiqueta sin duplicar, SSE).
- [x] B2 Ingesta: `WebhookMessage.referral`, parseo en
      `processMessagesValue`, aplicación antes de `ingestInboundCore`.
- [x] B3 DTO sin `clickId` (`serializeConversation`).
- [x] B4 Prompt: `renderOriginSection(origin, channel)` + sección de WhatsApp;
      pipeline la pasa también para WhatsApp.
- [x] B5 Tests `tests/unit/whatsapp-ad-origin-ingest.test.ts` (BD stub:
      orden origen → mensaje → agente, ilegible, sin referral, reentrega,
      clic viejo, fallo de escritura, sandbox, historial y ecos de 017).

## Fase C — UI y mocks
- [x] C1 Ficha: «· Ver anuncio» solo con enlace https.
- [x] C2 wa-mock `inbound` con `referral` crudo; ai-mock «¿de dónde vengo?»
      en WhatsApp.

## Fase D — Verificación
- [x] D1 Guion E2E `tests/e2e/035-whatsapp-ad-origin.md` conducido (a–e +
      reentregas + hostil + móvil).
- [x] D2 Gate: typecheck + lint + test + build.
- [x] D3 CLAUDE.md (mapa del código + feature activa).

## Estado

Todas completas (11-oct-2026) en el worktree `035-whatsapp-ad-origin`, rama
`035-whatsapp-ad-origin` (sin mergear ni deployar), rebasada sobre `main`
636fcde (ya con 034). Gate verde sobre esa base: `tsc`, `eslint`, `vitest`
(164 archivos, 1677 tests; 38 nuevos de 035) y `next build`; E2E 34/34.
Pendiente con un anuncio real después del deploy: ver «A verificar con un
anuncio real» en [spec.md](spec.md).
