# Plan: 007-campaign-management

**Enfoque**: sin migraciones. Lógica pura y de BD en
`src/server/campaigns/manage.ts` (filtros, `canDeleteCampaign`,
`deleteCampaign` acotado a la org y guardado por estado, ritmo de instancia).
Rutas: `GET /api/campaigns` (filtros + `eligibleNow` vía `previewSegment` +
`settings` con `getQuotaUsage`), `DELETE /api/campaigns/[id]`, detalle con
`eligibleNow`/fechas/`settings`. `TemplateError` gana `extra` para el 409
`in_use` con las campañas.

**UI**: `campaigns-client.tsx` reescrito: `useQueryFilters` (status/q/
campaign), chips de estado + búsqueda con debounce, `RowActions`,
`ConfirmDialog` con textos por acción (`buildConfirm`), `HowItWorks`
(colapsable, localStorage), `Lifecycle` en el detalle (stepper + ahora/
sigue por estado), selector de etiquetas reutilizando `TagPicker` +
`useTagFacets("contacts")`. Plantillas: chips enlazadas de `blockedBy`.

**Verificación**: unit (`campaign-manage.test.ts`, `templates-delete`
extra) + E2E con mocks en `tests/e2e/us-cc-4-campanas.md` §Gestión.
