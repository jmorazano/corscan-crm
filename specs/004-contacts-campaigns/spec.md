# Feature Specification: Contactos importados + Campañas de plantillas

**Feature Branch**: `004-contacts-campaigns`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Contactos importados + Campañas de plantillas (feature 004): el CRM pasa de solo-reactivo (contactos nacen del mensaje entrante) a poder salir a buscar clientes con consentimiento. (1) CONTACTOS: alta manual + import masivo Excel/CSV con vista previa, consentimiento y tags. (2) INICIAR CONVERSACIÓN SALIENTE con plantilla aprobada hacia un contacto que nunca escribió. (3) CAMPAÑAS con throttling por límite diario, tracking por destinatario y progreso en vivo. (4) OPT-OUT automático (BAJA/STOP). Restricciones: constitución completa, 1 número por empresa, coexistence en producción."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cargar mi lista de contactos (alta manual + import Excel/CSV) (Priority: P1)

El dueño de una empresa tiene su lista de clientes en un archivo Excel (o CSV)
armada fuera del CRM. Desde la página Contactos puede (a) dar de alta un
contacto individual con un formulario, y (b) importar el archivo completo:
elige el archivo, el sistema detecta las columnas por su encabezado
(teléfono, nombre, etiquetas, notas), le muestra una vista previa con las
filas válidas e inválidas, le exige declarar que esos contactos dieron su
consentimiento para recibir mensajes, y al confirmar incorpora la lista. Al
final ve un reporte: cuántos se crearon, cuántos ya existían (y qué se les
actualizó) y cuáles filas se rechazaron con el motivo.

**Why this priority**: sin los contactos adentro no existe nada que
segmentar ni a quién enviarle; es el insumo de todo lo demás y tiene valor
propio inmediato (el CRM pasa a ser la agenda central del negocio).

**Independent Test**: importar un archivo real con filas válidas, duplicadas
e inválidas y verificar el reporte + la lista resultante en la página
Contactos; repetir el mismo import y verificar que no duplica nada.

**Acceptance Scenarios**:

1. **Given** la página Contactos, **When** el operador crea un contacto con
   nombre y teléfono válidos, **Then** el contacto aparece en la lista y un
   segundo intento con el mismo teléfono avisa que ya existe.
2. **Given** un archivo Excel con encabezados reconocibles y 100 filas,
   **When** el operador lo selecciona, **Then** ve una vista previa con el
   mapeo de columnas detectado y el conteo de filas válidas/ inválidas antes
   de confirmar nada.
3. **Given** la vista previa, **When** el operador confirma sin marcar la
   declaración de consentimiento, **Then** el import no procede y se le
   explica por qué.
4. **Given** un import confirmado donde 3 filas tienen teléfono inválido y 5
   teléfonos ya existían, **Then** el reporte final muestra creados,
   actualizados e inválidos (con motivo por fila) y las etiquetas nuevas se
   agregaron a los existentes sin pisar el nombre que el operador ya había
   editado.
5. **Given** el mismo archivo importado dos veces, **Then** la segunda pasada
   no crea duplicados ni degrada datos (idempotencia).
6. **Given** un archivo corrupto o sin columna de teléfono reconocible,
   **Then** el sistema lo explica sin colgarse y no importa nada.

---

### User Story 2 - Escribirle a un contacto que nunca me escribió (Priority: P2)

El operador abre un contacto importado (sin conversación previa) y le envía
una plantilla aprobada. El sistema crea la conversación, envía la plantilla
y desde ahí el hilo vive en la bandeja como cualquier otro: si el cliente
responde, la conversación sigue normal.

**Why this priority**: es la capacidad nueva de plataforma (hoy el CRM solo
puede responder); además es el bloque sobre el que se montan las campañas.

**Independent Test**: con un contacto importado y una plantilla aprobada,
enviar la plantilla desde la ficha del contacto y verificar que la
conversación aparece en la bandeja con el mensaje saliente y sus estados
(enviado/entregado/leído); verificar los rechazos (plantilla no aprobada,
contacto dado de baja).

**Acceptance Scenarios**:

1. **Given** un contacto sin conversación y una plantilla aprobada, **When**
   el operador se la envía, **Then** se crea la conversación, el mensaje sale
   y sus estados se actualizan al llegar las confirmaciones del canal.
2. **Given** el mismo contacto, **When** el operador reintenta el envío tras
   un fallo transitorio, **Then** no se crea una segunda conversación.
3. **Given** una plantilla pendiente o rechazada, **When** el operador
   intenta enviarla, **Then** el sistema lo impide con un mensaje claro.
4. **Given** un contacto dado de baja (opt-out), **When** el operador intenta
   enviarle una plantilla, **Then** el sistema lo impide y explica el motivo.
5. **Given** un contacto de prueba del Laboratorio, **Then** jamás se le
   puede enviar nada por el canal real (sandbox intocable).

---

### User Story 3 - El cliente puede darse de baja y el sistema lo respeta (Priority: P3)

Un cliente que recibió un mensaje responde "BAJA" (o "STOP"). El sistema lo
marca como dado de baja automáticamente: no vuelve a recibir ninguna
campaña ni plantilla iniciada por la empresa, se lo excluye de los envíos
pendientes en curso, y su ficha lo muestra visiblemente. El operador puede
revertir la baja solo con una confirmación explícita (p. ej. si el cliente
pidió volver a recibir novedades).

**Why this priority**: es el guardrail de calidad y cumplimiento — sin esto
el envío masivo pone en riesgo el número real del negocio (bloqueos y baja
de calidad ante el proveedor del canal). Debe existir ANTES de habilitar
campañas.

**Independent Test**: simular un inbound "BAJA" y verificar la marca en el
contacto, la exclusión de un envío pendiente y el bloqueo de nuevos envíos;
verificar que un "baja" en medio de otra frase NO dispara la baja.

**Acceptance Scenarios**:

1. **Given** un contacto activo, **When** llega un inbound cuyo texto es
   exactamente "BAJA" o "STOP" (ignorando mayúsculas y espacios), **Then**
   el contacto queda dado de baja con fecha y su ficha lo muestra.
2. **Given** un contacto dado de baja con envíos pendientes en una campaña
   en curso, **Then** esos envíos se omiten (no se le envía nada más).
3. **Given** un inbound "me quiero dar de baja del gimnasio", **Then** NO se
   marca baja automática (solo coincidencia exacta de palabra clave).
4. **Given** un contacto dado de baja, **When** el operador revierte la baja,
   **Then** se le pide confirmación explícita y el cambio queda registrado.
5. **Given** un contacto dado de baja que vuelve a escribir por otro tema,
   **Then** la conversación funciona normal (responderle está permitido
   dentro de la ventana), pero sigue excluido de campañas hasta que el
   operador revierta la baja.

---

### User Story 4 - Enviar una campaña a un segmento, con freno y tracking (Priority: P4)

El operador crea una campaña: elige una plantilla aprobada, define el
segmento por etiquetas, elige cómo completar la variable de la plantilla
(nombre del contacto o un texto fijo) y la lanza. El sistema envía de a poco
(respetando un límite diario configurable por empresa y un espaciado entre
mensajes), muestra el progreso en vivo (pendientes / enviados / entregados /
leídos / respondieron / fallidos / omitidos) y permite pausar, reanudar o
cancelar. Si se alcanza el límite diario, la campaña se pausa sola y
continúa al día siguiente; si el servidor se reinicia a mitad de campaña,
retoma sin duplicar envíos.

**Why this priority**: es el objetivo final del dueño (marketing masivo),
pero requiere que las tres historias anteriores existan; se entrega última.

**Independent Test**: con contactos importados y etiquetados, lanzar una
campaña sobre un segmento con el canal simulado, observar el throttling y
el progreso en vivo, provocar el límite diario y verificar la pausa
automática + reanudación, reiniciar el servidor a mitad de campaña y
verificar que no duplica.

**Acceptance Scenarios**:

1. **Given** contactos con la etiqueta "clientes-2025" y una plantilla
   aprobada, **When** el operador crea y lanza la campaña sobre ese
   segmento, **Then** solo reciben el mensaje los contactos elegibles
   (con consentimiento, no dados de baja, no archivados, no de prueba) y el
   progreso se actualiza en vivo.
2. **Given** una campaña en curso, **When** el operador la pausa, **Then**
   no salen más mensajes hasta reanudarla; **When** la cancela, **Then** los
   pendientes quedan sin enviar de forma definitiva.
3. **Given** el límite diario de la empresa en N y una campaña con más de N
   destinatarios, **Then** al llegar a N la campaña se pausa sola indicando
   el motivo y reanuda automáticamente cuando el cupo se renueva.
4. **Given** un reinicio del servidor a mitad de campaña, **Then** al volver
   el servicio la campaña retoma desde donde estaba sin enviar dos veces a
   nadie.
5. **Given** destinatarios cuyos envíos fallan (número inexistente), **Then**
   la campaña continúa con el resto y el reporte final muestra los fallidos
   con su motivo.
6. **Given** una campaña lanzada, **When** un destinatario responde, **Then**
   figura como "respondió" en el tracking y su conversación aparece en la
   bandeja para atenderlo.
7. **Given** el envío individual de US2 y una campaña el mismo día, **Then**
   ambos consumen el MISMO cupo diario de la empresa.

### Edge Cases

- Archivo Excel con hoja vacía, encabezados en la fila 2, o miles de filas:
  la vista previa informa y acota (límite de filas por import) sin colgarse.
- Teléfonos con formato local (sin código de país), con espacios, guiones o
  "+": se normalizan de forma predecible antes de validar; los ambiguos se
  rechazan con motivo.
- Dos operadores importan a la vez listas que se pisan: el resultado es
  consistente (sin duplicados) por la unicidad org+teléfono.
- El segmento de una campaña queda vacío tras exclusiones: la campaña no se
  puede lanzar y se explica.
- La plantilla se despublica/pausa en el canal a mitad de campaña: los envíos
  siguientes fallan con motivo claro y la campaña puede pausarse; no se
  cuelga.
- Cambio de límite diario a mitad de campaña: aplica desde el próximo envío.
- El mismo contacto está en dos campañas activas: cada campaña lo trata
  independientemente, pero ambas comparten el cupo diario y el opt-out lo
  excluye de las dos.
- Inbound "BAJA" de un número que no es contacto (nunca importado): la
  ingesta lo crea como siempre y la baja aplica igual.
- Zona horaria del "día" del cupo: el cupo se renueva por día calendario en
  un huso fijo y documentado para la instancia.

## Requirements *(mandatory)*

### Functional Requirements

**Contactos: alta manual e import**

- **FR-001**: El operador MUST poder crear un contacto individual desde la
  página Contactos (nombre y teléfono obligatorios, notas y etiquetas
  opcionales), con aviso claro si el teléfono ya existe en su empresa.
- **FR-002**: El operador MUST poder importar contactos desde un archivo
  .xlsx o .csv; el archivo se procesa en el navegador del operador y al
  servidor solo llegan filas estructuradas y validadas.
- **FR-003**: El sistema MUST detectar las columnas por encabezado
  (teléfono, nombre, etiquetas, notas — con sinónimos razonables en
  español e inglés) y MUST mostrar una vista previa con el mapeo y el
  conteo de filas válidas/ inválidas antes de confirmar.
- **FR-004**: El import MUST exigir una declaración explícita del operador
  de que los contactos dieron su consentimiento; sin ella no procede. La
  fecha y la fuente del consentimiento ("import", con el momento de la
  declaración) quedan registradas por contacto.
- **FR-005**: El import MUST ser idempotente por empresa+teléfono: los
  existentes se actualizan por fusión (las etiquetas nuevas se agregan; el
  nombre y las notas existentes NO se pisan si el operador ya los editó;
  los vacíos se completan), los nuevos se crean, y re-importar el mismo
  archivo no cambia el resultado.
- **FR-006**: El import MUST normalizar teléfonos (espacios, guiones, "+",
  prefijos) a un formato canónico de dígitos con código de país, y MUST
  rechazar con motivo por fila los que no se puedan normalizar sin
  ambigüedad. El reporte final MUST listar creados, actualizados e
  inválidos (fila y motivo).
- **FR-007**: Los contactos MUST poder llevar etiquetas de segmentación
  visibles y editables en su ficha, y el consentimiento MUST registrarse
  también cuando un cliente escribe primero (fuente "inbound" con la fecha
  del primer mensaje) — incluyendo contactos preexistentes a esta feature.

**Conversación saliente iniciada por la empresa**

- **FR-008**: El operador MUST poder enviarle una plantilla aprobada a un
  contacto sin conversación previa; el sistema crea la conversación y el
  hilo continúa en la bandeja como cualquier otro.
- **FR-009**: El envío saliente MUST rechazarse con motivo claro cuando la
  plantilla no está aprobada, el contacto está dado de baja, el contacto es
  de prueba (sandbox del Laboratorio) o la empresa no tiene canal
  conectado. Reintentos MUST NOT duplicar la conversación ni el mensaje.

**Bajas (opt-out)**

- **FR-010**: Un mensaje entrante cuyo texto completo, ignorando mayúsculas
  y espacios, sea una palabra clave de baja ("BAJA" o "STOP") MUST marcar
  al contacto como dado de baja con fecha, y MUST excluirlo de inmediato de
  todo envío pendiente y futuro iniciado por la empresa.
- **FR-011**: La ficha y la lista de contactos MUST mostrar el estado de
  baja. Revertir una baja MUST requerir confirmación explícita del
  operador y quedar registrado (quién y cuándo).
- **FR-012**: Estar dado de baja MUST NOT impedir la conversación normal:
  si el cliente escribe, el operador (y el agente) pueden responderle
  dentro de la ventana; solo se bloquean los envíos iniciados por la
  empresa.

**Campañas**

- **FR-013**: El operador MUST poder crear una campaña con nombre,
  plantilla aprobada, segmento por etiquetas (unión: contactos con AL MENOS
  UNA de las etiquetas elegidas; sin etiquetas = todos los elegibles) y el
  valor de la variable de la plantilla (nombre del contacto o texto fijo),
  ver el tamaño del segmento elegible antes de lanzar, y MUST NOT poder
  lanzar una campaña con segmento elegible vacío.
- **FR-014**: Al lanzar, el sistema MUST congelar la lista de destinatarios
  elegibles (con consentimiento registrado, sin baja, no archivados, no de
  prueba) y enviarles la plantilla de a uno, con espaciado entre envíos,
  respetando el límite diario de la empresa. Contactos que se dan de baja
  después del lanzamiento MUST quedar omitidos aunque estén en la lista.
- **FR-015**: El límite diario de conversaciones iniciadas por la empresa
  MUST ser configurable por empresa (default 250) y MUST ser compartido
  entre campañas y envíos individuales. Alcanzado el límite, las campañas
  en curso MUST pausarse solas indicando el motivo y MUST reanudarse
  automáticamente al renovarse el cupo.
- **FR-016**: El operador MUST poder pausar, reanudar y cancelar una
  campaña. Cancelar es definitivo para los pendientes. Los estados de
  campaña son: borrador, en curso, pausada (manual o por límite),
  completada, cancelada.
- **FR-017**: El progreso MUST ser observable en vivo por destinatario y en
  agregado: pendiente, enviado, entregado, leído, respondió, fallido (con
  motivo), omitido (con motivo: baja, inelegible). Un destinatario cuenta
  como "respondió" si envía cualquier mensaje después de recibir la
  campaña.
- **FR-018**: El envío de campañas MUST sobrevivir reinicios del servicio:
  el estado vive en la base de datos, al arrancar el servicio las campañas
  en curso retoman solas, y ningún destinatario MUST recibir el mensaje
  dos veces (idempotencia por campaña+destinatario).
- **FR-019**: Las campañas MUST operar solo sobre el canal real de la
  empresa; las conversaciones y contactos de prueba del Laboratorio quedan
  fuera por diseño (el guardrail existente no se toca).
- **FR-020**: Toda la feature MUST respetar el aislamiento multi-empresa:
  contactos, campañas, cupos y reportes son por empresa y ninguna empresa
  puede ver ni afectar los de otra.

### Key Entities

- **Contacto (extendido)**: persona con teléfono único por empresa; ahora
  además lleva etiquetas, registro de consentimiento (fuente y fecha) y
  estado de baja (fecha; reversible con confirmación).
- **Campaña**: un envío masivo definido por plantilla aprobada + segmento
  por etiquetas + valor de variable; tiene estado (borrador/en curso/
  pausada/completada/cancelada), momento de lanzamiento y agregados de
  progreso.
- **Destinatario de campaña**: la relación campaña↔contacto congelada al
  lanzar; lleva el estado del envío (pendiente/enviado/entregado/leído/
  respondió/fallido/omitido) y su motivo; único por campaña+contacto.
- **Cupo diario**: contador por empresa y día calendario de conversaciones
  iniciadas por la empresa; límite configurable por empresa (default 250).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El dueño importa su lista real de Excel (hasta 5.000 filas)
  en menos de 2 minutos de principio a fin, con un reporte que le permite
  corregir las filas rechazadas sin ayuda técnica.
- **SC-002**: Una campaña lanzada a un segmento llega al 100% de los
  destinatarios elegibles sin exceder jamás el límite diario configurado,
  y el operador ve el progreso actualizarse en vivo sin refrescar.
- **SC-003**: Un cliente que responde la palabra clave de baja no recibe
  ningún envío posterior iniciado por la empresa: los pendientes en curso
  se omiten y queda excluido de campañas futuras.
- **SC-004**: Un reinicio del servicio a mitad de campaña no produce ningún
  envío duplicado y la campaña termina sola sin intervención.
- **SC-005**: Los caminos infelices (archivo corrupto, plantilla no
  aprobada, límite alcanzado, fallo del canal en un destinatario) degradan
  con mensajes claros y sin colgar el sistema, verificado en el self-test
  E2E de comportamiento con el canal simulado.

## Assumptions

- **Defaults elegidos por el agente (vetables por el dueño)**: palabras
  clave de baja fijas "BAJA" y "STOP" (coincidencia exacta del mensaje,
  case-insensitive, con trim); límite diario default 250 (tier sin
  verificar de Meta); segmento por unión de etiquetas (al menos una);
  variable {{1}} mapeada por default al nombre del contacto; sin
  auto-respuesta de confirmación de baja; sin reintento automático de
  fallidos (reporte + continuar); el "día" del cupo se renueva a
  medianoche en un huso fijo de la instancia; límite de 5.000 filas por
  import.
- El parseo de Excel/CSV ocurre en el navegador del operador; la librería
  de parseo es una dependencia del producto, no un servicio externo
  (constitución II intacta: sin S3, sin email, sin servicios de terceros).
- La plantilla del CRM soporta una única variable ({{1}}) — limitación
  preexistente aceptada; campañas con más variables quedan fuera de v1.
- Fuera de alcance v1: programar campañas a fecha/hora futura, flujos
  multi-paso (drip), A/B testing, auto-respuesta de confirmación de baja,
  import desde otras fuentes (Google Contacts, etc.), exportación de
  contactos.
- El límite diario protege el número real conectado por coexistence; subir
  el límite real ante Meta (verificación del portfolio) es un trámite del
  dueño, fuera del producto.
- Sigue vigente: 1 número de WhatsApp por empresa; webhook y tiempo real
  existentes no se rediseñan, solo se extienden.
