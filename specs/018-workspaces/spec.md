# Feature Specification: Espacios de trabajo (varias empresas por usuario)

**Feature Branch**: `018-workspaces`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Pedido del dueño (23-sep-2026): «Quiero que agreguemos al CRM
el concepto de "Workspace", básicamente como tiene Slack al momento de
loguearse en varias empresas: cuando pertenecés solo a una, no se ve el
panel izquierdo extra, pero cuando pertenecés a más de una compañía,
empezás a verlas por separado en ese panel izquierdo y sus notificaciones
pendientes en rojo. Es el caso de un cliente que tiene 2 empresas pero
algunos colaboradores atienden ambas; lo ideal sería que puedan moverse
en el CRM entre ambas atendiendo y configurando ambos espacios por
separado. Los usuarios por ahora no se van a agregar en un lugar común
sino en cada empresa: la app al loguearse debería identificar si el
usuario pertenece a más de una empresa y mostrarle los accesos. Atajos de
teclado como Slack (Cmd+1 → workspace 1, y así), soporte para Windows y
no olvidarse del comportamiento móvil.»

Esta feature **supersede el supuesto de 003** («un usuario pertenece a
una sola empresa»): a partir de ahora una cuenta puede tener membresía en
varias empresas de la instancia. Todo lo demás de 003 (aislamiento por
`organization_id`, gestión de empresas server-side, super admin) sigue
igual.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cambiar de empresa desde el rail (Priority: P1)

Como colaborador que atiende dos empresas del mismo cliente, cuando entro
al CRM veo a la izquierda de la barra lateral un rail angosto con un
mosaico por empresa (iniciales sobre el color de acento de cada una). El
mosaico de la empresa en la que estoy parado está marcado. Al tocar otro,
todo el CRM (Bandeja, Pipeline, Contactos, Campañas, Agente, Ajustes…)
pasa a ser el de esa empresa: sus conversaciones, su número, su agente,
sus ajustes. Si pertenezco a una sola empresa, no veo ningún rail: el CRM
es exactamente el de hoy.

**Why this priority**: es el corazón del pedido; sin esto no hay
workspaces.

**Independent Test**: con un usuario con dos membresías, entrar → rail
con dos mosaicos; click en el segundo → la Bandeja muestra SOLO las
conversaciones de la segunda empresa y Ajustes → WhatsApp muestra SU
número; un usuario con una membresía no ve el rail.

**Acceptance Scenarios**:

1. **Given** un usuario con membresía en A y B, **When** inicia sesión,
   **Then** ve el rail con dos mosaicos, el de A (o el último usado)
   marcado como activo, y el CRM cargado con los datos de A.
2. **Given** está en A, **When** toca el mosaico de B, **Then** la página
   se recarga en la misma sección (misma ruta, sin parámetros de la
   conversación abierta) con los datos de B, la marca (nombre, acento,
   título de la pestaña) de B, y el mosaico de B queda activo.
3. **Given** está en B en Ajustes → WhatsApp, **When** conecta un número
   o cambia el agente, **Then** el cambio queda SOLO en B; A no cambia.
4. **Given** un usuario con una sola membresía, **When** entra, **Then**
   no hay rail ni sección de espacios en el móvil.
5. **Given** un usuario con sesión en A en dos pestañas del navegador,
   **When** cambia a B en una, **Then** la otra, al volver a primer plano,
   se recarga sola en B (nunca muestra datos mezclados: cada pedido al
   servidor va con la empresa activa de la sesión).
6. **Given** le quitan la membresía de la empresa activa mientras opera,
   **When** hace el siguiente pedido, **Then** el sistema lo pasa a su
   otra empresa (la más antigua) sin error; si no le queda ninguna, la
   sesión deja de ser válida y vuelve al login.

---

### User Story 2 - Sumar una cuenta existente a otra empresa (Priority: P1)

Como super admin (Administración) o como propietario de una empresa
(Ajustes → Equipo), cuando doy de alta a alguien con un correo que YA
tiene cuenta en la instancia, el sistema no me rechaza: me avisa que la
cuenta existe y me ofrece sumarla a esta empresa con el rol que elegí,
sin crear otra contraseña. Esa persona, en su próximo pedido, ve las dos
empresas.

**Why this priority**: es la única forma de que un colaborador tenga dos
empresas; sin esto el rail nunca aparece.

**Independent Test**: en Administración, en la empresa B, dar de alta el
correo del operador de A → aviso «Ya existe una cuenta con ese correo»
con el botón «Sumar esa cuenta a esta empresa» → click → aparece en la
lista de usuarios de B; el operador de A entra y ve el rail.

**Acceptance Scenarios**:

1. **Given** el correo no existe, **When** lo doy de alta, **Then** se
   crea la cuenta con contraseña temporal como hoy (sin cambios).
2. **Given** el correo ya existe y no es miembro de esta empresa, **When**
   lo doy de alta, **Then** el sistema responde «ya existe» y ofrece
   sumarla; al confirmar, la cuenta queda como miembro con el rol elegido
   y conserva su contraseña (no se le exige cambiarla).
3. **Given** el correo ya es miembro de esta empresa, **When** intento
   sumarlo, **Then** el sistema lo dice y no duplica la membresía.
4. **Given** un correo reservado de la plataforma (super admin), **When**
   intento sumarlo a una empresa, **Then** se rechaza como hoy.
5. **Given** el propietario de B suma al operador de A, **When** ese
   operador entra, **Then** ve el rail con A y B; su rol en B es el que
   eligió el propietario de B y su rol en A no cambia.

---

### User Story 3 - No leídos de las otras empresas en rojo (Priority: P2)

Como colaborador parado en A, veo sobre el mosaico de B un globo rojo con
la cantidad de mensajes sin leer de B, y se actualiza solo cuando llega un
mensaje nuevo a B aunque yo esté mirando A. El mosaico activo no lleva
globo (el badge de «Bandeja» ya lo cubre).

**Why this priority**: sin esto el colaborador no sabe que la otra empresa
lo necesita y tiene que ir a mirar.

**Independent Test**: parado en A, entra un mensaje mock a B → en menos de
2 s el mosaico de B muestra «1» en rojo; al cambiar a B y leerlo, vuelve
a desaparecer.

**Acceptance Scenarios**:

1. **Given** B tiene 5 mensajes sin leer, **When** el usuario está en A,
   **Then** el mosaico de B muestra «5» en rojo (99+ por encima de 99).
2. **Given** está en A, **When** entra un mensaje a B, **Then** el globo
   de B se actualiza sin recargar.
3. **Given** está en A, **When** se marca como leída la conversación de B
   desde otro dispositivo, **Then** el globo baja o desaparece.
4. **Given** la conversación del Entrenador de B tiene no leídos, **When**
   el usuario está en A, **Then** cuentan igual que en el badge de Bandeja
   (misma regla: sandbox excluido salvo el Entrenador).

---

### User Story 4 - Atajos de teclado (Priority: P2)

Como colaborador de escritorio, con ⌘1…⌘9 (Mac) o Ctrl+1…Ctrl+9
(Windows/Linux) salto al espacio de trabajo 1…9, en el orden del rail. El
tooltip de cada mosaico me lo recuerda («Inmobiliaria Demo · ⌘2»).

**Independent Test**: con dos espacios, ⌘2 (o Ctrl+2) → cambia a B; ⌘1
→ vuelve a A; con un solo espacio, la tecla no hace nada y el navegador
sigue su comportamiento normal.

**Acceptance Scenarios**:

1. **Given** dos espacios, **When** el usuario presiona ⌘2 / Ctrl+2,
   **Then** el CRM cambia a B (misma recarga que el click) y el navegador
   no cambia de pestaña.
2. **Given** está en B, **When** presiona el atajo de B, **Then** no pasa
   nada (ya está ahí).
3. **Given** un solo espacio, **When** presiona ⌘1, **Then** el CRM no
   interviene.
4. **Given** el foco está en un campo de texto, **When** presiona ⌘2,
   **Then** cambia igual (el modificador evita que sea texto tipeado).

---

### User Story 5 - Móvil (Priority: P2)

Como colaborador en el celular no veo un rail (no hay lugar), pero en la
pestaña «Más» aparece arriba una sección «Espacios de trabajo» con los
mosaicos, la empresa activa marcada y el globo rojo de las otras; y la
pestaña «Más» lleva un punto rojo cuando otra empresa tiene no leídos.
Tocar un mosaico cambia de empresa igual que en escritorio.

**Independent Test**: a 375 px, sin rail; «Más» → sección con dos
mosaicos y globo; tocar B → recarga en B; con una sola empresa, la hoja
«Más» es la de hoy.

**Acceptance Scenarios**:

1. **Given** dos espacios a 375 px, **When** abre «Más», **Then** ve la
   sección con los dos mosaicos, el activo marcado y el globo de la otra.
2. **Given** B tiene no leídos y el usuario está en A, **When** mira la
   barra inferior, **Then** «Más» lleva un punto rojo.
3. **Given** toca el mosaico de B, **When** termina la recarga, **Then**
   está en B, en la misma sección, sin hoja abierta.

---

### Edge Cases

- El orden de los espacios es estable (por antigüedad de la membresía):
  los atajos no se «corren» de un día para otro.
- Más de 9 espacios → solo los primeros 9 tienen atajo; el resto se
  alcanza por click.
- El navegador se reserva el atajo (algunas combinaciones en algunos
  navegadores): el rail y el click siguen funcionando; no se rompe nada.
- El super admin sin membresía de empresa: no ve rail; Administración es
  igual que hoy.
- Enlace profundo a una conversación de A (`?c=…`) mientras cambia a B →
  el parámetro se descarta (la ruta se conserva); nunca se intenta abrir
  un id de otra empresa.
- Se acepta el oráculo de existencia de correos entre empresas (ya
  aceptado en 003): sumar una cuenta existente lo requiere.
- Notificaciones push (013): un dispositivo tiene UNA suscripción y las
  claves VAPID son por empresa, así que cada dispositivo recibe los avisos
  de la ÚLTIMA empresa en la que se usó (al cambiar, la suscripción se
  re-liga en silencio, como ya hacía 013 con «cambio de empresa»). Ajustes
  → Notificaciones lo dice cuando hay más de un espacio.
- La empresa activa se recuerda por usuario: al volver a entrar, arranca
  en la última usada (si sigue siendo miembro).
- Un colaborador sumado con rol distinto en cada empresa (owner en A,
  member en B): los permisos son los de la empresa activa.
- La conexión en vivo (SSE) de la empresa activa también avisa cuando
  cambia el no leído de las OTRAS empresas del usuario; el aviso lleva
  solo el id de la empresa, nunca contenido.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La empresa activa de un usuario MUST vivir en su sesión y
  validarse contra sus membresías en cada pedido; toda ruta y API sigue
  resolviendo `organization_id` desde ahí (sin cambios en el scoping).
- **FR-002**: Cambiar de empresa MUST hacerse por un endpoint propio que
  solo acepta empresas de las que el usuario es miembro (403 en otro
  caso); los endpoints self-serve del plugin de organizaciones siguen
  negados (FR-013 de 003 intacto).
- **FR-003**: El rail MUST mostrarse solo con dos o más membresías, en
  escritorio (≥ 768 px). En móvil su lugar es la sección «Espacios de
  trabajo» de la hoja «Más».
- **FR-004**: Cada mosaico MUST mostrar las iniciales de la empresa sobre
  su color de acento, con tooltip «nombre · atajo»; el activo MUST estar
  marcado visualmente.
- **FR-005**: Cambiar de empresa MUST recargar la app en la misma ruta sin
  parámetros de consulta; la marca (nombre, acento, título, ícono PWA)
  pasa a ser la de la empresa activa.
- **FR-006**: Cada mosaico no activo MUST mostrar en rojo la suma de
  mensajes sin leer de esa empresa (misma regla que el badge de Bandeja:
  sandbox excluido salvo el Entrenador; tope «99+»), y MUST actualizarse
  en vivo ante un mensaje nuevo o un cambio de lectura en esa empresa.
- **FR-007**: ⌘/Ctrl + 1…9 MUST cambiar al espacio N en el orden del rail
  cuando hay dos o más espacios, cancelando el comportamiento por defecto
  del navegador; con un solo espacio el CRM no intercepta la tecla.
- **FR-008**: Sumar una cuenta existente a una empresa MUST ser posible
  para el super admin (Administración) y el propietario (Ajustes →
  Equipo) mediante una confirmación explícita tras el aviso de «ya
  existe»; MUST respetar el rol elegido, no tocar la contraseña ni
  exigir cambiarla, rechazar correos reservados (403) y membresías
  duplicadas (409).
- **FR-009**: El sistema MUST recordar por usuario la última empresa usada
  y restaurarla al iniciar sesión si sigue siendo miembro; si no, la
  más antigua (determinismo de FR-012 de 003).
- **FR-010**: Otras pestañas del mismo navegador MUST converger a la
  empresa activa al volver a primer plano (recarga automática si difiere).
- **FR-011**: La base MUST impedir dos membresías del mismo usuario en la
  misma empresa (unicidad).
- **FR-012**: Las push MUST seguir la regla de 013 (una suscripción por
  dispositivo, re-ligada a la empresa activa al cambiar); Ajustes →
  Notificaciones MUST explicarlo cuando el usuario tiene más de un espacio.
- **FR-013**: El canal en vivo de la empresa activa MUST emitir un aviso
  `workspace.unread` (solo id de empresa) cuando cambia el no leído de
  otra empresa del usuario, para que el rail se refresque sin sondeo.
- **FR-014**: La lista de espacios MUST venir renderizada desde el
  servidor en la carga inicial (sin parpadeo del rail) y refrescarse por
  API después.

### Key Entities *(include if feature involves data)*

- **Membresía** (existente): usuario ↔ empresa con rol; ahora N por
  usuario; única por (empresa, usuario).
- **Sesión** (existente): lleva la empresa activa; se valida contra las
  membresías en cada pedido.
- **Usuario** (existente): recuerda la última empresa usada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un colaborador con dos empresas cambia entre ellas con un
  click o un atajo y ve datos SOLO de la empresa activa (E2E: la Bandeja
  de B no contiene ninguna conversación de A; pedir por API una
  conversación de A estando en B → 404).
- **SC-002**: Con una sola empresa, la UI es idéntica a la actual (sin
  rail, sin sección en «Más», sin cambios de comportamiento).
- **SC-003**: El globo rojo de la otra empresa refleja un entrante en
  menos de 2 s (mocks) sin recargar.
- **SC-004**: Sumar una cuenta existente a otra empresa lleva dos clicks
  (alta → confirmar) y no crea contraseñas ni usuarios nuevos.
- **SC-005**: Gate técnico verde (typecheck + lint + build + tests) y
  guion E2E `tests/e2e/018-workspaces.md` verde en escritorio y a 375 px,
  incluyendo el camino infeliz (empresa ajena → 403, membresía
  duplicada → 409, sesión con empresa activa inválida → fallback).

## Assumptions

- Los usuarios se siguen dando de alta empresa por empresa (Administración
  o Ajustes → Equipo); no hay un directorio central de usuarios en esta
  versión.
- Los roles son por empresa e independientes.
- Quitar una membresía no forma parte de esta feature (hoy tampoco existe
  en la UI).
- La constitución no cambia: no se agregan dependencias externas; la
  gestión de organizaciones sigue siendo server-side.
