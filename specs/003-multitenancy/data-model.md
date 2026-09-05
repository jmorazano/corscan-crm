# Data Model — 003 Multitenancy

Fase 1. Solo UNA tabla nueva; el resto del modelo ya es multi-tenant
(organization_id NOT NULL + índices org-first en todas las tablas de dominio).

## Tabla nueva: `ai_credentials`

Config de IA por empresa (patrón calcado de `meta_credentials`).

| Campo | Tipo | Reglas |
|---|---|---|
| id | text PK | nanoid con prefijo `aic_` |
| organization_id | text NOT NULL → organization.id | **UNIQUE** (a lo sumo una config por empresa); índice org-first |
| token_cipher | text NOT NULL | AES-256-GCM (lib/crypto), jamás en claro |
| token_iv | text NOT NULL | |
| token_tag | text NOT NULL | |
| model | text NULL | modelo del agente; NULL = default de producto |
| judge_model | text NULL | modelo del juez del Laboratorio; NULL = default (o el del agente) |
| created_at / updated_at | timestamp NOT NULL | |

**Validación** (Zod en el endpoint): token no vacío (trim); model/judge_model
opcionales con formato `proveedor/modelo` laxo (string no vacío).

**Acceso**: exclusivamente vía `src/server/ai/credentials.ts` con `scoped()`;
al cliente solo viaja `tokenLast4`, `model`, `judgeModel` y el estado
derivado (`configured: boolean`).

**Borrado**: DELETE físico de la fila = agente apagado para esa empresa
(estado observable en Ajustes). Sin cascada especial (borrar la organización
cascadea por FK como el resto del dominio).

## Entidades existentes afectadas (sin migración)

- **user**: UNA columna nueva: `must_change_password boolean NOT NULL
  DEFAULT false` (FR-017; migración propia de Fase 2 —
  drizzle/0001_pretty_steel_serpent.sql — separada de la de ai_credentials). Se setea en
  toda alta por tercero y en todo reset; se limpia en el cambio de
  contraseña propio. El rol de plataforma NO se persiste: deriva de
  `SUPER_ADMIN_EMAILS` (env) — ver research D1, con la regla anti-escalación
  de FR-016 en todos los caminos de alta.
- **member**: sin cambios de schema. Cambio de COMPORTAMIENTO:
  `resolveMembership` ordena por `created_at ASC, id ASC` (determinismo,
  FR-012). Sigue asumiéndose 1 membresía por usuario (spec assumption).
- **organization**: sin cambios de schema. El slug único ya existe; la
  generación pasa a `slugify(nombre)` + sufijo numérico en colisión (D11).
- **meta_credentials**: sin cambios (UNIQUE organization_id = 1 número por
  empresa, límite aceptado; UNIQUE phone_number_id ya garantiza el ruteo).

## Estados y transiciones

**Config de IA por empresa**: `no configurada` → (PUT token) → `activa` →
(PUT token nuevo) → `activa` (rotación) → (DELETE) → `no configurada`.
El agente y el Laboratorio de la empresa solo operan en `activa`; en
`no configurada` cada superficie muestra el aviso y la Bandeja manual opera
normal (FR-010).

**Empresa**: `creada` (seeds listos, sin WhatsApp ni IA) → `operativa
parcial` (conecta WhatsApp O configura IA) → `operativa completa`. No hay
estado "desactivada" en v1 (fuera de alcance).

## Migración (drizzle/)

1 migración nueva: `CREATE TABLE ai_credentials` + índice único por
organization_id. La re-ejecutabilidad la garantiza el journal del migrator
de drizzle (aplicación versionada al boot vía scripts/migrate.mjs), no el
SQL en sí. Sin backfill: la instancia productiva
arranca con la tabla vacía y el agente apagado hasta que cada empresa pegue
su token (SC-005, comunicado al dueño).
