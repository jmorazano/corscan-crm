# 054 — Reenviar mensajes y enviar contactos

**Estado**: implementada · **Migración**: ninguna (todo en `message.details`) ·
**Pedido**: el dueño (26-nov-2026): «en el CRM no se puede reenviar imágenes
ni textos, ni enviar contactos; es engorroso si solo usamos la app del CRM.
¿Se puede agregar el reenviar tal cual lo tiene WhatsApp?».

## Problema

Para pasarle a un cliente algo que ya está en otro chat (el comprobante que
mandó otro cliente, la foto de la cabaña, el texto con las condiciones) el
equipo tenía que descargar el archivo y volver a subirlo, o copiar y pegar.
Y la tarjeta de contacto de WhatsApp («te paso el número del encargado») no
existía: ni para mandarla ni para ver la que manda el cliente, que aparecía
como «📎 Contacto compartido» sin el nombre ni el teléfono.

## Qué hace

### Reenviar (como en WhatsApp)

- **Desde el hilo**: en escritorio, el menú «⌄» que aparece al pasar por un
  mensaje; en el celular, mantener apretado. Acciones: *Copiar texto*,
  *Reenviar*, *Seleccionar*. «Seleccionar» entra al modo selección (casillas
  en las burbujas y una barra «N seleccionados · Reenviar» en lugar del
  compositor), para reenviar varios juntos, en su orden original.
- **A quién**: diálogo «Reenviar a…» con las conversaciones recientes y un
  buscador (nombre, teléfono, @usuario). Hasta **5 chats** a la vez (el tope
  de WhatsApp) y hasta **20 mensajes** por reenvío. Con un solo destino, al
  terminar se abre ese chat.
- **Qué se puede reenviar**: texto (también el de una plantilla enviada),
  imágenes, videos, audios y notas de voz, documentos y tarjetas de contacto
  — recibidos o enviados, por WhatsApp o Instagram. No: stickers, reacciones,
  comentarios e historias de Instagram, mensajes eliminados, adjuntos que
  todavía se están descargando o que no se pudieron guardar.
- **Cómo viaja**: es un mensaje nuevo del equipo en el chat de destino, con
  las mismas reglas de siempre: ventana abierta (24 h en WhatsApp; la de
  Instagram), formatos y tamaños del canal de destino (026), sandbox del
  Laboratorio y Entrenador afuera. Un chat con la ventana cerrada aparece en
  la lista pero no se puede elegir, con el motivo. El epígrafe de una imagen
  o un documento viaja con él; la transcripción de un audio se copia (no se
  vuelve a transcribir).
- **La marca «Reenviado»**: se ve en el hilo del CRM (`details.forwarded`).
  El cliente lo recibe como un mensaje común: la Cloud API no permite marcar
  un mensaje como reenviado.
- **Resultado por chat**: si a un destino no se le pudo mandar (se cerró la
  ventana, el canal no acepta ese archivo), el diálogo lo dice chat por chat
  y lo que sí salió, salió. Un adjunto que el canal rechazó queda en el hilo
  como «No entregado» con *Reintentar* (026).
- **Quién**: todo el equipo (enviar es operar): `withAuth`.
- El agente ve lo reenviado como lo que es: un mensaje del equipo (lo calla
  como cualquier intervención de 031; a ≥ 3 chats cuenta como difusión, 036).

### Enviar contactos

- **Desde el compositor**: botón «Contacto» junto al clip. Diálogo con un
  buscador sobre los contactos del CRM (solo WhatsApp, con teléfono real) y
  «Otro contacto» para escribir nombre y teléfono a mano (el encargado, el
  electricista: gente que no es cliente). Hasta 10 por mensaje.
- **WhatsApp**: sale como tarjeta de contacto nativa (`type: "contacts"`),
  con el botón «Enviar mensaje» cuando el número se pudo normalizar.
- **Instagram**: no tiene tarjetas; sale como texto («Contacto: Nombre —
  +54 9 …») y la interfaz lo avisa antes de enviar.
- **Los que manda el cliente** (y los que el negocio manda desde el celular
  con coexistence): se guardan nombre, teléfonos y correo en
  `details.contacts` y el hilo muestra la tarjeta con «Copiar número». Se
  pueden reenviar.
- **El agente** ve una línea `[ADJUNTO]` con el nombre y el teléfono de la
  tarjeta (del cliente o del equipo) en vez de que el mensaje desaparezca de
  su historial.

## Reglas (puras)

- `src/lib/contact-card.ts`: `SharedContact`, lectura tolerante del payload
  de Meta (`parseWhatsAppContacts`, nunca lanza), saneo (nombre ≤ 120, hasta
  5 teléfonos por tarjeta, hasta 10 tarjetas), payload de envío, texto para
  Instagram y para el agente.
- `src/lib/forward.ts`: `forwardability(message)` (qué se puede y por qué
  no), topes, `forwardTargetState(conversation)` (ventana) y el resumen del
  resultado.

## Fuera de alcance

Marcar «Reenviado» del lado del cliente (Meta no lo permite), reenviar a un
contacto sin conversación o con la ventana cerrada (eso es una plantilla),
reenviar stickers y ubicaciones, enviar ubicación, agregar un comentario al
reenvío, que el agente de IA reenvíe o mande contactos, guardar en el CRM el
contacto de una tarjeta recibida.

## Mapa

`src/lib/forward.ts` · `src/lib/contact-card.ts` ·
`src/server/inbox/forward.ts` (orquesta) · `src/server/inbox/send-contacts.ts`
· `sendMedia`/`sendText` con `details.forwarded` · ingesta de `contacts` en
`ingest.ts`/`history.ts` · `POST /api/conversations/forward` ·
`POST /api/conversations/[id]/messages/contacts` ·
`src/components/inbox/forward-dialog.tsx`, `contact-picker.tsx`,
`message-thread.tsx` (menú, selección, tarjeta), `composer.tsx` ·
wa-mock `inbound` con `contacts` · guion `tests/e2e/us-054-forward.md`.
