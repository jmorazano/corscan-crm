# E2E fix — Notas de voz claras que quedaban «sin transcribir»

## Incidente (12 al 14-oct-2026, «Negocio de Juan Morazano»)

9 notas de voz entrantes por WhatsApp; 4 quedaron `media_state = failed` con
«No se pudo transcribir el audio» y el agente pidió «escribime». Las 4 eran
de conversaciones que llegaban por anuncios (`wa-anuncio`), y en ninguna el
cliente volvió a escribir.

## Causa

No fue la descarga, ni el formato, ni el tamaño, ni un error del proveedor:
los 4 eran OGG/Opus iguales a los que sí se transcribieron, y repetida la
llamada desde producción OpenRouter respondió **200 en ~2 s** con
`[SIN_CONTENIDO]`, de forma determinista (temperatura 0). Preguntado qué se
oía, el mismo modelo dijo «voz humana en español, se entiende con claridad,
hay ruido de fondo». El prompt le ofrecía el sentinel ante «silencio, ruido,
demasiado corto **o no se entiende**», y Gemini 2.5 Flash lo tomaba ante
cualquier ruido de fondo. Además `interpret` no logueaba el motivo: el
incidente no dejó ningún rastro en Railway.

Al cambiar el prompt aparecieron dos fallas más, que el fix también cubre:
con temperatura 0 un audio cayó en bucle («No, no, no, …» hasta 4.095
caracteres), y ante silencio el modelo INVENTA una consulta plausible
(«Hola, ¿cómo estás? Te hago una consulta…») con cualquier prompt.

## Fix

- `transcriptionMessages` (`src/lib/ai`): el sentinel solo si no habla nadie;
  «aunque haya ruido… transcribí lo que se entienda y marcá […]»; quién
  habla (`customer` / `team` / `owner`); el audio antes de la consigna; sin
  temperatura fija.
- `transcribeAudio`: 3 intentos (proveedor caído, sentinel una vez más,
  bucle, texto inverosímil); un bucle se devuelve recortado si no sale nada
  mejor.
- Reglas puras en `src/lib/transcription.ts` (sentinel, bucle, verosimilitud
  por duración a ≤ 30 caracteres/s + 20) y `oggOpusStats` en
  `src/lib/ogg-opus.ts` (duración y paquetes de silencio; tolera paquetes
  que cruzan páginas). Un OGG que es silencio digital no se manda al modelo.
- `interpret` loguea `[medios] transcripción <error> de <msg> (<mime>, <B>): <detalle>`.

## Validación con los audios reales (producción, solo lectura)

El código real empaquetado con esbuild y corrido en el contenedor sobre los
9 audios + silencio y ruido sintéticos, dos corridas:

| Audio | Antes | Después |
|---|---|---|
| 3 min (178 s) | `[SIN_CONTENIDO]` | transcripto (≈1.600 caracteres), 1 pedido |
| 9,4 s | `[SIN_CONTENIDO]` | transcripto, 1 pedido |
| 10,8 s | `[SIN_CONTENIDO]` | transcripto, 1 pedido |
| 1,1 s | `[SIN_CONTENIDO]` | «Che, hola.» o vacío (descarta un invento de 200 caracteres) |
| 5 que ya andaban | ok | ok, 1 pedido, mismo contenido |
| silencio digital 3 s | — | vacío sin llamar al proveedor |
| ruido 3 s | — | vacío (2 pedidos) |

## Self-test local (mocks, 15-oct-2026)

`WA_MOCK_ENABLED=true`, wa-mock + ai-mock en el puerto 3041, base aparte.

1. Entrante `audio` → `ready`, `text` = transcripción del mock, el agente
   contesta la consulta («¿Para qué fechas lo estás buscando?…»). ✅
2. Entrante `audio` con `mediaId=mediamock_audio_empty_1` → `failed`, «No se
   pudo transcribir el audio», el agente pide que lo escriban, y el log dice
   `[medios] transcripción empty de msg_… (audio/flac, 64 B): audio sin habla
   reconocible (respuestas: 2 sin voz)`. ✅
3. Entrenador: nota de voz WAV del dueño → `ready` con la transcripción y el
   agente aplica el cambio. ✅

Gate: `tsc`, `eslint`, `next build` y vitest 167 archivos / 1.737 tests.
