# Feature Specification: Conector MCP por empresa — el agente consulta el sistema del cliente

**Feature Branch**: `016-mcp-connector`

**Created**: 2026-09-21

**Status**: Draft

**Input**: Pedido del dueño (21-sep-2026): «El cliente de cabañas (Altos de
Calamuchita, Potrero de Garay y San Clemente) ya tiene su propio sistema de
reservas con un servidor MCP andando. Quiero que el agente de WhatsApp le
pregunte a ESE sistema la disponibilidad, los precios y el enlace, en vez de
contestar con lo que alguien cargó a mano hace tres meses. La reserva la
completa la persona en el sitio: nosotros informamos.» Decisiones cerradas
en la discusión del 21-sep, verificadas contra el servidor real con
credencial: el super admin de la instancia habilita el conector empresa por
empresa y es el único que fija la dirección del servidor; la credencial la
carga el propietario de la empresa; solo herramientas de SOLO LECTURA; un
perfil por proveedor traduce lo que el servidor devuelve (nada específico de
un PMS se cuela en el agente); el agente nunca confirma, retiene ni promete
una reserva.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El super admin habilita el conector para UNA empresa (Priority: P1)

Como super admin de la instancia entro a Administración, elijo la empresa
«Altos de Calamuchita», habilito el conector eligiendo el perfil del
proveedor, una etiqueta visible («Sistema de reservas») y la dirección del
servidor que me pasó el cliente. Desde ese momento esa empresa —y solo esa—
ve una tarjeta nueva en Integraciones. Si me equivoco de dirección o quiero
apuntar a otro servidor, lo edito; el CRM me avisa que eso borra la
credencial cargada. Puedo deshabilitar el conector y la tarjeta desaparece.

**Why this priority**: sin habilitación no hay nada; y es la única capa que
garantiza que la dirección del servidor (el dato con riesgo de red interna)
jamás la escriba un usuario de empresa.

**Independent Test**: habilitar el conector para una empresa de prueba, ver
la tarjeta en esa empresa y comprobar que la empresa vecina no la tiene ni
puede alcanzar la pantalla.

**Acceptance Scenarios**:

1. **Given** una instancia sin conectores, **When** el super admin habilita
   el conector de una empresa con perfil, etiqueta y dirección válidos,
   **Then** queda en estado «Habilitado · sin conectar» y la tarjeta aparece
   en Integraciones de esa empresa.
2. **Given** otra empresa de la misma instancia, **When** su propietario
   abre Integraciones, **Then** no ve la tarjeta y la pantalla de detalle no
   existe para él (no basta con ocultar el enlace).
3. **Given** el formulario de alta, **When** el super admin pega una
   dirección que no es `https://`, que lleva usuario y contraseña embebidos,
   que apunta a una IP o a una red interna, **Then** el alta se rechaza con
   el motivo en castellano y no se guarda nada.
4. **Given** un conector ya conectado, **When** el super admin cambia la
   dirección del servidor o la forma de autenticación, **Then** la
   credencial cargada se borra, el estado vuelve a «Habilitado · sin
   conectar» y el aviso lo anticipa antes de guardar.
5. **Given** dos empresas con la misma dirección de servidor, **When** el
   super admin la guarda, **Then** ve un aviso de que ese endpoint ya está
   en uso por otra empresa (no se bloquea: puede ser legítimo).
6. **Given** un conector habilitado, **When** el super admin lo
   deshabilita, **Then** la tarjeta desaparece, la credencial se borra y el
   agente vuelve a comportarse como antes de la feature.
7. **Given** un propietario de empresa (no super admin), **When** busca
   dónde cambiar la dirección del servidor, **Then** no existe esa opción en
   ninguna pantalla y la dirección completa no aparece en ninguna respuesta
   que reciba su navegador (solo el host, «altosdecalamuchita.com»).

---

### User Story 2 - El propietario conecta el servidor y lo prueba (Priority: P1)

Como propietario de la empresa entro a Integraciones → Sistema de reservas,
pego la credencial que me dio el proveedor y toco «Conectar». El CRM saluda
al servidor, me muestra qué es (nombre y versión), qué herramientas expone y
qué notas trae el proveedor, y la tarjeta pasa a «Conectada». Desde la misma
pantalla pruebo una búsqueda real (entrada, salida, personas) y veo las
propiedades con sus precios y enlaces: así compruebo que anda antes de que
lo use un cliente. Puedo apagar la consulta del agente sin desconectar, y
puedo desconectar cuando quiera.

**Why this priority**: es el momento de la verdad para el dueño del negocio
y la única forma de que la credencial entre al sistema; sin esto la
habilitación no sirve para nada.

**Independent Test**: con el servidor simulado, pegar la credencial,
verificar, ver las herramientas listadas y correr una búsqueda de prueba que
devuelva propiedades con precio.

**Acceptance Scenarios**:

1. **Given** el conector habilitado sin credencial, **When** el propietario
   abre la pantalla, **Then** ve el estado vacío («Este servidor todavía no
   está conectado…»), el host del servidor y el perfil, y el campo para
   pegar la credencial.
2. **Given** la credencial correcta, **When** toca «Conectar» y «Verificar
   conexión», **Then** la tarjeta pasa a «Conectada» y la pantalla muestra
   el nombre del servidor, su versión, la fecha del último saludo y la lista
   de herramientas con su descripción, rotuladas como texto del proveedor.
3. **Given** una credencial equivocada, **When** verifica, **Then** ve
   «El servidor rechazó la credencial. Pedile una nueva al proveedor y volvé
   a cargarla», la tarjeta no queda «Conectada» y la credencial no se guarda
   como buena.
4. **Given** la integración conectada, **When** el propietario mira la
   pantalla, **Then** ve la credencial solo por sus últimos 4 caracteres, y
   la dirección completa del servidor no aparece en ningún lado.
5. **Given** la integración conectada, **When** corre la búsqueda de prueba
   con entrada, salida y personas, **Then** ve las propiedades con el precio
   total, el precio por noche, la seña tal cual la informa el sistema y los
   enlaces clicables.
6. **Given** la integración conectada, **When** apaga «El agente puede
   consultar el sistema de reservas», **Then** el agente deja de ofrecer
   precios y disponibilidad (avisa que el equipo confirma) sin que se pierda
   la credencial.
7. **Given** un miembro del equipo (no propietario), **When** abre la
   pantalla, **Then** puede verla completa pero no conectar, desconectar,
   cambiar ajustes ni correr la prueba.
8. **Given** la integración conectada, **When** el propietario desconecta,
   **Then** el CRM olvida la credencial, la tarjeta vuelve a «No conectada»
   y el agente deja de consultar.

---

### User Story 3 - El agente responde disponibilidad y precios REALES por WhatsApp (Priority: P1)

Una familia escribe «Hola, buscamos cabaña para el finde largo, somos 4».
El agente pregunta lo que falte (fechas, cuántas personas), consulta el
sistema de reservas del negocio y responde con dos opciones concretas: el
nombre de la propiedad, cuántos dormitorios, el precio TOTAL por esas noches
y el enlace del sistema para ver fotos y reservar. Repite siempre para qué
fechas, cuántas noches y cuántas personas cotizó. Si después preguntan «¿y
con pileta?», no vuelve a pedir las fechas: reusa la búsqueda anterior.

**Why this priority**: es el valor de la feature. Sin esto el agente cotiza
de memoria, que es exactamente el problema que el cliente reporta.

**Independent Test**: con el proveedor de IA y el sistema de reservas
simulados, un entrante con fechas y personas produce una única respuesta con
precios que existen en la respuesta del sistema y el enlace exacto que el
sistema devolvió.

**Acceptance Scenarios**:

1. **Given** el conector conectado y el agente encendido, **When** el
   cliente pide alojamiento con fechas y cantidad de personas, **Then** la
   respuesta lista como máximo dos opciones con precio total en pesos,
   repite fechas/noches/personas y pasa UN enlace, tal cual lo devolvió el
   sistema.
2. **Given** que falta alguno de los tres datos (entrada, salida, personas),
   **When** el cliente escribe, **Then** el agente pregunta UNA sola cosa y
   no consulta el sistema todavía.
3. **Given** que el cliente dice «somos 4 y dos chicos», **When** el agente
   consulta, **Then** busca para 6 personas y lo dice en la respuesta («para
   6 personas, del … al …»).
4. **Given** que el cliente dice «este finde» o «mañana», **When** el agente
   convierte a fechas, **Then** usa el día de HOY en la zona del negocio
   (Córdoba), no la del servidor, y aclara en la respuesta qué fechas
   consultó.
5. **Given** una respuesta ya enviada con opciones, **When** el cliente pide
   una variante («¿y con pileta?», «¿algo más barato?»), **Then** el agente
   reusa fechas y personas de la última búsqueda de esa conversación y no
   vuelve a preguntarlas.
6. **Given** que el cliente pide dos características («pileta y parrilla»),
   **When** el agente consulta, **Then** las pide todas juntas (no
   «cualquiera de las dos») y las opciones ofrecidas las cumplen.
7. **Given** que el cliente nombra una propiedad que vio en el sitio
   («contame de la AC-003»), **When** el agente responde, **Then** muestra
   el detalle de esa propiedad y aclara que para el precio necesita las
   fechas.
8. **Given** que el sistema no tiene disponibilidad para esas fechas,
   **When** el agente responde, **Then** ofrece correr las fechas, bajar la
   cantidad de personas o sacar un requisito, y NO inventa alternativas.
9. **Given** una empresa con Google Calendar conectado además del conector,
   **When** el cliente pregunta «¿tienen disponibilidad para el finde?»,
   **Then** el agente entiende que es una estadía (no un turno de 30
   minutos) y consulta el sistema de reservas.
10. **Given** el conector desconectado o el agente sin permiso de consultar,
    **Then** el agente se comporta como antes de esta feature: no ofrece
    precios y avisa que el equipo confirma.

---

### User Story 4 - El agente informa y pasa el enlace: nunca promete una reserva (Priority: P1)

El cliente responde «dale, reservámela». El negocio no toma reservas por
WhatsApp: el agente explica que la reserva se completa en el enlace, lo
vuelve a pasar y, si el cliente insiste, deriva al equipo. En ningún caso
sale un mensaje que diga «te la reservo», «queda guardada» o «te la dejo
tomada», aunque el modelo lo escriba.

**Why this priority**: una reserva prometida y no cumplida es peor que no
responder; es la regla de negocio que el dueño puso como condición.

**Independent Test**: forzar al proveedor de IA simulado a escribir la
frase prohibida → el mensaje que sale al cliente no la contiene y sí lleva
el enlace.

**Acceptance Scenarios**:

1. **Given** una conversación con opciones ya ofrecidas, **When** el cliente
   pide que el agente reserve, **Then** la respuesta explica que la reserva
   se completa en el enlace y lo incluye.
2. **Given** que el modelo intenta escribir una promesa de reserva, **When**
   el mensaje está por salir, **Then** el sistema lo reemplaza por la frase
   segura con el enlace y registra el incidente.
3. **Given** que el cliente insiste en que se lo reserven o pide señar,
   **Then** el agente deriva al equipo (handoff) en vez de improvisar.
4. **Given** cualquier respuesta con precios, **Then** nunca se calcula ni
   se infiere la seña: se muestra el valor que informó el sistema, o no se
   menciona.
5. **Given** que el cliente pide hablar con una persona, **Then** la
   derivación ocurre como siempre, antes de cualquier consulta al sistema
   (cero llamadas, cero costo).

---

### User Story 5 - Cuando el sistema del cliente falla, la conversación no se rompe (Priority: P2)

El PMS se cae, tarda demasiado o la credencial vence. El agente no se
cuelga: le dice al cliente que el equipo le confirma la disponibilidad
enseguida y deriva. El propietario ve la tarjeta en «Requiere reconexión»
con un texto que le dice exactamente qué hacer. La bandeja, la ingesta de
mensajes y los envíos siguen funcionando con normalidad.

**Why this priority**: el sistema es de un tercero y se va a caer; que una
caída ajena tumbe el CRM es inaceptable (Constitución II, categoría 5).

**Independent Test**: simular caída, timeout, respuesta enorme, redirección
y credencial rechazada → ninguna tumba el proceso y cada una produce el
mensaje correcto al cliente y el estado correcto en la UI.

**Acceptance Scenarios**:

1. **Given** el sistema caído o lento, **When** el cliente pregunta precios,
   **Then** el agente responde que el equipo le confirma enseguida, deriva y
   NO inventa números; el estado de la integración no cambia (una caída
   pasajera no es una credencial rota) y el error queda registrado.
2. **Given** que el servidor rechaza la credencial, **Then** la tarjeta pasa
   a «Requiere reconexión» con el motivo, el turno siguiente ya usa el modo
   degradado y no se reintenta con la misma credencial.
3. **Given** que el cliente pide una localidad o un tipo de alojamiento que
   el sistema no conoce, **Then** el agente recibe las opciones válidas,
   vuelve a consultar y responde con resultados; no deriva por eso.
4. **Given** fechas fuera de la ventana publicada (por ejemplo, Navidad del
   año que viene), **Then** el agente lo explica, **captura el lead**
   (queda anotado qué fechas y para cuántas personas preguntó) y ofrece el
   enlace del sitio; no despide al cliente.
5. **Given** una fecha mal escrita o una salida anterior a la entrada,
   **Then** se corrige sin gastar una consulta al sistema.
6. **Given** que el cliente manda cinco mensajes seguidos mientras el agente
   está consultando, **Then** recibe UNA sola respuesta, con los datos del
   último mensaje, nunca dos precios distintos seguidos ni el mismo mensaje
   repetido.
7. **Given** respuestas hostiles del servidor (enormes, redirecciones, texto
   que no es JSON, texto con marcadores del prompt o enlaces a otro
   dominio), **Then** el proceso no se cae, el enlace ajeno no se envía
   nunca y el agente sigue hablando de alojamientos.
8. **Given** cualquier error, **Then** lo que ve la empresa es un texto de
   nuestro catálogo («El servidor no respondió a tiempo…»), jamás el texto
   crudo que eligió el tercero ni detalles internos de la red.

---

### User Story 6 - El Laboratorio y el Entrenador no tocan el sistema real (Priority: P2)

El dueño corre el Laboratorio para evaluar a su agente: las conversaciones
de prueba se responden con datos simulados y no generan ni una consulta al
PMS del cliente (ni gasto, ni ruido en sus métricas, ni atribución falsa de
leads). El juez del Laboratorio entiende que esos precios vienen del sistema
y no los marca como alucinación. Y si el dueño le dicta un precio al
Entrenador, el agente le explica que eso ya lo consulta en vivo y no lo
guarda en su conocimiento.

**Why this priority**: es un guardrail de la constitución y, además, evita
el peor bug silencioso de la feature: un precio viejo congelado en el
conocimiento que compite con el precio real.

**Independent Test**: limpiar el registro de llamadas del servidor simulado,
correr el Laboratorio completo, comprobar que el registro sigue vacío y que
las consultas simuladas sí quedaron anotadas como de prueba.

**Acceptance Scenarios**:

1. **Given** una conversación del Laboratorio, **When** la persona simulada
   pide disponibilidad, **Then** la respuesta usa datos simulados, el
   servidor real no recibe ninguna llamada y la consulta queda registrada
   como de prueba.
2. **Given** una corrida del Laboratorio en una empresa conectada, **Then**
   el juez no penaliza como «alucinación» los precios y propiedades que
   vienen del sistema; sí penaliza cualquier precio o propiedad que no esté
   entre los datos de esa corrida.
3. **Given** el conector conectado, **When** el dueño le dicta al Entrenador
   «la cabaña El Ciervo sale $80.000 la noche», **Then** el agente responde
   que los precios los consulta en vivo y NO guarda el cambio; sí guarda
   políticas (check-in, mascotas, formas de pago, cancelación).
4. **Given** que el conocimiento ya tenía precios cargados a mano, **When**
   el propietario abre la pantalla de la integración, **Then** ve listadas
   esas entradas con montos para poder borrarlas de a una.
5. **Given** el conocimiento con un precio viejo y el conector conectado,
   **When** un cliente pregunta «¿cuánto sale?», **Then** el agente consulta
   el sistema y responde con el precio real, no con el del conocimiento.
6. **Given** una pregunta cubierta por el sistema pero ausente del
   conocimiento («¿aceptan mascotas?»), **Then** el agente la busca en el
   sistema en vez de derivar al equipo.

---

### User Story 7 - Un servidor MCP sin perfil conocido: diagnóstico honesto (Priority: P3)

Un operador quiere conectar el servidor MCP de otro cliente para el que
todavía no escribimos un perfil. Habilita el conector con el perfil
«genérico»: el CRM se conecta, muestra qué servidor es, qué herramientas
expone y qué notas trae, y ahí termina. El agente no recibe ninguna
herramienta nueva ni cambia su comportamiento.

**Why this priority**: es el paso previo a escribir un perfil nuevo y evita
la tentación de exponerle a un modelo herramientas arbitrarias de un
servidor cuya semántica nadie verificó.

**Independent Test**: habilitar con perfil genérico → la pantalla muestra
servidor y herramientas; el prompt del agente no cambia y no hay acciones
nuevas disponibles.

**Acceptance Scenarios**:

1. **Given** el perfil genérico conectado, **Then** la pantalla muestra
   servidor, versión, herramientas y notas del proveedor, todo rotulado como
   texto sin verificar.
2. **Given** el perfil genérico, **When** un cliente pregunta precios,
   **Then** el agente responde como si no hubiera conector: no consulta nada
   y no menciona el sistema.

---

### Edge Cases

- **Ráfaga de mensajes**: «hola» / «somos 4» / «del 10 al 12» / «con
  pileta» tipeados en 25 segundos → una sola consulta y una sola respuesta
  con los cuatro datos; techo de 35 s hasta la primera salida (SC-005).
- **«Somos 4 y 2 chicos»**: los menores cuentan como huéspedes salvo que el
  sistema diga otra cosa; la respuesta dice para cuántas personas se cotizó.
- **Fechas fuera de la ventana publicada**: se explica, se anota el pedido
  como nota del lead y se ofrece el enlace del sitio; nunca se cierra la
  conversación con «no hay precios».
- **«¿Me la reservás vos?»**: frase segura + enlace; insistencia → handoff.
- **«Quiero hablar con una persona»**: deriva antes de cualquier consulta.
- **Conocimiento con precios viejos**: el sistema manda; la pantalla lista
  esas entradas para que el dueño las limpie.
- **Característica inventada por el modelo** («helipuerto»): se descarta,
  se avisa cuál se ignoró y la búsqueda sigue; no se aborta.
- **El detalle de una propiedad no trae precio** (depende de fechas): el
  agente lo dice y cotiza con las fechas.
- **Vocabulario compartido con la agenda**: «disponibilidad» significa
  estadía en un negocio de alojamientos y turno en la agenda; el agente
  distingue y jamás ofrece un turno de 30 minutos a quien quiere una cabaña.
- **Catálogo vencido** (tipos, localidades, características, ventana): se
  usa el último conocido y se refresca en segundo plano; el turno del agente
  nunca espera por el refresco.
- **Sin catálogo** (nunca se pudo traer): las búsquedas siguen funcionando;
  el sistema valida y el agente corrige con lo que le responde.
- **Un turno con agenda Y sistema de reservas**: cada uno con su propio
  presupuesto de consultas; agotar uno no deja al otro sin respuesta, y la
  degradación que recibe el cliente es la de su negocio (cabañas, no turnos).
- **El servidor cambia de manos**: cambiar la dirección o la forma de
  autenticación borra la credencial; hay que pegarla de nuevo.
- **Dos empresas con el mismo endpoint**: se permite, con aviso al super
  admin.
- **La misma consulta repetida dentro del mismo turno**: no se vuelve a
  preguntar al sistema; se reusa lo ya traído.
- **Moneda distinta de pesos**: se imprime el código tal cual y NO se
  convierte.
- **Enlace de un dominio ajeno** devuelto por el servidor: se omite y la
  respuesta lo dice; nunca llega a un WhatsApp.
- **Empresa sin conector que reciba una acción alucinada del modelo**: se
  degrada con handoff, no se intenta llamar a ningún servidor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El super admin MUST poder habilitar el conector para una
  empresa concreta, fijando perfil, etiqueta y dirección del servidor;
  ninguna otra empresa MUST ver la tarjeta ni poder alcanzar la pantalla de
  detalle. Deshabilitarlo MUST borrar la credencial y devolver al agente su
  comportamiento previo.
- **FR-002**: Un usuario de empresa MUST NOT poder escribir la dirección del
  servidor, ni verla completa: la UI muestra únicamente el host.
- **FR-003**: La dirección MUST validarse al guardarla y **de nuevo en cada
  conexión**, sobre la dirección de red realmente resuelta: solo `https://`,
  sin usuario ni contraseña embebidos, fuera de redes internas, de loopback,
  de link-local y de los endpoints de metadata de nube; una redirección MUST
  rechazarse en vez de seguirse. Cada conexión MUST tener timeout, tope de
  tamaño de respuesta y límite de consultas por empresa.
- **FR-004**: La credencial MUST guardarse cifrada en reposo y MUST NOT
  salir al navegador, a un log ni a un mensaje de error; la UI solo muestra
  sus últimos 4 caracteres.
- **FR-005**: Cambiar la dirección del servidor o la forma de autenticación
  MUST borrar la credencial guardada y volver el estado a «habilitado, sin
  conectar», avisándolo antes de guardar.
- **FR-006**: Solo el rol propietario MUST poder cargar, rotar o borrar la
  credencial, cambiar los ajustes del agente y correr la prueba; los demás
  miembros pueden ver.
- **FR-007**: El conector MUST invocar únicamente herramientas de SOLO
  LECTURA declaradas por el perfil; MUST NOT ejecutar escrituras, reservas,
  pagos ni acciones irreversibles en el sistema del tercero, aunque el
  servidor las ofrezca.
- **FR-008**: El agente MUST consultar el sistema antes de dar precios,
  disponibilidad o características de las propiedades, y MUST NOT
  inventarlos. Con el conector conectado, el sistema MUST prevalecer sobre
  el conocimiento cargado a mano, y una pregunta cubierta por el sistema
  MUST responderse consultándolo, no derivando. Toda respuesta con precios
  MUST repetir fechas, noches y cantidad de personas, y una pregunta de
  seguimiento MUST reusar los datos de la última búsqueda de esa
  conversación. El Entrenador MUST NOT guardar precios ni disponibilidad en
  el conocimiento mientras el conector esté conectado.
- **FR-009**: El agente MUST NOT prometer, confirmar, señar ni bloquear una
  reserva: informa y pasa el enlace. Esta regla MUST verificarse sobre el
  texto que sale al contacto, no solo pedirse en las instrucciones del
  modelo.
- **FR-010**: Toda URL devuelta por el servidor MUST validarse contra los
  dominios del perfil antes de enviarse a un contacto; la que no valide MUST
  omitirse. Los enlaces MUST pasarse tal cual los devolvió el sistema, sin
  reconstruirlos.
- **FR-011**: Todo texto que devuelva el servidor MUST tratarse como DATO y
  nunca como instrucción: delimitado, acotado en tamaño, sin marcadores
  internos del sistema, sin capacidad de cambiar las reglas del agente ni el
  contrato de sus acciones. Las notas del proveedor MUST estar apagadas por
  defecto y ser visibles en la UI antes de habilitarlas.
- **FR-012**: Una caída, un timeout, una respuesta ilegible o una credencial
  rechazada MUST degradar la respuesta (el agente lo dice y deriva) sin
  tumbar el turno, la ingesta ni el envío; una credencial rechazada MUST
  dejar la integración en «requiere reconexión» visible para el propietario,
  y una caída pasajera MUST NOT cambiar el estado.
- **FR-013**: Las conversaciones del Laboratorio (`is_test`) MUST NOT
  generar tráfico al servidor real: se responden con datos simulados y la
  consulta simulada MUST quedar registrada como de prueba, para poder
  demostrarlo. El juez del Laboratorio MUST conocer esos datos para no
  marcarlos como alucinación.
- **FR-014**: El self-test MUST poder ejercer todo el flujo —alta, conexión,
  búsqueda, errores del proveedor, texto hostil, caída y sandbox— sin el
  servidor real.
- **FR-015**: El turno del agente MUST tener cota dura de consultas y de
  tiempo, con presupuesto separado por familia de herramientas (agenda y
  sistema de reservas) para que una no consuma el de la otra; agotado el
  presupuesto, la degradación MUST ser la del negocio correspondiente.
- **FR-016**: Los mensajes de error que ven la empresa, la API y la bitácora
  MUST salir de un catálogo propio de textos; MUST NOT reproducir el texto
  que eligió el servidor de terceros ni exponer detalles de red que sirvan
  para sondear la infraestructura.

### Fuera de alcance (v1)

- Cualquier escritura contra el sistema del cliente: reservas, pagos,
  bloqueos, cancelaciones.
- Herramientas para el agente sobre un servidor sin perfil conocido (el
  perfil genérico solo diagnostica).
- Más de un servidor por empresa.
- OAuth contra el servidor MCP, conexiones persistentes y las partes del
  protocolo que no son herramientas.
- Cobro, checkout o confirmación de la reserva dentro de Vocero.

### Key Entities

- **Conector MCP de la empresa**: una conexión por organización — perfil del
  proveedor, etiqueta visible, host del servidor, estado (habilitado /
  conectada / requiere reconexión / deshabilitada), credencial cifrada y sus
  últimos 4, zona horaria del negocio, límites (timeout, tamaño, tasa), si
  el agente puede consultar, notas del proveedor y si se usan, catálogo
  guardado con su fecha, último saludo y último error.
- **Perfil del proveedor**: qué herramientas se pueden invocar, cuáles se
  exigen para dar la conexión por buena, qué catálogo se trae por
  adelantado, qué dominios se admiten en los enlaces y qué puede hacer el
  agente con ese sistema. Hoy: «Altos de Calamuchita (alojamientos)» y
  «genérico» (sin herramientas).
- **Bitácora de consultas**: cada consulta al sistema con herramienta,
  argumentos, resultado o código de error, duración, conversación asociada y
  si fue simulada; es la evidencia del sandbox y la memoria de la última
  búsqueda de cada conversación.

## Success Criteria *(mandatory)*

- **SC-001**: El super admin habilita el conector y el propietario lo
  conecta y corre una búsqueda de prueba exitosa en menos de 3 minutos, sin
  ayuda técnica.
- **SC-002**: 0 precios, propiedades o enlaces inventados en el guion E2E:
  todo valor que llega a un contacto existe en la respuesta del sistema.
- **SC-003**: 0 llamadas al sistema desde conversaciones del Laboratorio,
  demostrado con el registro de llamadas del servidor simulado y con la
  bitácora de consultas marcadas como de prueba.
- **SC-004**: 0 caídas del proceso ante respuestas hostiles (2 MB,
  redirección, texto que no es JSON, timeout, texto con marcadores del
  sistema); la bandeja manual y la ingesta siguen operando.
- **SC-005**: ≤ 35 segundos desde el último mensaje del cliente hasta la
  primera respuesta con precios, con una ráfaga de 4 o 5 mensajes seguidos.

## Assumptions

- La constitución fue enmendada a 1.7.0 con una quinta categoría de
  dependencia externa: servidores MCP de terceros POR EMPRESA, de solo
  lectura, habilitados por el super admin. Sin el conector el producto
  funciona completo y el agente sigue atendiendo con su conocimiento propio;
  el instalador no lo necesita.
- El servidor del primer cliente es de solo lectura y sin estado: una
  consulta por llamada, sin sesión que mantener. Sus errores viajan con el
  detalle adentro del resultado y no en el código HTTP, así que mirar el
  status nunca alcanza.
- Los valores del negocio (tipos de alojamiento, localidades,
  características, ventana de fechas con precios publicados, moneda) salen
  del catálogo que publica el servidor y NO se escriben a mano en ningún
  lado: cambian cuando el cliente los cambia.
- La seña o depósito varía por propiedad: se muestra tal cual lo informa el
  sistema y jamás se calcula como porcentaje.
- El identificador de la conversación viaja en los enlaces que arma el
  sistema, de modo que el proveedor puede atribuirse el lead que originó el
  CRM. Es un beneficio buscado, no un efecto lateral.
- Una sola conexión por empresa en v1; admitir varias más adelante es
  aditivo.
- El «hoy» del negocio se toma de la ventana que publica el proveedor, con
  la zona horaria de la empresa como respaldo (default
  America/Argentina/Cordoba).
- El conector no agrega ninguna variable de entorno nueva al runtime: la
  dirección la carga el super admin por pantalla y la credencial la carga la
  empresa.
- La reserva se completa siempre en el sitio del proveedor: Vocero no cobra,
  no bloquea ni confirma nada.
