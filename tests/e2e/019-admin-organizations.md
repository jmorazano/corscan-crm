# E2E 019 — Administración ordenada (tabla, detalle por empresa, baja de usuarios)

Entorno: dev server + mocks, BD local con A = `Negocio de Super Admin
Local` y B = `Inmobiliaria Demo` (estado que dejó el E2E de 018: `e2e` en A
y B, `compa` en B y A). Identidades: `superadmin@vocero.test` (plataforma)
y `e2e@vocero.test` (owner de A, sin rol de plataforma). Conducido en el
Browser pane.

## Guion

1. **Pestañas**: `/admin` como super admin abre en «Empresas» (contador de
   empresas en la pestaña) con la tabla: nombre + slug, usuarios (y
   propietarios), WhatsApp, IA, conector y alta. Sin formularios abiertos.
2. **Conectores MCP**: click en la pestaña → URL `?tab=mcp`, desaparece la
   tabla y aparece el panel consolidado de 016 (contadores, filtros, fila
   con «Verificar conexión» / «Ver detalle»). Volver a «Empresas» limpia
   `tab`.
3. **Detalle**: click en la fila de A (fuera del link) → navega a
   `/admin/organizations/<id>`: cabecera con nombre, slug, fecha y badges
   (WhatsApp / IA / Conector), tarjeta «Usuarios» con 4 cuentas y botones
   «Restablecer contraseña» y «Quitar», «Agregar usuario», y la tarjeta
   del conector MCP con Editar/Deshabilitar.
4. **Quitar (conserva la cuenta)**: «Quitar» sobre `compa` → diálogo con
   el efecto explicado → confirmar → «Usuario quitado ✓ … conserva su
   cuenta y sus otras empresas»; la lista baja a 3 y `compa` sigue en B.
5. **Quitar (elimina la cuenta)**: «Quitar» sobre `miembro-t029` (solo A)
   → confirmar → «Usuario quitado y cuenta eliminada ✓»; sumar ese correo
   por API responde 404 `user_not_found` (la cuenta ya no existe).
6. **Último propietario**: detalle de B → «Quitar» sobre `socio` (único
   owner) → confirmar → el diálogo queda abierto con «Es el único
   propietario de la empresa: nombrá otro propietario antes de quitarlo»
   (409) y nada cambia.
7. **Nueva empresa**: «Nueva empresa» abre el diálogo; crear «Empresa
   Prueba 019» con `admin019@vocero.test` → el diálogo muestra las
   credenciales una vez y la tabla pasa a 3 filas; «Abrir la empresa»
   lleva al detalle nuevo con su único usuario.
8. **Móvil (375 px)**: `/admin` sin scroll horizontal de página
   (`scrollWidth 375`), la tabla desplaza dentro de su contenedor; el
   detalle apila cabecera, badges, usuarios (íconos sin texto) y conector.
9. **Sin rol de plataforma**: como `e2e`, `GET /api/admin/organizations/<id>`
   y `DELETE …/users/<userId>` → 403; abrir `/admin/organizations/<id>`
   redirige a `/inbox`.

## Resultado (23-sep-2026)

Todo ✅ tal como está descrito arriba, en escritorio y a 375 px. Ajustes
durante la prueba: celdas de badges sin salto de línea y la nota del panel
MCP («Habilitar acá evita entrar a la empresa desde la pestaña Empresas»)
adaptada a la navegación nueva. Unit tests nuevos: `admin-remove-user`
(7), `admin-organization-routes` (9).
