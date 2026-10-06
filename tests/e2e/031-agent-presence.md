# E2E 031 — El agente a la vista: motivos en el hilo, sin promesas vacías y de vuelta cuando el equipo se va

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock + mcp-mock), BD `vocero_031` (copia de `vocero_030` con la migración
0025), usuario `e2e@vocero.test` (owner de «Negocio de Super Admin Local»,
agente «Giuliana», espera 1 s) y `superadmin@vocero.test` para habilitar el
conector. Los pasos de API se conducen con scripts Node (`fetch` con la cookie
de sesión; inbound/eco por `/api/dev/wa-mock/*`); «pasaron N minutos» se
simula corriendo hacia atrás las fechas de la conversación en la BD. La UI se
verifica en el Browser pane (escritorio 1400 px y móvil 375 px).

## Preparación

- Super admin: `PUT /api/admin/organizations/{org}/mcp` con perfil
  `altos_de_calamuchita` → `http://localhost:3000/api/dev/mcp-mock/assistant`;
  owner: `POST /api/integrations/mcp/verify` → `connected`.
- Owner: agente encendido, `replyDelayMs 1000`, `teamSilenceMs null`, token
  de IA del mock.

## A — Promesa vacía (US2, caso Agustina)

1. Inbound `[E2E_PROMESA] Somos 4 personas del 2026-11-27 al 2026-11-29`: el
   modelo devuelve `update_lead` + «Busco opciones…» sin consultar. **No
   sale**; el pipeline pide UNA corrección, el modelo consulta
   (`search_stays` + `lead_note`) y sale «Tengo estas opciones… <enlace>» en
   5,4 s. El mcp-mock registra `check-availability`. La nota «Consulta para 4
   personas del 27 al 29 de noviembre.» queda **una sola vez** (venía en el
   `update_lead` y en la `lead_note`).
2. `[E2E_PROMESA_INSISTE] …`: insiste tras la corrección → la promesa sale y
   la conversación pasa a atención humana `modelo` con la línea «La IA pasó la
   conversación a atención humana: avisó que iba a consultar y no lo hizo».

## B — Equipo presente (US3 + US1)

1. Primer mensaje → la IA responde.
2. El owner escribe desde el CRM → el mensaje queda con `sent_by_user_id` y
   `team: true` en el DTO.
3. El cliente responde → la IA NO responde; línea «La IA no respondió: alguien
   del equipo está atendiendo. Vuelve a responder si el cliente escribe desde
   las HH:MM» con `until` = mensaje del equipo + 10 min (±2 s).
4. Otro mensaje del cliente → sin respuesta y **sin** segunda línea (dedup).
5. Pasados 11 min → el cliente escribe → la IA responde y queda «La IA retomó
   la conversación: pasaron 10 min sin que el equipo escriba».
6. Eco del celular (`/api/dev/wa-mock/echo`) + mensaje del cliente → silencio
   otra vez (el celular también es el equipo).

## C — Switch apagado: fijo, con autor (AC1.2, AC3.3)

1. `PATCH {aiEnabled:false}` dos veces → UNA línea «Operador E2E pausó la IA
   en este chat».
2. El cliente escribe → «La IA no respondió: está pausada en este chat.
   Vuelve cuando alguien la prenda.» (sin hora de vuelta).
3. **Tres días después** el cliente escribe → sigue sin responder, sin línea
   repetida, `ai_enabled=f`.
4. `PATCH {aiEnabled:true}` → «Operador E2E activó la IA en este chat» y
   responde el siguiente mensaje.

## D — Atención humana: espera a una persona, después vence (caso Guillermo)

1. «Quiero hablar con un humano» → atención humana `cliente` + línea.
2. **5 h** sin que el equipo responda → el cliente escribe → «…está en
   atención humana (el cliente pidió una persona). Vuelve sola 10 min después
   de que alguien del equipo responda.»; sin respuesta y `handoff_at` intacto.
3. El equipo responde desde el CRM; el cliente contesta → «La IA no
   respondió: alguien del equipo está atendiendo. Vuelve a responder si el
   cliente escribe desde las HH:MM».
4. «Al otro día» (9 h) llega el PDF `Transferencia_a_Otras_Cuentas.pdf` → la
   IA lo lee y responde «Recibí el comprobante, gracias…»; `handoff_at=null`
   y línea «La IA retomó la conversación…».

(Primera versión del guion, antes de la aclaración del dueño: la pausa y la
atención humana vencían a los 10 min sin más; el C viejo falla ahora a
propósito.)

## E–J — Caminos infelices y ajustes

- **E** token `…-nocredit` (ai-mock → 402): «La IA no pudo responder: OpenRouter
  no tiene crédito suficiente (cargá saldo en openrouter.ai). Pasó a atención
  humana.» (sin reintentar un 402).
- **F** mcp-mock `failNextCall`: «El sistema de reservas no respondió: no se
  pudo conectar.»; la IA igual contesta («Dejame consultarlo con el equipo…»)
  y deriva.
- **G** wa-mock `failNextSend`: «La respuesta de la IA no salió: Meta no está
  disponible ahora.» con «Ver lo que iba a decir» (el texto completo +
  «Copiar»).
- **H** `[E2E_NADA]`: «La IA leyó el mensaje y decidió no responder: el
  cliente solo agradeció».
- **I** `teamSilenceMs` 0 y 25 h → 422; 15 min → 200, `effectiveTeamSilenceMs
  900000` y el silencio dice `minutes: 15`; `null` vuelve a 10 min. Tarjeta
  «Cuando alguien del equipo interviene» en `/agent`: «abc» → «Ingresá un
  número entero entre 1 y 1440 minutos.»; 15 → «El agente se calla 15 min
  después del último mensaje del equipo.».
- **J** agente apagado en `/agent`: ni respuesta ni líneas.

## UI (Browser pane)

- Escritorio: las líneas aparecen intercaladas por hora (tonos: gris =
  silencio, beige = derivación, rojo = error, verde = vuelta/activación).
- Click en el interruptor del panel → la línea «Operador E2E pausó la IA en
  este chat · HH:MM» llega en vivo por SSE y el panel dice «En pausa · vuelve
  a responder si el cliente escribe desde las HH:MM».
- Móvil 375 px: la línea del 402 se lee completa sin desbordar.
- Panel en atención humana sin respuesta: «La IA vuelve sola 10 min después
  de que alguien del equipo responda.»; con el switch apagado: «En pausa ·
  no responde hasta que la prendas».
- **Enlaces**: en la respuesta del agente los enlaces se ven azules y
  subrayados, `href` completo, `target=_blank`, `rel="noopener noreferrer
  nofollow"`.

## Estado

Verde (6-oct-2026) en el worktree `031-agent-resume`.
