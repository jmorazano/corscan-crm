# E2E 038 — Emojis

Mocks: `WA_MOCK_ENABLED=true`, Graph → wa-mock, OpenRouter → ai-mock.
`POST /api/dev/wa-mock/inbound` con el `phoneNumberId` de la empresa.

1. Texto del cliente → el agente responde.
2. `{"type":"sticker"}` → el mensaje queda `media_state=ready`,
   `media_summary="un pulgar arriba"` y el agente responde
   «¡Buenísimo! 😊 (entendí tu sticker: un pulgar arriba)». En el hilo se ve
   el sticker y «un pulgar arriba».
3. `{"type":"reaction","reactTo":"<wamid del saliente>","emoji":"❤️"}` →
   nota «Reaccionó ❤️ a «…»» con el texto del mensaje; reenviarla no
   duplica; `emoji:""` no genera nada; el agente responde (o queda la
   línea «La IA leyó el mensaje y decidió no responder»); reenviar la misma
   reacción o `emoji:""` no dispara otro turno; con la ventana de 24 h
   cerrada no hay turno ni handoff «ventana».
   - CRM-5, 👍 a una pregunta concreta: el agente pregunta «¿Te busco del
     05/01 al 08/01?» (ai-mock); `{"type":"reaction","reactTo":"<wamid de la
     pregunta>","emoji":"👍"}` → nota «Reaccionó 👍 a «¿Te busco…»», y el agente
     responde tomándolo como un sí (o queda «decidió no responder»).
   - CRM-5, otra empresa: una empresa nueva (no Altos) con WhatsApp en wa-mock,
     el agente prendido, sin conector MCP e instrucciones que no mencionan
     reacciones. El agente pregunta (ai-mock) y el cliente manda
     `{"type":"reaction","reactTo":"<wamid>","emoji":"👍"}` → nota «Reaccionó 👍
     a «…»», y el agente responde tomándolo como un sí (o aparece «decidió no
     responder»). Resultado: pendiente de verificación humana.
   - CRM-5, 👍 al mensaje del equipo con su ventana ya vencida: el equipo
     escribe desde el CRM, se espera más que la ventana del equipo y llega
     la reacción al mensaje del equipo → NO responde; queda la línea «La IA
     leyó el mensaje y decidió no responder: el cliente solo agradeció o
     confirmó…».
4. Camino infeliz: `{"type":"sticker","mediaId":"mediamock_sticker_empty_1"}`
   → `media_state=failed` y el agente igual responde con naturalidad
   («¡Buenísimo! 😊»), sin «no puedo ver».
5. Composer (escritorio): botón de carita → selector; elegir un emoji lo
   inserta donde está el cursor y el foco vuelve al campo; buscar «gracias»
   → 🙏 (Enter lo inserta); los recientes aparecen primero al reabrir; Esc
   cierra el selector sin cerrar el chat. Enviar → el outbox del wa-mock
   trae el texto con el emoji intacto.

Resultado 21-oct-2026: verde (1–5).
