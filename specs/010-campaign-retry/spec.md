# Feature Specification: Motivo de fallo visible y reintento de fallidos

**Feature Branch**: `010-campaign-retry`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Mostrar el error de entrega en la UI, y que los fallidos de una campaña se puedan identificar y reintentar después DESDE la propia campaña (decisión del dueño: sin tagueo automático — los tags habría que crearlos y limpiarlos a mano y arma campañas duplicadas)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver POR QUÉ falló un mensaje (Priority: P1)

Como operador, cuando un mensaje saliente falla veo el **motivo** — en la
burbuja de la conversación (junto al ícono de advertencia) y en el detalle de
la campaña por destinatario — traducido a lenguaje claro para los casos
comunes de Meta (facturación, límite de frecuencia de marketing, destinatario
inalcanzable), con el texto original como respaldo.

**Why this priority**: hoy el dato existe pero está enterrado en la base; el
operador no puede distinguir "arreglá la tarjeta" de "esperá unas horas".

**Independent Test**: forzar un fallo de entrega en el entorno de pruebas y
ver el motivo en la burbuja y en el detalle de la campaña.

**Acceptance Scenarios**:

1. **Given** un mensaje fallido por facturación, **When** abro la
   conversación, **Then** el ícono ⚠ muestra el motivo claro (hover y
   texto accesible) y una línea breve bajo la burbuja.
2. **Given** el detalle de una campaña con fallidos, **When** lo abro,
   **Then** cada fallido muestra su motivo.
3. **Given** un error de Meta no catalogado, **Then** se muestra el texto
   original tal cual.

---

### User Story 2 - Reintentar los fallidos de la campaña (Priority: P1)

Como operador, en el detalle de una campaña terminada (o pausada) con
fallidos veo cuántos y quiénes fallaron y un botón **«Reintentar fallidos
(N)»**: la MISMA campaña vuelve a correr solo para esos destinatarios, con el
mismo ritmo, cupo y guardas de siempre. Sin tags, sin campaña nueva.

**Why this priority**: es el pedido central — el fallo por límite de
frecuencia (131049) se resuelve reintentando al día siguiente.

**Independent Test**: campaña con 1 entregado y 1 fallido → reintentar → solo
el fallido recibe un nuevo envío; la campaña termina de nuevo; los contadores
cierran.

**Acceptance Scenarios**:

1. **Given** una campaña `completed` con 1 fallido de entrega, **When**
   toco «Reintentar fallidos», **Then** la campaña vuelve a "en curso", se
   reenvía SOLO al fallido y al terminar queda `completed` otra vez.
2. **Given** el reintento, **Then** los que ya recibieron NO reciben
   duplicados.
3. **Given** una campaña sin fallidos, **Then** el botón no aparece; la API
   rechaza la acción con motivo claro.
4. **Given** un fallido cuyo contacto se dio de BAJA después, **When**
   reintento, **Then** ese destinatario queda omitido (guardas del embudo
   intactas).
5. **Given** dos clics seguidos al botón, **Then** no se duplica nada
   (acción idempotente).

---

### Edge Cases

- Fallidos de DOS clases: rechazo al enviar (el canal nunca aceptó) y fallo
  de entrega (aceptado y luego fallido por webhook) — ambos se reintentan.
- El historial no se reescribe: el mensaje fallido original queda en la
  conversación; el reintento crea un mensaje nuevo.
- El reintento consume cupo como cualquier envío iniciado; si el cupo se
  agota, la campaña se pausa por límite diario como siempre.
- Cancelada: los `skipped` por cancelación NO se reintentan (decisión ya
  tomada por el operador).
- Multi-tenant: todo scoped por organización.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todo mensaje saliente fallido MUST exponer su motivo en la
  conversación (tooltip accesible + línea breve) y en el detalle de campaña.
- **FR-002**: Los motivos comunes del canal MUST traducirse a explicaciones
  claras en español; los desconocidos se muestran tal cual.
- **FR-003**: El detalle de campaña MUST permitir identificar los fallidos
  (cantidad y lista con motivo) sin salir de la campaña.
- **FR-004**: La acción «Reintentar fallidos» MUST reencolar SOLO los
  destinatarios fallidos (ambas clases) de una campaña terminada o pausada,
  devolviéndola a "en curso" con el runner/ritmo/cupo/guardas existentes.
- **FR-005**: La acción MUST ser idempotente y no duplicar envíos a quienes
  ya recibieron.
- **FR-006**: Sin tags automáticos ni campañas clonadas (decisión del dueño).

### Key Entities

- **Destinatario de campaña**: sus estados ganan una transición deliberada
  `fallido → pendiente` SOLO vía la acción de reintento (excepción guardada
  a la monotonicidad, auditable por el flujo).

## Success Criteria *(mandatory)*

- **SC-001**: En el entorno de pruebas, el 100% de los fallidos reintentados
  reciben exactamente UN nuevo envío y ningún no-fallido recibe nada.
- **SC-002**: El operador identifica el motivo de un fallo en <10 segundos
  desde la conversación o la campaña (visible sin herramientas técnicas).
- **SC-003**: Doble clic en reintentar → cero duplicados.
- **SC-004**: Flujos existentes de campañas (lanzar, pausar, reanudar,
  cancelar) sin cambios observables.

## Assumptions

- El reintento es manual (el operador decide cuándo); sin reintentos
  automáticos programados en v1.
- El motivo mostrado es el último conocido; si Meta no mandó detalle, se
  muestra el genérico existente.
