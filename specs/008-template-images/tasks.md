# Tasks: Plantillas con imagen de encabezado

**Input**: Design documents from `/specs/008-template-images/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: la spec exige self-test E2E (Definición de Hecho REFORZADA) + unit de reglas puras.

**Organization**: por historia — US1 alta con imagen (P1), US2 envío con imagen (P2), US3 miniaturas (P3).

## Phase 1: Setup

- [x] T001 Agregar kind `templateMedia` (prefijo `tm`) en src/lib/db/ids.ts
- [x] T002 Definir tabla `template_media` (bytea custom type, FK cascade a template UNIQUE, organization_id NOT NULL) en src/lib/db/schema.ts y generar migración con `pnpm db:generate` (drizzle/)

## Phase 2: Foundational (bloquea todas las historias)

- [x] T003 [P] Crear validación pura de imagen (whitelist MIME + magic bytes JPEG/PNG + tope 5MB, errores en español) en src/lib/template-header.ts
- [x] T004 [P] Agregar `uploadResumable(appId, token, bytes, mime)` (dos pasos de la Resumable Upload API, body binario, errores MetaApiError) en src/lib/meta/client.ts
- [x] T005 [P] Extender wa-mock: `POST {app_id}/uploads` → upload session, `POST upload:mock-*` → handle, alta de plantilla guarda `components`, outbox registra `template.components` en src/app/api/dev/wa-mock/graph/[...path]/route.ts

## Phase 3: US1 — Crear plantilla con imagen (P1) 🎯 MVP

- [x] T006 [US1] Alta con imagen en src/server/whatsapp/templates.ts: `createTemplate` acepta imagen validada, sube ejemplo (T004), arma HEADER(IMAGE)+BODY, y tras el OK de Meta upsertea template + reemplaza template_media en UNA transacción (D5, sin fantasmas); `deleteTemplate` sin cambios (cascade)
- [x] T007 [US1] `serializeTemplate` + carga con JOIN 1:1 a template_media → campo `headerImageUrl` en src/server/whatsapp/templates.ts (y su uso en GET /api/templates)
- [x] T008 [US1] Migrar `POST /api/templates` a multipart/form-data (formData + Zod de campos + File opcional) en src/app/api/templates/route.ts
- [x] T009 [US1] Ruta pública del binario `GET /api/template-media/[id]` (sin auth, Content-Type real, Cache-Control immutable, 404 si no existe) en src/app/api/template-media/[id]/route.ts
- [x] T010 [US1] Formulario de creación con input de imagen (aviso de tipo/peso en cliente, FormData, errores del server visibles) y miniatura en el listado en src/components/settings/templates-client.tsx
- [x] T011 [P] [US1] Unit tests de validación de imagen (magic bytes, peso, MIME falso) en tests/unit/template-header.test.ts

## Phase 4: US2 — Envío con imagen (P2)

- [x] T012 [US2] `sendTemplateCore` antepone componente `header` con link `APP_BASE_URL + /api/template-media/{id}` cuando la plantilla tiene media (guards intactos; sin imagen payload idéntico al actual) en src/server/whatsapp/templates.ts
- [x] T013 [P] [US2] Unit tests del payload de envío (con imagen + variable, con imagen sin variable, sin imagen = actual) en tests/unit/templates-header-send.test.ts

## Phase 5: US3 — Miniaturas en previews (P3)

- [x] T014 [US3] `template-preview.tsx` muestra la imagen arriba del cuerpo cuando `headerImageUrl` existe (sin hueco si no) en src/components/templates/template-preview.tsx
- [x] T015 [US3] Verificar/ajustar que el selector de campañas y el diálogo de envío 1:1 reciben `headerImageUrl` y renderizan el preview compartido (src/components/campaigns/campaigns-client.tsx y el diálogo de plantillas de la bandeja)

## Phase 6: Polish & verificación reforzada

- [x] T016 Guion E2E tests/e2e/008-template-images.md (flujo feliz + infelices del quickstart) y ejecutarlo con Playwright + mocks hasta verde
- [x] T017 Gate técnico completo: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
- [x] T018 Actualizar CLAUDE.md (fila del mapa de código: plantillas con imagen → template-header.ts, template-media route, uploadResumable)

## Dependencies

- T001→T002 → (T003,T004,T005) → US1 (T006–T011) → US2 (T012–T013) → US3 (T014–T015) → Polish.
- US2 depende de US1 (necesita plantillas con media persistida). US3 solo de US1.

## Parallel Opportunities

- T003, T004, T005 en paralelo (archivos distintos).
- T011 y T013 en paralelo con las tareas UI de su historia.

## Implementation Strategy

MVP = Phase 1–3 (crear con imagen y verla pendiente/aprobada). Luego envío
(US2), miniaturas (US3) y el guion E2E que cierra la Definición de Hecho.
