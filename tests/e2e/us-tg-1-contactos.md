# US-TG-1 — Contactos: filtro por etiquetas en la URL, bulk y paginación (feature 006, US1/US2/US4)

Entorno: quickstart 006 (Docker Postgres + mocks + `pnpm dev`), BD local con
5.026 contactos (import de 004: `masivo` ×4995, `newsletter` ×2497,
`clientes-2025` ×6, `vip` ×3). Conducido con Playwright (MCP) como el
usuario E2E propio (`e2e@vocero.test`, owner de "Negocio de Super Admin
Local"; ver memoria `e2e-usuario-local`).

## Pasos

1. **URL → estado (FR-003)**: abrir
   `/contacts?tags=vip,clientes-2025&mode=all&q=cliente` → ✔ selector
   "Filtrar por etiqueta 2", chips `#vip` `#clientes-2025` con ✕, modo
   "todas", búsqueda "cliente", **1 resultado** (Cliente Dos, que lleva
   ambas). Con `mode=any` → 7 (unión 6+3−2). Alias viejo `?tag=vip` → 3.
   `mode=zzz` → any; `tags=,,` → sin filtro (5.026).
2. **Bulk agregar (US2)**: `/contacts?tags=clientes-2025` → "Seleccionar
   todos" → barra "6 contactos seleccionados" → Agregar etiqueta → escribir
   `Seguimiento` + Enter (crea nueva, saneada a `seguimiento`) → ✔ los 6
   muestran `#seguimiento`, la selección se vacía, BD: exactamente 6 filas
   con la etiqueta (ninguna fuera del filtro).
3. **Bulk quitar**: `/contacts?tags=seguimiento` → Seleccionar todos →
   Quitar etiqueta → solo ofrece `#seguimiento` (presente en la selección)
   → ✔ lista vacía con "Sin contactos para estos filtros" + Limpiar
   filtros; BD: 0 con la etiqueta.
4. **Paginación (US4)**: `/contacts?page=3&tags=masivo` → ✔ 50 filas, pager
   "101–150 de 4995 · Página 3 de 100"; "Siguiente ›" → `?page=4`; tildar
   "Ver archivados" (cambio de filtro) → ✔ vuelve a página 1 (URL sin
   `page`). API: `page=999` → 0 filas y `pages=101` (la UI corrige a la
   última); `page=-2&limit=abc` → page 1 / 50; `limit=5000` → 200.
5. **Camino infeliz (FR-008)**: API `POST /api/contacts/bulk-tags` con
   `ids: []` → 422; con `add: [" "]` → 422 "Indicá al menos una etiqueta
   válida"; con 501 ids → 422; JSON roto → 422; ids ajenos/inexistentes →
   200 `{matched: 0, updated: 0}` (cero fugas, SC-003). En UI, con `fetch`
   saboteado para devolver 500 `{error:{message:"Error interno"}}`, la barra
   muestra "Error interno" y **conserva los 6 seleccionados** para
   reintentar; BD sin cambios.
6. Catálogo: `GET /api/tags?scope=contacts` → facetas con conteo ordenadas
   por uso; `scope=nope` → 422.

## Evidencia

Conducido VERDE el 7-sep-2026 (capturas en el scratchpad de la sesión:
`e2e-006-contacts-url-restored.png`, `e2e-006-contacts-page3.png`).
Sin errores de consola.
