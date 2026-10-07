# E2E 032 — Herramientas del conector sin deploy + reservas por WhatsApp

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock + **mcp-mock** con `bookingTools`, `AGENT_COALESCE_MS=2000`).
Empresa de prueba: «Inmobiliaria Demo» (`org_x063bgv6kib0cum49tz7`, número
mock `222222222`, propietario `socio@vocero.test`) para no tocar `principal`,
que guarda la evidencia del sandbox de MiniHotel. Conector habilitado por el
super admin con perfil `altos_de_calamuchita` →
`http://localhost:3000/api/dev/mcp-mock/assistant`. Guion conducido con
`scratchpad/e2e032.mjs` (fases) + el Browser pane para la UI.

El ai-mock imita a un modelo INGENUO: ante cualquier «sí/esperá/todavía»
pide `confirm-booking` igual. Lo que se prueba es que la barrera del CRM
decide, no el modelo.

## Guion y resultado (7-oct-2026)

1. **Reconectar trae lo nuevo** — knob `bookingTools:true`, «Verificar
   conexión» → 7 herramientas: `list-search-options`/`check-availability`/
   `show-property` = «La usa el perfil»; `start-booking`/`set-guest-details`/
   `show-booking-draft` = **Activa** (consulta); `confirm-booking` =
   **Pendiente de aprobar** (escribe). ✅
2. **Inicio de la reserva** — «Quiero reservar la AC-004 del … al … para 4»
   → `start-booking` con `guests:4` (llegó «4» como texto y se convirtió) y
   `conversation_id` completado por el CRM; `set-guest-details` con el
   **celular del chat** sin preguntarlo; al cliente: datos que faltan + enlace
   de términos (`altosdecalamuchita.com`, permitido). 7,7 s. ✅
3. **Memoria entre turnos** — el cliente manda nombre, correo, DNI, ciudad,
   provincia y «acepto» → `set-guest-details` con el MISMO `draft_id` (salió
   de la memoria de la conversación) → resumen con **total y seña** que SALE
   aunque Altos oculta importes (excepción del resumen). ✅
4. **Escritura pendiente** — «Sí, confirmo» con `confirm-booking` sin aprobar
   → el agente no la tiene: 0 reservas. ✅
5. **Aprobación por la UI** — Integraciones → «Aprobar» → diálogo con lo que
   implica → «Aprobar» → badge «Activa». ✅ (capturas)
6. **«no, esperá que lo consulto»** → el modelo pide `confirm-booking` → la
   barrera NO la llama (el mock no registra la llamada) → «Perfecto, sin
   apuro…». 0 reservas. ✅
7. **«Sí, confirmo»** → `confirm-booking` sale → `RES-0001` → al cliente:
   «quedó registrada, pendiente de seña» + `payment_url` (la guarda de
   promesas no lo bloquea: la escritura salió en el turno). Evento en el hilo
   «El agente registró en Altos de Calamuchita (reservas): Registrar la
   reserva…» y nota `[IA]` en el lead. ✅
8. **Doble confirmación** — «sí, confirmo» otra vez → el modelo vuelve a
   pedir `confirm-booking` → el CRM devuelve «YA se ejecutó» SIN llamar →
   sigue habiendo **1** reserva y **1** llamada en el mock. ✅
9. **Se ocupó mientras pedía los datos** — otra conversación, knob
   `bookingUnavailable` → `no_longer_available` → «se ocupó recién… ¿busco
   otras opciones?», 0 reservas nuevas. ✅
10. **Herramienta NUEVA sin deploy** — knob `extraTool` + «Verificar» →
    `list-house-rules` aparece **Activa**; `confirm-booking` conserva su
    aprobación (firma igual); «¿Cuáles son las normas de la casa?» → el agente
    la usa y contesta con las normas. ✅
11. **Entrenador** — «Acabo de actualizar la lista de herramientas del MCP de
    reservas, ¿podés fijarte?» → «Sí, ya las veo: …» con las 8 y su estado
    (antes: «pegámelas acá»). ✅
12. **Fila vieja (estado real de producción tras la reconexión del dueño)** —
    se pisó `tools` con el formato pre-032 (sin firma ni parámetros): las 5
    genéricas quedan «Verificá la conexión» y el agente atiende EXACTO como
    031 (búsqueda + enlace, sin herramientas de reserva). «Verificar» → vuelven
    activas y la escritura queda pendiente. ✅
13. **Permisos de la API** — miembro → `PATCH` 403; herramienta del perfil →
    422 `profile_tool`; inexistente → 404 `unknown_tool`.

Unit: `tests/unit/mcp-dynamic-tools.test.ts` (política, esquema,
conformidad, render, guardas) y `tests/unit/mcp-dynamic-execute.test.ts`
(barrera de escritura con `calls.ts` simulado, sección, Altos, Entrenador).
