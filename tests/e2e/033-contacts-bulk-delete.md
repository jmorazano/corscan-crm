# 033 — Contactos: borrar en bloque y «seleccionar todos» en todas las páginas

Entorno: dev server del worktree + Postgres local + mocks, usuario E2E
(`e2e@vocero.test`). Datos: 125 contactos `#bulk-033` (5 de ellos también
`#keep-033`), creados por `POST /api/contacts` y borrados al final.

## Pasos

1. `/contacts?tags=bulk-033` → «Seleccionar todos» → ✔ barra «50 contactos
   seleccionados» + aviso «Seleccionaste los 50 contactos de esta página ·
   Seleccionar los 125 que coinciden».
2. «Seleccionar los 125 que coinciden» → ✔ barra 125, aviso «Están
   seleccionados los 125… en todas las páginas». Ir a página 2 → ✔ las 50
   filas tildadas, sigue en 125.
3. Página 3: destildar los 5 `#keep-033` → ✔ «Seleccionados 120 de 125», la
   casilla de la página queda indeterminada.
4. «Eliminar» → diálogo «Eliminar 120 contactos» con «Escribí 120 para
   confirmar»; el botón queda deshabilitado hasta escribirlo. Antes de
   confirmar entra un contacto nuevo `#bulk-033` → confirmar con 120 → ✔ 409
   «La selección cambió: ahora son 121», el campo se vacía y NO se borró nada
   (API: 126).
5. Escribir 121 → confirmar → ✔ «Se borraron 121 contactos.», vuelve a la
   página 1 y quedan exactamente los 5 `#keep-033`.
6. Etiquetas en todas las páginas: 65 contactos → seleccionar todos los que
   coinciden → Agregar etiqueta `masivo-033` → ✔ 65 con la etiqueta (incluso
   los de la página 2), selección vacía.
7. Móvil (375×812): tildar 2 → «Eliminar» → hoja inferior SIN pedir la
   cantidad (menos de 10) → ✔ «Se borraron 2 contactos.».
8. Camino infeliz (API `POST /api/contacts/bulk-delete`): `ids`+`filter` →
   422; ninguno → 422; sin `expectedCount` → 422; ids ajenos → 409 count 0
   sin borrar; `bulk-tags` con `filter` y etiqueta vacía → 422.

9. Solo el propietario (pedido del dueño): como MIEMBRO de «Inmobiliaria
   Demo» → la barra muestra Agregar/Quitar etiqueta pero NO «Eliminar», y
   `POST /api/contacts/bulk-delete` → 403 `forbidden`. Como PROPIETARIO de la
   empresa principal → «Eliminar» visible y la API pasa el guard.

## Evidencia

Conducido VERDE el 8-oct-2026 (Browser pane), sin errores de consola salvo
los 409/422 provocados. Limpieza: `bulk-delete` con `filter` → 63 borrados, 0
restantes.
