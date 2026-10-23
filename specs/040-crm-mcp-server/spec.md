# Feature Specification: Conversar con el CRM desde Claude (Vocero como servidor MCP)

**Feature Branch**: `040-crm-mcp-server`

**Created**: 2026-10-23

**Status**: Draft

**Input**: Pedido del dueño (23-oct-2026): «Necesito que un cliente pueda
conectar a través de un MCP su sesión de Claude para que se comunique con el
CRM y sus cuentas a su nombre. Por ejemplo, el cliente de Altos de
Calamuchita y Altos de la Ciudad quiere conectarse con Claude Desktop y
preguntarle estadísticas de cantidad de mensajes, cuántos llegaron por
campañas, cuántos se respondieron: tener una charla con la información del
CRM de sus teléfonos.» Decisiones cerradas el 23-oct: **solo lectura** en
esta versión; **solo el propietario** de la empresa puede conectar; el
asistente **sí ve los textos** de las conversaciones; cada empresa tiene un
**switch «Permitir asistentes externos»** apagado por defecto; la conexión es
por usuario y el usuario elige en el consentimiento a qué empresas da acceso.

Hasta ahora Vocero era *cliente* de servidores MCP (016, el conector del PMS).
Esta feature lo convierte también en *servidor*: un asistente externo que el
propio usuario eligió (Claude Desktop, Claude Code) consulta el CRM en su
nombre.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conectar Claude a mis empresas (Priority: P1)

Como propietario de Altos de Calamuchita y de Altos de la Ciudad entro a
Ajustes → Asistentes (Claude) de cada empresa, enciendo «Permitir asistentes
externos» y copio la dirección del conector que la misma página muestra
junto con los pasos. En Claude Desktop agrego un conector personalizado con
esa dirección y toco «Conectar». Se abre el CRM en el navegador: si no tengo
sesión inicio sesión como siempre, y veo una pantalla de permiso en
castellano que dice qué asistente pide acceso, que el acceso es de **solo
lectura**, que incluye **los textos de las conversaciones**, y una lista con
mis empresas para tildar. Tildo las dos, acepto, y vuelvo a Claude con el
conector activo.

**Why this priority**: sin conexión no hay nada; y es la parte más delicada
(quién puede entrar y a qué).

**Independent Test**: con un cliente MCP de prueba que sigue el flujo
estándar de un conector personalizado (registro, autorización con PKCE,
token), un propietario con dos empresas autoriza una sola, y la herramienta
de listado de empresas devuelve exactamente esa; la conexión aparece en
Ajustes de esa empresa.

**Acceptance Scenarios**:

1. **Given** un propietario con el switch encendido en sus dos empresas,
   **When** agrega el conector en Claude y completa login + consentimiento
   tildando ambas, **Then** Claude queda conectado y al pedirle «¿a qué
   empresas tenés acceso?» responde las dos por nombre.
2. **Given** el consentimiento, **When** el usuario tilda solo una empresa,
   **Then** el asistente solo puede consultar esa; preguntar por la otra
   responde «no tengo acceso a esa empresa» sin ningún dato de ella.
3. **Given** una empresa con el switch apagado, **When** el propietario abre
   el consentimiento, **Then** esa empresa aparece deshabilitada con el
   texto «Activalo en Ajustes → Asistentes de esa empresa» y no se puede
   tildar.
4. **Given** un usuario que es solo miembro (no propietario) de una empresa,
   **When** abre el consentimiento, **Then** esa empresa no aparece como
   autorizable; si no es propietario de ninguna, el consentimiento explica
   que solo el propietario puede conectar asistentes y no emite acceso.
5. **Given** un usuario con contraseña temporal pendiente de cambio,
   **When** llega al consentimiento, **Then** primero se le pide cambiarla
   (mismo gate que el resto del CRM) y después sigue el flujo.
6. **Given** el consentimiento, **When** el usuario toca «Cancelar»,
   **Then** vuelve al asistente sin acceso y no queda ninguna autorización.
7. **Given** una dirección de retorno que no es la de un cliente permitido,
   **When** un cliente intenta registrarse o autorizar con ella, **Then** el
   CRM lo rechaza sin mostrar el consentimiento.
8. **Given** Claude Code en la computadora del usuario, **When** agrega el
   mismo conector, **Then** el flujo es el mismo (navegador → login →
   consentimiento) y queda como una conexión separada de la de Claude
   Desktop en la lista de Ajustes.

---

### User Story 2 - Preguntar por los números: mensajes, respuestas y campañas (Priority: P1)

Como propietario le pregunto a Claude cosas como «¿cuántos mensajes nos
llegaron esta semana en cada negocio y cómo venimos contra la semana
pasada?», «¿cuánto tardamos en responder?», «¿cuántas conversaciones nuevas
hubo en octubre por WhatsApp y por Instagram?», «¿cuántos llegaron por
anuncios?», «de la campaña de reactivación, ¿a cuántos les llegó, cuántos la
leyeron y cuántos respondieron?». Claude responde con números que coinciden
con los que veo en Métricas y en el detalle de cada campaña del CRM.

**Why this priority**: es exactamente lo que pidió el cliente; junto con la
historia 1 ya es un producto útil.

**Independent Test**: con el seed de números conocidos de Métricas (024) y
una campaña sembrada con estados conocidos, cada herramienta de cifras
devuelve los mismos valores que la pantalla de Métricas y el detalle de la
campaña.

**Acceptance Scenarios**:

1. **Given** una empresa autorizada, **When** se piden las métricas de un
   período (hoy, semana, mes, año o un rango de fechas), **Then** el
   resultado trae mensajes recibidos y enviados por canal, conversaciones
   nuevas, tiempo de respuesta (mediana y percentil 90) y la comparación con
   el período anterior de igual duración, con los mismos criterios que
   Métricas: sin conversaciones de prueba ni del Entrenador, sin reacciones,
   y el historial importado del celular informado aparte y fuera de los
   totales.
2. **Given** dos empresas autorizadas, **When** se pregunta sin nombrar
   empresa, **Then** el asistente puede consultar cada una por separado y
   cada resultado dice a qué empresa corresponde; nunca se mezclan en una
   misma cifra sin que se diga.
3. **Given** campañas en distintos estados, **When** se listan, **Then**
   cada una trae nombre, plantilla, estado, fechas de lanzamiento y fin, y
   cantidades de destinatarios: enviados, entregados, leídos, respondidos,
   fallidos (con los motivos más comunes en lenguaje claro), salteados y
   bajas.
4. **Given** una campaña, **When** se pide su detalle, **Then** además de
   las cantidades trae la tasa de respuesta sobre entregados y, si se pide,
   la lista paginada de quienes respondieron (nombre, teléfono, cuándo
   respondió y la conversación).
5. **Given** conversaciones originadas en anuncios de WhatsApp y en links o
   comentarios de Instagram, **When** se pregunta por el origen, **Then** se
   obtienen cantidades por origen (anuncio, link de entrada, comentario,
   orgánico) en el período.
6. **Given** un período sin datos, **When** se consulta, **Then** las cifras
   vuelven en cero con el período explícito, nunca un error.
7. **Given** una zona horaria, **When** se consulta «hoy» o «esta semana»,
   **Then** los cortes son en la hora local de la empresa (por defecto la de
   Argentina, como Métricas) y el resultado dice qué fechas abarca.

---

### User Story 3 - Controlar y cortar el acceso (Priority: P1)

Como propietario veo en Ajustes → Asistentes de cada empresa qué asistentes
tienen acceso (nombre del cliente, quién lo conectó, desde cuándo, último
uso) y un registro de qué consultaron y cuándo. Puedo revocar una conexión o
apagar el switch, y desde ese momento el asistente no obtiene un solo dato
más de esa empresa.

**Why this priority**: entregar acceso a los textos de los chats de los
clientes del negocio solo es aceptable si el propietario lo ve y lo corta
cuando quiere.

**Independent Test**: conectar, consultar, revocar desde Ajustes y
comprobar que la siguiente llamada del cliente de prueba falla por falta de
autorización; repetir apagando el switch.

**Acceptance Scenarios**:

1. **Given** una conexión activa, **When** el propietario la revoca
   (confirmación), **Then** la siguiente consulta del asistente es rechazada
   y el asistente le pide al usuario volver a conectar; la conexión figura
   como «Revocada».
2. **Given** una conexión autorizada a dos empresas, **When** el
   propietario apaga el switch en una, **Then** las consultas a esa empresa
   responden «el acceso de asistentes está desactivado en esta empresa» y
   las de la otra siguen funcionando.
3. **Given** un usuario que deja de ser propietario o es quitado de la
   empresa, **When** su asistente consulta esa empresa, **Then** no obtiene
   datos, sin esperar a que venza ningún token.
4. **Given** un usuario que restablece o cambia su contraseña, **When** su
   asistente vuelve a consultar, **Then** todas sus conexiones quedaron
   revocadas y debe volver a conectar.
5. **Given** consultas realizadas, **When** el propietario abre el
   registro, **Then** ve por cada una: fecha y hora, conexión, usuario, qué
   se consultó en lenguaje claro («Métricas de la semana», «Conversación con
   Juan Pérez») y si se respondió o se rechazó; nunca el contenido devuelto.
6. **Given** un propietario de otra empresa del mismo operador, **When**
   abre Ajustes → Asistentes, **Then** solo ve las conexiones con acceso a
   SU empresa.
7. **Given** un miembro (no propietario), **When** navega el CRM, **Then**
   no ve la sección Asistentes (mismo criterio de 022).

---

### User Story 4 - Leer y buscar conversaciones y contactos (Priority: P2)

Como propietario le pido a Claude «mostrame las conversaciones de ayer que
quedaron en atención humana», «¿qué preguntaron los que llegaron por el
anuncio de octubre?», «leeme la conversación con Juan Pérez», «¿quiénes
pidieron precio de la cabaña grande esta semana?», «resumime de qué se
quejan los huéspedes». Claude busca, abre los hilos que necesita y me
responde con lo que dicen los chats.

**Why this priority**: es lo que convierte las cifras en una charla útil
sobre el negocio; depende de que la conexión y el control ya existan.

**Independent Test**: con conversaciones sembradas (WhatsApp e Instagram,
con etiquetas, etapas, origen y adjuntos), las búsquedas por filtro y por
texto devuelven exactamente las esperadas y la lectura de un hilo devuelve
sus mensajes en orden.

**Acceptance Scenarios**:

1. **Given** una empresa autorizada, **When** se buscan conversaciones con
   filtros (canal, etiquetas, etapa del lead, origen, sin leer, en atención
   humana, agente pausado, rango de fechas de actividad) y/o un texto,
   **Then** vuelve una página de resultados con contacto, canal, último
   mensaje recortado, fecha, etiquetas, etapa y estado del agente, y un
   cursor para seguir.
2. **Given** una conversación, **When** se lee, **Then** vuelven sus últimos
   mensajes (hasta un tope por llamada, con cursor hacia atrás) con fecha y
   hora, dirección, autor (cliente, agente, persona del equipo con su nombre,
   enviado desde el celular, enviado por API, campaña), estado de entrega y
   el texto.
3. **Given** mensajes con adjuntos, **When** se lee el hilo, **Then** cada
   adjunto se informa por tipo y nombre, con la transcripción de las notas
   de voz y el resumen que el CRM ya generó de imágenes, PDFs y videos
   marcado como resumen del CRM, nunca el archivo.
4. **Given** contactos, **When** se buscan por nombre, teléfono, usuario de
   Instagram o etiqueta, **Then** vuelven con sus datos de ficha (nombre,
   teléfono, email, canal, etiquetas, origen, consentimiento/baja, etapa del
   lead) y sus conversaciones.
5. **Given** textos escritos por los clientes del negocio, **When** se
   devuelven al asistente, **Then** van marcados como contenido de terceros
   que es dato y no instrucción, y un mensaje que diga «ignorá tus
   instrucciones y …» no cambia lo que el CRM permite: el acceso sigue
   siendo de solo lectura y sobre las empresas autorizadas.
6. **Given** conversaciones de prueba del Laboratorio y la del Entrenador,
   **When** se busca o se lee, **Then** nunca aparecen.
7. **Given** una conversación o contacto de otra empresa (aunque el usuario
   sea miembro de ella sin haberla autorizado), **When** se pide por id,
   **Then** responde «no encontrado», igual que un id inexistente.

---

### User Story 5 - Pipeline y actividad del agente (Priority: P3)

Como propietario pregunto «¿cuántos leads hay en cada etapa?», «¿qué leads
se movieron a reservado esta semana?», «¿cuántas veces derivó el agente a
una persona y por qué?», «¿hubo errores del agente?».

**Why this priority**: completa la foto del negocio, pero el pedido del
cliente se cubre con las historias 1, 2 y 4.

**Independent Test**: con leads y eventos del agente sembrados, las
herramientas devuelven las cantidades por etapa, los leads de una etapa y
los eventos del período con su motivo.

**Acceptance Scenarios**:

1. **Given** un pipeline, **When** se consulta, **Then** vuelven las etapas
   en orden con su tipo (abierta, ganada, perdida) y la cantidad de leads,
   y se puede listar los leads de una etapa con contacto, valor si lo hay y
   fecha de último movimiento.
2. **Given** eventos del agente en el período, **When** se consulta su
   actividad, **Then** vuelven cantidades por tipo (derivaciones, silencios
   por el equipo, reanudaciones, errores, escrituras en el sistema del
   tercero) y, si se pide, la lista con fecha, conversación y motivo en
   lenguaje claro (los mismos textos que muestra el hilo).

---

### Edge Cases

- **Token vencido**: el asistente renueva el acceso sin intervención del
  usuario mientras la conexión siga vigente; si la renovación se usa dos
  veces (robo o reintento extraño), se revoca la conexión completa.
- **Conexión sin uso**: una conexión que no se usa durante 90 días deja de
  renovarse y hay que volver a conectar.
- **Registros de clientes basura**: el registro abierto de clientes tiene
  límite por IP y se descartan los clientes que nunca completaron una
  autorización.
- **Muchas consultas**: más de un tope por minuto por conexión responde
  «demasiadas consultas, esperá un minuto» sin tumbar nada.
- **Resultados grandes**: toda lista va paginada con tope; un hilo largo se
  lee por tramos; si un resultado se recorta, lo dice («hay más, pedí la
  página siguiente»). Ningún pedido trae la base entera.
- **Empresa borrada** o usuario eliminado: sus conexiones desaparecen con
  ella/él.
- **Super admin**: no tiene acceso especial; ve por el asistente solo las
  empresas de las que es propietario y que autorizó.
- **Consentimiento sin sesión**: el login vuelve al consentimiento con los
  mismos datos; si el pedido de autorización venció, se le pide al usuario
  reintentar desde el asistente.
- **Switch apagado y vuelto a encender**: las conexiones que habían
  autorizado esa empresa vuelven a funcionar (el switch es un corte, no una
  revocación); revocar sí es definitivo.
- **Contactos borrados** (033): no aparecen; sus campañas conservan los
  totales.
- **Historial importado del celular** (017): se informa aparte, igual que en
  Métricas, y en un hilo se marca «del historial del celular».
- **Caída o lentitud de la base**: el asistente recibe un error claro
  («no pude consultar el CRM, probá de nuevo») y el resto del CRM no se ve
  afectado.
- **Preguntas que piden escribir** («mandale un mensaje a Juan», «mové el
  lead»): no hay herramientas para eso; el asistente no puede hacerlo.

## Requirements *(mandatory)*

### Functional Requirements

**Conexión y autorización**

- **FR-001**: El CRM MUST exponer un servidor MCP remoto en una dirección
  pública y fija de la instancia, compatible con el «conector
  personalizado» de Claude Desktop/claude.ai y con Claude Code, sin que el
  usuario tenga que copiar claves ni editar archivos de configuración.
- **FR-002**: La autorización MUST seguir el flujo estándar que esos
  clientes esperan (descubrimiento de la autorización desde el propio
  servidor, registro dinámico de clientes, autorización con código y PKCE,
  renovación del acceso) y MUST aceptar solo direcciones de retorno de una
  lista permitida: las de Claude (claude.ai y claude.com) y las de loopback
  local para clientes de escritorio/terminal.
- **FR-003**: El consentimiento MUST mostrarse en el CRM, en castellano, con
  la sesión normal del usuario (login y gate de contraseña temporal
  incluidos), e informar: nombre del cliente que pide acceso, que el acceso
  es de solo lectura, que incluye los textos de las conversaciones y datos
  de contactos, y que se puede revocar en Ajustes.
- **FR-004**: En el consentimiento el usuario MUST elegir las empresas a las
  que da acceso; solo son elegibles aquellas donde es **propietario** y
  tienen el switch encendido. Sin al menos una empresa elegida no se emite
  acceso.
- **FR-005**: Cada empresa MUST tener un switch «Permitir asistentes
  externos», **apagado por defecto**, que solo el propietario cambia en
  Ajustes → Asistentes. Apagado, ninguna conexión obtiene datos de esa
  empresa, sin importar lo autorizado.
- **FR-006**: Los tokens de acceso y de renovación MUST guardarse solo como
  hash (nunca recuperables), viajar solo en el encabezado de autorización,
  no aparecer en logs ni en respuestas que no sean la del propio intercambio,
  vencer en poco tiempo (acceso ~1 h) y rotar en cada renovación (de un solo
  uso).

**Alcance en cada consulta**

- **FR-007**: En CADA consulta el CRM MUST revalidar que la conexión siga
  vigente, que la empresa pedida esté entre las autorizadas, que el switch
  esté encendido y que el usuario siga siendo propietario de esa empresa; si
  algo falla, no devuelve datos de esa empresa.
- **FR-008**: Toda consulta MUST quedar acotada a UNA empresa por llamada
  (la empresa es un parámetro explícito o, si hay una sola autorizada, la
  implícita), con el mismo aislamiento por empresa que el resto del CRM. Un
  id de otra empresa responde igual que uno inexistente.
- **FR-009**: Todas las herramientas de esta versión MUST ser de **solo
  lectura**: ninguna envía mensajes, cambia datos, toca WhatsApp,
  Instagram, el conector del PMS ni el agente, ni dispara efectos en
  terceros. Se declaran como de solo lectura ante el cliente MCP.

**Herramientas (catálogo de lectura)**

- **FR-010**: Listado de empresas autorizadas: nombre, canales conectados
  (WhatsApp, Instagram), zona horaria usada y si el acceso está activo.
- **FR-011**: Métricas de mensajes por período (hoy, semana, mes, año o
  rango de fechas): recibidos y enviados por canal, conversaciones nuevas,
  tiempo de respuesta (mediana y p90), comparación con el período anterior y
  serie por día/semana/mes, con los MISMOS criterios y resultados que la
  pantalla Métricas (024 y su ajuste del historial).
- **FR-012**: Conversaciones por origen en un período: anuncios de WhatsApp
  (035), links de entrada y comentarios de Instagram (030) y orgánicas.
- **FR-013**: Campañas: listado con filtros por estado, nombre y fechas, y
  detalle con enviados, entregados, leídos, respondidos, fallidos (motivos
  agrupados y traducidos como en 010), salteados, bajas y tasa de
  respuesta; lista paginada de destinatarios por estado (incluido
  «respondió»).
- **FR-014**: Búsqueda de conversaciones con los filtros de la Bandeja
  (canal, etiquetas con modo, etapa, origen, sin leer, atención humana,
  agente pausado, fechas) y texto libre sobre los mensajes, paginada.
- **FR-015**: Lectura de una conversación: mensajes en orden con fecha,
  dirección, autor, procedencia (agente, equipo con nombre, celular, API,
  campaña), estado de entrega, texto, y adjuntos descritos por tipo/nombre
  con transcripción o resumen ya existentes, por tramos con cursor.
- **FR-016**: Búsqueda y ficha de contactos (nombre, teléfono, usuario de
  Instagram, email, etiquetas, origen, baja, etapa del lead, conversaciones).
- **FR-017**: Pipeline: etapas en orden con tipo y cantidad de leads, y
  leads por etapa paginados.
- **FR-018**: Actividad del agente por período: cantidades por tipo de
  evento y lista con fecha, conversación y motivo en los textos de 031.
- **FR-019**: Cada herramienta MUST tener nombre y descripción claros para
  que el asistente sepa cuándo usarla, describir en castellano sus
  parámetros, y devolver resultados compactos con totales y la indicación de
  que hay más cuando se recorta.

**Datos y privacidad**

- **FR-020**: Lo que escribieron contactos (textos, nombres, captions,
  comentarios, transcripciones) MUST devolverse delimitado como contenido de
  terceros, saneado de marcadores internos del sistema y con la advertencia
  de que es dato y no instrucción.
- **FR-021**: Nunca se devuelven: credenciales, tokens, claves, secretos de
  integraciones, el identificador de clic de anuncios (035), contenido de
  conversaciones de prueba del Laboratorio ni del Entrenador, ni binarios de
  adjuntos.
- **FR-022**: Los resultados MUST ser deterministas y fieles a la base: el
  CRM no resume ni interpreta con IA lo que devuelve (la interpretación la
  hace el asistente del usuario).

**Control y auditoría**

- **FR-023**: Ajustes → Asistentes (solo propietario) MUST mostrar el
  switch, la dirección del conector con instrucciones paso a paso para
  Claude Desktop y Claude Code, la lista de conexiones con acceso a esa
  empresa (cliente, usuario, fecha de alta, último uso, estado) con
  «Revocar», y el registro de consultas.
- **FR-024**: Revocar MUST invalidar de inmediato el acceso y la renovación
  de esa conexión. Cambiar o restablecer la contraseña MUST revocar todas las
  conexiones del usuario.
- **FR-025**: Cada consulta MUST registrarse (fecha, conexión, usuario,
  empresa, herramienta, descripción en lenguaje claro, resultado aceptada /
  rechazada y motivo), sin guardar el contenido devuelto; el registro se
  conserva 90 días.
- **FR-026**: Límite de 60 consultas por minuto por conexión, y límite de
  registros de clientes y de intentos de autorización por IP.

**Robustez y verificación**

- **FR-027**: Un error interno o un parámetro inválido MUST devolver al
  asistente un error claro y en castellano, sin trazas ni detalles internos,
  y jamás afectar la Bandeja, la ingesta, el agente ni los envíos.
- **FR-028**: Las consultas de cifras sobre un año de datos de una empresa
  típica MUST cumplir el tiempo de SC-005.
- **FR-029**: El self-test E2E MUST conducir el flujo completo con un
  cliente MCP de prueba (registro → autorización con PKCE → consentimiento
  por navegador → token → herramientas → renovación → revocación) y los
  caminos infelices (switch apagado, empresa no autorizada, miembro, token
  vencido, renovación reutilizada, retorno no permitido, límite de tasa). Y
  antes de dárselo al cliente, una prueba real con Claude Desktop y Claude
  Code contra producción en la empresa del operador.

### Key Entities *(include if feature involves data)*

- **Cliente de asistente**: una aplicación registrada que pide acceso
  (p. ej. «Claude»), con sus direcciones de retorno permitidas; sin
  secreto (cliente público). No pertenece a ninguna empresa.
- **Conexión (autorización)**: el permiso que UN usuario dio a UN cliente;
  fecha de alta, último uso, estado (activa, revocada, vencida) y quién la
  revocó. Una persona puede tener varias (Claude Desktop y Claude Code).
- **Empresa autorizada**: cada empresa incluida en una conexión
  (pertenencia a la empresa explícita en el dato, para que el propietario de
  esa empresa la vea y la revoque).
- **Token de acceso / de renovación**: solo su hash, con vencimiento, la
  conexión a la que pertenece y si ya se usó (para la rotación).
- **Switch de la empresa**: «Permitir asistentes externos», por empresa.
- **Registro de consulta**: por empresa; conexión, usuario, herramienta,
  descripción, resultado y fecha.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propietario sin conocimientos técnicos conecta Claude
  Desktop a sus empresas en menos de 3 minutos siguiendo solo las
  instrucciones de Ajustes → Asistentes.
- **SC-002**: Las cifras que devuelve el asistente coinciden en el 100 % de
  los casos de prueba con las de Métricas y el detalle de campañas del CRM
  para el mismo período y empresa.
- **SC-003**: En las pruebas, el 100 % de los intentos de leer datos de una
  empresa no autorizada, con el switch apagado, por un miembro o después de
  revocar devuelve cero datos de esa empresa.
- **SC-004**: Revocar o apagar el switch corta el acceso desde la consulta
  siguiente, sin esperar vencimientos.
- **SC-005**: Las preguntas de cifras sobre un año de datos se responden en
  menos de 3 segundos del lado del CRM en el 95 % de los casos.
- **SC-006**: Las diez preguntas de ejemplo del cliente (mensajes de la
  semana por negocio, comparación con la semana anterior, tiempo de
  respuesta, conversaciones por anuncio, entregados/leídos/respondidos de una
  campaña, quiénes respondieron, conversaciones en atención humana, lectura
  de un hilo, búsqueda por tema, leads por etapa) se responden con datos
  correctos en una sesión real de Claude Desktop.
- **SC-007**: Ningún token ni secreto aparece en la base en forma
  recuperable, en logs ni en respuestas, verificado en el self-test.

## Assumptions

- El cliente tiene un plan de Claude que permite agregar conectores
  personalizados; se verifica con él antes de prometerlo.
- Claude Desktop y claude.ai consultan el conector desde los servidores de
  Anthropic: la instancia debe ser accesible por HTTPS pública (ya lo es en
  producción). Por eso los límites son por conexión y no por IP.
- Los datos que el asistente lee los lleva el propio propietario a su
  cuenta de Claude, por decisión suya y con consentimiento explícito; el CRM
  no envía nada por iniciativa propia. Se suma una mención en la política de
  privacidad y una enmienda de la constitución (acceso entrante de
  asistentes del usuario: no es una dependencia de runtime de la instancia,
  pero sí una salida de datos que debe quedar regida). La versión exacta de
  la enmienda se decide en el plan.
- Cualquier otro cliente MCP que siga el mismo estándar probablemente
  funcione, pero en esta versión solo se prueban y documentan Claude Desktop
  y Claude Code.
- Las herramientas reutilizan los criterios ya definidos por Métricas (024),
  campañas (004/010), etiquetas y filtros (006), origen (030/035) y eventos
  del agente (031): esta feature no redefine ninguna cifra.
- La zona horaria por defecto es la de Argentina, como en Métricas; el
  asistente puede pedir otra.
- **Fuera de alcance**: herramientas de escritura (enviar mensajes, mover
  leads, etiquetar, lanzar campañas), acceso de miembros, consultas libres a
  la base, descarga de archivos adjuntos, exportaciones, datos del
  Laboratorio y del Entrenador, y que el CRM haga resúmenes con IA propia.
