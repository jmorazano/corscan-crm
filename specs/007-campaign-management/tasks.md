# Tasks: 007-campaign-management

- [x] T01 `manage.ts`: parseCampaignFilters, likePattern, canDeleteCampaign, deleteCampaign, campaignPaceMs
- [x] T02 `GET /api/campaigns`: status/q, eligibleNow por borrador, settings (ritmo + cupo), fechas
- [x] T03 `DELETE /api/campaigns/[id]` + detalle con eligibleNow/settings/fechas
- [x] T04 `TemplateError.extra` → 409 in_use con `campaigns[]`; route lo propaga
- [x] T05 UI lista: filtros en URL, búsqueda, acciones por fila, confirmaciones, panel cómo funciona
- [x] T06 UI detalle: stepper + ahora/sigue, ETA, acciones con confirmación, borrar
- [x] T07 Nueva campaña con selector de etiquetas (catálogo) y texto de elegibles
- [x] T08 Plantillas: chips enlazadas de campañas bloqueantes
- [x] T09 Tests unit (manage, templates-delete extra) + guion E2E + CLAUDE.md
- [x] T10 Verificación E2E con mocks: crear → lanzar → pausar → reanudar → pausa por cupo → cancelar → borrar; plantilla bloqueada → link → borrar borrador → borrar plantilla
