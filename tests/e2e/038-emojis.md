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
   duplica; `emoji:""` no genera nada; el agente NO responde (30 s).
4. Camino infeliz: `{"type":"sticker","mediaId":"mediamock_sticker_empty_1"}`
   → `media_state=failed` y el agente igual responde con naturalidad
   («¡Buenísimo! 😊»), sin «no puedo ver».
5. Composer (escritorio): botón de carita → selector; elegir un emoji lo
   inserta donde está el cursor y el foco vuelve al campo; buscar «gracias»
   → 🙏 (Enter lo inserta); los recientes aparecen primero al reabrir; Esc
   cierra el selector sin cerrar el chat. Enviar → el outbox del wa-mock
   trae el texto con el emoji intacto.

Resultado 21-oct-2026: verde (1–5).
