# Tasks — 021 El alojamiento completo

## Fase 1 — Datos del alojamiento

- [x] T1 `condenseProperty`: `neighborhood`, `highlights` (de `details`) y
      `description`, saneados y acotados.
- [x] T2 `renderPropertyLine` con barrio y destacados; `renderShow` con
      barrio, detalles completos y descripción recortada.
- [x] T3 `MAX_PROPERTIES_FOR_MODEL` 2 → 5 + test que mide los bytes del
      render.

## Fase 2 — Precios fuera del mensaje

- [x] T4 `src/lib/price-guard.ts` puro + batería de falsos positivos.
- [x] T5 Precios etiquetados como internos en el `[HERRAMIENTA]` y regla
      dura en `renderSection`; `buildSearchSummary` sin importes.
- [x] T6 Enganche en `pipeline.ts` junto a la guarda de promesas.

## Fase 3 — Enlace

- [x] T7 Quitar el fallback a `catalog.searchBase`; sin `search_url`, el
      render pide el enlace directo de la propiedad.

## Fase 4 — Nombre del huésped

- [x] T8 Migración 0017 `contact.name_edited_at` + `PATCH /api/contacts/[id]`.
- [x] T9 `canOverwriteContactName` (generaliza `shouldAdoptAddressBookName`)
      + uso en la sync de 017.
- [x] T10 `contact_name` en `reply`/`update_lead`, validación pura y
      aplicación en el pipeline; regla en el prompt.

## Fase 5 — Verificación

- [x] T11 Guion E2E `tests/e2e/021-stays-detail.md` conducido con mocks.
- [x] T12 Gate: `typecheck && lint && build && test`.

## Estado

Todas completas. Guion conducido y verde: `tests/e2e/021-stays-detail.md`
(23-sep-2026). Gate: typecheck + lint + build + 1.001 tests.

Dos hallazgos del E2E, ambos corregidos y con test de regresión: el punto
separador de miles partía la oración en la guarda de precios, y quitarle los
importes a una respuesta podía dejarla idéntica a la anterior — la guarda
anti-duplicado de 011 la silenciaba y el huésped que preguntaba el precio no
recibía nada.
