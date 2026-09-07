# Tasks: Etiquetas + filtros persistidos (006)

**Input**: specs/006-tags-filters/ (spec, plan, data-model, contracts)

## Phase 1: Foundational

- [x] T001 `src/lib/tags.ts`: `TagMode`, `parseTagsParam`, `applyTagOps` + unit `tests/unit/tags-ops.test.ts`
- [x] T002 Schema `conversation.tags` + GIN en `src/lib/db/schema.ts`; migración `drizzle/0007_*`
- [x] T003 `src/server/tags.ts`: `tagsWhere(column, tags, mode)`, `listTagFacets`, `bulkUpdateContactTags`, `bulkUpdateConversationTags` + unit `tests/unit/tags-server.test.ts`
- [x] T004 SSE `conversations.updated` en `bus.ts` + `use-events.ts`
- [x] T005 `src/components/use-query-filters.ts` (hook URL) + componentes `src/components/tags/*`

## Phase 2: US1 + US2 Contactos

- [x] T006 API: `GET /api/contacts` (tags/mode, alias tag) · `POST /api/contacts/bulk-tags` · `GET /api/tags`
- [x] T007 UI `contacts-client.tsx`: filtros desde URL, selector de etiquetas, casillas + barra bulk, chips clicables que suman al filtro

## Phase 3: US3 Bandeja

- [x] T008 API: `listConversations` (tags en DTO + filtro), `GET /api/conversations` params, `PATCH tags`, `POST /api/conversations/bulk-tags`
- [x] T009 UI: `conversation-list.tsx` (chips, filtro, modo selección, barra bulk), `inbox-client.tsx` (filtros URL, refetch con filtros, evento plural), `contact-panel.tsx` (editor de etiquetas de conversación + del contacto)

## Phase 3b: US4 Paginación (pedido del dueño, 7-sep)

- [x] T013 `src/lib/pagination.ts` (page/limit/cursor) + unit `tests/unit/pagination.test.ts`
- [x] T014 API: `GET /api/contacts` page/limit; `listConversationsPage` (keyset + q + unread + totales) en `queries.ts`; `GET /api/conversations` nuevo shape; `GET /api/conversations/[id]`
- [x] T015 UI: pager en `contacts-client.tsx` (page en URL, reset al filtrar); "Cargar más" + totales en `conversation-list.tsx`; `inbox-client.tsx` con cursor, búsqueda server-side y fallback del hilo abierto

## Phase 4: Verify

- [x] T010 Gate `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
- [x] T011 E2E conducido: `tests/e2e/us-tg-1-contactos.md`, `us-tg-2-bandeja.md` (feliz + infeliz) con evidencia
- [x] T012 Docs: CLAUDE.md (mapa + feature activa), memoria
