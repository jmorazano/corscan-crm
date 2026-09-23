# Implementation Plan: Espacios de trabajo (018)

**Branch**: `018-workspaces` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-workspaces/spec.md`

## Summary

Un usuario puede tener membresía en varias empresas. La empresa activa
vive en `session.active_organization_id` (columna que el plugin
organization de Better Auth ya crea y que hoy se setea al crear la sesión
pero NO se usa) y se valida contra las membresías en cada pedido; todo el
scoping existente (`requireSession` → `organizationId`) queda intacto. Un
endpoint propio cambia la empresa activa (los `/organization/*` del plugin
siguen negados). La UI agrega un rail de escritorio y una sección en la
hoja «Más» del móvil, con no leídos por empresa en rojo actualizados por
un ping SSE, y atajos ⌘/Ctrl+1…9. Administración y Ajustes → Equipo
pueden sumar una cuenta existente a otra empresa con confirmación
explícita.

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15 App Router, React 19
**Primary Dependencies**: Better Auth + plugin organization (ya), Drizzle, Tailwind, lucide
**Storage**: PostgreSQL — migración 0015 (`user.last_organization_id`, unique `member(organization_id,user_id)`)
**Testing**: Vitest (unit: resolución de sesión, switch, attach, unread por org, atajo puro, rutas) + guion E2E `tests/e2e/018-workspaces.md` en el Browser pane con mocks
**Target Platform**: web escritorio + móvil (PWA)
**Constraints**: sin dependencias nuevas; sin cambios en el scoping; sin endpoints del plugin

## Constitution Check

- **I Seguridad**: nada nuevo al cliente salvo nombre/acento/no leídos de
  empresas de las que el usuario ES miembro. El ping SSE lleva solo el id.
- **II Soberanía (1.7.0)**: cero dependencias externas nuevas.
- **III Multi-tenancy**: el `organization_id` sigue saliendo de
  `requireSession`; la única novedad es DE DÓNDE sale (sesión validada
  contra membresías, con fallback determinista). Las queries nuevas
  (`unreadByOrganization`) filtran por la lista de orgs del usuario.
- **IV Idempotencia**: switch idempotente (mismo id → no-op 200); attach
  idempotente por unique index (segundo intento → 409 `already_member`);
  migración re-ejecutable (dedupe antes del unique).
- **V/IX Verificación**: gate técnico + E2E real (escritorio y 375 px,
  feliz e infeliz) conducido por el agente.
- **FR-013 de 003**: el gate allowlist del plugin no se toca (se agrega
  test de que `/organization/set-active` sigue negado).

## Decisiones

- **D1 — Fuente de verdad de la empresa activa**: `session.activeOrganizationId`
  del resultado de `auth.api.getSession` (el plugin lo expone). `requireSession`
  llama a `resolveActiveMembership(userId, sessionActiveOrgId)`: si hay
  membresía con ese id → esa; si no → la más antigua (regla actual) y se
  repara la fila de sesión en segundo plano. Sin membresías → Unauthorized
  (igual que hoy).
- **D2 — Cambio**: `POST /api/workspaces/switch { organizationId }` (withAuth):
  valida membresía → `update session set active_organization_id` por
  `session.id` + `update user set last_organization_id`. 403 `not_member`
  si no. El hook `session.create.before` ahora prefiere
  `user.last_organization_id` si sigue siendo miembro.
- **D3 — Esquema**: `user.last_organization_id text null` (sin FK dura para
  no acoplar el borrado de empresas al usuario; se valida en lectura) y
  `member_org_user_uq` UNIQUE(organization_id, user_id) precedido de un
  DELETE de duplicados que conserva la fila más antigua.
- **D4 — Listado**: `listWorkspaces(userId)` en `src/server/workspaces/list.ts`:
  membresías + org (name, slug, metadata→branding.accent) ordenadas por
  `member.created_at, member.id` + `unreadByOrganization(orgIds)` (un
  `group by` sobre `conversation` con la misma regla del badge:
  `is_test = false OR kind = 'trainer'`).
- **D5 — En vivo**: el route `/api/events` se suscribe además a las otras
  orgs del usuario y, ante `message.new` / `conversation.updated` /
  `conversations.updated` / `conversation.deleted` de ellas, emite
  `workspace.unread { organizationId }` (debounce 1 s por org). El
  cliente refetchea `/api/workspaces`. El tope de vida de 15 min ya
  re-resuelve membresías.
- **D6 — UI**: `src/components/workspaces/` — `workspace-rail.tsx`
  (escritorio, `hidden md:flex`, 56 px), `workspace-tiles.tsx` (mosaico
  compartido con badge), `use-workspaces.ts` (estado: inicial por props
  SSR desde el layout, refetch en `workspace.unread`, `focus` y
  `visibilitychange`; si `active` del servidor ≠ el montado → reload),
  `switch.ts` (POST + `location.assign(pathname)`). En móvil, sección
  en la hoja «Más» de `app-shell.tsx` + punto rojo en la pestaña «Más».
  `useEvents` aprende `onWorkspaceUnread`.
- **D7 — Atajos**: `workspaceShortcut(e): number | null` puro en
  `src/lib/gestures.ts` (mod = meta ∨ ctrl, sin alt/shift, dígito 1–9 por
  `key` o `code`). Listener global en `AppShell` (fase de captura,
  `preventDefault`) solo con ≥ 2 espacios y solo si el índice existe y
  no es el activo.
- **D8 — Attach**: `attachExistingUser({ organizationId, email, role })`
  en `src/server/auth/membership.ts` (compartido): busca usuario por email
  → reserved (403) → ya miembro (409) → insert member. Los POST de
  Administración y de Equipo aceptan `attachExisting: true` (sin
  contraseña) y, en el 409 `duplicate_email` del alta normal, devuelven
  `canAttach: true` para que la UI ofrezca el segundo paso.
- **D9 — Push**: sin cambios de código en 013; solo texto en Ajustes →
  Notificaciones cuando hay más de un espacio (la re-liga en silencio ya
  existe).
- **D10 — E2E**: BD local con `Negocio de Super Admin Local` (A) e
  `Inmobiliaria Demo` (B); el super admin suma `e2e@vocero.test` a B; el
  operador E2E ve el rail; entrante mock en B mientras está en A → globo.

## Project Structure

```text
specs/018-workspaces/
├── spec.md · plan.md · tasks.md
└── contracts/api.md

src/lib/db/schema.ts (+ drizzle/0015_*.sql)
src/lib/auth/session.ts                 # activeOrganizationId de la sesión
src/lib/auth/index.ts                   # hook session.create: last_organization_id
src/server/auth/on-signup.ts            # resolveActiveMembership
src/server/auth/membership.ts           # attachExistingUser (compartido)
src/server/admin/users.ts               # canAttach en duplicate_email
src/server/workspaces/{list,switch,unread}.ts
src/app/api/workspaces/route.ts · switch/route.ts
src/app/api/events/route.ts             # ping workspace.unread
src/app/api/admin/organizations/[id]/users/route.ts · src/app/api/settings/team/route.ts
src/app/(app)/layout.tsx                # workspaces iniciales al shell
src/components/workspaces/*             # rail, mosaicos, hook, switch
src/components/app-shell.tsx · app-nav.tsx · use-events.ts
src/components/admin/admin-client.tsx · settings/team-client.tsx · settings/notifications-client.tsx
src/lib/gestures.ts                     # workspaceShortcut
tests/unit/{workspaces-*,resolve-membership,attach-existing-user,gestures}.test.ts
tests/e2e/018-workspaces.md
```

## Complexity Tracking

Sin desvíos de la constitución.
