# E2E 050 — Instrucciones extendidas del agente

Entorno: mocks de siempre, `AGENT_COALESCE_MS=2000`, usuario E2E local
(propietario de «Negocio de Super Admin Local», miembro de «Inmobiliaria Demo»).
Conviene correrlo en una copia de la base (`CREATE DATABASE … TEMPLATE vocero`).

## Guion

1. **Apagada por defecto.** `GET /api/agent/profile` → `extendedInstructions: false`,
   `instructionsLimit: 15000`. En `/agent` el contador dice «N / 15.000» y el
   recuadro «Instrucciones extendidas» dice «Desactivado: hasta 15.000 caracteres.».
2. **Texto largo sin la opción.** Pegar 20.000 caracteres en «Instrucciones» →
   «20.000 / 15.000 · supera el tope» y «Guardar comportamiento» deshabilitado.
3. **Prender no borra lo pegado.** Clic en el switch → «Activado: hasta 30.000
   caracteres.», el campo conserva los 20.000, el contador pasa a «20.000 / 30.000»
   y el botón se habilita. Guardar → «Guardado ✓»; al recargar sigue todo.
4. **Apagar no recorta.** Con 20.000 guardados el switch queda deshabilitado y
   explica cuánto hay que acortar. `PUT {extendedInstructions:false}` → 422 con
   «…tienen 20.000 caracteres: acortalas a 15.000…». `PUT {enabled:false}` → 200.
5. **Topes por la API.** Con la opción: 30.000 → 200, 30.001 → 422. Acortar y
   apagar en un pedido → 200. Sin la opción: 15.000 → 200, 15.001 → 422 con «El
   propietario puede subirlo a 30.000…».
6. **Claude por MCP** (`tests/e2e/fixtures/mcp-client.mjs connect`, switch de
   asistentes prendido): `get_agent_knowledge` informa `limits.instructions`
   15000 / 30000 según la opción; `edit_agent` con 20.000 se rechaza apagada (con
   la pista de «Instrucciones extendidas») y entra prendida; `teach_agent` con una
   regla que pasaría los 30.000 se rechaza.
7. **Deshacer que ya no entra.** Guardar 20.000, acortar a 4.000 por `edit_agent`,
   apagar la opción y deshacer el acortado: por MCP «No se puede deshacer: Las
   instrucciones superan el tope de 15.000…»; desde el panel del Entrenador
   (`POST /api/trainer/changes/[id]/revert`) → 409 `over_limit`. Las instrucciones
   siguen en 4.000. Con la opción prendida de nuevo, el mismo «Deshacer» restaura
   las 20.000.
8. **El propietario decide.** Un miembro recibe 403 al intentar cambiar la opción.
9. **El agente sigue respondiendo.** Con 30.000 caracteres guardados, entra un
   mensaje por el wa-mock → la respuesta aparece en `/api/dev/wa-mock/outbox`.
