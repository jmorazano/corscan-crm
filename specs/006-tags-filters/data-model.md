# Data model — 006

## conversation (cambio)

| columna | tipo | nota |
|---|---|---|
| tags | text[] NOT NULL DEFAULT '{}' | saneadas (trim, lower, únicas, ≤20, ≤40 chars) |

Índice: `conversation_tags_gin_idx` GIN sobre `tags` (mismo patrón que `contact_tags_gin_idx`).

## contact (sin cambio de forma)

`tags text[]` (004). Se reutilizan `sanitizeTags`/`mergeTags`.

## Faceta de etiqueta (derivada, no persistida)

`{ tag: string, count: number }` por ámbito (`contacts` excluye `is_test`;
`conversations` excluye `is_test`).

## Operación bulk (pura)

`applyTagOps(current, { add, remove })` → `sanitizeTags([...current sin remove, ...add])`
(quitar antes que agregar: `remove` y `add` con la misma etiqueta = la agrega).
