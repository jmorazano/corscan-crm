# E2E 036 — El agente no deja chats colgados

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock), BD local `vocero`, org «Negocio de Super Admin Local»
(`org_m9651yzzrnaw62lwo4lm`) con el agente encendido, espera 1 s y ventana
del equipo 1 min (`team_silence_ms = 60000`). Entrantes por
`/api/dev/wa-mock/inbound`, ecos del celular por `/api/dev/wa-mock/echo`,
fallos de Meta con el knob `failSends`. Conducido por un script Node
(`fetch` + `postgres`) que restaura el perfil al terminar.

## A — Meta cae una vez (AC1.1)
`failSends: 1` → el cliente escribe → el primer envío da 500, el reintento
sale: **una** respuesta en el outbox y ninguna línea de error. El log dice
`[agente] reintento 1 del envío en cv_…: meta_unavailable`.

## B — Meta caída (AC1.2)
`failSends: 3` → nada sale; queda `ai_error/send` con el texto que iba a
decir («La respuesta de la IA no salió: Meta no está disponible ahora»).

## C/D/E/F — Retoma al vencer la ventana (AC2.1–2.4), cuatro chats en paralelo
Cada uno: «Hola» → responde el agente → eco del equipo → el cliente escribe →
línea `team_active` con `until` y sin respuesta durante la ventana.
- **C** «¿Cuánto sale la cabaña para 2?» → al vencer, «Perdón la demora.
  Retomo tu consulta…» + línea `ai_resumed`.
- **D** «Barbaro, gracias!» → no responde (corte antes del modelo) y queda
  «La IA leyó el mensaje y decidió no responder: el cliente solo agradeció…».
- **E** «Dale, lo hablo con mi pareja y te aviso» → el modelo (sección
  `RETOMA TRAS EL EQUIPO`) elige `none` con motivo.
- **F** el equipo contesta antes de que venza → al vencer no pasa nada.

## G — Difusión del equipo (AC3.1–3.2)
Cuatro chats con un «Hola» (tres de ellos corridos 2 h atrás). El mismo
«Se me liberó este 👇 <enlace>» desde el celular a los cuatro.
- **G7** (no venía escribiendo) pregunta el precio → el agente responde en
  segundos y el eco queda con `details.broadcast = true`.
- **G10** (había escrito recién: el mismo texto le RESPONDE) pregunta →
  silencio `team_active`; al vencer la ventana, retoma la pregunta.

## H — Reinicio con una retoma pendiente (AC2.5)
Eco del equipo + pregunta del cliente → silencio con `until` → se reinicia
el dev server antes de que venza → al arrancar `[boot] 1 retoma(s) del
agente reprogramada(s)` y al vencer el agente responde.

## Resultado (13-oct-2026)

A–G: 25/25 verdes en una corrida (los cuatro chats de C–F y los cuatro de G
corriendo a la vez). H: tras el reinicio, `[boot] 2 retoma(s)…` (la del
caso H y la del F, inocua: el equipo ya había contestado) y al vencer la
ventana, «La IA retomó…» + «Perdón la demora. Retomo tu consulta…». La UI
muestra «A las HH:MM retoma sola si el cliente quedó esperando respuesta»
(escritorio 1400 px).
