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
  leídos, sin ventana, sin lead y SIN despertar al agente; quitarla no
  genera nada. El agente la ve como `[REACCIÓN]` en el historial.
- Una reacción no cuenta como «el cliente escribió»: `isCustomerTurnMessage`
  la excluye de `lastInbound`, de la retoma de 036 y del chequeo de
  respuesta vieja (antes, en Instagram, una reacción durante la generación
  dejaba el turno reprogramándose).
- Prompt: interpretar emojis/stickers por contexto, nunca decir que no se
  ven; `[REACCIÓN]` es contexto.
- Composer: selector de emojis propio (escritorio; en el celular está el
  teclado): categorías, búsqueda en español, recientes en el navegador,
  inserta en el cursor sin robar el foco. Sin librerías ni CDN (II).

Sin migración (`details` jsonb ya existe).

## Verificación

- Unit: `tests/unit/emojis-038.test.ts` + ajustes en `inbound-media` y 036.
- E2E con mocks: guion `tests/e2e/038-emojis.md`.
