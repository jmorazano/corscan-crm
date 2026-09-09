# Feature Specification: Plantillas con imagen de encabezado

**Feature Branch**: `008-template-images`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Plantillas con imagen de encabezado (feature 008): las plantillas de WhatsApp del CRM pueden llevar una imagen de encabezado opcional, de punta a punta — alta con imagen enviada a revisión, almacenamiento soberano en la propia instancia, envío con la imagen en campañas y 1:1, y miniaturas en los previews."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear una plantilla con imagen (Priority: P1)

Como operador de una empresa, al crear una plantilla en Ajustes → Plantillas
puedo adjuntar una imagen de encabezado opcional (JPEG o PNG, hasta 5MB).
La plantilla se envía a revisión del canal **con esa imagen como ejemplo**,
para que el revisor vea el mensaje tal como lo recibirá el cliente. Las
plantillas de solo texto se siguen creando exactamente igual que hoy.

**Why this priority**: Sin el alta con imagen no existe nada que aprobar ni
enviar: es la puerta de entrada de toda la feature. Además el pedido concreto
del dueño es una versión con imagen de su plantilla de campaña.

**Independent Test**: Crear una plantilla adjuntando una imagen válida y
verificar que queda registrada "pendiente de aprobación" con su imagen
visible en el listado; crear otra sin imagen y verificar que nada cambió para
el flujo de texto.

**Acceptance Scenarios**:

1. **Given** una empresa con su número conectado, **When** el operador crea
   una plantilla con nombre, cuerpo e imagen JPEG válida, **Then** la
   plantilla queda "pendiente" en el listado con su miniatura visible y fue
   enviada a revisión del canal con la imagen de ejemplo.
2. **Given** el formulario de creación, **When** el operador adjunta un
   archivo que no es JPEG/PNG o pesa más de 5MB, **Then** ve un mensaje claro
   del problema y no se crea nada (ni plantilla ni imagen).
3. **Given** una caída del canal durante el alta, **When** el operador envía
   el formulario, **Then** ve un error claro y reintentable, y no queda
   ninguna plantilla fantasma ni imagen huérfana en el sistema.
4. **Given** una plantilla de solo texto, **When** se crea, **Then** el flujo
   es idéntico al actual (sin pasos nuevos obligatorios).

---

### User Story 2 - Enviar la plantilla con su imagen (Priority: P2)

Como operador, cuando una plantilla con imagen queda aprobada, **todo envío**
de esa plantilla — una campaña masiva o un envío 1:1 desde una conversación —
llega al destinatario con la imagen como encabezado del mensaje, sin ningún
paso extra: la imagen viaja siempre con la plantilla.

**Why this priority**: Es el valor final de la feature (el mensaje que ve el
cliente), pero depende de que exista el alta (US1) y de la aprobación del
canal.

**Independent Test**: Con una plantilla con imagen aprobada (vía el entorno
de pruebas), lanzar una campaña de prueba y hacer un envío 1:1, y verificar
que ambos mensajes salientes incluyen el encabezado de imagen con una
dirección accesible de la imagen.

**Acceptance Scenarios**:

1. **Given** una plantilla con imagen aprobada y una campaña que la usa,
   **When** la campaña corre, **Then** cada mensaje enviado incluye la imagen
   de encabezado además del cuerpo con sus variables.
2. **Given** la misma plantilla, **When** el operador la envía a una
   conversación con la ventana cerrada, **Then** el mensaje sale con la
   imagen de encabezado y el flujo de cupo/ventana se comporta igual que hoy.
3. **Given** una plantilla de solo texto aprobada, **When** se envía por
   cualquier camino, **Then** el mensaje es idéntico al comportamiento
   actual (sin encabezado).
4. **Given** una conversación de prueba del Laboratorio, **When** se intenta
   un envío real, **Then** el guardrail del sandbox lo sigue bloqueando
   exactamente como hoy.

---

### User Story 3 - Reconocer la plantilla por su imagen (Priority: P3)

Como operador, veo la miniatura de la imagen en el editor de plantillas, en
el selector de plantillas al armar una campaña y en el envío de plantilla
desde una conversación, para reconocer de un vistazo qué va a recibir el
cliente.

**Why this priority**: Es pulido de usabilidad: la feature funciona sin las
miniaturas, pero elegir una plantilla "a ciegas" invita a errores de envío
masivo.

**Independent Test**: Con una plantilla con imagen creada, recorrer el
listado de plantillas, el armado de campaña y el diálogo de envío 1:1 y
verificar que la miniatura aparece en los tres; una plantilla sin imagen
muestra el preview actual sin huecos.

**Acceptance Scenarios**:

1. **Given** una plantilla con imagen, **When** el operador abre el listado
   de plantillas, **Then** ve la miniatura junto al cuerpo.
2. **Given** el armado de una campaña, **When** el operador elige esa
   plantilla, **Then** el preview del mensaje muestra la imagen arriba del
   texto.
3. **Given** una plantilla sin imagen, **When** aparece en cualquier
   preview, **Then** se ve exactamente como hoy.

---

### Edge Cases

- Archivo con extensión de imagen pero contenido corrupto o de otro tipo →
  rechazo con mensaje claro antes de crear nada.
- Caída del canal a mitad del alta (después de subir la imagen de ejemplo,
  antes de registrar la plantilla) → nada queda a medias: sin plantilla
  fantasma ni imagen huérfana.
- Borrado de una plantilla con imagen → su imagen se elimina con ella (no
  quedan imágenes huérfanas accesibles).
- El borrado bloqueado por campañas activas se comporta igual que hoy (la
  imagen no se toca si la plantilla no se borra).
- La dirección pública de una imagen es imposible de adivinar, pero es
  pública sin login: necesario para que el canal la adjunte en cada envío.
  Nunca expone datos de contactos ni de la empresa más allá de la imagen que
  el propio operador eligió difundir de forma masiva.
- Dos empresas del mismo CRM crean plantillas con imagen → cada una ve y usa
  solo las suyas.
- La plantilla aprobada existente (`introduccin_servicio_lidar`) no se
  modifica: editarla la devolvería a revisión y bloquearía la campaña lista.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El formulario de creación de plantillas MUST aceptar una imagen
  de encabezado opcional en formato JPEG o PNG de hasta 5MB.
- **FR-002**: El sistema MUST validar tipo y peso del archivo y rechazarlo
  con un mensaje claro sin crear plantilla ni almacenar imagen.
- **FR-003**: Una plantilla creada con imagen MUST llegar a la revisión del
  canal con esa imagen como ejemplo del encabezado.
- **FR-004**: La imagen MUST almacenarse en la propia instancia, asociada
  uno-a-uno a su plantilla, sin depender de servicios de almacenamiento
  externos (constitución II).
- **FR-005**: Cada imagen MUST ser accesible por una dirección pública con
  identificador no adivinable, requisito del canal para adjuntarla en cada
  envío.
- **FR-006**: Todo envío de una plantilla con imagen — campaña o 1:1 — MUST
  incluir la imagen como encabezado, por el mismo camino único de envío
  existente (sin lógica duplicada).
- **FR-007**: El editor de plantillas, el selector de campañas y el envío
  desde conversación MUST mostrar la miniatura del encabezado cuando exista.
- **FR-008**: Borrar una plantilla MUST eliminar también su imagen; ningún
  fallo del canal durante el alta puede dejar plantilla fantasma ni imagen
  huérfana.
- **FR-009**: Las plantillas de solo texto MUST conservar su flujo actual de
  alta, aprobación y envío sin cambios observables.
- **FR-010**: La plantilla aprobada existente MUST permanecer intacta; la
  imagen es capacidad de plantillas nuevas.
- **FR-011**: Toda imagen y plantilla MUST estar aislada por empresa
  (multi-tenancy, constitución III).
- **FR-012**: Las conversaciones de prueba del Laboratorio MUST seguir sin
  tocar el canal real (guardrail del sandbox intacto).

### Key Entities

- **Plantilla**: gana un encabezado de imagen opcional; conserva nombre,
  idioma, categoría, cuerpo, estado de revisión y motivo de rechazo.
- **Imagen de plantilla**: archivo binario (JPEG/PNG ≤5MB) con tipo y tamaño,
  vinculado uno-a-uno a una plantilla de una empresa, direccionable por un
  identificador público no adivinable; su ciclo de vida sigue al de la
  plantilla.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un operador crea una plantilla con imagen en menos de 2
  minutos y la ve "pendiente" con su miniatura en el listado.
- **SC-002**: El 100% de los envíos de una plantilla con imagen (campaña y
  1:1, verificados en el entorno de pruebas de punta a punta) incluyen el
  encabezado de imagen.
- **SC-003**: El 100% de los archivos inválidos (tipo o peso) se rechazan
  con mensaje claro y cero registros creados.
- **SC-004**: Una caída del canal durante el alta deja cero plantillas
  fantasma y cero imágenes huérfanas.
- **SC-005**: Los flujos existentes de plantillas de texto (alta, envío por
  campaña, envío 1:1, sincronización de estado) pasan el self-test E2E sin
  regresiones.

## Assumptions

- Una plantilla tiene **una** imagen fija: todos los destinatarios reciben la
  misma (imagen variable por envío queda fuera de v1).
- Solo encabezado de **imagen** (JPEG/PNG): video y documento quedan fuera de
  v1.
- El límite de 5MB viene del canal; la validación local usa ese tope.
- La instancia ya expone una URL base pública (requisito existente del
  producto para webhooks), por lo que servir la imagen no agrega requisitos
  de infraestructura.
- La aprobación de la plantilla con imagen la decide el canal con sus plazos
  habituales; el CRM ya refleja ese estado automáticamente.
- El dueño creará una "versión 2 con imagen" de su plantilla de campaña
  cuando la feature esté en producción; la v1 aprobada sigue disponible.
