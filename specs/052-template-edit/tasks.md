# Tasks — 052 editar plantillas

## Plan

- **Puro** `src/lib/template-edit.ts`: `templateEditability(status,
  approvedEdits, now)` (estado + topes 1/24 h y 10/30 días → `nextEditAt`),
  `pruneApprovedEdits`, `sameBindings`, `editBlockingCampaigns`.
- **Datos**: `template.approved_edits` jsonb `[]` (marcas ISO de ediciones
  hechas a plantillas aprobadas) — migración 0039.
- **Servidor** `editTemplate` en `src/server/whatsapp/templates.ts`
  (validación compartida con el alta: `validateBindings`,
  `metaTemplateError`), `PATCH /api/templates/[id]` multipart con
  `withOwner`. `serializeTemplate` suma `edit` (puede, motivo, desde cuándo,
  categoría bloqueada).
- **UI**: el formulario del alta pasa a `TemplateEditor` con modo
  `create|edit`; botón «Editar» por fila.
- **wa-mock**: `POST /{tplmock_…}` (edita, queda PENDING) + `GET
  /{tplmock_…}` (estado) + knob `failTemplateEdit` (400 con mensaje de
  Meta).

## Tareas

- [x] T1 `src/lib/template-edit.ts` + `tests/unit/template-edit.test.ts`.
- [x] T2 schema + migración 0039.
- [x] T3 `editTemplate` + helpers compartidos + test con fetch mockeado
  (`tests/unit/templates-edit.test.ts`).
- [x] T4 `PATCH /api/templates/[id]`.
- [x] T5 DTO `edit` + UI (editor compartido, botón, motivos, confirmación).
- [x] T6 wa-mock (edición, estado, knob).
- [x] T7 Gate (typecheck, lint, build, test).
- [x] T8 Guion `tests/e2e/052-template-edit.md` conducido en el navegador:
  editar rechazada (texto + variable), aprobada (confirmación, vuelve a
  pendiente, segundo intento bloqueado), conservar/quitar/reemplazar
  imagen (HEADER en el mock), sin cambios, campaña en curso → 409, Meta
  rechaza (knob) → nada cambia.
- [x] T9 CLAUDE.md (mapa + feature activa) y memoria.
