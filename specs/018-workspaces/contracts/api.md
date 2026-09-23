# Contratos — Espacios de trabajo (018)

Todos los endpoints internos usan `withAuth` (401 `unauthorized`, 403
`password_change_required`) salvo los de Administración (`withSuperAdmin`).

## `GET /api/workspaces`

Espacios del usuario autenticado, en el orden del rail (antigüedad de la
membresía) y con sus no leídos.

```json
{
  "active": "org_a",
  "workspaces": [
    { "id": "org_a", "name": "Corscan Ingeniería", "slug": "principal", "role": "owner", "accent": "#3f5972", "unread": 0 },
    { "id": "org_b", "name": "Inmobiliaria Demo", "slug": "inmobiliaria-demo", "role": "member", "accent": "#3f6b66", "unread": 5 }
  ]
}
```

- `unread`: suma de `conversation.unread_count` de esa empresa con la
  regla del badge (`is_test = false OR kind = 'trainer'`).
- `accent`: color de acento de la marca de la empresa (para el mosaico).
- Con una sola membresía devuelve un solo elemento (la UI no dibuja rail).

## `POST /api/workspaces/switch`

```json
{ "organizationId": "org_b" }
```

- 200 `{ "ok": true, "organizationId": "org_b" }` — la sesión actual pasa a
  `org_b` y se recuerda como última usada. Idempotente si ya era la activa.
- 403 `not_member` — el usuario no es miembro de esa empresa (o no existe;
  mismo código para no revelar existencia).
- 422 `invalid_body`.

## `GET /api/events` — evento nuevo

```
event: workspace.unread
data: {"organizationId":"org_b"}
```

Se emite (debounce 1 s por empresa) cuando en OTRA empresa del usuario
ocurre `message.new`, `conversation.updated`, `conversations.updated` o
`conversation.deleted`. No lleva contenido; el cliente refetchea
`GET /api/workspaces`.

## Sumar una cuenta existente

### `POST /api/admin/organizations/[id]/users` (super admin)

Alta normal (sin cambios): `{ name, email, password, role }`.

- 409 `duplicate_email` ahora incluye `"canAttach": true` cuando la cuenta
  existe y NO es miembro de esa empresa (si ya lo es, `canAttach: false` y
  el mensaje lo dice).

Adjuntar: `{ email, role, attachExisting: true }` (sin `name` ni `password`).

- 200 `{ "ok": true, "userId": "u_…", "attached": true }`.
- 404 `not_found` empresa inexistente · 404 `user_not_found` correo sin
  cuenta · 403 `reserved_email` · 409 `already_member`.

### `POST /api/settings/team` (propietario)

Mismo contrato: alta normal `{ name, email, password }` (409 `duplicate`
+ `canAttach`), o `{ email, attachExisting: true }` (rol `member`).

## Sesión

`requireSession` resuelve `organizationId` así: `session.activeOrganizationId`
si el usuario tiene membresía con ese id; si no, la membresía más antigua
(`created_at ASC, id ASC`) y la sesión se repara. Sin membresías → 401.
Al crear la sesión (login) se prefiere `user.last_organization_id` si
sigue siendo miembro.
