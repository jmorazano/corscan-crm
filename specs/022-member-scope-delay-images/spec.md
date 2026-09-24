# Feature Specification: Miembros sin configuración, espera del agente por empresa e imágenes en el Entrenador

**Feature Branch**: `022-member-scope-delay-images`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Tres pedidos del dueño (24-sep-2026):

1. Ocultar Integraciones y la configuración al rol «miembro» para que no
   cometan errores.
2. La espera del agente antes de responder (hoy `AGENT_COALESCE_MS` de
   instancia, 20 s por defecto) tiene que ser configurable POR EMPRESA: al
   dueño de una empresa le parece que el agente tarda; el valor alto existe
   para no interrumpir a quien escribe en ráfaga.
3. En la conversación del Entrenador no se puede adjuntar una imagen. Tiene
   que ser posible y la tiene que analizar un modelo multimodal, elegible
   en Ajustes → Inteligencia artificial si hace falta.

Extiende 003 (roles owner/member), 011 (agente paciente), 015 (Entrenador)
y 020 (visión sobre imágenes). Sin cambios de constitución: no entra
ninguna dependencia nueva (la visión usa el mismo proveedor OpenRouter).

## Decisiones tomadas (defaults sensatos, revisables)

- **Qué es «configuración» para un miembro**: Agente (perfil + conocimiento),
  Laboratorio, Integraciones y todas las pestañas de Ajustes salvo
  Notificaciones (por dispositivo) y Mi contraseña (personal). El
  Entrenador de la Bandeja TAMBIÉN es configuración (modifica el
  conocimiento del agente) y queda solo para el propietario.
- **La guarda es server-side**: página → redirección a la Bandeja; API de
  escritura → 403 `forbidden`. Esconder del menú es solo la primera capa.
- **Las lecturas siguen abiertas** a los miembros donde la operación las
  necesita (listar plantillas para enviarlas, ver el perfil del agente en el
  panel, saber si la IA está configurada).
- **La espera vive en el perfil del agente** (`agent_profile.reply_delay_ms`,
  NULL = default de instancia), se edita en segundos en la página Agente y
  acota 0–120 s. El Laboratorio no la usa (sigue inmediato).
- **Modelo de visión aparte** (`ai_credentials.vision_model`, NULL = default
  de producto `google/gemini-2.5-flash`). Lo usan las imágenes del
  Entrenador Y las imágenes entrantes de clientes (020), que hasta hoy
  tomaban prestado el modelo de transcripción.
- **La imagen del dueño se LEE en detalle** (texto transcripto + descripción,
  hasta ~3.000 caracteres) porque es material para aprender: precios,
  listas, fotos de productos. A diferencia de 020, acá NO se ocultan
  importes: los mandó el dueño para que el agente los sepa.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un miembro del equipo solo ve lo operativo (Priority: P1)

Como miembro atiendo la Bandeja, muevo leads, cargo contactos y sigo
campañas. No veo Agente, Laboratorio, Integraciones ni Ajustes (salvo mis
notificaciones y mi contraseña), y si pego una URL de esas secciones me
lleva a la Bandeja.

**Acceptance Scenarios**:

1. **Given** sesión de un `member`, **When** abre la app, **Then** la barra
   lateral (escritorio) y la hoja «Más» (móvil) muestran Bandeja, Pipeline,
   Contactos, Campañas, Notificaciones y Mi contraseña, y nada más.
2. **Given** un `member`, **When** navega a `/agent`, `/lab`,
   `/integrations`, `/integrations/google-calendar`, `/settings/whatsapp`,
   `/settings/ai`, `/settings/team` (etc.), **Then** termina en `/inbox`.
3. **Given** un `member`, **When** abre `/settings`, **Then** cae en
   Notificaciones y la navegación de Ajustes muestra solo Notificaciones y
   Mi contraseña.
4. **Given** un `member`, **When** llama a `PUT /api/agent/profile`,
   `POST /api/kb`, `POST /api/templates`, `PUT /api/settings/sending`,
   `PUT /api/settings/whatsapp`, `POST /api/lab/runs` (y el resto de
   escrituras de configuración), **Then** recibe 403 `forbidden`.
5. **Given** un `member`, **When** lista `GET /api/conversations`, **Then**
   `trainer` es `null`; escribirle a la conversación del entrenador → 403.
6. **Given** un `owner`, **When** hace todo lo anterior, **Then** nada
   cambia respecto de hoy.

### User Story 2 - El dueño elige cuánto espera su agente (Priority: P1)

Como dueño configuro que mi agente responda a los 5 segundos (o al
instante), sabiendo que un valor bajo puede interrumpir a quien escribe en
varios mensajes.

**Acceptance Scenarios**:

1. **Given** la página Agente, **When** guardo «Espera antes de responder»
   en 5 s, **Then** un cliente que escribe un mensaje recibe la respuesta
   ~5 s después; dos mensajes con 2 s de diferencia reciben UNA respuesta
   ~5 s después del segundo.
2. **Given** el campo vacío, **Then** rige el default de la instancia y la
   página lo muestra («por defecto: 20 s»).
3. **Given** un valor fuera de rango (negativo, > 120 s, no entero),
   **Then** la API devuelve 422 y la UI no lo deja guardar.
4. **Given** el Laboratorio, **Then** sigue corriendo sin espera.

### User Story 3 - El dueño le manda una imagen a su agente (Priority: P1)

Como dueño le adjunto al Entrenador la foto de mi lista de precios (o la
pego, o la arrastro) y el agente la lee y guarda lo que aprende.

**Acceptance Scenarios**:

1. **Given** el hilo del Entrenador, **When** adjunto un JPEG, **Then**
   aparece a la derecha con miniatura y «Leyendo la imagen…», luego lo que
   leyó, y el agente responde con los cambios aplicados (p. ej. una P/R
   nueva con el precio de la foto).
2. **Given** una imagen con epígrafe (texto en el composer al adjuntar),
   **Then** el epígrafe viaja con la imagen y el agente lo lee junto con
   ella.
3. **Given** una imagen que el modelo no entiende, **Then** el mensaje
   queda «No se pudo leer la imagen» y el agente igual responde (pide que
   se lo cuenten por texto); nunca queda mudo.
4. **Given** un archivo que no es JPEG/PNG/WebP, o supera 5 MB, **Then**
   la subida se rechaza con motivo claro antes de llegar al modelo.
5. **Given** una conversación de WhatsApp real, **Then** el adjunto de
   imagen NO está disponible (409 por API; sin botón en la UI).
6. **Given** Ajustes → IA, **When** cargo «Modelo de visión», **Then** las
   imágenes del Entrenador y las de los clientes se leen con ese modelo;
   vacío usa el default de producto.
7. **Given** la IA apagada, **Then** la subida responde 409
   `ai_not_configured`.

## Requirements *(mandatory)*

- **FR-001** Función pura `canManageConfig(role)` (owner) y navegación
  derivada del rol, compartida por sidebar, hoja «Más» y Ajustes.
- **FR-002** Guarda server-side de páginas: las rutas de configuración
  redirigen a `/inbox` para `member`.
- **FR-003** Guarda de API: `withOwner` (403 `forbidden`) en toda escritura
  de configuración; las lecturas operativas siguen con `withAuth`.
- **FR-004** El Entrenador (fila, alta lazy, mensajes, cambios) es solo
  para `owner`.
- **FR-005** `agent_profile.reply_delay_ms` (0–120000, NULL = default de
  instancia) editable por `PUT /api/agent/profile`; `GET` devuelve además
  `defaultReplyDelayMs`.
- **FR-006** El debounce del agente usa la espera de la empresa (también al
  re-esperar tras un turno). La espera se resuelve al agendar el turno.
- **FR-007** `ai_credentials.vision_model` (NULL = default) en
  `GET/PUT /api/settings/ai` y en la tarjeta de Ajustes; `describeImage`
  (020) y la lectura del Entrenador usan ese modelo.
- **FR-008** `POST /api/conversations/[id]/messages/image` multipart
  (`file`, `caption?`), solo `trainer`, IA configurada, 5 MB, firma binaria
  JPEG/PNG/WebP; el mensaje nace `media_state=pending`, la lectura llega
  por SSE `message.updated`.
- **FR-009** La lectura de la imagen entra al turno del Entrenador como
  DATO con marcador `[IMAGEN]` (nunca instrucción); una lectura fallida
  también produce una línea, para que el agente nunca calle.
- **FR-010** Un adjunto que termina de leerse DESPUÉS de que el turno cubrió
  mensajes posteriores igual dispara un turno (marca de cobertura forzada;
  arregla el mismo agujero para las notas de voz de 015).
- **FR-011** Composer del Entrenador: clip visible en móvil y escritorio,
  acepta audio e imagen, y admite pegar/arrastrar imágenes.
- **FR-012** ai-mock: lectura fija ante una imagen del Entrenador (marcador
  propio), `[SIN_CONTENIDO]` ante PNG para el camino infeliz.

## Fuera de alcance

- Roles intermedios (admin) o permisos granulares.
- Imágenes hacia clientes de WhatsApp (salientes) o en conversaciones
  reales.
- Cambiar la espera desde el propio Entrenador por chat.
