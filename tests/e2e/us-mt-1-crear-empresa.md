# US-MT-1 — El super admin crea una empresa con su admin inicial

Guion E2E de comportamiento (feature 003, US1). Entorno: quickstart de
`specs/003-multitenancy/quickstart.md` (Postgres docker + mocks + node
22.22.1). `SUPER_ADMIN_EMAILS` debe contener el email del primer usuario
registrado. Identidades de fixture: `superadmin@vocero.test` (super admin) y
`socio@vocero.test` (admin de la empresa nueva).

## Preparación

1. Instancia vacía → `/register` abierto: registrar `superadmin@vocero.test`
   (nace la empresa "principal").
   ✅ Entra directo a la app; en la nav aparece **Administración** (Shield).

## Camino feliz

2. Ir a **Administración** (`/admin`).
   ✅ Lista de empresas: solo la principal, con sus badges de estado y su
   miembro owner.
3. Crear empresa: nombre `Inmobiliaria Demo`, admin `Socio Demo` +
   `socio@vocero.test`, contraseña generada por el botón.
   ✅ Tras crear: credenciales (email + contraseña temporal) visibles UNA
   sola vez con aviso de guardarlas; la empresa nueva aparece en la lista
   con su owner y sin WhatsApp/IA.
4. Cerrar sesión. Iniciar sesión con `socio@vocero.test` + la temporal.
   ✅ Redirect inmediato a **/change-password** (cambio obligatorio): no se
   puede navegar a la bandeja sin cambiarla.
5. Cambiar la contraseña (nueva propia, ≥8).
   ✅ Entra a SU CRM: bandeja vacía, pipeline sembrado (5 etapas), Ajustes
   operativos. En la nav NO existe "Administración". No hay rastro de datos
   de la empresa principal (contactos/conversaciones vacíos).

## Caminos infelices

6. Como super admin: crear otra empresa con el MISMO email `socio@vocero.test`.
   ✅ Error claro de email duplicado (409); no se crea empresa ni usuario.
7. Como owner de una empresa (p. ej. el socio en Ajustes → Equipo): intentar
   crear un miembro con email `superadmin@vocero.test`.
   ✅ 403 `reserved_email` con mensaje claro (FR-016).
8. Como el socio (no super admin): navegar a `/admin` y llamar
   `GET /api/admin/organizations`.
   ✅ La página redirige fuera; la API responde 403 `forbidden`.

## US5 — Usuario adicional y reset de contraseña (T026/T027)

9. Como super admin en `/admin`: en la tarjeta de `Inmobiliaria Demo`,
   **Agregar usuario** → nombre `Compa Demo`, correo `compa@vocero.test`,
   rol Miembro, contraseña generada por el botón → Crear usuario.
   ✅ Credenciales (email + temporal) visibles UNA sola vez; el usuario
   aparece en la lista de la empresa con badge Miembro.
10. **Restablecer contraseña** sobre `socio@vocero.test` → confirmar.
    ✅ Temporal NUEVA mostrada una sola vez. Login del socio con la
    contraseña vieja → falla; con la temporal nueva → entra y cae en
    **/change-password** (cambio obligatorio). Si el socio tenía una sesión
    abierta en otro navegador, esa sesión quedó invalidada (rebota a
    /login en la siguiente navegación).
11. Infelices: repetir el alta con el MISMO correo `compa@vocero.test` → 409
    `duplicate_email`; alta con `superadmin@vocero.test` → 403
    `reserved_email`; `POST /api/admin/users/u_inexistente/password` → 404;
    reset sobre la cuenta de OTRO super admin (si hay segunda en
    `SUPER_ADMIN_EMAILS`) → 403 `forbidden`.

## Evidencia esperada

Cada ✅ verificado conduciendo el navegador; anotar fecha y resultado en la
sesión que lo condujo.

## Última conducción

**5-sep-2026 (2ª conducción) — VERDE pasos 9-11 (US5)**: usuario adicional
"Compa Demo" creado con credenciales una-vez y badge Miembro; reset del
socio → la contraseña vieja rechazada, la temporal nueva entró y cayó en
/change-password (cambio obligatorio); infelices 409 duplicate_email /
403 reserved_email / 404 not_found. (El 403 de reset entre dos super
admins no es conducible con un solo super admin local: cubierto por unit
tests.)

**5-sep-2026 — VERDE los 8 pasos** (entorno quickstart 003, primera
conducción E2E de comportamiento del repo):

- Alta de "Inmobiliaria Demo" con credenciales mostradas una vez; empresa en
  la lista con slug `inmobiliaria-demo`, owner y badges de estado.
- Login del socio con la temporal → redirect directo a /change-password; el
  cambio dejó la sesión viva (fix del Set-Cookie validado en vivo) y cayó en
  SU bandeja vacía con pipeline sembrado (5 etapas) y nav SIN Administración.
- Infelices: duplicado → 409 `duplicate_email` sin efectos (la lista siguió
  con 2 empresas); email reservado desde Equipo del socio → 403
  `reserved_email`; /admin como socio → redirect a /inbox y API 403
  `forbidden`.
