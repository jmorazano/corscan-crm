# Feature Specification: Administración ordenada — tabla de empresas, detalle por empresa y baja de usuarios

**Feature Branch**: `019-admin-organizations`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Pedido del dueño (23-sep-2026): «Ordenemos la UI de administrar
las compañías, está caótica y con mucho espacio en blanco. (1) Que los
usuarios existentes de las compañías se puedan eliminar. (2) Que las
empresas estén listadas en una tabla y que al hacer click me lleve a la
página de la empresa con todo para gestionarla. (3) Que "Conectores MCP"
sea una tab de dos: "Empresas | Conectores MCP"; en una solo las empresas
y navegar a su detalle, en la otra el resumen de MCPs conectados.»

Extiende 003 (Administración) y 016 (panel MCP). Sin cambios de dominio ni
de constitución.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Empresas en una tabla con detalle propio (Priority: P1)

Como super admin, Administración abre en la pestaña «Empresas»: una tabla
con nombre, usuarios, WhatsApp, IA, conector y fecha de alta. Un botón
«Nueva empresa» abre el formulario de alta en un diálogo (las credenciales
del admin inicial se muestran una sola vez, como hoy). Al hacer click en
una fila entro a la página de esa empresa, con todo lo necesario para
gestionarla: estado, usuarios (alta, sumar existente, restablecer
contraseña, quitar) y su conector MCP. «Volver» me devuelve a la tabla.

**Acceptance Scenarios**:

1. **Given** super admin en `/admin`, **When** carga, **Then** ve la tabla
   de empresas (una fila por empresa) y ningún formulario abierto.
2. **Given** la tabla, **When** hace click en una fila, **Then** navega a
   `/admin/organizations/<id>` con cabecera (nombre, slug, badges de
   WhatsApp/IA) y las secciones Usuarios y Conector MCP.
3. **Given** «Nueva empresa», **When** completa y crea, **Then** el diálogo
   muestra las credenciales una vez y la tabla incorpora la fila.
4. **Given** un id de empresa inexistente, **When** abre el detalle,
   **Then** ve «Esta empresa ya no existe» y el botón para volver.
5. **Given** un usuario que no es super admin, **When** abre `/admin` o el
   detalle, **Then** es redirigido (protección server-side, como hoy).

### User Story 2 - Quitar un usuario de una empresa (Priority: P1)

Como super admin, en el detalle de una empresa puedo quitar a un usuario.
Se pide confirmación. Si la persona no tiene otra empresa, su cuenta se
elimina (ya no podría entrar a nada); si tiene otras, conserva la cuenta
y solo pierde esta empresa. No se puede quitar al último propietario.

**Acceptance Scenarios**:

1. **Given** un miembro con solo esta empresa, **When** lo quito y
   confirmo, **Then** desaparece de la lista y su cuenta deja de existir
   (no puede iniciar sesión).
2. **Given** un usuario con dos empresas, **When** lo quito de una,
   **Then** sigue entrando a la otra y su rail deja de mostrar esta.
3. **Given** el único propietario de la empresa, **When** intento
   quitarlo, **Then** el sistema lo rechaza con un mensaje claro (409).
4. **Given** un super admin ajeno (otro correo de plataforma), **When**
   intento quitarlo, **Then** 403 (misma regla que el reset de contraseña).
5. **Given** el propio super admin, **When** se quita de una empresa donde
   hay otro propietario, **Then** pierde la membresía pero su cuenta de
   plataforma NUNCA se elimina.

### User Story 3 - Pestaña «Conectores MCP» (Priority: P2)

Como super admin, la pestaña «Conectores MCP» muestra el panel
consolidado de 016 tal cual (contadores, filtros, verificación, detalle).
La pestaña activa vive en la URL (`?tab=mcp`) para poder enlazarla.

**Acceptance Scenarios**:

1. **Given** `/admin?tab=mcp`, **When** carga, **Then** ve el panel MCP y
   no la tabla de empresas; al volver a «Empresas» la URL pierde `tab`.

### Edge Cases

- Quitar a un usuario con sesión activa en esa empresa: su siguiente
  pedido cae a otra empresa (018) o queda sin sesión válida.
- Tabla en móvil: scroll horizontal dentro de la tabla, sin desbordar la
  página.
- El detalle conserva las reglas existentes: correo reservado (403),
  duplicado con oferta de sumar (018), reset con temporal nueva.

## Requirements *(mandatory)*

- **FR-001**: `/admin` MUST mostrar dos pestañas «Empresas» y «Conectores
  MCP», con la activa en `?tab=` (por defecto Empresas).
- **FR-002**: La pestaña Empresas MUST listar las empresas en una tabla
  (nombre, slug, usuarios, WhatsApp, IA, conector, alta) con filas
  navegables al detalle, y un botón «Nueva empresa» con el alta en diálogo.
- **FR-003**: MUST existir `/admin/organizations/[id]` (gate super admin
  server-side) con estado, usuarios y conector MCP de esa empresa.
- **FR-004**: `DELETE /api/admin/organizations/[id]/users/[userId]` MUST
  quitar la membresía; si el usuario queda sin empresas y no es correo de
  plataforma, MUST eliminar la cuenta; MUST rechazar al último propietario
  (409 `last_owner`) y a un super admin ajeno (403).
- **FR-005**: `GET /api/admin/organizations/[id]` MUST devolver el mismo
  DTO que el listado para una empresa (404 si no existe).
- **FR-006**: La UI MUST pedir confirmación antes de quitar y explicar el
  efecto (pierde la empresa / se elimina la cuenta).

## Success Criteria *(mandatory)*

- **SC-001**: Guion E2E `tests/e2e/019-admin-organizations.md` verde
  (escritorio + 375 px): tabla → detalle → alta → sumar existente → quitar
  (cuenta eliminada y cuenta conservada) → último propietario rechazado →
  pestaña MCP.
- **SC-002**: Gate técnico verde.

## Assumptions

- «Eliminar un usuario» = quitarlo de la empresa; la cuenta se elimina
  solo cuando no le queda ninguna empresa (una cuenta sin empresas no
  puede operar en esta instancia).
- No hay borrado de empresas en esta feature.
