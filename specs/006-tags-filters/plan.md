# Implementation Plan: Etiquetas + filtros persistidos (006)

**Branch**: `006-tags-filters` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

## Summary

Extender el modelo de etiquetas de 004 (solo contactos, filtro de una
etiqueta en memoria de componente) a: etiquetas propias en conversaciones,
filtro multi-etiqueta con modo `any|all` resuelto en SQL, estado de filtros
en los query params (hook compartido), selección múltiple con acciones bulk
en Contactos y Bandeja, catálogo de etiquetas por ámbito y propagación SSE.

## Technical Context

**Language/Version**: TypeScript estricto · Next.js 15 App Router · React 19
**Primary Dependencies**: Drizzle ORM (arrays de Postgres, `@>` / `&&`), Zod, lucide
**Storage**: PostgreSQL — `conversation.tags text[]` + índice GIN
**Testing**: Vitest (unit, con mocks de `@/lib/db`) + E2E conducido (Playwright/Browser pane + mocks)
**Constraints**: multi-tenant vía `scoped()`; sin dependencias externas nuevas; sandbox intacto

## Constitution Check

- I Seguridad: sin secretos nuevos. ✅
- II Soberanía: cero servicios externos. ✅
- III Multi-tenancy: `conversation.tags` en tabla que ya lleva `organization_id`; toda query bulk pasa por `scoped()` y filtra por ids ∩ org. ✅
- IV Idempotencia: migración aditiva re-ejecutable; bulk idempotente (set-union / set-difference). ✅
- Sandbox: conversaciones `is_test` no se listan; etiquetarlas no tiene efecto externo. ✅

## Decisiones (research)

- **D1 Etiquetas de conversación separadas** de las del contacto (triage vs. segmento; norma en Chatwoot/Respond.io). El panel muestra ambas.
- **D2 Filtro en SQL**: `any` = `OR(arrayContains(tags,[t]))` (usa GIN); `all` = `arrayContains(tags, [t1,t2…])` (`@>`).
- **D3 URL como estado**: hook `useQueryFilters` sobre `useSearchParams` + `router.replace(..., {scroll:false})`; `tags` CSV, `mode=all` solo cuando aplica, alias `tag` (004).
- **D4 Bulk en una transacción**: leer filas (ids ∩ org), calcular `applyTagOps` (puro, en `lib/tags`), actualizar solo las que cambian; respuesta `{updated}`.
- **D5 Evento SSE `conversations.updated` (plural)** con los ids, para que el bulk no dispare N refetches.
- **D6 Catálogo derivado**: `GET /api/tags?scope=` con `unnest(tags)` + `count(*)` scoped; sin tabla nueva.
- **D7 Paginación** (pedido del dueño 7-sep): Contactos por `page`/`limit` (offset; la lista cambia poco) y Bandeja por keyset `(coalesce(last_message_at, created_at), id)` — estable ante inserciones arriba; el refetch por SSE pide la primera página con el tamaño ya cargado (acotado a 200). Búsqueda y "No leídas" migran al servidor con totales.
- **D8 Hilo abierto independiente de la página**: `GET /api/conversations/:id` como fallback cuando la seleccionada no está en la lista cargada.

## Project Structure

```text
specs/006-tags-filters/
├── spec.md · plan.md · data-model.md · quickstart.md · tasks.md
└── contracts/tags-api.md

src/lib/tags.ts                         # + applyTagOps, parseTagsParam, TagMode
src/lib/db/schema.ts                    # conversation.tags + GIN
drizzle/0007_*.sql                      # migración
src/server/tags.ts                      # listTagFacets, tagsWhere, bulkUpdateTags (contact/conversation)
src/server/inbox/queries.ts             # tags en DTO, filtro en listConversations, updateConversation.tags
src/server/events/bus.ts + use-events   # conversations.updated
src/app/api/tags/route.ts               # GET catálogo
src/app/api/contacts/route.ts           # tags/mode en GET
src/app/api/contacts/bulk-tags/route.ts # POST
src/app/api/conversations/route.ts      # tags/mode en GET
src/app/api/conversations/bulk-tags/route.ts
src/app/api/conversations/[id]/route.ts # PATCH tags
src/components/use-query-filters.ts     # hook URL
src/components/tags/                    # tag-chip, tag-filter, tag-picker, bulk-tags-bar, tag-editor
src/components/contacts/contacts-client.tsx
src/components/inbox/{inbox-client,conversation-list,contact-panel}.tsx
tests/unit/tags-ops.test.ts · tags-server.test.ts · bulk-tags-routes.test.ts
tests/e2e/us-tg-1-contactos.md · us-tg-2-bandeja.md
```
