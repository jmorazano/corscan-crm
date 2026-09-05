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

- La contraseña la genera el CLIENTE (mismo generador del team-client) y se
  muestra UNA vez tras el 200; el server jamás la devuelve.
- Efectos: `provisionOrganization` (org + slug único + 5 etapas + perfil de
  agente) + usuario vía bypass interno + membresía `owner`.
- 409 `duplicate_email` si el email ya existe (ningún efecto parcial
  persistente: la org solo se crea si el alta del usuario procede — orden:
  validar email → crear org → crear usuario; fallo del usuario ⇒ rollback de
  la org creada en esa request).

Response 200: `{ "organizationId": "org_...", "slug": "masterbrand" }`

## POST /api/admin/organizations/[id]/users

Usuario adicional en una empresa (FR-014). Request
`{ "name", "email", "password", "role": "owner" | "member" }` (generada en
cliente, mostrada una vez). 404 si la org no existe; 409 email duplicado.

## POST /api/admin/users/[id]/password

Reset de contraseña (FR-014): request `{ "password": "nueva-temporal" }`
(generada en cliente, mostrada una vez). Invalida las sesiones activas del
usuario. 404 si el usuario no existe.

## Gate del plugin organization (FR-013)

Los endpoints self-serve del plugin (`/api/auth/organization/create`, y
demás mutaciones de organización/miembros no usadas por la app) responden
403 salvo dentro del bypass interno. Verificado por unit test.
