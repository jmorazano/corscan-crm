# Feature Specification: El agente ve y escucha — notas de voz e imágenes entrantes

**Feature Branch**: `020-inbound-media`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Análisis de la base de conocimiento del agente anterior del cliente
«Altos de Calamuchita» (carpeta `giuliana_agent`, 17 días de conversaciones
reales). Dos huecos bloqueantes para portar ese agente a Vocero:

1. Una parte grande de los huéspedes consulta **por nota de voz** («Juliana,
   ¿me podrías decir qué tenés disponible para 10 personas del 7 al 9 de
   octubre?»). Hoy Vocero guarda el mensaje con `text = null`, el agente lo
   filtra del historial y **queda mudo**: el cliente escribe y nadie
   contesta.
2. Los huéspedes mandan **comprobantes de pago** por foto. Hoy la imagen no
   se descarga ni se guarda: ni el agente ni la persona del equipo pueden
   verla. En la bandeja aparece un clip que dice «Imagen» y nada más.

Decisión del dueño (23-sep-2026): las imágenes **las mira la IA** (modelo
multimodal), no solo se guardan.

Extiende 001 (ingesta), 015 (notas de voz del entrenador) y 011 (agente
paciente). Sin cambios de constitución: el audio y la imagen viajan al
**mismo** proveedor LLM OpenRouter-compatible que ya usa el entrenador
(categoría 2), y el binario se guarda en Postgres propio (ningún S3).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El huésped consulta por nota de voz (Priority: P1)

Como huésped mando un audio preguntando disponibilidad y el agente me
responde como si lo hubiera escrito. Como dueño, en la bandeja veo el
reproductor y debajo la transcripción, igual que en el entrenador.

**Acceptance Scenarios**:

1. **Given** una conversación con el agente encendido, **When** entra un
   mensaje `audio`, **Then** el mensaje aparece en la bandeja con el
   reproductor y el cartel «Transcribiendo…», y el agente **todavía no**
   responde.
2. **Given** ese audio, **When** la transcripción termina, **Then** el texto
   aparece bajo el reproductor, el agente corre su turno con ese texto y
   responde en el hilo.
3. **Given** un audio que el proveedor no puede transcribir, **When**
   termina el intento, **Then** la bandeja muestra el motivo y el agente
   corre igual y le pide al huésped que lo escriba (nunca queda mudo).
4. **Given** una nota de voz, **When** el operador la abre en el iPhone,
   **Then** se reproduce (el binario responde `Range`).
5. **Given** un audio de una conversación del Laboratorio (`is_test`),
   **When** se ingesta, **Then** no se descarga nada de Meta.

### User Story 2 - El huésped manda un comprobante de pago (Priority: P1)

Como huésped mando la foto de la transferencia y el agente me confirma que
la recibió y me explica el paso siguiente, sin repetir mis datos bancarios.
Como dueño, **veo la foto** en la bandeja para poder verificar el pago.

**Acceptance Scenarios**:

1. **Given** una conversación, **When** entra un mensaje `image`, **Then**
   la bandeja muestra la miniatura y al tocarla se ve en grande.
2. **Given** esa imagen, **When** la IA la describe, **Then** el agente
   recibe esa descripción como contexto y puede acusar recibo con sentido
   («recibí el comprobante»), no un acuse genérico.
3. **Given** una imagen con epígrafe (`caption`), **When** se ingesta,
   **Then** el epígrafe se guarda como texto real del cliente y se
   distingue visualmente de la descripción generada por la IA.
4. **Given** un comprobante, **When** el agente responde, **Then** NO
   repite CBU, alias, importe ni titular en su mensaje.
5. **Given** que la descripción falla, **When** termina el intento,
   **Then** el agente corre igual sabiendo que llegó una imagen.

### User Story 3 - El resto de los adjuntos no deja mudo al agente (Priority: P2)

Como huésped mando un video, un documento o un sticker y el agente responde
algo razonable en vez de ignorarme.

**Acceptance Scenarios**:

1. **Given** un mensaje `video`, `document` o `sticker`, **When** se
   ingesta, **Then** el agente corre su turno sabiendo qué tipo de adjunto
   llegó (sin descargarlo) y responde o escala.
2. **Given** un `document` con nombre de archivo, **When** se ingesta,
   **Then** el nombre queda visible en la bandeja.

### Edge Cases

- **Idempotencia**: el mismo `wa_message_id` dos veces descarga y transcribe
  **una sola vez** (gate de dedup existente).
- **Archivo demasiado grande**: por encima del tope no se descarga; el
  mensaje queda `failed` con motivo y el agente corre igual.
- **Medio vencido en Meta**: la URL de descarga caduca; un 404/410 es un
  fallo normal, no un error de la app.
- **BAJA por voz**: el corte de opt-out mira el texto en la ingesta, cuando
  la transcripción todavía no existe. Se re-evalúa con la transcripción.
- **Ventana de 24 h**: si venció mientras se transcribía, el turno degrada a
  handoff como hoy.
- **Ráfaga**: tres audios seguidos = tres transcripciones, un solo turno (el
  debounce de 011 ya los junta).
- **Sin IA configurada**: el medio se descarga y se muestra igual en la
  bandeja; no hay transcripción ni descripción.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La ingesta DEBE guardar el `media_id`, el `mime_type` y el
  `caption` que trae el webhook para los tipos con adjunto.
- **FR-002**: El sistema DEBE descargar de Meta los adjuntos de tipo `audio`
  e `image` y guardarlos en `message_media` (Postgres), en segundo plano.
- **FR-003**: La descarga DEBE validar que el host de la URL que devuelve
  Meta pertenece a una allowlist; una URL de otro host se rechaza.
- **FR-004**: El audio entrante DEBE transcribirse con el modelo multimodal
  de la empresa; la transcripción se guarda como `text` del mensaje.
- **FR-005**: La imagen entrante DEBE describirse en una línea con el mismo
  modelo; la descripción se guarda en `media_summary`, SEPARADA del texto
  real del cliente.
- **FR-006**: El turno del agente NO DEBE dispararse hasta que el adjunto
  esté resuelto (listo o fallido).
- **FR-007**: Un fallo de descarga, transcripción o descripción NUNCA deja
  mudo al agente: el turno corre con un marcador que dice qué llegó.
- **FR-008**: La bandeja DEBE mostrar el reproductor y la transcripción de
  un audio entrante, y la imagen de una foto entrante.
- **FR-009**: El agente NO DEBE repetir datos sensibles de un comprobante
  (CBU, alias, importe, titular) en su respuesta.
- **FR-010**: Las conversaciones `is_test` JAMÁS descargan de Meta.
- **FR-011**: El estado del adjunto DEBE vivir en su propio campo, sin
  pisar el estado de entrega del mensaje.
- **FR-012**: El tope de bytes por adjunto DEBE ser explícito y configurado
  en un módulo puro, testeable sin red.

### Key Entities

- **message**: campos nuevos `media_state` (`pending|ready|failed`, NULL
  cuando no hay adjunto que procesar) y `media_summary` (descripción
  generada por IA; NULL para audio, cuya transcripción va en `text`).
- **message_media**: sin cambios de forma. Deja de ser exclusiva del
  entrenador: ahora también guarda adjuntos entrantes de WhatsApp.

## Success Criteria *(mandatory)*

- **SC-001**: Un huésped manda una nota de voz y recibe una respuesta del
  agente coherente con lo que dijo, sin intervención humana.
- **SC-002**: Un huésped manda un comprobante y recibe el acuse correcto; el
  dueño abre la bandeja y **ve la foto**.
- **SC-003**: Ningún camino infeliz (audio ilegible, imagen enorme, medio
  vencido, proveedor caído) deja al agente sin responder.
- **SC-004**: El gate técnico queda verde y el guion E2E de la historia se
  conduce entero con mocks.

## Out of Scope

- Enviar audio o imágenes DESDE el CRM hacia el huésped.
- Descargar videos y documentos (solo se reconoce que llegaron).
- OCR estructurado del comprobante (importe, CBU) ni conciliación de pagos.
- Enriquecer el condensado del conector MCP (barrio, `details`,
  descripción), ocultar precios y guardar el nombre del huésped: van en la
  feature siguiente.
