# Feature Specification: Etiquetas en contactos y conversaciones + filtros persistidos

**Feature Branch**: `006-tags-filters`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Agregar al CRM el manejo de tags, tanto en los
contactos como en las conversaciones. Incluir filtros que se persistan en los
query params. Entrar a la página de contactos y poder filtrar por tags,
marcar contactos en bulk y agregarle o quitarle tags. Lo mismo para las
conversaciones."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filtrar contactos por etiquetas con URL compartible (Priority: P1)

El operador entra a Contactos y elige una o varias etiquetas en un selector
de filtro. La lista se reduce a los contactos que llevan **alguna** de esas
etiquetas (o **todas**, si cambia el modo). Los filtros activos (etiquetas,
modo, búsqueda, ver archivados) quedan reflejados en la URL: al recargar,
volver atrás o pegar el enlace a un compañero, la vista es la misma.

**Why this priority**: es la base de todo lo demás (para etiquetar en bulk
primero hay que encontrar el subconjunto) y la URL persistente es lo que
convierte un filtro en una vista de trabajo compartible.

**Independent Test**: con contactos etiquetados `vip` y `cordoba`, filtrar
por `vip` → solo los `vip`; agregar `cordoba` en modo "cualquiera" → unión;
cambiar a "todas" → intersección; recargar la página → mismo filtro; quitar
el chip → lista completa y URL limpia.

**Acceptance Scenarios**:

1. **Given** contactos con distintas etiquetas, **When** el operador elige la
   etiqueta `vip`, **Then** la lista muestra solo contactos con `vip`, el
   contador dice cuántos son y la URL contiene `tags=vip`.
2. **Given** el filtro `vip` activo, **When** agrega `cordoba`, **Then** en
   modo "cualquiera" ve la unión (`tags=vip,cordoba`), y al cambiar a
   "todas" ve solo los que llevan ambas (`mode=all`).
3. **Given** `?tags=vip&mode=all&archived=true&q=juan` en la URL, **When**
   recarga o abre el enlace en otra pestaña, **Then** los controles muestran
   exactamente ese estado y la lista ya viene filtrada.
4. **Given** una etiqueta activa, **When** pulsa ✕ en su chip, **Then** se
   quita solo esa; con "Limpiar" vuelve a la lista completa y la URL queda
   sin parámetros de filtro.
5. **Given** un enlace viejo `?tag=vip` (formato de la feature 004),
   **When** lo abre, **Then** sigue funcionando como `tags=vip`.
6. **Given** un valor inválido en la URL (etiqueta vacía, modo desconocido),
   **Then** se ignora sin romper la página.

---

### User Story 2 - Etiquetar contactos en bulk (Priority: P1)

El operador marca varios contactos con casillas (o "seleccionar todos los
visibles") y desde una barra de acciones agrega una etiqueta (existente o
nueva) o quita una etiqueta que tengan. La lista se actualiza al instante y
la selección se limpia.

**Why this priority**: es el pedido central del dueño — segmentar cientos de
contactos importados sin editar uno por uno.

**Independent Test**: seleccionar 3 contactos, "Agregar etiqueta" →
`seguimiento` → los 3 la muestran; seleccionarlos otra vez, "Quitar
etiqueta" → `seguimiento` → desaparece solo de ellos.

**Acceptance Scenarios**:

1. **Given** la lista, **When** tilda 3 contactos, **Then** aparece una barra
   "3 seleccionados" con Agregar etiqueta / Quitar etiqueta / Cancelar.
2. **Given** 3 seleccionados, **When** agrega `seguimiento` (escribiéndola
   nueva o eligiéndola de las existentes), **Then** los 3 muestran
   `#seguimiento`, los demás no cambian, y la selección se vacía.
3. **Given** contactos seleccionados con etiquetas distintas, **When** abre
   Quitar etiqueta, **Then** solo se ofrecen las etiquetas presentes en la
   selección; al quitar una, desaparece de los seleccionados que la tenían.
4. **Given** "Seleccionar todos", **Then** se marcan todos los contactos
   visibles del filtro actual (no los de otras páginas ni los ocultos).
5. **Given** una etiqueta que ya tienen algunos, **When** la agrega en bulk,
   **Then** no se duplica; el saneo (minúsculas, sin espacios sobrantes,
   tope de etiquetas por contacto) es el mismo de la feature 004.
6. **Given** el servidor no responde, **When** confirma la acción, **Then**
   ve un error claro y la selección se mantiene para reintentar.

---

### User Story 3 - Etiquetas en la bandeja: filtro + bulk (Priority: P1)

En la Bandeja el operador ve las etiquetas de cada conversación en la lista,
filtra por etiquetas (mismo selector y misma persistencia en la URL, junto
con la búsqueda y el filtro "No leídas"), entra en modo selección para marcar
varias conversaciones y agrega o quita etiquetas en bulk. Desde el panel de
detalles edita las etiquetas de la conversación abierta.

**Why this priority**: el dueño pidió explícitamente "lo mismo" para las
conversaciones; las etiquetas de conversación sirven para el triage del día
(`urgente`, `esperando-pago`), distintas del segmento del contacto.

**Independent Test**: etiquetar dos conversaciones con `urgente` desde el
modo selección; filtrar por `urgente` → solo esas dos; recargar → mismo
filtro; quitar `urgente` desde el panel de una → sale del filtro.

**Acceptance Scenarios**:

1. **Given** conversaciones con etiquetas, **Then** cada fila de la lista las
   muestra como chips pequeños junto a la etapa.
2. **Given** la bandeja, **When** elige etiquetas en el filtro, **Then** la
   lista se reduce y la URL refleja `tags=…&mode=…`; el filtro "No leídas" y
   la búsqueda también persisten (`filter=unread`, `q=`).
3. **Given** modo selección, **When** marca varias conversaciones y agrega
   una etiqueta, **Then** todas la muestran y la selección se limpia.
4. **Given** la conversación abierta, **When** edita sus etiquetas en el
   panel de detalles, **Then** la lista se actualiza en vivo; el panel
   también muestra las etiquetas del contacto (edición independiente).
5. **Given** otra pestaña abierta en la bandeja, **When** se etiqueta en
   bulk, **Then** la otra pestaña se actualiza sin recargar.
6. **Given** el filtro `urgente` activo y la conversación abierta pierde esa
   etiqueta, **Then** sale de la lista pero el hilo abierto sigue visible
   hasta elegir otro (FR-010).

---

### User Story 4 - Listas paginadas (Priority: P2)

Contactos y Bandeja dejan de mostrar una lista truncada: Contactos pagina de
a 50 con un pager (anterior/siguiente, "51–100 de 5026") y la página vive en
la URL como el resto de los filtros; la Bandeja carga las 50 más recientes y
ofrece "Cargar más" al final, con la búsqueda y "No leídas" resueltas en el
servidor sobre el total (no sobre lo cargado). El hilo abierto no se cierra
por no estar en la página cargada (enlace directo, filtro, más allá de la
página).

**Why this priority**: pedido explícito del dueño (7-sep-2026); con 5.000
contactos importados y una bandeja que crece, sin paginación los filtros y el
bulk operan sobre una vista engañosa.

**Independent Test**: con 5.026 contactos, ir a `?page=3` → ver 101–150 y el
pager; cambiar un filtro → vuelve a la página 1. En la Bandeja con más de 50
conversaciones: ver 50, "Cargar más" agrega las siguientes sin duplicar; la
búsqueda encuentra una conversación que no estaba cargada.

**Acceptance Scenarios**:

1. **Given** más contactos que el tamaño de página, **Then** el pager muestra
   rango y total, y `page=N` en la URL restaura esa página.
2. **Given** una página > 1, **When** cambia cualquier filtro, **Then** vuelve
   a la página 1 y la selección se limpia.
3. **Given** `page` fuera de rango, **Then** se corrige a la última página.
4. **Given** más conversaciones que el tamaño de página, **Then** la lista
   muestra "Cargar más (50 de N)" y al pulsarlo agrega sin duplicar.
5. **Given** una búsqueda o "No leídas", **Then** los contadores reflejan el
   total del servidor y la lista trae solo lo que coincide.
6. **Given** un enlace `/inbox?contact=<id>` cuya conversación no está en la
   primera página, **Then** igual se abre el hilo.

---

### Edge Cases

- Etiqueta con mayúsculas/espacios (`" VIP "`) → se guarda como `vip`.
- Más de 20 etiquetas en un contacto/conversación → se respeta el tope; el
  bulk no supera el límite (las que no entran se descartan).
- Ids de otra empresa en un bulk → se ignoran (0 actualizados), jamás se
  tocan datos ajenos.
- Bulk con lista vacía o sin `add`/`remove` → 422.
- Bulk de más de 500 ids → 422 (el cliente selecciona de a páginas).
- Conversaciones del Laboratorio (`is_test`) no aparecen en la bandeja, así
  que no entran en la selección.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Las conversaciones MUST llevar etiquetas propias (saneadas con
  las mismas reglas que las de contacto), independientes de las del contacto.
- **FR-002**: Contactos y conversaciones MUST poder filtrarse por una o más
  etiquetas, con modo "cualquiera" (unión, por defecto) o "todas"
  (intersección), aplicado en el servidor (no sobre una página truncada).
- **FR-003**: El estado de filtros de Contactos (`q`, `archived`, `tags`,
  `mode`) y de la Bandeja (`q`, `filter`, `tags`, `mode`) MUST vivir en los
  query params de la URL, restaurarse al cargar y actualizarse sin ensuciar
  el historial. `?tag=` (004) sigue aceptado como alias de `tags=`.
- **FR-004**: El operador MUST poder seleccionar varios contactos y varias
  conversaciones (casillas + seleccionar todos los visibles) y aplicar
  agregar/quitar etiquetas en una sola operación.
- **FR-005**: Las operaciones bulk MUST ser atómicas por request, idempotentes
  (repetirlas no cambia el resultado) y acotadas al tenant.
- **FR-006**: El sistema MUST ofrecer las etiquetas existentes de la empresa
  (con su cantidad de uso) para autocompletar y para el selector de filtro,
  por ámbito (contactos / conversaciones).
- **FR-007**: Un cambio de etiquetas en conversaciones MUST propagarse en vivo
  a las demás pestañas por el canal de eventos existente.
- **FR-008**: La UI MUST degradar con mensaje claro ante error de red o del
  servidor, sin perder la selección.
- **FR-009**: Contactos MUST paginar por número de página (`page`, en la URL;
  tamaño 50, tope 200) y la Bandeja por cursor estable (fecha del último
  mensaje + id) con "Cargar más"; búsqueda y "No leídas" de la Bandeja se
  resuelven en el servidor con totales.
- **FR-010**: El hilo abierto MUST seguir disponible aunque la conversación no
  esté en la página cargada.

### Key Entities

- **Contacto**: ya lleva `tags` (004). Sin cambio de forma.
- **Conversación**: gana `tags` (lista saneada, única, con tope).
- **Etiqueta (faceta)**: derivada — nombre + cantidad de uso, por ámbito.

## Success Criteria *(mandatory)*

- **SC-001**: Etiquetar 50 contactos con una etiqueta nueva toma menos de 10
  segundos de operación (seleccionar todos + agregar) y un solo request.
- **SC-002**: Un enlace con filtros pegado en otra pestaña reproduce la vista
  idéntica en el 100% de los casos probados.
- **SC-003**: Cero fugas entre empresas: un bulk con ids ajenos actualiza 0.
- **SC-004**: El gate técnico y el self-test E2E (feliz + infeliz) quedan
  verdes antes de declarar Hecho.

## Assumptions

- Las etiquetas de conversación son un concepto aparte de las del contacto
  (triage vs. segmento); el panel de detalles muestra ambas.
- No hay tabla de etiquetas: siguen siendo texto libre saneado (como en 004);
  el catálogo se deriva de los datos.
- El agente de IA no etiqueta (fuera de alcance de esta feature).
- "Seleccionar todos" actúa sobre lo visible (la página cargada).
