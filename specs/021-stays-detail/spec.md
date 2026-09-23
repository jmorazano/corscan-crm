# Feature Specification: El alojamiento completo — barrio, detalles, precios fuera del mensaje y el nombre del huésped

**Feature Branch**: `021-stays-detail`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Decisiones del dueño (23-sep-2026) tras el análisis del agente
anterior del cliente «Altos de Calamuchita» (ver `020-inbound-media/spec.md`
para el contexto de la carpeta `giuliana_agent`):

1. **Precios: mantener el comportamiento viejo.** Giuliana tenía la regla
   «Nunca muestres precios ni tarifas en el mensaje»; los valores se ven al
   entrar al enlace. Hoy Vocero escribe el total, el precio por noche y la
   seña en el chat.
2. **Un solo enlace de búsqueda**, que lleve a los resultados exactos.
3. Sobre los huecos de datos: *«si la información está, tenemos que
   soportarlo»*. Está: el MCP devuelve `neighborhood`, `details` y
   `description`, y nuestro condensado los tira.
4. El nombre del huésped **se guarda automáticamente**, pero solo si el
   contacto no tiene un nombre puesto por una persona del equipo.

Extiende 016 (conector MCP) y 001 (acciones del agente). Sin cambios de
constitución: no se agregan dependencias ni se amplía la allowlist de
herramientas — se lee mejor lo que el servidor ya devuelve.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El huésped pregunta por barrio y por el entorno (Priority: P1)

Como huésped pregunto «¿en Bosque Douglas tenés algo?» o «¿alguna con bajada
al río?» y el agente me contesta con lo que realmente hay, no con un «no
tengo esa información».

**Acceptance Scenarios**:

1. **Given** una búsqueda con resultados, **When** el agente recibe las
   opciones, **Then** cada una trae su **barrio** y sus **detalles**
   destacados (p. ej. «Arrollo a 300 metros», «Campo de lavandas»).
2. **Given** que el huésped pregunta por un barrio, **When** el agente
   responde, **Then** nombra el barrio de cada opción y no lo inventa.
3. **Given** `show_stay` de una propiedad, **When** el agente recibe la
   ficha, **Then** trae barrio, detalles completos y una descripción
   recortada, y sigue diciendo que NO tiene precio.
4. **Given** una búsqueda con más opciones que las que se muestran,
   **When** el huésped pide «la más chica» o «¿y alguna más?», **Then** el
   agente tiene suficientes opciones a la vista para comparar.

### User Story 2 - El precio se ve en el enlace, no en el chat (Priority: P1)

Como dueño no quiero que el agente escriba importes por WhatsApp: los
valores y las condiciones se ven en la ficha, que es donde además se
reserva.

**Acceptance Scenarios**:

1. **Given** una búsqueda con precios, **When** el agente responde,
   **Then** su mensaje NO contiene importes (ni total, ni por noche, ni
   seña) y remite al enlace.
2. **Given** que el huésped pregunta «¿cuál es la más económica?», **When**
   el agente responde, **Then** puede decir cuál es la más barata **sin
   decir el monto** (el modelo sigue viendo los precios para ordenar).
3. **Given** que el modelo igual escribe un importe, **When** se envía,
   **Then** una guarda lo detecta y lo saca antes de que salga.
4. **Given** una respuesta sin importes, **When** se envía, **Then** la
   guarda no la toca (los falsos positivos son el modo de falla caro:
   fechas, cantidad de personas, dormitorios y teléfonos son números
   legítimos).

### User Story 3 - Un solo enlace, y que lleve a lo que se buscó (Priority: P2)

Como huésped hago clic en el enlace y veo los resultados de MI búsqueda,
no el listado completo del sitio.

**Acceptance Scenarios**:

1. **Given** que el proveedor devuelve `search_url`, **When** el agente
   responde, **Then** usa ese enlace, que ya reproduce la búsqueda.
2. **Given** que el proveedor NO devuelve `search_url` (la combinación de
   filtros no es reproducible en el buscador del sitio), **When** el agente
   responde, **Then** pasa el enlace DIRECTO de la propiedad que recomienda
   y NO un enlace general que mezclaría opciones sin lo que el huésped
   pidió.
3. **Given** cualquiera de los dos casos, **When** el agente responde,
   **Then** manda **un solo enlace** por mensaje.

### User Story 4 - El agente se acuerda del nombre (Priority: P2)

Como huésped digo «mi nombre es Santiago Pintos» y el agente me llama por
mi nombre, también dos días después.

**Acceptance Scenarios**:

1. **Given** un contacto cuyo nombre es el teléfono o el del perfil de
   WhatsApp, **When** el huésped dice su nombre, **Then** queda guardado en
   el contacto y se ve en la bandeja.
2. **Given** un contacto cuyo nombre lo editó una persona del equipo,
   **When** el huésped dice otro nombre, **Then** el nombre guardado NO
   cambia.
3. **Given** un contacto importado desde una planilla, **When** el huésped
   dice su nombre, **Then** el nombre de la planilla se conserva.
4. **Given** un nombre que no es un nombre (una frase larga, un emoji, un
   número), **When** el agente intenta guardarlo, **Then** se descarta.

### Edge Cases

- **Presupuesto del prompt**: más propiedades y más campos por propiedad
  cuestan contexto. El condensado tiene que seguir siendo una fracción del
  crudo, con una prueba que lo mida.
- **Texto ajeno**: `neighborhood`, `details` y `description` los escribe el
  tercero. Pasan por el saneo de 016 como todo lo demás: son DATO, nunca
  instrucción.
- **Precio pedido explícitamente**: si el huésped insiste «decime el
  precio», el agente lo manda al enlace; no lo escribe.
- **La guarda de precios y la de promesas** corren las dos sobre el mismo
  texto saliente; el orden no debe producir un mensaje raro.
- **Nombre en una nota de voz**: llega como transcripción (020), así que
  funciona igual.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El condensado de una propiedad DEBE incluir el barrio y sus
  detalles destacados, saneados y acotados.
- **FR-002**: La ficha (`show_stay`) DEBE incluir además la descripción,
  recortada a un tope explícito.
- **FR-003**: El agente DEBE ver más de dos opciones por búsqueda para
  poder comparar, sin que el texto de herramienta supere un tope medido.
- **FR-004**: El agente NO DEBE escribir importes en su respuesta al
  cliente; los precios siguen llegándole a ÉL para ordenar y comparar.
- **FR-005**: Una guarda pura DEBE quitar los importes del texto saliente
  antes de enviarlo, sin tocar fechas, cantidades ni teléfonos.
- **FR-006**: Cuando el proveedor no devuelve un enlace de búsqueda
  reproducible, el agente NO DEBE pasar un enlace general: pasa el de la
  propiedad.
- **FR-007**: El agente DEBE poder guardar el nombre del huésped junto con
  su respuesta, sin gastar un turno aparte.
- **FR-008**: El nombre guardado por el agente NO DEBE pisar un nombre
  cargado por import, alta manual, API **ni editado a mano en el CRM**.
- **FR-009**: El nombre propuesto DEBE validarse (largo, forma) antes de
  guardarse.

### Key Entities

- **contact**: campo nuevo `name_edited_at` (timestamp, NULL = nadie del
  equipo tocó el nombre). Cierra un agujero que ya tenía 017: un contacto
  nacido de un entrante cuyo nombre el operador editó a mano seguía siendo
  «reemplazable» para la sync de la agenda del celular.

## Success Criteria *(mandatory)*

- **SC-001**: Preguntando por un barrio o por el entorno, el agente
  responde con datos reales de las propiedades disponibles.
- **SC-002**: En ninguna respuesta del agente aparece un importe.
- **SC-003**: El huésped que dice su nombre es llamado por su nombre, y el
  nombre que cargó el equipo nunca se pisa.
- **SC-004**: El gate técnico queda verde y el guion E2E se conduce entero.

## Out of Scope

- Filtrar la búsqueda POR barrio (el MCP no acepta ese parámetro; el agente
  filtra sobre lo que le vuelve).
- Armar enlaces de búsqueda a mano (016 research D8 lo descartó: el
  buscador del sitio filtra distinto que el MCP). Si se quiere un enlace
  exacto en los casos que hoy vuelven `null`, se le pide al desarrollador
  del MCP que siempre devuelva `search_url`.
- Combinar propiedades para grupos grandes de forma automática.
