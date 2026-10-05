# Feature Specification: Instagram que vende — comentarios, botones y primer contacto

**Feature Branch**: `030-instagram-growth`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Pedido del dueño (5-oct-2026). Un cliente (Altos de Calamuchita)
usaba ManyChat para «comentá ALGO y te mando el link por DM». Al conectar el
CRM a su Instagram, ManyChat dejó de funcionar; el dueño desconectó el CRM y
ManyChat volvió. Pidió averiguar la causa, ofrecer la misma función desde el
CRM y sumar las funciones más útiles y conocidas de ManyChat. Aprobó la
feature completa («arrancá con la feature y agregá el permiso») y que se
actualice el guion del video del App Review.

Extiende 023 (Instagram Direct), 020/026 (adjuntos), 011 (agente paciente) y
021 (nombre del huésped). Enmienda la constitución a **1.10.0** (Principio
VIII y condición II.1(i): comentarios de las publicaciones propias). Sin
dependencias nuevas: el QR se dibuja con un codificador propio.

## Diagnóstico (5-oct-2026)

Desde el 23-oct-2025 toda cuenta de Instagram está en **Conversation
Routing** de Meta: una sola app (la «predeterminada» o la que tomó el
control) recibe los mensajes en `entry[].messaging[]`; las demás los
reciben en `entry[].standby[]` y sus envíos fallan («another app is
controlling this thread», código 2018300; «not the thread owner», 2534037).
Con el CRM conectado, el CRM recibía por `messaging`: era el dueño de los
hilos. La primera respuesta privada de ManyChat salía (en producción se ven 5
envíos automáticos el 4-oct a las 22:25–22:38 como ecos «share» vacíos),
pero la respuesta de la persona le llegaba al CRM y contestaba nuestro
agente: el flujo de ManyChat quedaba cortado. Con Instagram Login no existe
pasar/tomar el control por API. Conclusión: no hay convivencia real de dos
contestadores automáticos; el CRM tiene que hacer lo que hacía ManyChat.

Estado de Meta: `instagram_business_basic` y `instagram_business_manage_messages`
con acceso ESTÁNDAR (la solicitud de App Review de Instagram nunca se envió;
45 y 37 llamadas registradas). `instagram_business_manage_comments` agregado
al caso de uso el 5-oct (Ready for testing). Los webhooks `comments` y
`live_comments` SOLO llegan con acceso AVANZADO; la lectura de comentarios
por API sí funciona con acceso estándar para cuentas con rol en la app.

## Historias de usuario

### US1 — Comentario → DM (P1, reemplaza a ManyChat)

El dueño crea en **Ajustes → Instagram → Comentarios** una regla: en qué
publicaciones (las que elige de una grilla de las últimas, todas las
publicaciones, o los vivos), qué palabras clave (vacío = cualquier
comentario), el DM que se manda, un botón opcional («Quiero el link»), un
mensaje de seguimiento opcional que sale cuando la persona responde (el link)
y respuestas públicas opcionales («¡Te escribimos por DM! 📩»).

Cuando alguien comenta con la palabra en esa publicación: le llega el DM
(respuesta privada oficial de Instagram), el comentario recibe la respuesta
pública si se configuró, y en la Bandeja aparece la conversación con una
nota «Comentó en tu publicación…» seguida del DM enviado. Si la persona
responde, sale el seguimiento (si hay) y después atiende el agente, sabiendo
qué comentó y en qué publicación.

**Aceptación**:
1. Comentario «ALGO» en la publicación elegida → 1 DM (outbox) + respuesta
   pública + conversación nueva con la nota del comentario y el DM, sin no
   leídos del agente y sin abrir la ventana de 24 h.
2. La misma persona vuelve a comentar en la misma publicación → no recibe
   otro DM (una vez por persona, publicación y regla).
3. Comentario sin la palabra, respuesta a otro comentario o comentario de la
   propia cuenta → nada.
4. La persona responde el DM → sale el seguimiento y el agente NO contesta
   encima; su siguiente mensaje lo atiende el agente con el contexto.
5. El mismo comentario llega dos veces (webhook + consulta, o reintento de
   Meta) → un solo DM (idempotencia por `comment_id` POR TENANT).
6. Instagram rechaza la respuesta privada (comentario de más de 7 días,
   otra app maneja el hilo, Meta caído) → el evento queda «falló» con el
   motivo en castellano; nada se cuelga ni se reintenta en loop.
7. Sin el permiso de comentarios (cuenta conectada antes de 030) → la
   sección explica «Reconectá la cuenta para habilitar los comentarios».
8. Mientras Meta no habilite el webhook de comentarios (acceso estándar), el
   CRM consulta los comentarios de las publicaciones con reglas cada minuto;
   cuando llegan por webhook, la consulta baja a cada 15 minutos.

### US2 — Moderación de comentarios (P2)

Lista de palabras: un comentario que las contenga se **oculta** solo
(queda visible para quien lo escribió, no para el resto). En la actividad
reciente se ve cada comentario procesado (respondido, ocultado, ignorado,
falló) con «Ocultar» / «Mostrar» a mano.

### US3 — Botones, tarjetas y respuestas rápidas del agente (P1)

En Instagram el agente puede acompañar su respuesta con hasta 3 **botones
de enlace** («Ver la cabaña» → URL), un **carrusel** de hasta 10 tarjetas
(título, subtítulo, enlace, imagen opcional) y hasta 4 **respuestas
rápidas** (incluidas las de «mi email» / «mi teléfono» que Instagram
precarga). Los enlaces e imágenes solo salen si aparecen tal cual en lo que
el agente tuvo delante en el turno (conocimiento, herramientas,
conversación): un enlace inventado no sale. Si Instagram rechaza el formato,
se manda el texto con los enlaces. En la Bandeja se ven los botones y las
respuestas rápidas debajo del mensaje.

### US4 — Primer contacto: preguntas frecuentes y menú (P2)

En **Ajustes → Instagram → Primer contacto**: hasta 4 preguntas que
Instagram sugiere al abrir un chat nuevo (ice breakers) y un menú fijo de
hasta 5 opciones: «Pregunta» (el agente la responde), «Enlace» (abre una
web) o «Hablar con una persona» (pasa la conversación al equipo). Se guarda
en Instagram al apretar «Guardar» y se vuelve a aplicar al reconectar.

### US5 — Links con origen, QR y anuncios (P2)

En **Ajustes → Instagram → Links con origen**: links `ig.me/<cuenta>?ref=…`
con nombre («Flyer cabañas») e instrucción opcional para el agente («ofrecé
el 10% de primavera»), con botón copiar y **QR descargable** (SVG). La
conversación que llega por ese link queda marcada con su origen (etiqueta de
la conversación `ig-<slug>` y contexto del agente), y se cuenta cuántas
conversaciones trajo cada link. Lo mismo con los anuncios «Enviar mensaje»
de Instagram: etiqueta `ig-anuncio` y el título del anuncio como contexto.

### US6 — Historias (P1)

Respuesta a una historia y mención en una historia: la imagen de la historia
se baja (como un adjunto) y se describe; el agente sabe que la persona
respondió a la historia (o la mencionó) y qué se veía. En la Bandeja se ve
la historia junto al mensaje.

### US7 — Captura de email y teléfono (P2)

El agente guarda el email (los dos canales) y el teléfono (Instagram) que
la persona da en el chat, con la misma regla que el nombre (021): validado,
nunca pisa lo que cargó una persona del equipo. Se ve en la ficha del
contacto.

### US8 — Convivencia con otras apps (P1)

- Si otra app (ManyChat) maneja los hilos, los mensajes que llegan como
  `standby` se guardan igual en la Bandeja sin que el agente responda, y
  Ajustes → Instagram avisa: «Otra app maneja las conversaciones de esta
  cuenta» con cómo dejar al CRM como app principal (Meta Business Suite →
  Configuración → Integraciones → Conversation Routing).
- Los errores 2018300 / 2534037 se explican en castellano.
- Lo que manda otra app (tarjetas, botones) se ve en el hilo con su texto,
  no como una burbuja vacía.

## Requisitos funcionales

- **FR-001** El Business Login pide además `instagram_business_manage_comments`;
  se guardan los permisos concedidos y los campos suscriptos.
- **FR-002** La suscripción de la cuenta intenta `comments`, `live_comments`,
  `standby` y `messaging_handover` además de los de 023; si Meta rechaza la
  lista completa, cae a una más corta (nunca rompe la conexión).
- **FR-003** El webhook acepta los comentarios en `entry[].changes[]` y en
  `entry[].field/value` (formato de Business Login), y `entry[].standby[]`.
- **FR-004** Idempotencia: `instagram_comment_event` UNIQUE
  (organization_id, comment_id); el DM y la respuesta pública salen a lo sumo
  una vez por comentario (reserva primero, envío después).
- **FR-005** Una respuesta privada por persona + publicación + regla; tope de
  700 respuestas privadas por hora por cuenta (Meta: 750).
- **FR-006** La nota del comentario es un mensaje `in` tipo `comment` que NO
  abre la ventana de 24 h, NO suma no leídos y NO despierta al agente.
- **FR-007** El agente jamás escribe por su cuenta a quien solo comentó: el
  único envío previo a que la persona escriba es la respuesta privada.
- **FR-008** Botones/tarjetas/respuestas rápidas: solo Instagram, solo URLs
  presentes en el corpus del turno, títulos ≤20 (respuestas rápidas) / ≤20
  (botón) / ≤80 (tarjeta), y caída a texto plano si Meta rechaza.
- **FR-009** Ice breakers ≤4 (≤80 caracteres), menú ≤5 (título ≤30); el
  postback «hablar con una persona» escala sin pasar por el modelo.
- **FR-010** Links: slug `[a-z0-9-]{2,40}` único por empresa; `ref` es el
  slug; la referencia llega suelta, dentro de `message` o dentro de
  `postback`.
- **FR-011** Origen de la conversación (`conversation.ig_origin`): el último
  conocido (link, anuncio, comentario, historia); el agente lo recibe como
  DATO salvo la instrucción del link, que la escribió el dueño.
- **FR-012** Consulta de comentarios (respaldo del webhook): solo cuentas con
  el permiso y con reglas o moderación activas; solo publicaciones con
  reglas (o las 10 últimas si hay regla «todas» o moderación); solo
  comentarios posteriores a la regla y de menos de 7 días.
- **FR-013** Todo lo nuevo es por empresa (`organization_id` + `scoped()`),
  solo el propietario configura (`withOwner`), y el sandbox no toca nada.

## Fuera de alcance

Publicar contenido, métricas de la cuenta, difusiones o mensajes iniciados
por el negocio fuera de la respuesta privada, «seguime y te mando el link»
(zona gris de la política de Meta), like automático (no existe en la API),
constructor visual de flujos, respuestas públicas generadas por IA.

## Decisiones (defaults sensatos, revisables)

- **Consulta + webhook**: con acceso estándar el webhook de comentarios no
  llega; la consulta por minuto hace que la función sirva YA para cuentas con
  rol (Altos de Calamuchita) y para grabar el video del App Review.
- **Seguimiento determinístico** (no IA) para el «tocá el botón y te paso el
  link»: es lo que el negocio espera exactamente igual a ManyChat. Después,
  el agente.
- **El botón del DM es una respuesta rápida**: la doc de respuestas privadas
  solo muestra texto; si Instagram rechaza la respuesta rápida, se manda
  solo el texto.
- **Nota del comentario en el hilo**: el equipo ve qué disparó la
  conversación y el agente lo recibe como contexto (marcador `[COMENTARIO]`).
- **Mensajes `standby`**: se guardan (el equipo ve todo) pero el agente no
  responde: no puede, otra app tiene el hilo.
- **QR propio** (byte mode, corrección M, versiones 1–10): sin dependencias.
