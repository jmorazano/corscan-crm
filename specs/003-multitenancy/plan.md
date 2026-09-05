# Implementation Plan: Multitenancy real — varias empresas en una instancia

**Branch**: `003-multitenancy` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-multitenancy/spec.md`

## Summary

Abrir el perímetro single-tenant del CRM: un rol de plataforma **super admin**
(definido por configuración de instancia, sin schema nuevo) con una sección
Administración para crear empresas (organización + seeds, extraídos de
`onUserCreated`) y sus usuarios (patrón existente `runInternalSignup` +
contraseña temporal mostrada una vez); y **configuración de IA por empresa**
(token OpenRouter cifrado AES-256-GCM con last-4, modelo del agente y del
juez), sin fallback global, resuelta por `organizationId` en todos los call
sites del adaptador LLM. Incluye los endurecimientos que la exploración marcó
(scope del borrado demo, membresía determinista, gate de los endpoints
self-serve del plugin organization) y estrena el **self-test E2E de
comportamiento en local** (Docker Postgres + mocks + guiones multi-empresa).

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22 (nvm 22.22.1)

**Primary Dependencies**: Next.js 15 App Router, React 19, Drizzle ORM, Better Auth 1.6.23 (plugin organization; el plugin admin NO se adopta — ver research D1), Zod, Tailwind

**Storage**: PostgreSQL (migraciones versionadas en `drizzle/`, aplicadas al boot); tabla nueva `ai_credentials` (patrón `meta_credentials`)

**Testing**: Vitest (unit) + guiones E2E en `tests/e2e/*.md` conducidos con Playwright MCP sobre entorno local (Docker Postgres + wa-mock + ai-mock)

**Target Platform**: instancia self-hosted (Railway hoy; Docker standalone)

**Project Type**: web app monolito (App Router)

**Performance Goals**: sin cambios (SSE in-process, throughput WhatsApp por número)

**Constraints**: constitución completa; sin servicios externos nuevos; sin emails (credenciales manuales); 1 número WhatsApp por empresa; migración idempotente sobre la instancia productiva

**Scale/Scope**: 2-10 empresas por instancia (caso real: Corscan + Masterbrand); ~15 archivos tocados + 1 migración + 3 guiones E2E nuevos

## Constitution Check

*GATE inicial: PASA (con una tensión registrada). Re-evaluado tras Fase 1: PASA.*

- **I Seguridad**: token IA cifrado en reposo (AES-256-GCM `lib/crypto`), solo
  last-4 al cliente, jamás en logs. Aislamiento por tenant reforzado (fix del
  borrado demo cross-tenant). ✅
- **II Soberanía**: cero servicios externos nuevos; sin email (entrega manual
  de credenciales); el adaptador LLM sigue OpenRouter-compatible; el token
  migra de env a BD cifrada (la lista de dependencias no cambia). ✅
- **III Multi-tenancy**: `ai_credentials.organization_id` NOT NULL UNIQUE;
  toda query nueva por `scoped()`; el perímetro (creación de orgs) pasa a ser
  una capacidad real. ✅
- **IV Idempotencia**: creación de empresa idempotente (slug/email únicos,
  error claro en duplicado); bootstrap de super admin por env (re-ejecutable
  por definición); migración re-ejecutable. ✅
- **V + IX Verificación**: gate técnico + PRIMER self-test E2E de
  comportamiento en vivo (local, mocks), guiones nuevos multi-empresa,
  caminos infelices incluidos. ✅
- **VI Specs antes de código**: este flujo. ✅
- **VII Trazabilidad**: decisiones D1-D11 en research.md; supuestos en spec. ✅
- **VIII Foco vertical — TENSIÓN REGISTRADA**: VIII dice "una instancia = un
  negocio"; esta feature sirve N negocios del MISMO operador. Se justifica:
  (a) el Principio III sancionó el modelo multi-tenant explícitamente "para
  no cerrar la puerta a evoluciones" — esta es esa evolución; (b) no se
  agrega nada de "plataforma centralizada" (sin billing, sin planes, sin
  multi-instancia); (c) sirve al operador que despliega (dueño + socio), que
  es a quien VIII protege. Se recomienda enmienda **MINOR** de la
  constitución al mergear ("una instancia = un operador; una o más empresas
  del operador") — expansión material del alcance según la propia política
  de versionado, no un refinamiento de redacción. Ver Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-multitenancy/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — decisiones D1-D11
├── data-model.md        # Fase 1 — entidades y migración
├── quickstart.md        # Fase 1 — entorno E2E local + guiones
├── contracts/
│   ├── admin-api.md     # Endpoints de Administración (super admin)
│   └── ai-settings.md   # Endpoint de config IA por empresa
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── env.ts                       # + SUPER_ADMIN_EMAILS; depreca OPENROUTER_API_TOKEN/MODEL(es)
│   ├── api.ts                       # + withSuperAdmin (sesión sin exigir membresía)
│   └── ai/index.ts                  # chatJson recibe AiConfig (token/model por empresa)
├── server/
│   ├── auth/
│   │   ├── on-signup.ts             # extrae provisionOrganization(); resolveMembership (AQUÍ vive, :68) determinista
│   │   └── super-admin.ts           # isSuperAdminEmail() sobre SUPER_ADMIN_EMAILS + regla FR-016
│   ├── admin/
│   │   └── organizations.ts         # crear empresa + admin inicial; listar; crear usuario; reset password
│   ├── ai/
│   │   ├── credentials.ts           # save/get/delete AiConfig cifrada (patrón whatsapp/credentials)
│   │   ├── pipeline.ts / trigger.ts # gate y llamadas con AiConfig por organizationId
│   │   └── ...
│   ├── lab/judge.ts                 # judge model por empresa (organizationId plumbeado)
│   └── seed/demo.ts                 # FIX (path real): borrado demo scoped por organización (:162-183)
├── app/
│   ├── (app)/admin/page.tsx         # sección Administración (solo super admin)
│   ├── api/admin/organizations/route.ts          # GET lista / POST crear empresa+admin
│   ├── api/admin/organizations/[id]/users/route.ts  # POST usuario adicional
│   ├── api/admin/users/[id]/password/route.ts    # POST reset (temporal, una vez)
│   └── api/settings/ai/route.ts     # GET estado (last4) / PUT token+modelos / DELETE
├── components/
│   ├── admin/admin-client.tsx       # UI Administración
│   ├── settings/ai-card.tsx         # card de IA en Ajustes (token last4, modelos, estado agente)
│   └── app-nav.tsx                  # ítem Administración condicionado a super admin
└── lib/db/schema.ts                 # + aiCredentials
drizzle/                             # + migración aiCredentials
tests/
├── unit/                            # admin-orgs, ai-credentials, super-admin gate, membership determinista
└── e2e/us-mt-*.md                   # guiones: crear empresa, aislamiento, token por empresa
```

**Structure Decision**: monolito existente; solo se agregan la sección
`admin/` (UI+API+server) y la config de IA por empresa siguiendo los patrones
ya establecidos (withAuth/withSuperAdmin, credentials cifradas, cards de
Ajustes).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Tensión con VIII ("una instancia = un negocio") | El operador real (dueño + socio) necesita 2 empresas en su instancia; III diseñó el modelo para esto | Desplegar una segunda instancia para Masterbrand: duplica VPS/dominio/app de Meta y rompe "gestión única del operador"; el modelo de datos ya es multi-tenant y el riesgo agregado es el perímetro, que esta feature construye con verificación explícita |
