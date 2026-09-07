# US-TG-2 — Bandeja: etiquetas, filtro en la URL, bulk, panel, SSE y paginación (feature 006, US3/US4)

Entorno: el de US-TG-1; BD con 64 conversaciones reales (30 de prueba
excluidas). Dos navegadores con sesión en la misma empresa (Playwright + el
Browser pane) para el cruce por SSE.

## Pasos

1. **Paginación (US4)**: `/inbox` → ✔ "Bandeja 64", 50 filas, chips "Todas
   64 · No leídas 17", botón "Cargar más (50 de 64)"; al pulsarlo ✔ 64
   filas únicas y el botón desaparece. El badge del menú lateral sigue
   mostrando la suma total de no leídos (30), no la de la página.
   API: recorrido completo por cursor en 7 páginas de 10 → 64 únicas;
   `cursor=basura` se ignora; `q=sof` → 2 (Sofía Prueba, Ana Sofía Torres)
   buscando sobre TODAS, no solo las cargadas; `filter=unread` → solo
   no leídas con `unreadTotal=17`; `contactId=` → la conversación del
   contacto; `GET /api/conversations/:id` → 200 / 404.
2. **Bulk (US3)**: botón "Seleccionar conversaciones" → tildar Sin Agenda y
   Sin Permiso (click en la fila, no abre el hilo) → barra "2 sel." →
   Etiqueta → `Urgente` + Enter → ✔ ambas filas muestran `#urgente`, la
   selección se vacía y el modo selección sigue; BD: 2 filas con la
   etiqueta.
3. **SSE entre pestañas (FR-007)**: la otra pestaña (sin recargar,
   `performance.navigation` = 1) ✔ muestra `#urgente` en las mismas 2 filas
   (evento `conversations.updated`).
4. **Filtro (FR-002/FR-003)**: Etiquetas → tildar `#urgente` → ✔ URL
   `?tags=urgente`, "Bandeja 2", chips "Todas 2 · No leídas 2", chip
   activo removible. Recargar con
   `/inbox?tags=urgente&filter=unread&q=permiso` → ✔ búsqueda "permiso",
   "No leídas" activo, chip `#urgente`, 1 fila (Sin Permiso).
5. **Hilo abierto independiente de la página (FR-010)**: abrir Sin Permiso
   → se marca leída → sale de la lista filtrada por no leídas ("Sin
   resultados para este filtro") pero ✔ el hilo y el panel siguen abiertos
   (fallback `GET /api/conversations/:id`).
6. **Panel de detalles**: "Etiquetas de la conversación" → `Esperando
   Pago` + Enter → ✔ chip `#esperando pago` (saneo 004: minúsculas) y BD;
   "Etiquetas del contacto" → `cliente-vip` + Enter → ✔ BD del contacto.
   ✕ en `#urgente` → ✔ BD `{esperando pago}`, el hilo sigue abierto, y la
   otra pestaña muestra el cambio sin recargar (`conversation.updated`).
7. **Camino infeliz**: `POST /api/conversations/bulk-tags` con ids ajenos →
   `{matched: 0, updated: 0}`; con `fetch` rechazando (TypeError) la barra
   muestra "Sin conexión con el servidor: no se aplicó el cambio.", la fila
   sigue tildada ("1 sel.") y BD sin cambios
   (`e2e-006-inbox-bulk-error.png`).
9. **Enlace directo fuera de página (US4-6)**: `/inbox?contact=<id>` de una
   conversación en la posición 61 (Paty Domínguez) → ✔ el hilo se abre
   aunque no esté entre las 50 cargadas (`contactId=` + fallback por id).
8. **Regresión corregida durante la conducción**: los chips de etiqueta
   dentro de la fila (que era un `<button>`) generaban "button cannot be a
   descendant of button" (hidratación). La fila pasó a `div[role=button]`
   con teclado (Enter/Espacio). ✔ consola limpia tras recargar.

## Evidencia

Conducido VERDE el 7-sep-2026 (capturas: `e2e-006-inbox-initial.png`,
`e2e-006-inbox-bulk-tagged.png`, `e2e-006-inbox-filter-urgente.png`).
