# 038 — Emojis: el agente los entiende y el equipo los manda

**Pedido de clientes del CRM (21-oct-2026):**
1. «Que pueda interpretar los emojis: cuando le ponen un emoji responde que
   no puede ver lo que le envió.»
2. «Que podamos enviar emojis desde el CRM.»

## Diagnóstico

Un emoji escrito llega como texto y el modelo lo ve. Lo que el cliente
llama «emoji» y el agente «no podía ver» eran:

- **Stickers de WhatsApp** (`type: "sticker"`): no se bajaban y el marcador
  decía «No lo podés abrir: preguntale de qué se trata» → el agente
  contestaba «no puedo ver lo que me mandaste».
- **El corazón grande de Instagram** (`like_heart`): caía como «publicación
  compartida que no podés abrir».
- **Reacciones de WhatsApp** (👍 a un mensaje): se descartaban sin rastro —
  ni el equipo ni el agente se enteraban.

## Qué cambia

- Sticker (WhatsApp; Instagram `animated_image`/`sticker`) → se baja y se
  describe con el modelo de visión con un prompt propio («qué expresa»), sin
  pasar por los comprobantes de 034. El marcador lo presenta como un gesto;
  si no se pudo mirar, el agente lo interpreta por el contexto y NUNCA dice
  que no lo puede ver.
- `like_heart` → entra como el texto «❤️».
- Reacción de WhatsApp → nota `reaction` en el hilo (como Instagram) con el
  comienzo del mensaje reaccionado (`message.details.reactionTo`). Sin no
  leídos, sin ventana y sin lead; quitarla no genera nada (CRM-5: ahora
  despierta al agente, ver abajo). El agente la ve como `[REACCIÓN]` en el historial.
- Una reacción no cuenta como «el cliente escribió» para 048, el seguimiento,
  las métricas ni la lista de pendientes de 036 (`isCustomerTurnMessage`).
  Desde CRM-5 el turno del agente sí la toma como `lastInbound` y en el
  chequeo de respuesta vieja (`isAgentTurnMessage`, mismo criterio en ambos).
- Prompt: interpretar emojis/stickers por contexto, nunca decir que no se
  ven; `[REACCIÓN]` es contexto.
- Composer: selector de emojis propio (escritorio; en el celular está el
  teclado): categorías, búsqueda en español, recientes en el navegador,
  inserta en el cursor sin robar el foco. Sin librerías ni CDN (II).

Sin migración (`details` jsonb ya existe).

## CRM-5 — la reacción del cliente despierta al agente (nov-2026)

Reemplaza el «SIN despertar al agente» para WhatsApp e Instagram.

- Una reacción agenda un turno si la ventana de 24 h (por `lastInboundAt`)
  está abierta. Un duplicado o una reacción quitada nunca lo agenda.
- En el pipeline la reacción cuenta como turno del cliente en ambos canales
  (`isAgentTurnMessage`; `lastInbound` y el chequeo de respuesta vieja usan el
  mismo criterio).
- En la retoma de 036 una reacción cuenta como confirmación (no responde y
  deja la línea «decidió no responder»).
- El prompt trata `[REACCIÓN]` como una respuesta corta (👍 a una pregunta = sí).
- No leídos, lead, push y 048 quedan como estaban.

## Verificación

- Unit: `tests/unit/emojis-038.test.ts` + ajustes en `inbound-media` y 036.
- E2E con mocks: guion `tests/e2e/038-emojis.md`.
