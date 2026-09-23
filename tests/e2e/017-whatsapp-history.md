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
