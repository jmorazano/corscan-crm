# E2E 017 — Historial del celular (coexistence)

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`, wa-mock + ai-mock,
`AGENT_COALESCE_MS=2000`), usuario E2E local (owner), número mock
`111111111` (`waba_a`). La UI se conduce en el Browser pane; los webhooks
los entrega el propio wa-mock por loopback (`smb_app_data` en el graph mock
→ `history` × 2 desordenados + detalle de media; `smb_app_state_sync`;
`POST /api/dev/wa-mock/echo` → `smb_message_echoes`).

## Guion

1. **Tarjeta**: Ajustes → WhatsApp muestra «Historial del celular» con
   «Sin importar» y el botón «Importar últimos 60 días».
2. **Importar**: click → `POST /api/settings/whatsapp/history-import`
   (`days 60`) → el mock registra `syncRequests` `[smb_app_state_sync,
   history]` y responde `request_id`; la tarjeta pasa a «Solicitado» /
   «Recibiendo…» y al 100 % a «Importado: 5 mensajes en 1 conversaciones ·
   4 más viejos que 60 días, descartados · terminado el …».
3. **Bandeja**: la conversación de `5493515550777` aparece con nombre de
   agenda «Marcos Proveedor Drones» (llegó por `smb_app_state_sync` ANTES
   que el historial: el contacto se crea con ese nombre); el hilo muestra,
   en orden cronológico con separadores «3 de septiembre», «18 de
   septiembre», «Hoy»: 2 mensajes de hace 20 días (in/out), la foto de
   hace 5 días con su pie «Foto del terreno desde la ruta» (placeholder →
   detalle), y los dos de hoy. Preview «Sí, te llega esta tarde», `unread
   0`, ventana abierta (último entrante hace 2 h). El hilo `…5550778`
   (solo mensajes de 65 días) NO existe.
4. **Sin efectos de entrante**: ningún push, ningún lead nuevo, el outbox
   del mock sigue vacío (el agente no respondió a nada importado).
5. **Eco del celular**: `POST /api/dev/wa-mock/inbound` («¿y la factura…»)
   + a los 300 ms `POST /api/dev/wa-mock/echo` («A, te la mando desde el
   celu») → el hilo muestra el eco como saliente con «Desde el celular»
   (`message-from-phone`), ordenado DESPUÉS del entrante, y a los 5 s el
   outbox del mock sigue en 0: el agente no habló encima. Control: un
   entrante sin eco → outbox 1 (el agente responde normal).
6. **Dedup del eco**: dos ecos con el mismo `waMessageId` → una sola burbuja.
7. **Rechazo**: knob `historyDeclined: true` + «Volver a importar» → la
   tarjeta pasa a «Rechazado por el negocio» con el texto que explica cómo
   activarlo en la app (código 2593109).
8. **En curso**: pedir dos veces seguidas → la segunda responde 409
   `in_progress`; al terminar (`done`), los mensajes ya importados no se
   duplican (contador estable).
9. **Móvil (375 px)**: tarjeta completa con estado y contadores,
   `scrollWidth 375`.

## Resultado (23-sep-2026)

Todo ✅ tal como está descrito arriba. Correcciones durante la prueba: (a) el
wa-mock reiniciaba el contador de wamid al limpiar el outbox y la dedup
descartaba en silencio el siguiente entrante del guion (ahora el contador
sobrevive al reset); (b) el eco se ordenaba ANTES del entrante (timestamp de Meta en segundos vs.
`created_at` en milisegundos) y el agente respondía igual → los ecos se
insertan con `created_at = ahora`. Unit tests nuevos: `history-import`
(12), `agent-skips-when-business-replied` (1) — 852 en total en verde.

Pendiente de verificación humana: la sincronización REAL contra Meta para
el número de Corscan (onboardeado hace semanas: Meta exige pedirla dentro
de las 24 h del onboarding; si la rechaza, hay que reconectar el número
por Embedded Signup y la importación se pide sola al terminar).

## Un solo pedido por conexión (fix 26-nov-2026)

Caso real: «Distrito Inmobiliario (Administración)». Meta aceptó el pedido,
mandó la agenda y nunca un tramo de historial; el segundo pedido lo rechazó
con `(#4) … Synchronization Request limit exceeded`. Reglas puras en
`historyImportView` (`src/lib/history-import.ts`); perillas del wa-mock
`historySyncLimit` (queda prendida: el pedido son dos llamadas) y
`historySilent` (acepta y no manda nada).

1. **Rechazo con historial ya importado**: `historySyncLimit: true` +
   «Volver a importar» → el estado SIGUE «Importado» con sus contadores, sale
   la nota «Meta permite pedir el historial una sola vez por conexión…» y el
   botón desaparece (`last_error_code = sync_limit`).
2. **Rechazo sin historial**: fila `requested` de hace 2 h + `POST
   /api/settings/whatsapp/history-import` → 422 con el texto en criollo; la
   tarjeta queda «Falló» con los pasos para reconectar y SIN botón.
3. **Fila vieja** (`last_error_code = '4'` + texto crudo de Meta, como quedó
   en producción): misma tarjeta que el punto 2, sin una palabra en inglés.
4. **Sin respuesta**: `requested` de hace 11 min → «Sin respuesta de Meta»,
   sin ruedita ni botón, con la explicación y los pasos.
5. **Reconexión**: `meta_credentials.updated_at = ahora` → vuelve «Importar
   últimos 60 días» aunque el pedido anterior tenga menos de una hora (antes
   respondía `in_progress` y el pedido automático de la reconexión se perdía).
   Con `historySilent: true` → «Solicitado a Meta» con ruedita y botón
   deshabilitado; con las perillas apagadas → «Importado».
6. **Meta dejó de mandar**: `receiving` con el último tramo hace 20 min →
   «Importado en parte», contadores a la vista, sin ruedita ni botón.

Resultado (26-nov-2026): los 6 ✅ en el navegador contra los mocks. Unit:
`history-import` suma 9 casos de `historyImportView`.

## Rastro de eventos de Meta y período completo (26-nov-2026)

Pedido del dueño tras el caso Distrito: saber qué llegó sin deducirlo del
tamaño de los pedidos HTTP, y que «44 %» no parezca una importación a medias.

1. **Rastro** (`src/lib/webhook-trace.ts`, línea `[meta]` en el log por cada
   POST que trae algo que no es tráfico de mensajes): importar con los mocks
   deja `history pn=… tramos=1 hilos=2 mensajes=7 fase=1 orden=1 progreso=100`,
   `smb_app_state_sync pn=… contactos=1` y `history pn=… media=1`, cada una
   con `bytes=`. Sin contenido: ni textos ni teléfonos de contactos.
2. **Campo que el CRM no procesa**: `POST` al webhook local con
   `field: "account_update"`, `event: "PARTNER_REMOVED"` → 200 y
   `account_update waba=… evento=PARTNER_REMOVED claves=event,phone_number,waba_info`
   (el teléfono del valor no aparece).
3. **Período completo**: fila `receiving` al 44 %, último tramo hace 20 min y
   el mensaje importado más viejo a 6 h del borde de los 60 días → «Importado»
   (no «Importado en parte») con «Los últimos 60 días están completos: lo
   importado llega hasta el …», sin ruedita ni botón.
4. **Aviso de app abierta**: con `historySilent: true`, «Solicitado a Meta»
   muestra «Dejá WhatsApp Business abierto en el celular hasta que termine…»;
   el bloque «Ya uso este número en el celular» del alta suma el párrafo de
   aceptar el historial y dejar la app abierta.

Resultado: los 4 ✅ en el navegador contra los mocks. Unit: `webhook-trace`
(10) y un caso más de `historyImportView` (período cubierto).
