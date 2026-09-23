# Tasks: Espacios de trabajo (018)

**Input**: specs/018-workspaces/spec.md + plan.md + contracts/api.md

## Phase 1: Fundaciones

- [x] T001 Esquema: `user.last_organization_id` + unique `member(organization_id,user_id)` + migración drizzle/0015 (dedupe previo)
- [x] T002 [P] `resolveActiveMembership(userId, preferredOrgId)` en src/server/auth/on-signup.ts + `requireSession` usa `session.activeOrganizationId` + hook `session.create` prefiere `last_organization_id` (tests: resolve-membership, session)
- [x] T003 [P] Puro: `workspaceShortcut` en src/lib/gestures.ts + tests

## Phase 2: US1 — Cambiar de empresa

- [x] T004 [US1] src/server/workspaces/{list,unread,switch}.ts + `GET /api/workspaces` + `POST /api/workspaces/switch` (+ tests unit)
- [x] T005 [US1] Layout pasa `workspaces` + `organizationId` al shell; `use-workspaces.ts` (refetch, focus/visibility → reload si difiere); `switch.ts` cliente
- [x] T006 [US1] `workspace-rail.tsx` + `workspace-tiles.tsx` (escritorio, ≥2) integrados en app-shell.tsx

## Phase 3: US2 — Sumar cuenta existente

- [x] T007 [US2] src/server/auth/membership.ts `attachExistingUser` + `canAttach` en duplicate_email (admin/users.ts) + rutas admin y team con `attachExisting` (+ tests)
- [x] T008 [US2] UI: admin-client.tsx y team-client.tsx ofrecen «Sumar esa cuenta a esta empresa» tras el 409

## Phase 4: US3 — No leídos en rojo

- [x] T009 [US3] `/api/events` suscribe a las otras orgs y emite `workspace.unread` (debounce) + `useEvents.onWorkspaceUnread` + refetch del rail

## Phase 5: US4 — Atajos

- [x] T010 [US4] Listener global en AppShell (captura, preventDefault, solo ≥2) + tooltip con atajo por plataforma

## Phase 6: US5 — Móvil

- [x] T011 [US5] Sección «Espacios de trabajo» en la hoja «Más» + punto rojo en la pestaña «Más»
- [x] T012 [US5] Texto en Ajustes → Notificaciones cuando hay ≥2 espacios (FR-012)

## Phase 7: Docs, verificación y cierre

- [x] T013 Guion tests/e2e/018-workspaces.md conducido en el Browser pane el 23-sep-2026 (escritorio + 375 px, feliz + infeliz) — en verde
- [x] T014 CLAUDE.md (fila + feature activa) + nota en specs/003 (supuesto superado) + memoria
- [x] T015 Gate técnico completo (typecheck + lint + build + test) — verde el 23-sep-2026 (888 tests)
