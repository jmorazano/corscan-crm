# Feature Specification: Multitenancy real — varias empresas en una instancia

**Feature Branch**: `003-multitenancy`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Multitenancy real: el CRM maneja varias empresas/teléfonos (segundo tenant: Masterbrand, atención al cliente del socio); rol super admin que gestiona empresas y usuarios (crear empresa, crear su usuario admin; luego ese admin gestiona todo como hoy); el token del LLM deja de ser variable de entorno y pasa a configuración por empresa cifrada, para que cada admin use el suyo y monitoree sus gastos."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El super admin crea una empresa nueva con su admin inicial (Priority: P1)

El dueño de la instancia (super admin) entra a una sección de Administración,
crea la empresa "Masterbrand" y, en el mismo flujo, el usuario administrador
inicial para su socio. El sistema genera una contraseña temporal que se
muestra UNA sola vez; el super admin se la entrega a mano (WhatsApp, en
persona). El socio inicia sesión y ve su CRM vacío y listo: pipeline de
etapas, perfil de agente por defecto y sus Ajustes — sin rastro de la otra
empresa.

**Why this priority**: es la capacidad que hoy no existe en absoluto (la
instancia solo sabe crear la primera empresa) y la puerta de entrada de todo
lo demás.

**Independent Test**: crear una empresa desde Administración, entrar con las
credenciales entregadas y verificar que el nuevo admin opera su empresa
(Equipo, Ajustes) sin ver datos ajenos.

**Acceptance Scenarios**:

1. **Given** una instancia con la empresa original operando, **When** el
   super admin crea "Masterbrand" con nombre + email del admin inicial,
   **Then** la empresa queda lista (etapas y perfil de agente sembrados) y se
   muestran las credenciales temporales una única vez.
2. **Given** el admin inicial recibió sus credenciales, **When** inicia
   sesión, **Then** entra directo a SU empresa y puede gestionar Equipo,
   Ajustes y Bandeja como lo hace hoy el dueño con la suya.
3. **Given** un usuario común (no super admin), **When** intenta acceder a la
   sección Administración o a sus operaciones, **Then** el sistema se lo
   niega.
4. **Given** el super admin repite la creación con el mismo email, **Then**
   recibe un error claro y no se duplica nada (idempotencia).

---

### User Story 2 - Cada empresa vive aislada de las demás (Priority: P1)

Con dos empresas operando a la vez, cada equipo ve exclusivamente lo suyo:
conversaciones, contactos, plantillas, laboratorio, equipo y eventos en vivo.
Los mensajes entrantes de cada número de WhatsApp llegan a la bandeja de la
empresa dueña de ese número, y nada de lo que haga una empresa (incluida la
recarga del negocio de demostración) toca datos de la otra.

**Why this priority**: sin aislamiento verificado no hay multitenancy — hay
una fuga de datos esperando; incluye la corrección del borrado de demo sin
scope, que hoy es destructivo entre empresas.

**Independent Test**: sembrar dos empresas con números y conversaciones
propias; verificar por UI y por API directa que ninguna operación de A
alcanza datos de B, y que los eventos en vivo de A no llegan a sesiones de B.

**Acceptance Scenarios**:

1. **Given** dos empresas conectadas con números distintos, **When** entra un
   mensaje a cada número, **Then** cada mensaje aparece solo en la bandeja de
   su empresa.
2. **Given** un usuario de la empresa A autenticado, **When** intenta leer o
   borrar por API un recurso de la empresa B (conversación, contacto,
   plantilla), **Then** recibe "no existe"/denegado y nada cambia en B.
3. **Given** la empresa A recarga su negocio de demostración, **Then**
   ningún contacto o conversación de B se ve afectado, aunque compartan
   teléfonos de contacto iguales.
4. **Given** las herramientas de autoservicio de la plataforma de
   autenticación, **When** alguien intenta crear una organización por fuera
   del flujo del super admin, **Then** la operación está deshabilitada.

---

### User Story 3 - Cada empresa usa su propio token de IA (Priority: P2)

El admin de cada empresa pega su propio token del proveedor LLM en Ajustes
(se guarda cifrado; solo se muestran los últimos 4), y opcionalmente elige
modelo del agente y del juez del Laboratorio. Desde ese momento, todo consumo
de IA de esa empresa corre contra SU token — cada uno monitorea su gasto en
el panel de su proveedor. Una empresa sin token tiene el agente apagado con
un aviso claro; la atención manual sigue funcionando.

**Why this priority**: separa los gastos entre socios (el pedido explícito) y
elimina el token global. Va después del aislamiento porque depende de que
las empresas existan.

**Independent Test**: configurar tokens distintos en dos empresas y verificar
que cada turno de agente usa el de su empresa; quitar el token de una y
verificar el apagado limpio con aviso.

**Acceptance Scenarios**:

1. **Given** una empresa sin token configurado, **When** entra un mensaje,
   **Then** el agente no actúa, la bandeja funciona normal y Ajustes muestra
   por qué el agente está apagado y cómo activarlo.
2. **Given** dos empresas con tokens distintos, **When** el agente responde
   en cada una, **Then** cada consumo viaja con el token de la empresa dueña
   de la conversación (jamás el de la otra).
3. **Given** un admin pega un token, **Then** solo se ven sus últimos 4
   caracteres desde ese momento, y puede reemplazarlo o borrarlo.
4. **Given** un token inválido o el proveedor caído, **When** el agente
   intenta responder, **Then** el turno degrada sin colgarse y el humano
   puede seguir atendiendo.

---

### User Story 4 - Masterbrand conecta su propio WhatsApp (Priority: P3)

El admin de Masterbrand entra a sus Ajustes y conecta el número de WhatsApp
de su empresa con el mismo asistente de conexión que existe hoy (incluida la
opción de seguir usando el número en el celular). No necesita al super admin
para esto.

**Why this priority**: la conexión por empresa ya existe y el ruteo por
número ya es multi-empresa; esta historia sobre todo VERIFICA que funciona
con N empresas y define el límite aceptado (un número por empresa).

**Independent Test**: conectar un segundo número (mock o real) desde la
segunda empresa y verificar el circuito entrante/saliente de esa empresa.

**Acceptance Scenarios**:

1. **Given** el admin de Masterbrand en sus Ajustes, **When** conecta su
   número, **Then** su empresa queda operativa sin intervención del super
   admin y sin afectar la conexión de la otra empresa.

---

### User Story 5 - El super admin gestiona usuarios de cualquier empresa (Priority: P3)

Desde Administración, el super admin ve las empresas con sus usuarios, puede
crear usuarios adicionales en cualquier empresa y restablecer la contraseña
de un usuario (nueva contraseña temporal mostrada una vez, entrega manual) —
la red de rescate cuando un admin se bloquea, sin depender de emails.

**Why this priority**: operación de soporte; valiosa pero no bloquea el MVP
(el admin de cada empresa ya gestiona su equipo).

**Independent Test**: crear un usuario extra y restablecer una contraseña
desde Administración; verificar acceso con las nuevas credenciales.

**Acceptance Scenarios**:

1. **Given** el super admin en Administración, **When** restablece la
   contraseña del admin de Masterbrand, **Then** se muestra una contraseña
   temporal nueva una única vez y la anterior deja de servir.

---

### Edge Cases

- Email ya usado por un usuario de otra empresa → error claro; un usuario
  pertenece a una sola empresa en esta versión. (Supuesto aceptado y
  registrado: el error de duplicado revela que un email tiene cuenta en la
  instancia — un oráculo de existencia entre empresas tolerable con dos
  socios que se conocen; revisar si la instancia crece.)
- Un usuario con contraseña temporal intenta operar sin cambiarla → el
  sistema lo lleva al cambio obligatorio antes de cualquier otra pantalla.
- Nombre de empresa repetido → se permite el nombre visible repetido pero la
  identidad interna es única (sin colisiones).
- Usuario con más de una membresía (dato histórico o error) → el sistema
  resuelve SIEMPRE la misma empresa activa (determinista), no una al azar.
- El super admin también es dueño de su propia empresa → sus dos sombreros no
  se mezclan: Administración para la plataforma, su CRM para su empresa.
- La instancia existente se actualiza → la empresa original sigue operando
  sin cambios visibles; su agente sigue funcionando apenas su admin pegue el
  token en Ajustes (aviso claro hasta entonces).
- Empresa recién creada que nunca conecta WhatsApp ni token → todo lo demás
  funciona; los avisos indican qué falta.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST reconocer un rol de plataforma "super admin",
  asignado de forma idempotente al dueño de la instancia mediante
  configuración de la instancia (sin registro público).
- **FR-002**: El super admin MUST poder crear una empresa nueva con su
  usuario admin inicial en un solo flujo; la empresa nace con sus datos
  semilla (etapas de pipeline y perfil de agente) iguales a los de la
  primera empresa de la instancia.
- **FR-003**: Las credenciales iniciales (y los restablecimientos) MUST
  entregarse en pantalla una única vez, para entrega manual; el sistema no
  envía emails (soberanía).
- **FR-004**: La sección Administración y todas sus operaciones MUST estar
  vedadas a cualquier usuario que no sea super admin, tanto en UI como en
  API.
- **FR-005**: Todo dato de dominio MUST seguir perteneciendo a exactamente
  una empresa; ninguna operación de una empresa puede leer ni modificar
  datos de otra (incluida la recarga del negocio de demostración, hoy sin
  scope — corregir).
- **FR-006**: Los eventos en vivo MUST llegar solo a sesiones de la empresa
  dueña del evento (comportamiento actual, que MUST quedar cubierto por la
  verificación).
- **FR-007**: Los mensajes entrantes MUST rutearse a la empresa dueña del
  número receptor con N empresas conectadas (un número por empresa en esta
  versión).
- **FR-008**: El token del proveedor LLM MUST configurarse por empresa,
  cifrado en reposo, visible solo por sus últimos 4, reemplazable y
  borrable desde Ajustes por el admin de la empresa.
- **FR-009**: El modelo del agente y el del juez del Laboratorio MUST poder
  elegirse por empresa, con valores por defecto sensatos.
- **FR-010**: Todo consumo de IA MUST ejecutarse con la configuración de la
  empresa dueña de la conversación/corrida; sin token, el agente y el
  Laboratorio de esa empresa quedan inactivos con aviso claro, sin fallback
  a un token global.
- **FR-011**: La actualización de una instancia existente MUST ser
  idempotente y no interrumpir a la empresa original (su bandeja, número,
  equipo e historial quedan intactos).
- **FR-012**: La resolución de la empresa activa de un usuario MUST ser
  determinista aunque existan múltiples membresías.
- **FR-013**: TODA mutación de organizaciones y membresías por fuera de los
  flujos propios del producto (Administración y Equipo) MUST quedar
  deshabilitada — semántica de lista de permitidos: se niega todo lo no
  usado explícitamente por la aplicación, incluidas creación, borrado,
  invitaciones y cambios de rol de la plataforma de autenticación.
- **FR-014**: El super admin MUST poder listar empresas con sus usuarios,
  crear usuarios adicionales en una empresa y restablecer contraseñas
  (entrega manual).
- **FR-015**: Los textos de la interfaz MUST dejar de referir el token de IA
  como variable de entorno y guiar a la configuración por empresa.
- **FR-016**: Ningún camino de alta o edición de usuarios (Equipo de una
  empresa, Administración) MUST permitir crear o modificar una cuenta cuyo
  email esté designado como super admin, salvo que quien opera sea super
  admin — cierra la escalación de privilegios por registro de un email
  reservado.
- **FR-017**: Toda contraseña generada por un tercero (alta inicial o
  restablecimiento) MUST ser realmente temporal: el usuario MUST cambiarla
  en su primer inicio de sesión antes de operar, y todo usuario MUST poder
  cambiar su propia contraseña en cualquier momento. Esto garantiza que
  quien generó la credencial (super admin u owner) pierde el acceso a la
  cuenta ajena apenas su dueño la estrena.
- **FR-018**: La actualización de una instancia existente MUST verificarse
  ejercitando la migración sobre una base con datos previos (no solo sobre
  una instancia vacía); la verificación final sobre la instancia productiva
  se marca como pendiente de verificación en el deploy (Principio V).

### Key Entities

- **Empresa (organización)**: el tenant; posee conversaciones, contactos,
  plantillas, equipo, conexión de WhatsApp, configuración de IA y datos de
  laboratorio.
- **Usuario**: pertenece a exactamente una empresa (en esta versión) con rol
  de empresa (dueño/miembro); adicionalmente puede portar el rol de
  plataforma super admin.
- **Configuración de IA por empresa**: token cifrado (last-4 visible),
  modelo del agente, modelo del juez; existe a lo sumo una por empresa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El super admin crea una empresa nueva con su admin inicial en
  menos de 2 minutos, y ese admin inicia sesión al primer intento con las
  credenciales entregadas.
- **SC-002**: Cero visibilidad cruzada: los intentos explícitos de una
  empresa por leer/modificar datos de otra (UI y API directa) fallan el
  100% de las veces en la verificación.
- **SC-003**: Con dos números conectados, el 100% de los mensajes entrantes
  de la verificación aparece en la bandeja de la empresa correcta.
- **SC-004**: Cada respuesta del agente en la verificación consume el token
  de su propia empresa; una empresa sin token no genera NINGÚN consumo y su
  bandeja manual sigue operativa.
- **SC-005**: Tras actualizar la instancia real, la empresa original opera
  sin regresión (mismo número conectado, mismas conversaciones, mismo
  equipo) y su agente vuelve a responder apenas se configura el token en
  Ajustes.

## Assumptions

- El super admin es el dueño de la instancia (hoy: una persona); el
  bootstrap se hace por configuración de la instancia y es re-ejecutable
  sin efectos duplicados.
- Sin servicio de email (constitución II): toda entrega de credenciales es
  manual, en pantalla y por única vez.
- Un usuario pertenece a una sola empresa; compartir un usuario entre
  empresas queda fuera de alcance.
- Un número de WhatsApp por empresa (límite actual aceptado); varios números
  por empresa queda fuera de alcance.
- Sin fallback global del token de IA: la variable de entorno actual queda
  deprecada; tras la actualización, cada empresa (incluida la original)
  activa su agente pegando su token en Ajustes.
- El monitoreo de gastos de IA se hace en el panel del proveedor de cada
  empresa; un panel de gastos dentro del CRM queda fuera de alcance.
- Desactivar/eliminar empresas y la suplantación (entrar "como" otra
  empresa) quedan fuera de alcance de esta versión; el super admin gestiona
  sin navegar los datos de las otras empresas.
- El aislamiento de eventos en vivo y el ruteo por número ya existen; esta
  feature los cubre con verificación, no los reimplementa.
