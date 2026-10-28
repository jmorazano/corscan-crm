# E2E 044 — El pipeline se ordena solo + ventana a la vista

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock + mcp-mock), BD local `vocero`, empresa «Inmobiliaria Demo»
(`org_x063bgv6kib0cum49tz7`, número mock `222222222`) con espera del agente
en 1 s durante la corrida (se restaura). Conducido por dos scripts Node
(`fetch` + `postgres`) que borran sus contactos al terminar; la parte B monta
el conector Altos sobre el mcp-mock (`bookingTools`, `confirm-booking`
aprobada) y lo quita al final.

Perillas del ai-mock (antes que cualquier herramienta):
«[E2E_ETAPA:<etapa>]» → `reply` con `stage`; «[E2E_MOVER:<etapa>]» → la
acción vieja `move_stage` con respuesta.

## A — reglas de etapa (18/18, 28-oct-2026)

1. «Hola» → lead creado en **Nuevo**, el agente responde.
2. Segundo mensaje → el cliente respondió a un saliente → **En conversación**.
3. «[E2E_MOVER:Interesado]» → `move_stage` → **Interesado**.
4. «[E2E_ETAPA:En conversación]» → la respuesta sale, el lead NO retrocede.
5. «[E2E_ETAPA:Perdido]» → **Perdido** (la etapa viajó con la respuesta).
6. «[E2E_ETAPA:Cliente]» → de Perdido a **Cliente**.
7. «[E2E_ETAPA:Perdido]» → de Cliente no sale solo.
8. Otro contacto, «[E2E_ETAPA:Inventada]» → se ignora, sigue en Nuevo, la
   respuesta sale.
9. `GET /api/pipeline/board` → la tarjeta trae `windowClosesAt` ≈ +24 h;
   las de ventana cerrada, `null`.

## B — conector de reservas (11/11)

1. «Hola» → Nuevo.
2. «Quiero reservar la AC-004 del 2026-11-10 al 2026-11-12 para 4» →
   `start-booking` con entrada y salida → **Interesado** (pasa por En
   conversación en el mismo pedido).
3. Datos del huésped → `set-guest-details` → sigue Interesado.
4. «Sí, confirmo» → `confirm-booking` registrada → **Cliente**.

## UI (Browser pane, 1400 px y 375 px)

Botón «Ventana abierta (N)» en el encabezado del tablero; al tocarlo queda
`?ventana=1` y solo se ven las tarjetas con ventana, con conteos por
columna; cada tarjeta con ventana muestra «Ventana · quedan 23 h». En móvil
«Gestionar etapas» queda como ícono (con `aria-label`).

## Reclasificación (dry-run sobre producción, Altos, 28-oct-2026)

`scripts/reclassify-leads.ts --org org_ivzjjfv8lwaw48attq1q` (sin `--apply`):
Nuevo 855 → 184 · En conversación 0 → 140 · Interesado 188 → 707 ·
Cliente 1 → 13 · Perdido 2 → 2 (los perdidos no se tocan).
