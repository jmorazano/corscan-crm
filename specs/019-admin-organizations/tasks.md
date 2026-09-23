# Tasks: Administración ordenada (019)

**Input**: specs/019-admin-organizations/spec.md + plan.md

## Phase 1: Servidor

- [x] T001 `getOrganization(id)` en src/server/admin/organizations.ts + `GET /api/admin/organizations/[id]`
- [x] T002 `removeOrganizationUser` en src/server/admin/users.ts (last_owner, forbidden, cuenta eliminada si queda sin empresas, plataforma nunca) + `DELETE /api/admin/organizations/[id]/users/[userId]` + tests

## Phase 2: UI

- [x] T003 [US1] admin-client.tsx: pestañas «Empresas | Conectores MCP» (`?tab=`), tabla de empresas navegable, alta en diálogo
- [x] T004 [US1] organization-detail-client.tsx + página `/admin/organizations/[id]` (gate server-side): cabecera con estado, usuarios (alta / sumar existente / reset / quitar), conector MCP
- [x] T005 [US2] Confirmación de baja en Dialog + mensaje según `accountDeleted`

## Phase 3: Verificación y cierre

- [x] T006 Guion tests/e2e/019-admin-organizations.md en el Browser pane el 23-sep-2026 (escritorio + 375 px, feliz + infeliz) — en verde
- [x] T007 CLAUDE.md (fila de Administración + feature activa) + memoria
- [x] T008 Gate técnico completo (typecheck + lint + build + test) — verde el 23-sep-2026 (904 tests)
