# Feature Specification: CRM móvil — usabilidad estilo WhatsApp

**Feature Branch**: `012-mobile-responsive`

**Created**: 2026-09-17

**Status**: Draft

**Input**: Pedido del dueño (17-sep-2026): «Quiero que hagamos el CRM
responsive a mobile. Trata de que tenga una usabilidad de primera calidad y
que se asemeje lo más posible a la app nativa de WhatsApp (gestos y shortcuts
incluidos) además de las funcionalidades propias del CRM. Necesitamos que los
usuarios puedan usarlo desde su celular.»

Estado de partida (relevado el 17-sep): la app se diseñó para escritorio.
El shell es `flex h-screen overflow-hidden` con un sidebar fijo de 224 px; en
Ajustes se suma otro rail de 176 px (400 px de cromo en un viewport de 375).
La bandeja es una grilla de tres columnas fijas (360 / flexible / 320). Hay
nueve modales artesanales sin scroll ni Escape, el pipeline solo tiene
`PointerSensor` (arrastrar y scrollear compiten en táctil), no existe
`viewport` ni manifest PWA, ningún control alcanza 44 px y los inputs de
14 px hacen zoom en iOS. Únicamente las páginas de auth caben en 375 px.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shell móvil instalable (Priority: P1)

Como operador que atiende desde el celular, abro el CRM en el navegador del
teléfono (o lo agrego a la pantalla de inicio) y encuentro una app que ocupa
toda la pantalla, sin barras laterales aplastando el contenido, con una barra
de pestañas inferior como WhatsApp (Bandeja con contador de no leídos,
Pipeline, Contactos, Campañas y «Más» para el resto), respetando las zonas
seguras del teléfono (notch, barra de gestos) y sin que el teclado rompa el
layout ni la página haga zoom al tocar un campo.

**Why this priority**: sin un shell que quepa en el teléfono, ninguna otra
pantalla es usable. Es el prerrequisito de todo lo demás.

**Independent Test**: abrir cualquier ruta autenticada en un viewport de
375×812; navegar entre secciones con la barra inferior; instalar como PWA
(manifest válido con nombre y color de la empresa); enfocar un input y
comprobar que no hay zoom ni scroll horizontal.

**Acceptance Scenarios**:

1. **Given** viewport < 768 px, **When** cargo `/inbox`, **Then** no hay
   sidebar; la barra inferior muestra Bandeja (badge con no leídos),
   Pipeline, Contactos, Campañas y Más; no existe scroll horizontal.
2. **Given** la barra inferior, **When** toco «Más», **Then** se abre una hoja
   inferior con Agente, Laboratorio, Integraciones, Ajustes, Administración
   (solo super admin), la identidad del usuario y Cerrar sesión.
3. **Given** viewport ≥ 768 px, **When** cargo cualquier ruta, **Then** el
   sidebar de escritorio se ve exactamente como hoy (cero regresión).
4. **Given** un teléfono con notch, **When** abro la app instalada, **Then**
   la barra inferior y el compositor no quedan bajo la barra de gestos
   (safe-area) y la barra de estado usa el color de la marca.
5. **Given** cualquier input o select, **When** lo enfoco en iOS, **Then** la
   página no hace zoom (tipografía ≥ 16 px en móvil).
6. **Given** la app, **When** pido `/manifest.webmanifest`, **Then** devuelve
   nombre, color e íconos de la marca de la empresa de la sesión (o los
   neutros de la instancia sin sesión) y `display: standalone`.

---

### User Story 2 - Bandeja estilo WhatsApp (Priority: P1)

Como operador, uso la bandeja en el celular igual que WhatsApp: una lista de
chats a pantalla completa; toco uno y se abre el hilo a pantalla completa
(la barra de pestañas se oculta); vuelvo con la flecha, con el botón atrás
del teléfono o deslizando desde el borde izquierdo; toco el nombre del
contacto en la cabecera y se abre su ficha (etapa, IA, etiquetas, notas,
borrar) a pantalla completa. En la lista, deslizo una fila hacia la izquierda
para ver acciones rápidas (marcar no leída / leída, más) y mantengo apretado
para entrar en modo selección (etiquetado en bloque). En el hilo, mantengo
apretado un mensaje para copiarlo, y al subir aparece el botón «bajar al
final» con contador de nuevos. En el compositor, escribo `/` para elegir una
respuesta rápida (plantilla aprobada) como en WhatsApp Business; Enter
inserta salto de línea en el celular (se envía con el botón) y sigue enviando
en escritorio. En escritorio, además, dispongo de atajos de teclado para
moverme entre chats sin el mouse.

**Why this priority**: la bandeja es el 80 % del uso diario y el pedido
explícito es que se sienta como WhatsApp.

**Independent Test**: en 375×812 abrir la bandeja, entrar a un hilo, enviar
un texto, abrir la ficha, volver con gesto/atrás, deslizar una fila, marcar
no leída, seleccionar varias con long-press y etiquetarlas, usar `/` en el
compositor. En escritorio, verificar que el layout de tres columnas no cambió
y que los atajos funcionan.

**Acceptance Scenarios**:

1. **Given** móvil y ninguna conversación abierta, **When** cargo `/inbox`,
   **Then** veo solo la lista (búsqueda, filtros, filas con área táctil ≥ 56
   px) y la barra de pestañas.
2. **Given** la lista, **When** toco una fila, **Then** el hilo ocupa toda la
   pantalla con cabecera (← / avatar / nombre / estado de ventana), la barra
   de pestañas desaparece, la URL lleva `?c=<id>` y el botón atrás del
   navegador vuelve a la lista.
3. **Given** el hilo abierto, **When** deslizo desde el borde izquierdo
   (< 32 px) más de 80 px hacia la derecha, **Then** vuelvo a la lista.
4. **Given** el hilo abierto, **When** toco el nombre del contacto, **Then**
   se abre la ficha (mismo contenido que el panel de escritorio) a pantalla
   completa con «←» y atrás del navegador la cierra.
5. **Given** una fila de la lista, **When** deslizo hacia la izquierda,
   **Then** aparecen las acciones «No leída»/«Leída» y «Más» (pausar/reanudar
   IA, abrir ficha, eliminar conversación con confirmación).
6. **Given** una fila, **When** la mantengo apretada ~450 ms, **Then** entro
   en modo selección con esa fila tildada y la barra de etiquetado en bloque.
7. **Given** una conversación leída, **When** la marco «No leída», **Then**
   su contador vuelve a mostrarse (≥ 1) en la lista y en el badge de Bandeja,
   y al abrirla se limpia.
8. **Given** el compositor con ventana abierta, **When** escribo `/`, **Then**
   se abre un selector de respuestas rápidas (plantillas aprobadas) filtrado
   por lo que sigo tecleando; tocar una la inserta con el nombre del contacto
   resuelto.
9. **Given** móvil, **When** presiono Enter en el compositor, **Then** se
   inserta un salto de línea y el envío es con el botón; en escritorio Enter
   envía y Shift+Enter hace salto.
10. **Given** un mensaje, **When** lo mantengo apretado, **Then** puedo
    copiar su texto.
11. **Given** que subí en el hilo, **When** llega un mensaje nuevo, **Then**
    no me arrastra abajo: aparece un botón flotante «↓» con el contador y
    tocarlo baja al final.
12. **Given** escritorio, **When** uso `Ctrl/⌘+K`, `Alt+↓/↑`, `Esc` y
    `Ctrl/⌘+Shift+U`, **Then** enfoco la búsqueda, cambio de chat, cierro
    ficha/deselecciono y marco no leída, respectivamente.
13. **Given** escritorio (≥ 768 px), **When** uso la bandeja, **Then** las
    tres columnas, el panel plegable y el comportamiento actual no cambian.

---

### User Story 3 - Pipeline táctil (Priority: P2)

Como operador, en el celular veo el pipeline como páginas horizontales (una
etapa por pantalla, con snap) y una tira de etapas arriba para saltar; muevo
un lead manteniéndolo apretado y arrastrándolo, o —más fiable— tocándolo y
eligiendo «Mover a…» en una hoja de acciones que también me lleva a la
conversación.

**Why this priority**: el pipeline es la segunda pantalla más usada y hoy es
inoperable en táctil (arrastrar y scrollear compiten).

**Independent Test**: en 375×812 abrir `/pipeline`, deslizar entre etapas,
tocar un lead y moverlo con «Mover a…», verificar que cambió de columna; en
escritorio el drag con mouse sigue igual.

**Acceptance Scenarios**:

1. **Given** móvil, **When** abro `/pipeline`, **Then** cada columna ocupa
   ~85 % del ancho con snap horizontal y una tira de etapas (con conteo)
   arriba; tocar una etapa desplaza a esa columna.
2. **Given** un lead, **When** lo toco, **Then** se abre una hoja con «Abrir
   conversación» y «Mover a <cada otra etapa>»; elegir una etapa lo mueve
   (mismo endpoint que el drag) y la columna destino lo muestra.
3. **Given** un lead, **When** lo mantengo apretado 250 ms y arrastro,
   **Then** se mueve con drag táctil sin que la página scrollee.
4. **Given** escritorio, **When** arrastro con mouse, **Then** funciona como
   hoy.

---

### User Story 4 - Resto del CRM operable en el celular (Priority: P2)

Como operador, contactos, campañas, ajustes, integraciones, agente,
laboratorio y administración caben en el teléfono: cabeceras que se apilan,
acciones por fila agrupadas en un menú «⋯», diálogos que se abren como hojas
inferiores con scroll y se cierran con Escape/atrás, tablas desplazables,
navegación de Ajustes como pestañas horizontales.

**Why this priority**: sin esto el operador debe volver a la computadora para
tareas frecuentes (crear contacto, lanzar campaña, cambiar una etiqueta).

**Independent Test**: en 375×812 recorrer cada ruta, abrir cada diálogo (nuevo
contacto, editar, importar, nueva campaña, confirmar, etapas del pipeline),
comprobar que se ve completo con scroll y sin desbordes horizontales; en
escritorio, cero cambios visuales relevantes.

**Acceptance Scenarios**:

1. **Given** móvil, **When** abro `/contacts`, **Then** título, búsqueda
   (ancho completo) y botones se apilan; cada fila muestra nombre/teléfono/
   etiquetas y un botón «⋯» con Editar, Abrir conversación, Plantilla,
   Archivar y Eliminar.
2. **Given** cualquier diálogo, **When** se abre en móvil, **Then** es una
   hoja inferior con asa, `max-h` 90 % y scroll interno; en escritorio es el
   modal centrado de siempre; Escape y el botón atrás lo cierran.
3. **Given** `/settings/*`, **When** lo abro en móvil, **Then** la navegación
   es una tira horizontal desplazable bajo el título y el contenido ocupa
   todo el ancho; los formularios se apilan en una columna.
4. **Given** `/campaigns`, **When** lo abro en móvil, **Then** las acciones
   de cada fila y del detalle se ven completas (envueltas) y la tabla de
   destinatarios se desplaza horizontalmente sin romper la página.
5. **Given** `/integrations/google-calendar`, **When** edito horarios en
   móvil, **Then** cada rango (día, desde, hasta, quitar) cabe en su fila.
6. **Given** el asistente de importación, **When** lo uso en móvil, **Then**
   estadísticas y tablas de vista previa se leen sin desborde.

---

### Edge Cases

- Rotación del teléfono: el corte es por ancho. Un teléfono angosto en
  horizontal (< 768 px, p. ej. 667×375) conserva el shell móvil; uno ancho
  (≥ 768 px, p. ej. 812×375) recibe el shell de escritorio (sidebar + tres
  columnas), que a esa altura sigue operable. En ambos casos el hilo +
  compositor caben con el teclado abierto (`100dvh`,
  `interactive-widget=resizes-content`, altura del visual viewport en iOS).
- Teclado virtual abierto en el hilo: el compositor permanece visible y la
  lista de mensajes conserva la posición.
- Back del navegador cuando no hay estado propio en el historial: sale de la
  bandeja (comportamiento estándar), nunca queda «atrapado».
- Deslizar una fila mientras la lista scrollea verticalmente: el gesto se
  descarta si el movimiento vertical supera al horizontal.
- Long-press que termina en scroll: no entra en selección.
- Enlace directo `/inbox?c=<id>` a una conversación que no está en la página
  cargada o fue borrada: abre por id; si no existe, vuelve a la lista sin
  colgarse.
- Marcar no leída una conversación abierta en otra pestaña: al abrirla se
  limpia; los eventos SSE mantienen ambas pestañas coherentes.
- Sin plantillas aprobadas: `/` no abre nada (y no bloquea el texto).
- Portapapeles no disponible (contexto inseguro): «Copiar» informa el fallo
  sin colgar.
- Escritorio angosto (768–1024): la bandeja conserva tres columnas pero el
  panel de detalles arranca cerrado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El shell autenticado MUST renderizar, bajo 768 px, una barra de
  pestañas inferior (Bandeja con badge, Pipeline, Contactos, Campañas, Más)
  y ocultar el sidebar; sobre 768 px el sidebar actual sin cambios.
- **FR-002**: La app MUST declarar `viewport` con `viewport-fit=cover`,
  `interactive-widget=resizes-content` y `theme-color` de la marca; MUST
  respetar `safe-area-inset-*` en barra inferior y compositor; MUST usar
  `100dvh` en lugar de `100vh`.
- **FR-003**: La app MUST servir `manifest.webmanifest` dinámico por marca
  (nombre, color, íconos PNG generados con la inicial y el acento) y los
  metadatos Apple (`apple-mobile-web-app-capable`, `apple-touch-icon`).
- **FR-004**: En móvil, inputs/selects/textarea MUST tener ≥ 16 px; botones
  e íconos accionables MUST tener ≥ 44 px de alto (44×44 los de ícono);
  checkboxes ≥ 18 px.
- **FR-005**: La bandeja MUST apilar lista → hilo → ficha bajo 768 px con
  navegación por historial (`?c=<id>` push en móvil; replace en escritorio
  para que refrescar conserve el hilo) y gesto de borde para volver.
- **FR-006**: Las filas MUST soportar deslizar-izquierda (acciones) y
  long-press (selección); el gesto se cancela ante scroll vertical.
- **FR-007**: `PATCH /api/conversations/[id]` MUST aceptar `markUnread`
  (deja `unreadCount ≥ 1`) y publicar `conversation.updated`.
- **FR-008**: El compositor MUST ofrecer respuestas rápidas con `/`
  (plantillas aprobadas, filtradas, variable `{{1}}` = nombre) y MUST enviar
  con Enter solo en escritorio.
- **FR-009**: El hilo MUST auto-desplazar solo si el usuario está al final;
  si no, MUST mostrar un botón flotante con contador de nuevos.
- **FR-010**: Mantener apretado un mensaje MUST ofrecer «Copiar texto».
- **FR-011**: En escritorio la bandeja MUST responder a `Ctrl/⌘+K` (buscar),
  `Alt+↓/↑` (siguiente/anterior), `Esc` (cerrar ficha / salir de selección)
  y `Ctrl/⌘+Shift+U` (marcar no leída).
- **FR-012**: El pipeline MUST usar sensores de mouse (distancia) y táctil
  (delay 250 ms) y ofrecer «Mover a…» por hoja de acciones; en móvil las
  columnas MUST paginarse con snap y una tira de etapas.
- **FR-013**: Todos los diálogos MUST usar un componente compartido: hoja
  inferior en móvil, modal centrado en escritorio, portal, scroll interno,
  cierre por Escape, backdrop y botón atrás; foco inicial dentro.
- **FR-014**: Contactos y campañas MUST agrupar las acciones por fila en un
  menú «⋯» bajo 768 px manteniendo el clúster visible en escritorio.
- **FR-015**: La navegación de Ajustes MUST ser una tira horizontal bajo
  768 px; las grillas `grid-cols-N` fijas MUST apilarse en móvil; las tablas
  MUST ir dentro de contenedores con scroll horizontal y ancho mínimo.
- **FR-016**: Nada de lo anterior MUST cambiar el comportamiento ni el
  aspecto de escritorio salvo las mejoras explícitas (URL `?c=`, atajos,
  botón «↓», respuestas rápidas con `/`, Escape en diálogos).
- **FR-017**: Todo gesto MUST tener alternativa por toque (botón atrás,
  menú «⋯», «Mover a…»): los gestos aceleran, no condicionan.

### Key Entities

- Sin cambios de esquema. `conversation.unread_count` pasa a poder
  incrementarse manualmente (`markUnread`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En 375×812 ninguna ruta autenticada produce scroll horizontal
  (`document.documentElement.scrollWidth <= innerWidth`).
- **SC-002**: El flujo abrir chat → responder → volver se completa en móvil
  solo con toques/gestos, en < 10 s, sin cambiar de zoom.
- **SC-003**: Lighthouse «Installable» verde (manifest + íconos + start_url).
- **SC-004**: En escritorio, capturas antes/después de bandeja, pipeline,
  contactos y campañas no muestran diferencias estructurales.
- **SC-005**: Gate técnico verde (typecheck, lint, build, tests) y guion E2E
  `tests/e2e/012-mobile.md` ejecutado en verde con viewport móvil y de
  escritorio.

## Assumptions

- Punto de corte móvil/escritorio: 768 px (breakpoint `md` de Tailwind).
  Tablets en vertical reciben el shell móvil; en horizontal el de escritorio.
- Barra inferior (patrón WhatsApp iOS / PWA moderna) en lugar de menú
  hamburguesa: cinco destinos máximos, el resto bajo «Más».
- Sin service worker ni modo offline en esta feature: la app es en tiempo
  real y un SW agrega riesgo de caché obsoleta tras cada deploy. La
  instalación (manifest + íconos) no lo requiere en Chrome/Android ni iOS.
- Notificaciones push quedan fuera (feature aparte: Web Push con VAPID
  propio, sin servicios externos).
- Reacciones, respuestas citadas y adjuntos salientes no existen en el CRM
  hoy; los gestos que en WhatsApp los disparan no se emulan.
- Los íconos PWA se generan en runtime con `ImageResponse` (incluido en
  Next), sin dependencias nuevas ni servicios externos (Principio II).
