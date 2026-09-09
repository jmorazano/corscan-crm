# Feature Specification: Agente paciente y baja visible

**Feature Branch**: `011-patient-agent-optout`

**Created**: 2026-09-09

**Status**: Draft

**Input**: Caso real (campaña del 9-sep): un contacto escribió dos mensajes
seguidos («Buenas tardes» + «Dispongo de equipos y personal», 14s aparte) y
el agente respondió DOS veces el mismo saludo, sin considerar el segundo
mensaje. Pedido del dueño: «esperar unos segundos o un minuto para que la
persona termine de contestar en uno o más mensajes y luego elaborar la
respuesta en base a eso». Además el mismo contacto respondió «Baja» y «no
sucedió nada» visible — la baja SÍ se registró (protege campañas futuras)
pero sin señal en la UI ni movimiento del lead; el dueño pide moverlo a
«Perdido» o marcarlo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El agente espera y responde UNA vez, con todo el contexto (Priority: P1)

Como cliente que escribe en ráfaga (2-3 mensajes en un minuto), recibo UNA
sola respuesta del asistente que considera TODO lo que dije — nunca dos
respuestas iguales ni una respuesta que ignora mi último mensaje.

**Why this priority**: dos saludos idénticos a un colega que ofrecía sus
servicios quedó mal frente a un contacto real; es la cara del negocio.

**Acceptance Scenarios**:

1. **Given** dos mensajes entrantes con menos de la ventana de espera entre
   sí, **Then** el agente responde UNA vez, después del último.
2. **Given** un mensaje que llega MIENTRAS el agente está pensando la
   respuesta del anterior, **Then** esa respuesta se descarta sin enviarse y
   el agente vuelve a pensar con el contexto completo (una sola respuesta
   final).
3. **Given** que el agente generó un texto idéntico a su último mensaje
   enviado, **Then** no lo envía (jamás dos iguales seguidos).
4. **Given** una respuesta de confirmación de turno ya reservado, **Then**
   SÍ se envía aunque haya llegado otro mensaje (la acción ya ocurrió; lo
   nuevo se responde en el turno siguiente).
5. La ventana de espera es configurable por instancia (default ~20s).

---

### User Story 2 - La baja se ve y ordena el pipeline (Priority: P1)

Como operador, cuando alguien responde BAJA/STOP: (a) su lead pasa solo a la
etapa «Perdido» del pipeline; (b) la conversación muestra un distintivo
claro «Dado de baja» en la bandeja; (c) el asistente NO le responde nada.
(La protección de campañas/envíos ya existía y no cambia.)

**Acceptance Scenarios**:

1. **Given** un contacto con lead en el pipeline, **When** responde «Baja»,
   **Then** el lead queda en la etapa «Perdido» y la bandeja muestra el
   distintivo.
2. **Given** la baja, **Then** el agente no genera ninguna respuesta a ese
   mensaje ni a mensajes posteriores del contacto.
3. **Given** un contacto sin lead, **Then** la baja solo marca y muestra el
   distintivo (sin error).
4. La reversión manual de la baja existente sigue funcionando; el lead NO
   vuelve solo de «Perdido» (decisión humana).

---

### Edge Cases

- Tres o más mensajes en ráfaga → sigue siendo UNA respuesta (la espera se
  reinicia con cada mensaje).
- El Laboratorio no cambia: evalúa turnos directos sin espera (sandbox).
- «Baja» con espacios/minúsculas ya se detecta (regla existente intacta).
- Multi-tenant: etapa «Perdido» de LA empresa del contacto.

## Requirements *(mandatory)*

- **FR-001**: El agente MUST esperar una ventana configurable (default 20s)
  desde el ÚLTIMO mensaje entrante antes de responder; mensajes nuevos
  reinician la espera.
- **FR-002**: Una respuesta elaborada con contexto viejo (llegó un mensaje
  durante la generación) MUST descartarse sin enviar y regenerarse.
- **FR-003**: El agente MUST no enviar un texto idéntico a su último mensaje
  saliente de la conversación.
- **FR-004**: Las confirmaciones de acciones ya ejecutadas (p. ej. turno
  reservado) MUST enviarse igual.
- **FR-005**: Al detectar BAJA/STOP el lead del contacto MUST moverse a la
  etapa de tipo «perdido» de su empresa (si existe lead).
- **FR-006**: La bandeja MUST mostrar «Dado de baja» en la conversación del
  contacto dado de baja.
- **FR-007**: El agente MUST quedar en silencio ante el mensaje de baja y en
  conversaciones de contactos dados de baja.
- **FR-008**: El sandbox del Laboratorio y el flujo actual de handoff MUST
  quedar intactos.

## Success Criteria *(mandatory)*

- **SC-001**: Ráfaga de 2+ mensajes en el entorno de pruebas → exactamente 1
  respuesta del agente, posterior al último mensaje.
- **SC-002**: Cero pares de mensajes del agente idénticos consecutivos.
- **SC-003**: BAJA → lead en «Perdido» + distintivo visible + 0 respuestas
  del agente, verificado E2E.
- **SC-004**: Suite y flujos existentes sin regresiones.

## Assumptions

- Ventana default 20s (el dueño pidió «unos segundos o un minuto»); ajustable
  con la variable de instancia existente.
- La baja no borra al contacto ni su historial; solo ordena y señaliza.
