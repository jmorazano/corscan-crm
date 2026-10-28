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

## C — días sin respuesta (21/21)

Guion con `fetch` + `postgres`; el reloj de cada contacto se corre para
atrás en la BD (`last_inbound_at`, `lead.updated_at`) y el barrido se
dispara con `POST /api/dev/lead-stale`. Guarda y restaura las etapas de la
empresa (la regla barre también sus leads viejos).

1. Apagado → el barrido no mueve nada.
2. `GET /api/pipeline/settings` trae la vista previa (7: 35, 14: 34, 30: 14,
   60: 0) y `canEdit=false` para el miembro; el miembro → 403; 10 días → 422.
3. El propietario prende 7 días → se aplican en el acto 35 = lo que decía
   la vista previa.
4. Callado 8 días → Perdido con `stale_lost_at` y línea `lead_stale` (7
   días); cliente callado 40 días → no se toca; callado 3 días → sigue.
5. Segundo barrido → nada nuevo.
6. El callado vuelve a escribir → En conversación, sin marca. El que dijo
   que no escribe «gracias, chau» → se queda en Perdido.
7. Una persona lo mueve hoy a Interesado (callado hace 10 días) → el
   barrido no lo pierde.

## UI (Browser pane, 1400 px y 375 px)

Botón «Ventana abierta (N)» en el encabezado del tablero; al tocarlo queda
`?ventana=1` y solo se ven las tarjetas con ventana, con conteos por
columna; cada tarjeta con ventana muestra «Ventana · quedan 23 h». En móvil
«Gestionar etapas» queda como ícono (con `aria-label`). En «Gestionar
etapas», sección «Pasar a Perdido por días sin respuesta»: Apagado / «7 días
sin respuesta — hoy pasarían 34 leads»…; para un miembro, deshabilitada con
«Lo cambia el propietario de la cuenta».

## Reclasificación (dry-run sobre producción, Altos, 28-oct-2026)

`scripts/reclassify-leads.ts --org org_ivzjjfv8lwaw48attq1q` (sin `--apply`):
Nuevo 855 → 184 · En conversación 0 → 140 · Interesado 188 → 707 ·
Cliente 1 → 13 · Perdido 2 → 2 (los perdidos no se tocan).
