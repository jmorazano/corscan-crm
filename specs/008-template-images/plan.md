# Implementation Plan: Plantillas con imagen de encabezado

**Branch**: `008-template-images` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-template-images/spec.md`

## Summary

Las plantillas de WhatsApp ganan un encabezado de imagen opcional de punta a
punta: el alta sube la imagen de ejemplo a Meta por la **Resumable Upload
API** (`header_handle`) y registra la plantilla con componentes
`HEADER(IMAGE) + BODY`; la imagen se guarda **en Postgres** (tabla propia
1:1, constitución II — sin S3) y se sirve por una ruta pública con id no
adivinable; el envío agrega el componente `header` con esa URL en el embudo
único `sendTemplateCore` (cubre campañas y 1:1 sin duplicar lógica); el
editor y los previews muestran la miniatura. El wa-mock se extiende con los
endpoints de upload para el self-test E2E.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22, Next.js 15 App Router + React 19

**Primary Dependencies**: Drizzle ORM, Zod, Tailwind; Graph API de Meta vía el cliente único `src/lib/meta/client.ts` (nueva capacidad: subida binaria resumable)

**Storage**: PostgreSQL — nueva tabla `template_media` (bytea, 1:1 con `template`, cascade)

**Testing**: Vitest (unit: validaciones, componentes de alta/envío, merge de serialización) + guion E2E `tests/e2e/008-template-images.md` con Playwright + mocks (wa-mock extendido)

**Target Platform**: monolito self-hosted (Railway hoy; Docker standalone)

**Project Type**: web app monolítica existente — se extienden módulos actuales

**Performance Goals**: sin metas nuevas; imágenes ≤5MB servidas con cache headers (`immutable`) — el runner de campañas no re-lee el blob por envío (la URL es estable)

**Constraints**: constitución completa (I secretos, II soberanía sin S3, III `scoped()`, IV idempotencia); ruta de imagen pública SIN auth (requisito del canal) con id nanoid no adivinable; la plantilla aprobada `introduccin_servicio_lidar` no se toca

**Scale/Scope**: pocas decenas de plantillas por org; blob ≤5MB en Postgres es aceptable a esta escala (documentado en research R3)

## Constitution Check

*GATE inicial: PASA. Re-check post-diseño: PASA.*

- **I (Secretos)**: no hay secretos nuevos. La ruta pública sirve SOLO la
  imagen de marketing que el operador eligió difundir masivamente; nunca
  tokens ni datos de contactos. El token de la org sigue cifrado y solo se
  usa server-side para el upload resumable.
- **II (Soberanía)**: imagen en Postgres propio, servida por la propia app.
  Cero servicios externos nuevos; Meta ya era dependencia (canal).
- **III (Multi-tenancy)**: `template_media.organization_id` NOT NULL; toda
  query por `scoped()`. La ruta pública resuelve por id no adivinable y no
  filtra por sesión (no la hay): expone únicamente el binario.
- **IV (Idempotencia)**: alta con el mismo `onConflictDoUpdate`
  (org+name+language) reemplazando su media en la misma transacción; borrado
  re-ejecutable (cascade); migración Drizzle versionada re-ejecutable.
- **Sandbox Laboratorio**: `sendTemplateCore` conserva la aserción `is_test`
  intacta (el header se agrega DESPUÉS de los guards).

## Project Structure

### Documentation (this feature)

```text
specs/008-template-images/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── tasks.md   (/speckit-tasks)
```

### Source Code (repository root)

```text
src/lib/db/schema.ts                      # + tabla template_media
src/lib/db/ids.ts                         # + prefijo templateMedia ("tm")
drizzle/00XX_*.sql                        # migración generada
src/lib/meta/client.ts                    # + uploadResumable() (dos pasos, binario)
src/lib/template-header.ts                # validación pura de imagen (mime/peso) compartida
src/server/whatsapp/templates.ts          # alta con HEADER + envío con header + borrado/replace de media + serialize
src/app/api/templates/route.ts            # POST pasa a multipart (FormData) con imagen opcional
src/app/api/template-media/[id]/route.ts  # GET público del binario (cache immutable)
src/components/settings/templates-client.tsx   # input de imagen + miniaturas + errores
src/components/templates/template-preview.tsx  # preview con imagen arriba del cuerpo
src/app/api/dev/wa-mock/graph/[...path]/route.ts  # + {app_id}/uploads y sesión de upload; header en alta y outbox
tests/unit/template-header.test.ts        # validación de imagen
tests/unit/templates-header-send.test.ts  # componentes del payload de envío
tests/e2e/008-template-images.md          # guion E2E (mocks)
```

**Structure Decision**: extender los módulos existentes respetando el mapa de
fronteras de CLAUDE.md (canal en `src/lib/meta` + `src/server/whatsapp`,
reglas puras en `src/lib`, UI en `src/components`). Sin carpetas nuevas salvo
la ruta pública del binario.

## Fases

- **Phase 0** → [research.md](research.md): decisiones D1–D6 (upload
  resumable, link vs media id en el envío, blob en Postgres, multipart,
  atomicidad del alta, forma del mock).
- **Phase 1** → [data-model.md](data-model.md), [contracts/api.md](contracts/api.md),
  [quickstart.md](quickstart.md); actualización del contexto del agente
  (CLAUDE.md → Feature activa + fila del mapa).
- **Phase 2** → `/speckit-tasks` genera tasks.md por historia (US1 alta, US2
  envío, US3 previews) con Setup/Foundational compartidos.

## Complexity Tracking

Sin violaciones: no se agregan proyectos, servicios ni patrones nuevos.
