# 039 — El agente mira los videos del cliente (opcional por empresa)

**Pedido del dueño (22-oct-2026):** «que el agente lea los videos como las
imágenes, pero opcional en la configuración del agente para que no sea un
gasto excesivo de tokens; por default apagado; y que responda acorde».

**Contexto:** en producción el agente de Altos de Calamuchita contestaba
«no puedo abrir el video, ¿me contás de qué se trata?» (oct-2026). Desde 026
los videos se guardaban para el equipo pero el agente no los miraba.

## Qué cambia

- `agent_profile.read_videos` (migración 0028, `false` por defecto) +
  tarjeta «Ver los videos del cliente» en `/agent` con aviso de costo y del
  modelo (el de visión; tiene que aceptar video, p. ej. Gemini).
- Con la opción **y el agente prendido**, un video entrante (WhatsApp o
  Instagram) pasa de `store` a `process`: se guarda, se publica, y el modelo
  de visión lo resume (`readVideo`, parte `video_url` con data URI, defensa
  de origen como imágenes y PDF). Retiene el turno como un PDF. La fila lleva
  `details.videoRead` (la Bandeja muestra «Mirando el video…» y el marcador
  «se está mirando» solo en ese caso).
- Marcadores: mirado → `[ADJUNTO] El cliente mandó un video: <resumen>`; sin
  mirar (opción apagada o fallo) → `VIDEO_UNSEEN`: responder a lo demás y,
  solo si hace falta, pedir en una frase qué muestra. Ya no «no lo podés
  abrir».
- Bandeja: «Lo que se ve: …» debajo del video; error con «el agente sigue con
  lo demás».
- Tope: 16 MB (el máximo de WhatsApp). Historias de Instagram en video:
  sin cambios (se guardan sin IA, 030).

## Verificación

Unit `tests/unit/agent-video-039.test.ts`; E2E `tests/e2e/039-agent-video.md`.
Pendiente: confirmar con el modelo real (Gemini por OpenRouter) en producción.
