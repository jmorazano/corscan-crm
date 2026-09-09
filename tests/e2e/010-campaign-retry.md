# E2E 010 — Motivo de fallo visible y reintento de fallidos

Entorno: dev server + mocks (usuario E2E). Evidencia = UI (detalle de campaña
y burbuja de la bandeja), outbox del wa-mock y respuestas HTTP.

## Guion

1. Campaña con `promo_multivar` (imagen + variables — revalida 008/009) a 2
   contactos (`e2e-var`): ambos envíos salen.
2. Mock de estados: el mensaje de UNO se marca `failed` con el error real de
   Meta («…healthy ecosystem engagement»); el del otro, `delivered`.
3. ✅ Detalle de campaña: contador de fallidos = 1, la fila del fallido
   muestra el motivo TRADUCIDO («límite de frecuencia…»), botón «Reintentar
   fallidos (1)» visible (campaña completed).
4. ✅ Bandeja: la burbuja del fallido muestra el ⚠ con tooltip y la línea
   «No entregado: …» traducida.
5. «Reintentar fallidos» (con confirmación) → 202 `{retried: 1}` → la
   campaña vuelve a en curso y SOLO el fallido recibe un envío nuevo
   (outbox: exactamente +1, del número correcto, con header y variables).
6. ✅ Al terminar: campaña `completed` de nuevo; con el nuevo mensaje
   `delivered`, el botón de reintento desaparece (0 fallidos).

## Infelices

7. `retry_failed` sin fallidos → 422 `no_failed`.
8. `retry_failed` sobre campaña `running` o `draft` → 409.
9. Doble ejecución de la acción → la segunda da 422 (idempotencia: nada que
   reencolar) y no hay duplicados en el outbox.
