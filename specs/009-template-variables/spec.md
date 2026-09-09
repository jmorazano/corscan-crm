# Feature Specification: Variables enriquecidas de plantillas

**Feature Branch**: `009-template-variables`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "El cuerpo de una plantilla admite hasta 5 variables {{1}}..{{5}}, cada una atada en la creación a un origen (nombre del contacto, teléfono, nombre de la empresa, o texto libre pedido al enviar); los orígenes automáticos se resuelven solos al enviar en campañas y 1:1. Alcance 'multi-variable simple' elegido por el dueño (campos personalizados quedan para una feature futura)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear una plantilla con varias variables con significado (Priority: P1)

Como operador, al crear una plantilla puedo usar hasta **5 variables** en el
cuerpo, y cada una queda atada a un **origen** que elijo en ese momento:
nombre del contacto, teléfono del contacto, nombre de mi empresa, o texto
libre a completar al enviar. El editor me ofrece el catálogo al insertar
(igual que hoy con `{{`), me muestra qué significa cada variable ya usada, y
el preview las resuelve con ejemplos realistas. La plantilla llega a la
revisión del canal con ejemplos coherentes para cada variable.

**Why this priority**: es la capacidad pedida ("manejar más que nombre o
texto libre… en la creación de la plantilla") y la base de todo lo demás.

**Independent Test**: crear una plantilla con 3 variables (nombre + empresa +
texto libre), verla "pendiente" con sus bindings visibles y el preview
resuelto; los cuerpos inválidos (huecos, más de 5) se rechazan con mensaje
claro.

**Acceptance Scenarios**:

1. **Given** el editor de plantillas, **When** escribo un cuerpo con
   `{{1}}` (nombre), `{{2}}` (mi empresa) y `{{3}}` (texto libre) eligiendo
   cada origen del catálogo, **Then** la plantilla se crea "pendiente", el
   listado muestra qué es cada variable y el preview las resuelve con
   ejemplos.
2. **Given** un cuerpo con `{{1}}` y `{{3}}` sin `{{2}}` (hueco), **When**
   intento crear, **Then** veo un mensaje claro y no se crea nada.
3. **Given** un cuerpo con 6 variables, **When** intento crear, **Then** veo
   el límite (5) y no se crea nada.
4. **Given** una plantilla con variables e imagen de encabezado a la vez,
   **When** la creo, **Then** ambas capacidades conviven sin conflicto.

---

### User Story 2 - Envío que resuelve las variables solo (Priority: P1)

Como operador, cuando envío una plantilla con variables atadas, **no cargo lo
que el sistema ya sabe**: nombre del contacto, su teléfono y el nombre de mi
empresa se completan solos para CADA destinatario. Solo las variables de
"texto libre" me piden valor: en una campaña las cargo una vez al crearla
(el mismo valor para todos), y en un envío 1:1 las tipeo en el diálogo.

**Why this priority**: es el valor de negocio real — personalización por
destinatario sin trabajo manual; sin esto la US1 es cosmética.

**Independent Test**: con una plantilla de 3 variables aprobada, lanzar una
campaña a 2 contactos con nombres distintos y verificar que cada mensaje
saliente lleva SU nombre + la empresa + el texto de la campaña, en el orden
correcto; el 1:1 pide solo el texto libre.

**Acceptance Scenarios**:

1. **Given** una campaña con esa plantilla y el texto libre cargado, **When**
   corre, **Then** cada destinatario recibe sus valores propios (su nombre)
   y los comunes (empresa, texto de campaña) en las posiciones correctas.
2. **Given** el armado de la campaña, **When** la plantilla tiene variables
   automáticas, **Then** la UI las muestra como "se completa solo" y solo
   pide las de texto libre; si falta un texto libre, no deja lanzar.
3. **Given** el diálogo de envío 1:1, **When** elijo esa plantilla, **Then**
   veo qué se completa solo y tipeo únicamente los textos libres.
4. **Given** un contacto sin nombre cargado (el CRM usa su teléfono como
   nombre), **When** la campaña lo alcanza, **Then** el mensaje sale con ese
   valor visible (el teléfono) — sin romper el envío.

---

### User Story 3 - Las plantillas y campañas existentes no cambian (Priority: P2)

Como operador con plantillas ya aprobadas (incluida la de la campaña LiDAR),
todo lo que ya existe sigue funcionando EXACTAMENTE igual: las plantillas
viejas de una variable conservan su flujo (campañas con "nombre del contacto
o texto fijo"; 1:1 con texto tipeado) y las campañas existentes no se tocan.

**Why this priority**: hay una campaña real lista para salir; una regresión
acá cuesta plata y confianza.

**Independent Test**: correr el flujo completo de una plantilla vieja (sin
bindings) — campaña y 1:1 — y verificar comportamiento y mensajes idénticos a
hoy.

**Acceptance Scenarios**:

1. **Given** una plantilla creada antes de esta feature, **When** la uso en
   una campaña, **Then** el armado ofrece el modo actual (nombre del contacto
   o texto fijo) y el envío es idéntico al de hoy.
2. **Given** esa misma plantilla en el 1:1, **When** la envío, **Then** el
   diálogo pide el texto como siempre.

---

### Edge Cases

- La misma variable repetida en el cuerpo (`{{1}}` dos veces) → se resuelve
  con el mismo valor en ambas posiciones (permitido).
- Cuerpo sin variables → flujo actual intacto (nada que atar ni pedir).
- Texto libre vacío o solo espacios al lanzar campaña o enviar 1:1 →
  rechazado con mensaje claro (jamás sale un mensaje con huecos).
- Contacto cuyo nombre es su teléfono (import sin nombre) → el valor se envía
  igual; es visible y honesto, no un error.
- El nombre de la empresa sale de la marca configurada; si el operador la
  cambia, los envíos futuros usan el nuevo valor (los pasados no se tocan).
- Bindings inconsistentes con el cuerpo (menos orígenes que variables) →
  rechazo en el alta; imposible crear una plantilla a medias.
- Dos empresas del CRM: cada una resuelve "mi empresa" con SU marca.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El cuerpo MUST admitir de 0 a 5 variables posicionales
  contiguas desde la primera (sin huecos); todo lo demás se rechaza con
  mensaje claro antes de crear nada.
- **FR-002**: Cada variable MUST quedar atada en la creación a UN origen del
  catálogo: nombre del contacto · teléfono del contacto (formato legible) ·
  nombre de la empresa · texto libre al enviar.
- **FR-003**: El editor MUST ofrecer el catálogo al insertar variables,
  asignar el índice siguiente automáticamente y mostrar el significado de
  cada variable ya usada; el preview MUST resolver cada origen con ejemplos.
- **FR-004**: La plantilla MUST llegar a la revisión del canal con un ejemplo
  coherente por variable.
- **FR-005**: En el envío (campaña y 1:1), los orígenes automáticos MUST
  resolverse por destinatario/empresa sin intervención del operador, en las
  posiciones correctas.
- **FR-006**: Las variables de texto libre MUST pedirse: una vez por campaña
  (valor común a todos los destinatarios) y por envío en el 1:1; sin todos
  los valores, el lanzamiento/envío se rechaza con mensaje claro.
- **FR-007**: Las plantillas creadas antes de esta feature MUST conservar su
  comportamiento actual completo (modo nombre-del-contacto/texto-fijo en
  campañas, texto tipeado en 1:1); las campañas existentes MUST quedar
  intactas.
- **FR-008**: Las variables MUST convivir con la imagen de encabezado (008)
  en la misma plantilla.
- **FR-009**: Resolución multi-empresa: "nombre de la empresa" MUST salir de
  la marca de LA empresa que envía (aislamiento por organización).
- **FR-010**: El guardrail del Laboratorio (conversaciones de prueba jamás
  tocan el canal real) MUST permanecer intacto.

### Key Entities

- **Plantilla**: suma la lista ordenada de orígenes de sus variables
  (vacía = sin variables; ausente = plantilla anterior con comportamiento
  legado).
- **Campaña**: suma los valores de texto libre cargados al crearla (solo para
  plantillas nuevas con variables atadas); el modo legado se conserva para
  plantillas viejas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un operador crea una plantilla de 3 variables con significado
  en menos de 3 minutos, sin leer documentación (catálogo autoexplicativo).
- **SC-002**: En una campaña a N contactos con la plantilla nueva, el 100%
  de los mensajes salientes llevan los valores correctos por destinatario y
  en el orden correcto (verificado de punta a punta en el entorno de
  pruebas).
- **SC-003**: El 100% de los cuerpos inválidos (huecos, >5) y de los
  lanzamientos sin textos libres completos se rechazan con mensaje claro y
  cero registros a medias.
- **SC-004**: Los flujos de plantillas anteriores (campaña con modo actual,
  1:1 tipeado) pasan la regresión E2E sin ningún cambio observable.

## Assumptions

- El catálogo v1 es fijo (4 orígenes); campos personalizados por contacto
  (p. ej. localidad) quedan explícitamente para una feature futura — decisión
  del dueño del 9-sep-2026.
- El valor de texto libre en campañas es único por campaña (igual que el
  "texto fijo" actual), no por destinatario.
- El teléfono se muestra en formato legible internacional; el dato es el que
  el CRM ya tiene del contacto.
- "Nombre de la empresa" = el nombre configurado en Ajustes → Marca de la
  organización que envía.
- Tope de 5 variables: suficiente para mensajes de este canal y mantiene la
  revisión del canal simple; el canal admite más, se puede subir después.
