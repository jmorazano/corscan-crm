# Research — 003 Multitenancy

Fase 0. Insumo: exploración paralela del 5-sep-2026 (5 agentes sobre auth,
tenancy/eventos, IA/cifrado, UI y entorno E2E). Sin NEEDS CLARIFICATION
pendientes: todas las incógnitas se resolvieron leyendo el código y con los
defaults comunicados al dueño (con veto abierto) antes de la spec.

## D1 — Rol super admin: flag por configuración, NO plugin admin de Better Auth

- **Decision**: no adoptar el plugin `admin` de better-auth. El rol de
  plataforma se define por env (`SUPER_ADMIN_EMAILS`, lista separada por
  comas) evaluada en un helper `isSuperAdminEmail()`; sin columnas nuevas.
- **Rationale**: el plugin exige migración (user.role, banned, ban_expires,
  session.impersonated_by) y expone endpoints que NO queremos (impersonación,
  bans) — más superficie que auditar (Constitución I/II: mínima superficie).
  El patrón server-side ya probado (`runInternalSignup` + `signUpEmail` en
  /api/settings/team) cubre la creación de usuarios sin plugin. Env-driven es
  idempotente por definición (FR-001) y suficiente para "el dueño de la
  instancia" (se admiten varios emails si algún día hace falta).
- **Alternatives considered**: plugin admin (rechazado: superficie extra +
  migración de auth); columna propia `is_super_admin` (rechazada: exige
  bootstrap con escritura y no aporta sobre el env para 1-2 personas).

## D2 — withSuperAdmin: sesión sin exigir membresía

- **Decision**: wrapper `withSuperAdmin` que resuelve la sesión con
  `auth.api.getSession` directamente y valida `isSuperAdminEmail(email)`;
  NO pasa por `requireSession` (que exige membresía de organización).
- **Rationale**: desacopla el sombrero de plataforma del de empresa; el super
  admin opera Administración aunque su membresía cambie. El ítem de nav se
  muestra cuando la sesión es super admin.
- **Alternatives**: reutilizar withAuth + chequeo extra (rechazado: acopla
  Administración a tener membresía, y el gap de resolveMembership no
  determinista lo vuelve frágil).

## D3 — Crear empresa: provisionOrganization() extraída + secuencia idempotente

- **Decision**: extraer de `on-signup.ts` una `provisionOrganization({name})`
  (org con slug único `slugify(name)` + sufijo en colisión, seeds de 5 etapas
  y agentProfile) reutilizada por: (a) el caso instancia-vacía actual, (b) el
  endpoint de Administración. La creación de empresa+admin es una secuencia
  con verificaciones de unicidad (slug, email) y errores claros — no una
  transacción única, porque `signUpEmail` escribe vía el adapter de Better
  Auth fuera de nuestra transacción.
- **Rationale**: un solo lugar siembra empresas (paridad garantizada con la
  primera); idempotencia por constraints + detección de duplicados (FR-002,
  FR-011, edge case de doble submit).
- **Alternatives**: `auth.api.createOrganization` del plugin organization
  (rechazado: no siembra dominio y duplicaría el camino); transacción global
  (imposible cruzando el adapter).

## D4 — Config de IA por empresa: tabla `ai_credentials` + AiConfig explícita

- **Decision**: tabla `ai_credentials` (organization_id NOT NULL UNIQUE,
  token cifrado cipher/iv/tag, model y judge_model opcionales con defaults de
  producto). Módulo `src/server/ai/credentials.ts` calcado de
  `whatsapp/credentials.ts` (save/get/delete + last4). `chatJson` deja de
  leer env: recibe `AiConfig {token, model}` resuelta aguas arriba por
  `getAiConfig(organizationId)`. `isAiConfigured()` (sync, global) se
  reemplaza por ese lookup async. `OPENROUTER_BASE_URL` SIGUE siendo env:
  es del adaptador/instancia (y es lo que intercepta el ai-mock), no del
  tenant.
- **Rationale**: FR-008/009/010; separa el secreto (por empresa) del
  transporte (por instancia); el patrón cifrado ya existe y está probado.
- **Alternatives**: fallback al env token (rechazado por el dueño: gasto
  cruzado silencioso); token por usuario (rechazado: el gasto es de la
  empresa).
- **Call sites a migrar** (de la exploración): `server/ai/pipeline.ts:158`
  (organizationId en scope), `server/lab/judge.ts:42-48` (plumbear org),
  `server/ai/trigger.ts:12` (gate async), `app/api/lab/runs/route.ts:37-41`
  y `app/api/agent/profile/route.ts:27` (session.organizationId), y 3 textos
  de UI que nombran las env vars.

## D5 — Gate de endpoints self-serve del plugin organization

- **Decision**: hook `before` en el config de better-auth que rechaza los
  paths de creación/gestión de organizaciones del plugin
  (`/organization/create`, etc.) salvo que corran dentro del bypass interno
  (mismo mecanismo AsyncLocalStorage de `runInternalSignup`).
- **Rationale**: FR-013; el patrón de gate por hook ya existe (signup
  cerrado) y evita depender de que "nadie llame" endpoints montados.
- **Alternatives**: deshabilitar el plugin (imposible: da el modelo
  org/member); permisos del plugin (insuficiente: cualquier usuario podría
  crear su org por API).

## D6 — Endurecimientos

- `resolveMembership`: agregar `ORDER BY created_at ASC` (+ orden estable
  secundario por id) — FR-012.
- `seedDemo`: el borrado de contactos demo pasa a filtrar por
  `organization_id` (bug destructivo cross-tenant detectado) — FR-005.
- Textos de UI que instruyen setear `OPENROUTER_API_TOKEN`: pasan a apuntar a
  Ajustes → Inteligencia artificial — FR-015.

## D7 — Reset de contraseñas sin email

- **Decision**: el super admin (Administración) y el owner de la empresa
  (Equipo, ya existente para creación) generan contraseña temporal en el
  cliente (mismo generador `crypto.getRandomValues` del team-client) y se
  muestra UNA vez. El reset del super admin usa el update interno de
  credenciales de better-auth vía API server-side.
- **Rationale**: FR-003/FR-014; sin email (Constitución II); patrón de
  entrega manual ya validado en Equipo.

## D8 — Deprecación de envs

- **Decision**: `OPENROUTER_API_TOKEN`, `OPENROUTER_MODEL` y
  `OPENROUTER_JUDGE_MODEL` dejan de leerse en runtime (quedan documentadas
  como deprecadas en `.env.example`, con guía de migración a Ajustes).
  `SUPER_ADMIN_EMAILS` se agrega al schema de env (opcional: sin ella, no
  hay Administración y la instancia opera como hoy).
- **Rationale**: FR-010/FR-015; SC-005 exige aviso claro post-upgrade (el
  agente de la empresa original queda apagado hasta pegar el token en
  Ajustes — comunicado al dueño y aceptado).

## D9 — Entorno E2E local (primer self-test de comportamiento real)

- **Decision**: Docker Desktop (instalado; solo arrancar daemon) +
  `docker-compose.dev.yml` (postgres:16 ya definido) + bloque dev en `.env`
  (DATABASE_URL local, secretos generados, WA_MOCK_ENABLED=true,
  META_GRAPH_BASE_URL→wa-mock, OPENROUTER_BASE_URL→ai-mock) + node 22.22.1 +
  `pnpm db:migrate && pnpm dev`; guiones conducidos con Playwright (browsers
  ya instalados). Detalle operativo en quickstart.md.
- **Rationale**: Constitución IX ("local primero"); era la deuda declarada de
  la Definición de Hecho. Todo está instalado: el bloqueo histórico era solo
  daemon apagado + .env vacío + node default roto.
- **Guiones nuevos**: us-mt-1 (super admin crea Masterbrand + login del
  admin), us-mt-2 (aislamiento: dos números mock ruteando, cross-org
  negado, demo reload scoped, eventos SSE), us-mt-3 (token IA por empresa:
  agente con token propio vía ai-mock, empresa sin token = apagado limpio).

## D10 — Alcance del super admin en datos ajenos

- **Decision**: Administración lista empresas/usuarios y gestiona altas y
  resets; NO navega bandejas ni datos de dominio de otras empresas (sin
  impersonación en v1).
- **Rationale**: mínima superficie de privacidad entre socios; alineado con
  Constitución I; explicitado en spec (assumption).

## D11 — Slug y nombre de empresa

- **Decision**: nombre visible libre (repetible); slug interno único
  autogenerado (`masterbrand`, `masterbrand-2`, …). El slug de la primera
  empresa ("principal") no cambia.
- **Rationale**: edge case de spec; evita colisiones sin molestar al usuario.
