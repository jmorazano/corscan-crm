# Implementation Plan: Administración ordenada (019)

**Branch**: `019-admin-organizations` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary

Reorganización de `/admin` en dos pestañas («Empresas» con tabla + alta en
diálogo, «Conectores MCP» con el panel de 016), página de detalle por
empresa en `/admin/organizations/[id]` (usuarios + conector) y baja de
usuarios (`DELETE …/users/[userId]`). Sin cambios de esquema.

## Technical Context

TypeScript / Next 15 / React 19 · Drizzle (sin migración) · Vitest + guion
E2E en el Browser pane · sin dependencias nuevas.

## Constitution Check

- **I/III**: todo bajo `withSuperAdmin`; el detalle expone solo metadatos
  de plataforma (mismo DTO que el listado, research D10 de 003).
- **IV**: quitar es idempotente (segundo intento → 404 `not_member`).
- **V/IX**: gate técnico + E2E real, feliz e infeliz.

## Decisiones

- **D1 — Detalle por ruta real** (`/admin/organizations/[id]`), no por
  query param: es una página con su propia URL enlazable y «atrás» natural.
  Gate server-side idéntico al de `/admin`.
- **D2 — `getOrganization(id)`** reutiliza `listOrganizations` y filtra:
  N pequeño (empresas de un operador), una sola fuente de verdad del DTO.
- **D3 — Quitar usuario** = borrar membresía; si no le queda ninguna
  empresa y no es correo de plataforma, se elimina la cuenta (cascada de
  sesiones/credenciales por FK). Guardas: último propietario (409), super
  admin ajeno (403). La cuenta de plataforma nunca se elimina.
- **D4 — Pestaña en la URL** (`?tab=mcp`) con `useQueryFilters`; el panel
  MCP sigue usando sus propios params (`q`, `status`, `errors`).
- **D5 — Alta de empresa en `Dialog`** (hoja en móvil, modal en
  escritorio); las credenciales se muestran dentro del diálogo una vez, con
  atajo «Abrir la empresa».
- **D6 — Confirmación de baja en `Dialog`** con el efecto explicado; el
  resultado dice si la cuenta se eliminó (`accountDeleted`).

## Project Structure

```text
src/server/admin/organizations.ts        # getOrganization
src/server/admin/users.ts                # removeOrganizationUser
src/app/api/admin/organizations/[id]/route.ts            # GET
src/app/api/admin/organizations/[id]/users/[userId]/route.ts  # DELETE
src/app/(app)/admin/organizations/[id]/page.tsx
src/components/admin/admin-client.tsx                    # tabs + tabla + diálogo de alta
src/components/admin/organization-detail-client.tsx      # detalle (usuarios + MCP)
src/components/admin/temp-password.ts
tests/unit/admin-remove-user.test.ts · admin-organization-routes.test.ts
tests/e2e/019-admin-organizations.md
```
