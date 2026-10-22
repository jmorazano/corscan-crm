# E2E 039 — El agente mira videos (opcional)

Mocks: wa-mock + ai-mock. Org con el agente prendido.

1. Opción apagada (default): `{"type":"video"}` → `media_state=ready`, sin
   resumen, sin `details.videoRead`; el agente NO dice «no puedo abrir el
   video» (responde con `VIDEO_UNSEEN`).
2. `/agent` → tarjeta «Ver los videos del cliente» desactivada; clic en el
   switch → «Activado…» y `GET /api/agent/profile` trae `readVideos: true`.
3. `{"type":"video","text":"mirá lo que pasa"}` → `details.videoRead=true`,
   `media_summary` = resumen del ai-mock; el agente responde según lo que se
   ve. En la Bandeja: «Lo que se ve: …».
4. Camino infeliz: `{"type":"video","mediaId":"mediamock_video_empty_1"}` →
   `media_state=failed`, el agente responde igual sin colgarse.

Resultado 22-oct-2026: verde (1–4).
