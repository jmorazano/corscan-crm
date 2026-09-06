# Feature Specification: Integraciones + Google Calendar (turnos por el agente)

**Feature Branch**: `005-integrations-google-calendar`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Nueva sección del sidenav 'Integraciones' donde
viven las integraciones soportadas; la primera es Google Calendar. El admin
de la empresa conecta Google Calendar al CRM de su empresa y así el agente
puede consultar turnos disponibles (sin dar detalles de turnos existentes)
y agendar turnos nuevos según reglas de horarios. Probablemente parte del
KB del agente. Entregar el paso a paso de GCP."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conectar Google Calendar a mi empresa (Priority: P1)

El propietario de una empresa entra a la nueva sección **Integraciones**
del menú lateral, ve la tarjeta de Google Calendar y pulsa "Conectar". Se
abre la pantalla de consentimiento de Google, elige la cuenta del negocio y
acepta. Al volver al CRM ve la integración conectada: la cuenta usada,
el calendario elegido (por defecto el principal, cambiable entre los
calendarios de esa cuenta) y la zona horaria. Puede desconectarla en
cualquier momento; al hacerlo el CRM olvida las credenciales.

**Why this priority**: sin conexión no hay agenda que consultar; es el
prerequisito de todo y tiene valor propio (los turnos del negocio quedan
visibles y administrables desde el CRM).

**Independent Test**: conectar con una cuenta de prueba, ver la tarjeta
"Conectada · cuenta@…", cambiar el calendario, desconectar y comprobar que
vuelve al estado inicial y que la BD no conserva tokens.

**Acceptance Scenarios**:

1. **Given** una instancia con la integración habilitada por el operador,
   **When** el propietario abre Integraciones, **Then** ve la tarjeta Google
   Calendar en estado "No conectada" con el botón Conectar.
2. **Given** la tarjeta, **When** pulsa Conectar y acepta en Google, **Then**
   vuelve a Integraciones → Google Calendar con estado "Conectada", la
   cuenta usada y el calendario principal seleccionado.
3. **Given** la integración conectada, **When** cambia el calendario o la
   zona horaria y guarda, **Then** el cambio persiste y se refleja al
   recargar.
4. **Given** un usuario con rol de equipo (no propietario), **When** abre la
   integración, **Then** puede verla pero no conectar, desconectar ni editar
   reglas.
5. **Given** una instancia SIN la integración habilitada por el operador,
   **Then** la tarjeta explica que el operador debe configurarla y no ofrece
   Conectar.
6. **Given** el usuario cancela en Google o Google devuelve error, **Then**
   vuelve a la sección con un aviso claro y nada queda conectado.
7. **Given** la integración conectada, **When** desconecta, **Then** el CRM
   borra las credenciales, revoca el acceso en Google (si es posible) y el
   agente deja de ofrecer turnos.

---

### User Story 2 - Definir las reglas de turnos (Priority: P1)

El propietario configura cómo se agenda: días y franjas horarias de
atención por día de la semana, duración del turno, margen entre turnos,
anticipación mínima, horizonte máximo, si el agente puede agendar solo, e
instrucciones libres para el agente (qué datos pedir, qué no agendar). La
pantalla muestra una vista previa de los próximos huecos libres calculada
con esas reglas y la agenda real, para comprobar que quedaron bien.

**Why this priority**: sin reglas el agente ofrecería cualquier hora; las
reglas son lo que hace que un turno agendado por IA sea aceptable para el
negocio.

**Independent Test**: definir lunes 9–12, turnos de 30 min, y ver en la
vista previa exactamente los huecos 9:00, 9:30, …, 11:30 del próximo
lunes, descontando cualquier evento ya existente en el calendario.

**Acceptance Scenarios**:

1. **Given** la integración conectada, **When** guarda reglas válidas,
   **Then** la vista previa muestra los huecos libres de los próximos días
   respetando franjas, duración, margen, anticipación y horizonte.
2. **Given** un evento existente en el calendario a las 10:00, **Then** la
   vista previa NO ofrece 10:00 (ni ningún hueco que se solape) y no muestra
   ningún dato del evento existente.
3. **Given** franjas inválidas (fin antes que inicio, formato incorrecto),
   **Then** el guardado se rechaza con el motivo y no se pisa lo anterior.
4. **Given** "el agente puede agendar" apagado, **Then** el agente sigue
   pudiendo informar disponibilidad pero, ante un pedido de reserva, deriva
   al equipo.

---

### User Story 3 - El agente ofrece y agenda turnos por WhatsApp (Priority: P1)

Un cliente escribe por WhatsApp pidiendo turno. El agente consulta la
disponibilidad real (calendario + reglas), ofrece opciones concretas sin
revelar nada de otros turnos, y cuando el cliente elige una, la agenda: el
evento aparece en el Google Calendar del negocio con el nombre y teléfono
del cliente, el cliente recibe la confirmación por WhatsApp, el turno queda
registrado en el CRM (visible en la integración y como nota del lead). Si
el hueco se ocupó mientras tanto, el agente ofrece alternativas en lugar
de duplicar.

**Why this priority**: es el valor de negocio de la feature: convertir una
conversación en un turno sin intervención humana.

**Independent Test**: con el proveedor de IA y Google simulados, un inbound
"quiero un turno para el martes" produce una respuesta con huecos reales;
"dale, el de las 10" crea el evento, confirma por WhatsApp y registra el
turno.

**Acceptance Scenarios**:

1. **Given** el agente encendido y la integración conectada, **When** el
   cliente pregunta por turnos, **Then** la respuesta lista huecos libres
   reales (fecha y hora) dentro de las reglas y jamás menciona eventos
   ajenos.
2. **Given** huecos ofrecidos, **When** el cliente elige uno, **Then** se
   crea el evento en el calendario, el cliente recibe confirmación con
   fecha/hora y el turno aparece en la lista de turnos de la integración.
3. **Given** que el hueco elegido se ocupó entre la oferta y la elección,
   **Then** no se crea nada y el agente ofrece alternativas.
4. **Given** el cliente pide un horario fuera de las reglas (domingo, hoy
   dentro de la anticipación mínima, más allá del horizonte), **Then** el
   agente lo explica y ofrece opciones válidas; nunca agenda fuera de
   reglas aunque el modelo lo pida.
5. **Given** el mismo cliente ya tiene un turno futuro, **Then** el agente
   lo sabe (puede recordárselo); solo el turno de ESE cliente, nunca los de
   otros.
6. **Given** Google falla o las credenciales caducaron, **Then** el agente
   no se cuelga: informa que confirmará con el equipo y deriva; la
   integración queda marcada "requiere reconexión" y el propietario lo ve.
7. **Given** una conversación del Laboratorio (sandbox), **Then** nada llega
   a Google: la disponibilidad se simula solo con las reglas y la reserva
   se simula sin crear eventos.
8. **Given** la integración desconectada o "agente puede agendar" apagado,
   **Then** el agente se comporta como antes de esta feature para reservas.

---

### User Story 4 - Ver y cancelar turnos desde el CRM (Priority: P2)

El equipo ve en la integración la lista de próximos turnos agendados desde
el CRM (cliente, fecha/hora, origen) y puede cancelar uno: se elimina del
calendario y queda como cancelado en el CRM.

**Independent Test**: cancelar un turno agendado por el agente → desaparece
del calendario simulado y la lista lo muestra cancelado.

**Acceptance Scenarios**:

1. **Given** turnos agendados, **When** abre la integración, **Then** ve la
   lista ordenada por fecha con nombre del cliente y estado.
2. **Given** un turno confirmado, **When** lo cancela, **Then** el evento se
   borra del calendario y el turno figura como cancelado (no desaparece del
   historial).

---

### Edge Cases

- Cambio de horario de verano en la zona configurada: los huecos se
  calculan en hora local del negocio (no se corren una hora).
- Reglas con dos franjas el mismo día (mañana y tarde) y días sin franja.
- El calendario elegido deja de existir o pierde permisos → estado
  "requiere reconexión" con mensaje claro; el agente deriva.
- Token de acceso vencido en medio de un turno del agente → se renueva de
  forma transparente; si la renovación falla, degrada sin colgarse.
- Dos clientes eligen el mismo hueco casi a la vez → el segundo recibe
  alternativas (verificación contra la agenda real antes de crear).
- Reintento del mismo turno (el modelo repite la acción) → no se duplica
  el evento (idempotente por cliente + inicio).
- El modelo devuelve fecha/hora mal formada → se degrada a pedir
  aclaración; nunca se agenda un inicio inválido.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El menú lateral MUST incluir la sección "Integraciones" con
  una página índice que liste las integraciones soportadas (hoy: Google
  Calendar) y su estado.
- **FR-002**: La integración Google Calendar es POR EMPRESA (una conexión
  por organización); conectar, desconectar y editar reglas MUST estar
  restringido al rol propietario; los demás miembros pueden ver.
- **FR-003**: La conexión MUST hacerse por OAuth con consentimiento del
  usuario en Google; el CRM MUST pedir solo los permisos necesarios (leer
  calendarios/eventos y crear eventos), con acceso persistente (refresh).
- **FR-004**: Las credenciales de Google MUST guardarse cifradas en reposo y
  MUST NOT viajar al navegador ni a logs; la UI solo muestra la cuenta
  conectada y el calendario.
- **FR-005**: La habilitación de la integración es DE INSTANCIA (el
  operador provee las credenciales de la app de Google por entorno); sin
  ellas la tarjeta MUST explicarlo y no ofrecer Conectar.
- **FR-006**: El propietario MUST poder elegir el calendario destino entre
  los de la cuenta conectada y la zona horaria del negocio.
- **FR-007**: Las reglas de turnos MUST incluir: franjas por día de la
  semana (0..n por día), duración del turno, margen entre turnos,
  anticipación mínima, horizonte máximo, "el agente puede agendar" e
  instrucciones libres para el agente. Defaults razonables al conectar.
- **FR-008**: El cálculo de huecos libres MUST descontar los eventos
  ocupados del calendario y los turnos ya registrados, en hora local del
  negocio, y MUST NOT exponer ningún dato de esos eventos (solo
  ocupado/libre).
- **FR-009**: La página de la integración MUST mostrar una vista previa de
  los próximos huecos libres calculada con las reglas vigentes.
- **FR-010**: El agente MUST poder (a) consultar disponibilidad para una
  fecha o rango y (b) agendar un turno en un hueco válido, como acciones
  del turno del agente validadas por el servidor contra las reglas y contra
  la agenda real en el momento de agendar.
- **FR-011**: Al agendar, el sistema MUST crear el evento en el calendario
  con nombre y teléfono del cliente (y nota si la hay), registrar el turno
  en el CRM asociado al contacto y la conversación, dejar nota en el lead y
  confirmar por WhatsApp.
- **FR-012**: Agendar MUST ser idempotente por (empresa, contacto, inicio):
  repetir la acción no duplica eventos.
- **FR-013**: Ante fallo del proveedor de calendario o credenciales
  caducadas, el turno del agente MUST degradar sin colgarse (respuesta de
  "lo confirmo con el equipo" + derivación) y la integración MUST quedar en
  estado "requiere reconexión" visible en la UI.
- **FR-014**: Las conversaciones de prueba (Laboratorio) MUST NOT tocar el
  calendario real: disponibilidad simulada solo con reglas y reserva
  simulada.
- **FR-015**: El equipo MUST poder ver los próximos turnos agendados desde
  el CRM y cancelar uno (borra el evento y marca cancelado).
- **FR-016**: El prompt del agente MUST incluir, solo cuando la integración
  está conectada, la fecha/hora actual del negocio, las reglas resumidas,
  las instrucciones libres y el próximo turno propio del cliente (si
  existe); nunca turnos de otros clientes.
- **FR-017**: El self-test MUST poder ejercer todo el flujo sin Google real
  (mock de OAuth y de la API de calendario tras el gate de mocks).

### Key Entities

- **Integración de calendario**: conexión por empresa (proveedor, cuenta,
  calendario, zona horaria, credenciales cifradas, estado) + reglas de
  turnos.
- **Turno**: reserva registrada en el CRM (contacto, conversación, inicio,
  fin, evento externo, estado, origen, sandbox).

## Success Criteria *(mandatory)*

- **SC-001**: Un propietario conecta Google Calendar y guarda reglas en
  menos de 3 minutos sin ayuda técnica.
- **SC-002**: En el self-test, un pedido de turno por WhatsApp termina en
  un evento creado y confirmación enviada en un solo intercambio de
  "pregunta → opciones → elección → confirmación".
- **SC-003**: 0 huecos ofrecidos que se solapen con eventos existentes en
  las pruebas automatizadas de cálculo de disponibilidad.
- **SC-004**: Ante fallo simulado del proveedor, 0 caídas del servidor y la
  bandeja manual sigue operando.

## Assumptions

- Un solo calendario destino por empresa (el elegido); los eventos de ese
  calendario son los que cuentan como ocupados.
- Duración única de turno por empresa (v1); sin tipos de turno.
- Zona horaria por empresa (default America/Argentina/Buenos_Aires).
- El evento se crea sin invitar al cliente por email (no tenemos su email).
- La cuenta de Google que conecta es la del negocio (propietario o cuenta
  compartida); la app de Google es del operador de la instancia.
- Nombre del evento: "Turno: {nombre del contacto}" (v1, no configurable).
