# Guion E2E — 054: Reenviar mensajes y enviar contactos

> Conducido contra `next dev` del worktree (puerto 3053) con wa-mock e
> ig-mock (26-nov-2026). Usuario `e2e@vocero.test`: propietario en «Negocio
> de Super Admin Local», miembro en «Inmobiliaria Demo».

## Datos (wa-mock `/api/dev/wa-mock/inbound`)

- **Ana Origen 053** (`…0530001`) manda: un texto, una imagen con epígrafe,
  un PDF (`contrato-053.pdf`), una nota de voz, una nota de voz OGG/Opus real
  (`mediaId: "mediamock_audio_opus_1"`), una tarjeta de contacto
  (`type: "contacts"`) y un sticker.
- **Beto** y **Caro** (`…0530002/3`) escriben «hola» (ventana abierta).
- **Dani** (`…0530004`) escribió hace dos días (`timestamp` viejo → ventana
  cerrada).

## La tarjeta del cliente se ve

1. Abrir el chat de Ana.
   ✅ La tarjeta muestra «Contacto de Prueba», `+54 9 351 555-0100` y el
   botón de copiar (antes: «📎 Contacto compartido» y nada más).
   ✅ `details.contacts` guarda nombre, teléfono y `waId`.

## Reenviar varios (escritorio)

2. Pasar el mouse por un mensaje → flecha «⌄» → menú con *Copiar texto*,
   *Reenviar*, *Seleccionar mensajes*.
3. «Seleccionar mensajes» → casillas en las burbujas; la barra «1
   seleccionado · Reenviar» reemplaza al compositor. Tocar el texto y el PDF
   → «3 seleccionados». Tocar el sticker → aviso «Los stickers no se pueden
   reenviar» y no se marca. Escape sale del modo sin cerrar el chat.
4. «Reenviar» → diálogo «Reenviar 3 mensajes a…» con los chats recientes.
   Buscar `053` → Beto, Caro, Ana y Dani; Dani aparece apagado con «Ventana
   de 24 h cerrada: necesita una plantilla» y no se puede elegir. Elegir Beto
   y Caro → «2 de 5 chats».
5. «Reenviar».
   ✅ wa-mock `/outbox`: texto, documento y `contacts` a cada uno, en el
   orden del hilo; `mediaUploads` = 1 (el PDF se sube UNA vez para los dos).
   ✅ El diálogo se cierra, la selección se suelta, vuelve el compositor.
   ✅ En el chat de Caro cada burbuja dice «↪ Reenviado» y firma «Operador
   E2E»; el panel dice «El equipo está atendiendo» (el agente calla, 031).

## Reenviar uno (se abre el destino)

6. Flecha de un mensaje → «Reenviar» → elegir solo a Beto → «Reenviar».
   ✅ Se abre el chat de Beto con el mensaje al final y el aviso «Reenviado
   a Beto Destino 053».

## Notas de voz e imágenes (API)

7. `POST /api/conversations/forward` con los cinco tipos a Beto, Caro y Dani.
   ✅ `image {id, caption: "Comprobante de la seña"}`, `document {id,
   filename}`, `contacts`, texto; Dani: `sent: 0`, «La ventana de 24 horas
   está cerrada…».
   ✅ El audio del mock mínimo (no es Opus) → «WhatsApp solo acepta audios
   OGG con códec Opus…» SOLO para ese mensaje; el resto sale.
8. Reenviar la nota de voz Opus real → `audio {id, voice: true}` a los dos
   destinos con una sola subida.

## Camino infeliz

9. Sticker → 422 `not_forwardable` «Los stickers no se pueden reenviar».
10. Destino = Entrenador → 422 `invalid_target`; origen = Entrenador → 422.
11. Mensaje de OTRO chat con ese origen → 404; destino inexistente → 404;
    6 destinos → 422; sin sesión → 401. En ningún caso sale nada.
12. Knob `failSends: 20` (Meta caída) → 200 con `sent: 0` y «Meta no está
    disponible ahora» por chat, en 0,2 s (corta al primer fallo de cada
    destino; no se cuelga).
13. Knob `failSends: 1` desde el navegador con dos destinos → el diálogo
    queda abierto: «Se reenvió, pero no a todos · Llegó a Ana · Beto — no se
    envió: Meta no está disponible ahora».
14. Knob `mediaUploadFails` → el adjunto queda en el hilo del destino como
    «No entregado» con la marca Reenviado; `POST …/retry` lo saca.

## Enviar contactos

15. En el chat de Beto, botón «Contacto» del compositor → «Enviar contacto».
    Buscar «Ana Origen» → elegirla. «Otro» → `Juan Electricista` /
    `351 555 0199` → «Agregar». «Enviar».
    ✅ `/outbox`: `type: "contacts"` con dos tarjetas; la escrita a mano
    sale `+5493515550199` con `wa_id` (regla AR del 9).
    ✅ El hilo muestra las dos tarjetas con su número completo.
16. Por API: teléfono `abcde` → 422 «El teléfono de X no es válido»; cuerpo
    vacío → 422; contacto inexistente → 422; chat con la ventana cerrada →
    409 `window_closed`. Un fijo sin característica (`4601234`) viaja como
    se escribió, sin `wa_id`.

## Celular (375 px)

17. Mantener apretado un mensaje → hoja con las tres acciones.
    «Seleccionar mensajes» → casillas y barra inferior.
    ✅ El botón «Contacto» está junto al clip y se esconde al escribir.

## Instagram (ig-mock)

18. Reenviar un texto, una imagen y una tarjeta desde un chat de WhatsApp a
    una conversación de Instagram con la ventana abierta.
    ✅ Texto y adjunto salen por el envío de Instagram; la tarjeta sale como
    texto «Contacto: Nombre — +54…».
19. «Enviar contacto» en un chat de Instagram muestra el aviso «Instagram no
    tiene tarjetas de contacto: se envía como un mensaje de texto…».

## Aislamiento

20. Cambiar a «Inmobiliaria Demo» (miembro): origen de la otra empresa →
    404; destino de la otra empresa → 404; contacto de la otra empresa →
    422. Nada sale.
