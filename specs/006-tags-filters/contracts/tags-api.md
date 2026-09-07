# Contrato — Etiquetas (006)

Todas las rutas: sesión requerida (`withAuth`), scoped a la organización.

## GET /api/tags?scope=contacts|conversations

→ `200 { tags: [{ tag, count }] }` ordenado por count desc, tag asc. `scope`
inválido → 422.

## GET /api/contacts?tags=a,b&mode=any|all&page=N&limit=M (+ q, archived)

`tags` CSV saneado; `tag` (004) se acepta como alias. `mode` default `any`.
`page` ≥ 1 (default 1), `limit` 1..200 (default 50).
→ `{ contacts, total, page, pageSize, pages }` (filtro y paginación en SQL).

## GET /api/conversations?tags=a,b&mode=any|all&q=&filter=unread&limit=M&cursor=&contactId= (+ since)

Búsqueda `q` sobre nombre, teléfono, etiquetas y último mensaje. `cursor` es
el `nextCursor` de la página anterior (opaco: `"<iso>|<id>"`, keyset sobre
`coalesce(last_message_at, created_at), id`). `contactId` restringe a ese
contacto (enlace directo).
→ `{ conversations, total, unreadTotal, unreadMessages, nextCursor }`;
`total`/`unreadTotal` (conversaciones con no leídos) / `unreadMessages` (suma
de no leídos, badge del menú) cuentan sobre tags + q sin el filtro de no
leídas; cada `ConversationDto` incluye `tags: string[]`.

## GET /api/conversations/:id

→ `200 { conversation }` (sin preview/etapa) · 404 si no es de la empresa.

## PATCH /api/conversations/:id `{ tags?: string[] }`

Reemplaza las etiquetas de la conversación (saneadas). Publica
`conversation.updated`.

## POST /api/contacts/bulk-tags · POST /api/conversations/bulk-tags

Body: `{ ids: string[] (1..500), add?: string[], remove?: string[] }` — al
menos una de `add`/`remove` no vacía (tras saneo), si no 422.

→ `200 { updated: number, matched: number }`. `matched` = ids encontrados en
la organización; `updated` = filas cuyo set de etiquetas cambió. Ids ajenos o
inexistentes se ignoran. Conversaciones: publica `conversations.updated`
`{ conversationIds }` (solo las modificadas).

## SSE

Nuevo evento `conversations.updated` → `data: { conversationIds: string[] }`.
