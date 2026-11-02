# Feature Specification: 048 — Quién atiende (atención del equipo a la vista del propietario)

**Feature Branch**: `048-team-attention`

**Created**: 2026-11-02

**Status**: Draft

**Pedido**: el dueño de Altos de Calamuchita (2-nov-2026): tiene empleados
«de guardia» que atienden desde la app del CRM y quiere saber si
efectivamente lo están haciendo.

**Input**: el propietario ve quién atiende. (1) Firma en el hilo de cada
mensaje del equipo. (2) Aviso al propietario cuando un cliente espera a una
persona y pasan N minutos sin respuesta. (3) Sección «Equipo» en Métricas por
persona. (4) Estado de los avisos de cada persona. Sin «en línea ahora». Cada
empleado ve sus propios números.

## Contexto

- El equipo de Altos responde desde la **app del CRM** (instalada en el
  teléfono), no desde la app de WhatsApp Business: cada mensaje queda con su
  autor. Hoy ese dato se guarda, pero no se muestra en ningún lado.
- No hay guardias ni horarios definidos, y el dueño no los necesita por
  ahora. Tampoco hay asignación de conversaciones: lo que espera a una
  persona es **del equipo**.
- Se descarta mostrar quién está «en línea ahora»: la app instalada pierde la
  conexión en cuanto pasa a segundo plano, así que alguien de guardia
  esperando la notificación figuraría desconectado. Sería una señal falsa.
- Lo que se mide son **resultados del trabajo** (respuestas y tiempos), no
  pantallas abiertas. Cada persona puede ver sus propios números.

## Definiciones

- **Espera**: un cliente quedó en manos de una persona y nadie del equipo le
  respondió todavía. Empieza en el primero de estos momentos:
  - el agente **derivó** la conversación a una persona; o
  - el cliente escribió en una conversación con **la IA apagada** (en la
    conversación o en la empresa), y el último mensaje del negocio es
    anterior a ese mensaje.

  Mientras la espera está abierta, los mensajes que el cliente siga mandando
  no abren otra.
- **Cierre de una espera** (exactamente uno):
  - **Respondida**: una persona del equipo le escribió al cliente. Queda
    atribuida a esa persona (la primera que respondió) con el tiempo
    transcurrido desde que empezó la espera.
  - **Retomada por el agente**: el agente volvió a responder (por ejemplo,
    porque se reactivó la IA o porque terminó la ventana de atención humana
    de 031).
  - **Sin respuesta**: se cerró la ventana de 24 h del canal sin que nadie le
    respondiera.
- **A tiempo / tarde**: respondida dentro de los minutos del aviso de la
  empresa, o después. Si el aviso está apagado, se usa el valor por defecto
  (15 minutos).
- **No cuenta como respuesta de una persona**: mensajes del agente, de
  campañas, de la API pública, seguimientos automáticos (042) ni difusiones
  del equipo (036: el mismo texto a muchos chats).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Aviso cuando un cliente espera (Priority: P1)

El dueño quiere enterarse en el momento en que la guardia falla, sin tener
que mirar un panel. Cuando un cliente lleva N minutos esperando a una
persona sin respuesta, le llega una notificación al teléfono que abre esa
conversación.

**Why this priority**: es lo que responde a la preocupación real («¿están
atendiendo?») en el momento en que todavía se puede hacer algo. El resto es
análisis de lo que ya pasó.

**Independent Test**: con el aviso en 15 minutos, el agente deriva una
conversación y nadie responde. A los 15 minutos le llega un único aviso al
propietario. Al tocarlo se abre la conversación. Si alguien responde antes de
los 15 minutos, no llega nada.

**Acceptance Scenarios**:

1. **Given** el aviso encendido en 15 min y una conversación derivada a las
   10:00, **When** a las 10:15 nadie del equipo respondió, **Then** cada
   propietario de la empresa con notificaciones activas recibe «<cliente>
   espera hace 15 min» y al tocarlo se abre esa conversación.
2. **Given** la misma espera, **When** una persona del equipo responde a las
   10:08, **Then** no se envía ningún aviso.
3. **Given** un aviso ya enviado por una espera, **When** el cliente manda
   más mensajes sin que nadie responda, **Then** no se envía un segundo aviso
   por esa misma espera.
4. **Given** una conversación con la IA apagada, **When** el cliente escribe
   y pasan 15 min sin respuesta del equipo, **Then** se envía el aviso.
5. **Given** el aviso apagado, **When** un cliente espera, **Then** no se
   envía nada, pero la espera igual cuenta en Métricas.
6. **Given** un propietario sin notificaciones activas en ningún
   dispositivo, **When** configura el aviso, **Then** la pantalla le
   advierte que no le va a llegar hasta activarlas.

---

### User Story 2 — Atención del equipo en Métricas (Priority: P1)

El propietario abre Métricas y ve una sección «Equipo». Arriba, el resumen
del período: cuántos clientes esperaron a una persona, cuántos se
respondieron a tiempo, tarde o nunca, y quién está esperando ahora. Debajo,
una fila por persona.

**Why this priority**: es la otra mitad del pedido: saber si lo están
haciendo a lo largo del tiempo, y quién.

**Independent Test**: sembrar esperas conocidas (respondidas por dos
personas con tiempos conocidos, una tarde, una sin respuesta) y comprobar
que las cifras de la sección coinciden con las sembradas, en los tres
rangos de Métricas.

**Acceptance Scenarios**:

1. **Given** un período con esperas, **When** el propietario abre la sección
   «Equipo», **Then** ve el total de esperas del período, cuántas fueron
   respondidas a tiempo, tarde, retomadas por el agente y sin respuesta, y
   la mediana de respuesta del equipo.
2. **Given** esperas respondidas tarde o sin respuesta, **When** las mira,
   **Then** ve la lista de esas conversaciones (cliente, cuándo empezó,
   cuánto tardó o «sin respuesta») y cada una abre la conversación.
3. **Given** clientes esperando en este momento, **When** abre la sección,
   **Then** ve «Esperando ahora: N», con cada conversación y hace cuánto
   espera.
4. **Given** el período elegido, **When** mira la fila de una persona,
   **Then** ve: esperas que respondió primero, su mediana de respuesta,
   conversaciones en las que escribió, mensajes enviados, la hora de su
   último mensaje y la última vez que abrió el CRM.
5. **Given** cambia el rango (día, semana, año), **When** la sección se
   recarga, **Then** todas las cifras corresponden al nuevo período, con el
   mismo corte horario que el resto de Métricas.

---

### User Story 3 — Firma en el hilo (Priority: P2)

En la conversación, cada mensaje enviado por una persona del equipo muestra
quién lo mandó, junto a la hora.

**Why this priority**: es lo más barato y responde «¿quién atendió a este
cliente?» mirando la conversación. Pero no avisa ni resume nada.

**Independent Test**: dos personas responden en la misma conversación y
cada mensaje muestra el nombre de quien lo envió.

**Acceptance Scenarios**:

1. **Given** un mensaje enviado desde el CRM por Lucía, **When** cualquiera
   del equipo abre la conversación, **Then** el mensaje muestra «Lucía» y la
   hora.
2. **Given** mensajes del agente, de una campaña, de la API o desde el
   celular, **When** se muestran, **Then** conservan su marca actual
   (agente, «Enviado por API», «Desde el celular») y no muestran el nombre
   de una persona.
3. **Given** que Lucía dejó el equipo, **When** se abre una conversación
   vieja, **Then** sus mensajes siguen mostrando su nombre.

---

### User Story 4 — ¿Les llegan los avisos? (Priority: P2)

En la sección «Equipo», cada persona muestra si tiene las notificaciones
activadas y en cuántos dispositivos.

**Why this priority**: una persona de guardia sin notificaciones en el
teléfono no se entera de nada. Probablemente sea la causa más común de «no
estaban atendiendo», y se arregla sin cambiar nada más.

**Independent Test**: una persona con notificaciones activas en un
dispositivo y otra sin ninguna. La sección muestra la primera como activa
y la segunda con «Sin avisos en ningún dispositivo».

**Acceptance Scenarios**:

1. **Given** una persona sin notificaciones activas en ningún dispositivo,
   **When** el propietario mira su fila, **Then** ve «Sin avisos en ningún
   dispositivo» resaltado.
2. **Given** una persona con notificaciones solo de derivaciones, **When**
   el propietario mira su fila, **Then** ve cuántos dispositivos tiene y que
   recibe solo derivaciones.

---

### User Story 5 — Cada persona ve sus números (Priority: P3)

Un miembro del equipo (no propietario) puede ver su propia fila: sus
esperas respondidas, su mediana, sus mensajes y si sus avisos están
activos. No ve las filas de los demás ni el resto de Métricas.

**Why this priority**: transparencia. El equipo sabe qué se mide y puede
corregirse solo. No es imprescindible para que el dueño tenga la
información.

**Independent Test**: un miembro entra y ve solo su fila. No puede ver la de
otra persona ni las métricas del negocio, ni por la interfaz ni pidiendo los
datos directamente.

**Acceptance Scenarios**:

1. **Given** un miembro, **When** abre su atención, **Then** ve su fila con
   las mismas columnas y el mismo período que vería el propietario.
2. **Given** un miembro, **When** intenta ver datos de otra persona o las
   métricas del negocio, **Then** se le niega el acceso.

---

### Edge Cases

- **Mensajes del cliente durante una espera abierta**: no abren otra espera
  ni otro aviso.
- **Reacciones del cliente** (038): no abren una espera.
- **Mensaje de baja** (palabra clave de 011): no abre una espera.
- **Contactos del número personal** (025): el agente calla por otra razón;
  no es una espera salvo que la conversación esté derivada o con la IA
  apagada.
- **Difusión del equipo** (036): no cierra una espera; la difusión no es
  atención.
- **Espera que cruza el cierre de la ventana de 24 h**: queda «sin
  respuesta»; el aviso se manda igual si se cumplen los minutos antes del
  cierre.
- **Varias personas responden**: la espera es de la primera; las demás
  suman mensajes y conversaciones atendidas, no esperas.
- **El propietario responde**: cuenta como persona del equipo, con su
  propia fila.
- **Persona que dejó el equipo**: aparece en los períodos en los que tuvo
  actividad, marcada «ya no está en el equipo».
- **Cuentas de plataforma** (super admin que escribe desde Administración):
  si no son miembros de la empresa, sus mensajes cuentan como respuesta pero
  aparecen agrupados como «Soporte de la plataforma», no como una persona
  del equipo.
- **Varios propietarios**: el aviso les llega a todos los que tengan
  notificaciones activas.
- **Conversaciones de prueba** (Laboratorio, Entrenador): nunca abren
  esperas ni avisos ni cuentan en Métricas.
- **El aviso no se pudo entregar** (dispositivo vencido): no se reintenta
  por esa espera; la espera igual cuenta en Métricas.
- **Reinicio del servidor** con esperas cerca de los N minutos: el aviso se
  manda igual al volver, una sola vez, si la espera sigue abierta.
- **Cambio de los minutos del aviso**: aplica a las esperas abiertas desde
  ese momento; las ya avisadas no se vuelven a avisar.

## Requirements *(mandatory)*

### Functional Requirements

**Esperas**

- **FR-001**: El sistema MUST registrar cada espera según las Definiciones:
  conversación, cuándo empezó, por qué empezó (derivación o IA apagada),
  cómo se cerró, quién respondió primero y cuánto tardó.
- **FR-002**: Una conversación MUST tener como máximo una espera abierta a
  la vez.
- **FR-003**: Solo un mensaje enviado por una persona del equipo MUST
  cerrar una espera como «respondida». Los del agente, campañas, API,
  seguimientos automáticos y difusiones no.
- **FR-004**: Las conversaciones de prueba (Laboratorio, Entrenador) MUST
  NOT abrir esperas.
- **FR-005**: Las esperas MUST registrarse siempre, con el aviso encendido o
  apagado: Métricas no depende del aviso.

**Aviso al propietario**

- **FR-006**: Cada empresa MUST poder encender o apagar el aviso y elegir
  los minutos (entre 5 y 120; 15 por defecto). Solo el propietario lo
  configura.
- **FR-007**: El aviso MUST estar apagado por defecto en todas las empresas.
- **FR-008**: Cuando una espera abierta cumple los minutos configurados, el
  sistema MUST enviar una notificación a cada propietario de la empresa con
  notificaciones activas. La notificación dice quién espera y hace cuánto,
  y abre esa conversación.
- **FR-009**: El sistema MUST enviar como máximo un aviso por espera, aun
  ante reinicios del servidor, reintentos o mensajes nuevos del cliente.
- **FR-010**: Si la espera se cerró antes de cumplir los minutos, el
  sistema MUST NOT enviar el aviso.
- **FR-011**: El aviso MUST estar activo todo el día (sin horarios).
- **FR-012**: La pantalla de configuración MUST advertirle al propietario si
  él no tiene notificaciones activas en ningún dispositivo.

**Métricas — sección «Equipo»**

- **FR-013**: Métricas MUST mostrar una sección «Equipo» para el período y
  la zona horaria elegidos, con el mismo corte que el resto de Métricas
  (una espera pertenece al período en el que empezó).
- **FR-014**: El resumen del equipo MUST mostrar: total de esperas,
  respondidas a tiempo, respondidas tarde, retomadas por el agente, sin
  respuesta, y la mediana de respuesta del equipo.
- **FR-015**: El resumen MUST listar las esperas respondidas tarde o sin
  respuesta del período (cliente, inicio, demora o «sin respuesta»), cada
  una con acceso a la conversación.
- **FR-016**: El resumen MUST mostrar las esperas abiertas en este momento,
  con hace cuánto espera cada cliente.
- **FR-017**: Por cada persona con actividad en el período o que sea parte
  del equipo, la sección MUST mostrar: esperas que respondió primero, su
  mediana de respuesta, cantidad de esas que respondió tarde, conversaciones
  en las que escribió, mensajes enviados (sin fallidos), hora de su último
  mensaje y última vez que abrió el CRM.
- **FR-018**: Por cada persona, la sección MUST mostrar si tiene
  notificaciones activas, en cuántos dispositivos y de qué tipo (todos los
  mensajes o solo derivaciones), y resaltar a quien no tiene ninguna.
- **FR-019**: El sistema MUST registrar la última vez que cada persona usó
  el CRM en esa empresa. Se guarda solo el último momento, no un historial
  de conexiones.
- **FR-020**: La sección MUST NOT mostrar si alguien está «en línea ahora».

**Firma en el hilo**

- **FR-021**: Cada mensaje enviado por una persona del equipo MUST mostrar
  su nombre junto a la hora, para todo el equipo.
- **FR-022**: El nombre MUST conservarse aunque la persona deje el equipo o
  se elimine su cuenta.
- **FR-023**: Los mensajes sin autor (agente, campañas, API, celular)
  MUST conservar sus marcas actuales.

**Acceso**

- **FR-024**: Solo el propietario MUST ver la sección «Equipo» completa y
  configurar el aviso.
- **FR-025**: Un miembro MUST poder ver solo su propia fila (mismas columnas
  que FR-017 y FR-018) y MUST NOT poder ver las de otras personas, el
  resumen del equipo ni las métricas del negocio.
- **FR-026**: Todas las cifras MUST ser de la empresa activa y nunca mezclar
  empresas.

### Key Entities

- **Espera**: un cliente esperando a una persona en una conversación.
  Atributos: conversación, empresa, inicio, motivo (derivación o IA
  apagada), cierre (respondida, retomada por el agente, sin respuesta),
  momento del cierre, persona que respondió primero (con su nombre
  copiado), demora, y si ya se avisó.
- **Configuración del aviso** (por empresa): encendido o apagado y minutos.
- **Última actividad** (por persona y empresa): última vez que usó el CRM.
- **Autor del mensaje**: la persona que envió un mensaje, con su nombre
  conservado para que la firma sobreviva a su salida del equipo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con el aviso encendido, el propietario recibe la notificación
  a más tardar 1 minuto después de cumplirse los minutos configurados, en el
  100 % de las esperas que siguen abiertas.
- **SC-002**: Nunca llega más de un aviso por espera, ni un aviso por una
  espera que ya se respondió.
- **SC-003**: Las cifras de la sección «Equipo» coinciden exactamente con
  las esperas y mensajes sembrados en la prueba de punta a punta, en los
  tres rangos.
- **SC-004**: Desde Métricas, el propietario puede responder en menos de
  1 minuto «¿quién respondió la mayoría de las esperas de esta semana y
  cuánto tardó?» y «¿qué clientes quedaron sin respuesta?».
- **SC-005**: En cualquier conversación, cada mensaje de una persona del
  equipo muestra su nombre, incluidos los de personas que ya no están.
- **SC-006**: Un miembro nunca accede a datos de otra persona del equipo ni
  a las métricas del negocio.

## Assumptions

- El equipo de Altos responde desde la app del CRM. Los mensajes enviados
  desde la app de WhatsApp Business del celular no tienen autor: cierran la
  espera como respuesta del negocio, agrupados como «Desde el celular», sin
  persona.
- Los destinatarios del aviso son solo los propietarios. Los miembros ya
  reciben las derivaciones por sus propias notificaciones (013).
- «Tarde» usa los minutos del aviso para que el aviso y las métricas digan
  lo mismo; con el aviso apagado, 15 minutos.
- Que el equipo esté en la charla (031) y el agente calle por eso no es una
  espera: el agente vuelve a responder solo al terminar esa ventana.
- La última vez que alguien usó el CRM se actualiza con una precisión de
  algunos minutos, no al segundo.
- Las esperas empiezan a registrarse desde el despliegue. No se reconstruye
  el pasado.
- Reutiliza las notificaciones de 013, la ventana de 24 h de cada canal y
  los rangos y la zona horaria de Métricas (024). No suma dependencias
  externas (constitución II).
- Requiere una migración nueva (0035).

## Fuera de alcance

Guardias u horarios por persona, asignar conversaciones a alguien, «en línea
ahora», historial de conexiones, avisar a los miembros, horario de silencio
para el aviso, reconstruir esperas anteriores al despliegue, y atribuir
mensajes enviados desde la app de WhatsApp Business del celular.
