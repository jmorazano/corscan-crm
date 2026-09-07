# Feature Specification: Gestión de campañas y ciclo de vida claro

**Feature Branch**: `main` (entregada directo, sin rama)

**Created**: 2026-09-07

**Status**: Implemented (verificada E2E con mocks el 7-sep-2026)

**Input**: "La campaña en borrador figura con 0 destinatarios aunque el
segmento tenía 1 disponible; no puedo borrar la plantilla porque tampoco
puedo borrar la campaña; agreguemos gestión de campañas con botones y
filtros; no queda claro el ciclo de vida (si se puede pausar, si manda
todo junto o en escalones): que la sección sea más intuitiva."

## User Scenarios & Testing

### US1 - Entender qué va a pasar antes de lanzar (P1)

El operador ve en cada borrador cuántos contactos son elegibles HOY y que la
lista se congela al lanzar. Un panel «¿Cómo funciona una campaña?» explica
los pasos (borrador → lanzar → en curso → pausar/reanudar → completada o
cancelada) con el ritmo real de envío y el cupo de 24h de la empresa.

**Acceptance**: borrador con etiqueta `lead` y 1 contacto elegible → la
lista y el detalle dicen «1 elegible(s) hoy · la lista se congela al
lanzar»; el panel muestra «1 mensaje cada Xs» y «N disponibles de M».

### US2 - Gestionar campañas desde la lista (P1)

Acciones por fila (Lanzar / Pausar / Reanudar / Cancelar / Borrar) con una
confirmación que explica el efecto; filtros por estado y búsqueda por
nombre persistidos en la URL; borrado de borradores, completadas y
canceladas (las que están enviando se cancelan primero).

**Acceptance**: `?status=draft` muestra solo borradores; borrar un
borrador lo saca de la lista; `DELETE` de una campaña en curso → 409.

### US3 - Ver el estado y qué sigue en el detalle (P2)

Un stepper (Borrador → En curso → Completada/Cancelada) con «qué pasa
ahora» y «qué sigue» por estado, incluida la pausa automática por cupo y
la estimación de tiempo restante.

### US4 - Borrar una plantilla bloqueada por una campaña (P2)

El error `in_use` enumera las campañas que bloquean (nombre · estado) con
enlace directo a cada una.

## Requirements

- FR-001: `GET /api/campaigns` acepta `status` (lista) y `q`; devuelve
  `eligibleNow` para borradores y `settings` (ritmo y cupo).
- FR-002: `DELETE /api/campaigns/:id` solo en draft/completed/cancelled,
  guardado por estado (409 `in_progress` en running/paused).
- FR-003: toda acción destructiva o irreversible pide confirmación con el
  efecto explicado; nunca `window.confirm` en campañas.
- FR-004: los filtros viven en la URL (`status`, `q`, `campaign`).
- FR-005: `DELETE /api/templates/:id` 409 incluye `campaigns[]`.
- Sin cambios de esquema: el borrado usa el FK cascade existente.
