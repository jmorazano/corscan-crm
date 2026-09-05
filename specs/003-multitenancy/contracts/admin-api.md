# Contrato: API de Administración (solo super admin)

Todos los endpoints bajo `withSuperAdmin` (sesión válida + email en
`SUPER_ADMIN_EMAILS`; sin exigir membresía de organización). Cualquier otro
caso → 403 `forbidden` (no 404: la sección existe, el acceso no). Sin
`SUPER_ADMIN_EMAILS` configurada → 403 siempre (la instancia opera como hoy).

Errores con el envelope existente `{ error: { code, message } }`; validación
Zod → 422.

## GET /api/admin/organizations

Lista empresas con sus usuarios.

```json
{
  "organizations": [
    {
      "id": "org_...",
      "name": "Corscan",
      "slug": "principal",
      "createdAt": "...",
      "whatsappConnected": true,
      "aiConfigured": true,
      "members": [
        { "userId": "u_...", "name": "Juan", "email": "j@...", "role": "owner" }
      ]
    }
  ]
}
```

## POST /api/admin/organizations

Crea empresa + usuario admin inicial en un solo flujo (FR-002).

Request:

```json
{
  "organizationName": "Masterbrand",
  "admin": { "name": "Socio", "email": "socio@...", "password": "generada-en-cliente" }
}
```

- La contraseña la genera el CLIENTE (mismo generador del team-client), se
  muestra UNA vez tras el 200 y el server jamás la devuelve. Validación
  server-side Zod: mínimo 8 caracteres (en ESTE endpoint y en los otros dos
  que reciben password — nunca se confía en el cliente).
- Efectos: `provisionOrganization` (org + slug único + 5 etapas + perfil de
  agente) + usuario vía bypass interno con `must_change_password = true` +
  membresía `owner`.
- 409 `duplicate_email` si el email ya existe. 403 `reserved_email` si el
  email figura en `SUPER_ADMIN_EMAILS` (FR-016 aplica también al POST de
  Equipo existente).
- Recuperación ante efectos parciales: el camino de error hace rollback
  compensatorio de la org creada en la request; ante un crash puede quedar
  una org huérfana (sin miembros) — el reintento con el mismo nombre la
  DETECTA y REUTILIZA en vez de crear otra (idempotencia recuperable, no
  atomicidad).

Response 200: `{ "organizationId": "org_...", "slug": "masterbrand" }`

## POST /api/admin/organizations/[id]/users

Usuario adicional en una empresa (FR-014). Request
`{ "name", "email", "password", "role": "owner" | "member" }` (password
generada en cliente, min 8 validado server-side, mostrada una vez; el alta
setea `must_change_password`). 404 si la org no existe; 409 email duplicado;
403 `reserved_email` (FR-016).

## POST /api/admin/users/[id]/password

Reset de contraseña (FR-014/FR-017): request `{ "password": "nueva-temporal" }`
(generada en cliente, min 8 validado server-side, mostrada una vez). Efectos:
setea `must_change_password`, invalida las sesiones activas del usuario. 404
si el usuario no existe. No aplicable sobre cuentas super admin ajenas (403).

## Cambio de contraseña propio + primer login (FR-017)

- `POST /api/settings/password`: `{ "currentPassword", "newPassword" }`
  (min 8) — cualquier usuario autenticado; usa el changePassword de la
  plataforma de auth; limpia `must_change_password`.
- Mientras `must_change_password` sea true, el shell de la app redirige a la
  pantalla de cambio obligatorio antes de cualquier otra vista; las APIs de
  dominio pueden seguir exigiendo solo sesión (la coerción es de UX; el
  riesgo que cierra es el acceso del TERCERO que conoce la temporal, y ese
  se corta con el cambio).

## Gate del plugin organization (FR-013) — ALLOWLIST

TODO `/api/auth/organization/*` mutante responde 403 fuera del bypass
interno. Paths denegados enumerados y testeados uno por uno: `create`,
`update`, `delete`, `set-active`, `invite-member`, `accept-invitation`,
`cancel-invitation`, `reject-invitation`, `remove-member`,
`update-member-role`, `leave`. La app cliente no usa ninguno (allowlist
vacía); el circuito de invitaciones queda inoperante aunque la tabla exista.
