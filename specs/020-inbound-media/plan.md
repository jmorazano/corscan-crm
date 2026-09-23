# Plan — 020 El agente ve y escucha

## Fronteras

| Pieza | Archivo |
|---|---|
| Descarga de medios de Meta (única frontera de salida) | `src/lib/meta/client.ts` (`fetchMediaHandle`, `downloadMediaBinary`) |
| Políticas puras del adjunto (qué se baja, topes, mime) | `src/lib/inbound-media.ts` |
| Orquestación en segundo plano | `src/server/inbox/media.ts` |
| Enganche en la ingesta | `src/server/inbox/ingest.ts` |
| Visión (descripción de imagen) | `src/lib/ai/index.ts` (`describeImage`) |
| Contexto del adjunto para el agente | `src/server/ai/pipeline.ts` + `src/lib/inbound-media.ts` |
| UI del hilo | `src/components/inbox/message-thread.tsx` |
| Mocks | `src/app/api/dev/wa-mock/graph/[...path]`, `src/app/api/dev/wa-mock/media`, `src/server/dev/ai-mock.ts` |

## Decisiones

### D1 — La descarga son DOS pedidos, y el segundo no va a la Graph API

`GET /{media-id}` devuelve `{url, mime_type, file_size, sha256}`; el binario
está en `lookaside.fbcdn.net`, fuera de `META_GRAPH_BASE_URL`. Consecuencias:

- El segundo pedido **no** puede pasar por `graphRequest` (arma la URL desde
  el base + versión). Se agrega `downloadMediaBinary(url, token)`.
- Meta exige un `User-Agent` en ese segundo pedido: sin él la CDN responde
  403. Se manda uno propio y fijo.
- `file_size` llega en el primer pedido: el tope se aplica **antes** de
  bajar el cuerpo, y otra vez sobre los bytes reales.

### D2 — Anti-SSRF: la URL viene de un payload externo

La URL sale de una respuesta de Meta, que a su vez sale de un webhook. Es un
dato externo que termina en un `fetch` del servidor: mismo riesgo que cerró
016. El host se valida contra una allowlist (`*.fbcdn.net`,
`lookaside.facebook.com`) y, solo con el gate de mocks activo, el host de
`META_GRAPH_BASE_URL`. Sin `https` o con otro host: se rechaza sin pedir.

### D3 — La transcripción va a `text`; la descripción NO

Una transcripción **es** lo que la persona dijo: va a `message.text`, igual
que en el entrenador (015). Así el agente, la búsqueda y la bandeja la ven
sin tocar nada más.

Una descripción de imagen la escribió la IA, no el cliente: mentiría
ponerla en `text`. Va a `media_summary`, campo nuevo. El epígrafe real de
WhatsApp (`caption`) sí va a `text`.

### D4 — El estado del adjunto no pisa el estado de entrega

015 usó `message.status` (`pending→delivered|failed`) para el estado de la
transcripción del entrenador. Para un mensaje ENTRANTE `status` ya significa
otra cosa (entrega) y lo leen el push, la bandeja y los ticks. Se agrega
`media_state` (`pending|ready|failed`, NULL = nada que procesar) y **se
migra también el entrenador**: con esto `status` vuelve a significar una
sola cosa en todo el repo.

### D5 — El turno del agente espera al adjunto

La ingesta de un mensaje con adjunto procesable **no** llama a
`maybeRunAgentTurn`: lo llama `processInboundMedia` cuando termina, en
cualquiera de los dos finales. Sin esto el agente contestaría el mensaje
anterior (hoy el historial filtra los mensajes sin texto) y la guarda de
duplicados de 011 lo dejaría mudo.

### D6 — Un fallo nunca deja mudo al agente

Todo final escribe algo que el pipeline pueda inyectar al historial:

- audio listo → `text` = transcripción.
- audio fallido → marcador `[ADJUNTO] nota de voz que no se pudo
  transcribir` → el agente pide que lo escriban.
- imagen lista → `media_summary` → marcador `[ADJUNTO] imagen: <resumen>`.
- video/documento/sticker → marcador con el tipo, sin descargar nada.

El marcador se arma en `src/lib/inbound-media.ts` (puro) y entra al
historial del pipeline como `role: "user"`, porque describe algo que hizo
el cliente. Se distingue del texto real con el prefijo `[ADJUNTO]`, mismo
patrón que `[HERRAMIENTA]` en 016: es DATO, nunca instrucción.

### D7 — La visión reusa el modelo de transcripción

`ai_credentials.transcription_model` (default `google/gemini-2.5-flash`) ya
es un modelo multimodal y acepta imágenes además de audio. Se reusa: cero
migración, cero campo nuevo en Ajustes. El comentario del campo pasa a decir
«modelo multimodal (audio e imagen)».

### D8 — El comprobante: describir sin transcribir los datos

El prompt de `describeImage` pide **una línea** que diga qué es, y prohíbe
explícitamente copiar CBU, alias, importes, titulares o números de
documento. Es la defensa de origen: si el dato nunca entra al contexto, el
agente no puede repetirlo. FR-009 se cumple por construcción, no por
instrucción al agente.

### D9 — La BAJA por voz

`onInboundSideEffects` corre en la ingesta, cuando la transcripción todavía
no existe. Se re-evalúa el opt-out con la transcripción antes de disparar el
turno: si el huésped dijo «baja» por audio, se marca y el agente calla.

### D10 — Topes

- Audio: 8 MB (mismo tope que la nota de voz del entrenador).
- Imagen: 5 MB (mismo tope que el encabezado de plantilla, 008).
- Por encima: no se descarga, `media_state='failed'` con motivo legible.

## Migración

`drizzle/0016_*.sql`: `ALTER TABLE message ADD COLUMN media_state text`,
`ADD COLUMN media_summary text`. Re-ejecutable. Los mensajes del entrenador
existentes conservan su `status`; la UI cae a `status` cuando `media_state`
es NULL y el mensaje es del entrenador (compatibilidad de una línea).

## Riesgos

- **Costo**: cada audio y cada imagen es una llamada al proveedor. Acotado:
  solo entrantes, solo dos tipos, con topes de bytes.
- **Privacidad**: los comprobantes de pago de los huéspedes viajan al
  proveedor LLM. Es la misma categoría 2 de la constitución que ya usan los
  audios del entrenador; la decisión la tomó el dueño el 23-sep-2026 y el
  prompt prohíbe extraer los datos sensibles.
- **Latencia**: transcribir suma segundos al primer turno. El debounce de
  011 (20 s) ya absorbe la espera sin que el cliente note nada raro.
