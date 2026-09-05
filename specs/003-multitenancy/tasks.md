# Tasks: Multitenancy real — varias empresas en una instancia

**Input**: Design documents from `/specs/003-multitenancy/`

**Prerequisites**: plan.md, spec.md, research.md (D1-D11), data-model.md, contracts/, quickstart.md

**Tests**: la Definición de Hecho del repo EXIGE tests unitarios donde aplique
y el self-test E2E de comportamiento (Constitución V + IX) — incluidos.

**Organization**: por user story; cada fase es un incremento verificable.

## Path Conventions

Monolito Next.js: `src/`, `tests/`, `drizzle/` en la raíz (ver plan.md).

---

## Phase 1: Setup

- [ ] T001 Levantar el entorno E2E local según specs/003-multitenancy/quickstart.md (Docker daemon + postgres compose + bloque dev en .env + `pnpm db:migrate` + smoke de `pnpm dev`) — deja evidencia de que la instancia local arranca vacía.

---

## Phase 2: Foundational (bloquea todas las historias)

- [ ] T002 Agregar `SUPER_ADMIN_EMAILS` (opcional) al schema de src/lib/env.ts, con guía inline en .env.example y placeholder en .env local.
- [ ] T003 [P] Helper de plataforma en src/server/auth/super-admin.ts: `isSuperAdminEmail(email)` (parse de SUPER_ADMIN_EMAILS, case-insensitive, trim) + unit test en tests/unit/super-admin.test.ts.
- [ ] T004 [P] `withSuperAdmin` en src/lib/api.ts: resuelve sesión vía auth.api.getSession SIN exigir membresía, 403 `forbidden` si el email no es super admin (contrato admin-api.md) — unit test del gate.
- [ ] T005 [P] Determinismo de membresía en src/server/auth/on-signup.ts:68 (path verificado — NO crear duplicados en session.ts): `resolveMembership` con ORDER BY created_at ASC, id ASC (research D6) + unit test con dos membresías.
- [ ] T006 [P] FIX cross-tenant en src/server/seed/demo.ts:162-183 (path verificado): el borrado por inArray(contact.phone, demoPhones) filtra además por organization_id (FR-005) + unit test que verifica el WHERE scoped.
- [ ] T007 Extraer `provisionOrganization({ name })` de src/server/auth/on-signup.ts a src/server/admin/organizations.ts (org + slug único slugify+sufijo D11 + reuso de org homónima VACÍA en reintento post-crash + 5 etapas + agentProfile); on-signup queda usándola para el caso instancia-vacía; unit tests de slug único, idempotencia y reuso de huérfana.
- [ ] T008 Gate ALLOWLIST del plugin organization en src/lib/auth/index.ts (hook before que niega TODO /organization/* mutante fuera del bypass interno; paths enumerados en research D5, invitaciones incluidas) + unit test POR PATH denegado (FR-013).
- [ ] T008b Regla anti-escalación FR-016 en src/server/auth/super-admin.ts + aplicarla en src/app/api/settings/team/route.ts POST (403 reserved_email si el email está en SUPER_ADMIN_EMAILS y el operador no es super admin) + unit tests (team y, cuando existan, endpoints admin).
- [ ] T008c Contraseñas temporales reales (FR-017): columna `must_change_password` en user (schema + entra en la migración de T017), set en el POST de team existente, endpoint POST /api/settings/password (changePassword de better-auth, Zod min 8, limpia el flag), pantalla de cambio obligatorio con redirect desde el shell, y validación Zod min 8 en team POST + unit tests.

**Checkpoint**: gate técnico verde; nada visible cambió para la empresa actual.

---

## Phase 3: US1 — El super admin crea una empresa con su admin inicial (P1) 🎯 MVP

**Goal**: crear "Masterbrand" + admin inicial desde Administración; el admin entra y gestiona su empresa. — **Independent Test**: guion us-mt-1.

- [ ] T009 [US1] Server: creación de empresa + admin inicial en src/server/admin/organizations.ts (provisionOrganization + runInternalSignup/signUpEmail con must_change_password + member owner; orden, rollback y reuso de huérfana del contrato; 409 duplicate_email; 403 reserved_email FR-016; Zod min 8) + listado de empresas con miembros y estados (whatsappConnected/aiConfigured).
- [ ] T010 [US1] API: src/app/api/admin/organizations/route.ts (GET/POST bajo withSuperAdmin, Zod, envelope de errores) + unit tests (403 para no-super-admin, 409 duplicado, creación feliz).
- [ ] T011 [US1] UI: src/app/(app)/admin/page.tsx + src/components/admin/admin-client.tsx — lista de empresas y formulario crear empresa+admin con contraseña generada en cliente (mismo generador de team-client) mostrada UNA vez; estados de carga y error.
- [ ] T012 [US1] Nav: ítem "Administración" en src/components/app-nav.tsx visible solo para super admin (dato expuesto por el endpoint de sesión/config que ya consume la nav o uno mínimo nuevo).
- [ ] T013 [US1] Guion tests/e2e/us-mt-1-crear-empresa.md (feliz CON cambio obligatorio de contraseña en el primer login del admin nuevo + email duplicado + email reservado 403 + acceso denegado a no-super-admin) y conducirlo en local con Playwright hasta verde.

**Checkpoint**: US1 entregable sola (MVP).

---

## Phase 4: US2 — Aislamiento entre empresas (P1)

**Goal**: dos empresas operando sin verse. — **Independent Test**: guion us-mt-2.

- [ ] T014 [US2] Revisión dirigida de aislamiento: auditar que TODOS los endpoints de dominio y el SSE usan scoped()/canal org (lista de la exploración); corregir cualquier resto que se encuentre; unit tests de los corregidos.
- [ ] T015 [US2] Verificar ruteo multi-número con mocks: wa-mock con dos phoneNumberIds → cada mensaje a su bandeja (apoyado en credenciales por org existentes); test unitario del lookup por phone_number_id con 2 orgs.
- [ ] T016 [US2] Guion tests/e2e/us-mt-2-aislamiento.md (mensajes a dos números → bandejas correctas; API cross-org 404 sin efectos; demo reload de A no toca B; SSE de A no llega a B; webhook de número desconocido ignorado; intento de /api/auth/organization/create y de invite-member desde sesión común → denegado, escenario 4 de US2/FR-013) y conducirlo hasta verde.

**Checkpoint**: US1+US2 = multitenancy segura operable.

---

## Phase 5: US3 — Token de IA por empresa (P2)

**Goal**: cada empresa su token/modelos; sin token, agente apagado limpio. — **Independent Test**: guion us-mt-3.

- [ ] T017 [US3] Schema: tabla `aiCredentials` en src/lib/db/schema.ts según data-model.md + `pnpm db:generate` → migración nueva en drizzle/.
- [ ] T018 [US3] Server: src/server/ai/credentials.ts (saveAiConfig/getAiConfig/deleteAiConfig con encryptSecret/decryptSecret, tokenLast4, defaults de producto para model/judgeModel) + unit tests (cifrado round-trip, scoping por org, defaults).
- [ ] T019 [US3] Adaptador: src/lib/ai/index.ts — chatJson recibe `AiConfig` (token/model) en vez de leer env; OPENROUTER_BASE_URL sigue de instancia; eliminar isAiConfigured() sync.
- [ ] T020 [US3] Call sites: src/server/ai/pipeline.ts, src/server/ai/trigger.ts (gate async: sin config → corta antes del proveedor), src/server/lab/judge.ts (+plumbeo de organizationId), src/app/api/lab/runs/route.ts, src/app/api/agent/profile/route.ts — todos resuelven getAiConfig(organizationId); unit tests actualizados (el mock de config reemplaza al mock de env).
- [ ] T021 [US3] API: src/app/api/settings/ai/route.ts (GET/PUT/DELETE según contrato ai-settings.md, owner-only en mutaciones) + unit tests (last4, owner gate, delete idempotente).
- [ ] T022 [US3] UI: card "Inteligencia artificial" en Ajustes (src/components/settings/ai-card.tsx + alta en la página de Ajustes): token con last4, modelos con defaults visibles, estado del agente (apagado/activo) con guía; actualizar los 3 textos de UI que nombran las env vars (FR-015).
- [ ] T023 [US3] Deprecar envs en .env.example (OPENROUTER_API_TOKEN/MODEL/JUDGE_MODEL con nota de migración a Ajustes) manteniendo OPENROUTER_BASE_URL; ajustar src/lib/env.ts.
- [ ] T024 [US3] Guion tests/e2e/us-mt-3-ia-por-empresa.md (A con token responde vía ai-mock; B sin token apagado limpio con aviso; token "-invalid" degrada sin colgarse; DELETE apaga) y conducirlo hasta verde.

**Checkpoint**: separación de gastos operativa.

---

## Phase 6: US4 — Masterbrand conecta su WhatsApp (P3)

- [ ] T025 [US4] Verificación dirigida (mock): desde la segunda empresa, conectar número por el camino manual/mock del wizard y ejercitar el circuito entrante/saliente; cubierto principalmente por us-mt-2 — este guion agrega la conexión hecha POR el admin nuevo desde sus Ajustes (extender us-mt-2 o mini-guion us-mt-4).

## Phase 7: US5 — Gestión de usuarios por el super admin (P3)

- [ ] T026 [US5] Server+API: POST /api/admin/organizations/[id]/users y POST /api/admin/users/[id]/password según contrato (Zod min 8, set must_change_password, invalidación de sesiones, 403 sobre super admins ajenos, 403 reserved_email) + unit tests (404/409/403/felices).
- [ ] T027 [US5] UI: en admin-client.tsx, usuarios por empresa con "crear usuario" y "restablecer contraseña" (temporal mostrada una vez); extender us-mt-1 con el reset y conducirlo.

---

## Phase 8: Polish & verificación final

- [ ] T028 Gate técnico completo (typecheck+lint+build+test) + revisión adversarial del diff (workflow de verificación con lentes: seguridad multi-tenant, contrato cliente-servidor, regresión del self-test) y fixes.
- [ ] T029 Re-conducir TODOS los guiones existentes tests/e2e/us1..us7 como regresión (us7-team es crítico: ejercita el signup interno que esta feature refactoriza) sobre la empresa original en el entorno local.
- [ ] T029b Verificación de UPGRADE (FR-018, research D12): con la BD local poblada por los guiones, re-ejecutar `pnpm db:migrate` + reboot y verificar integridad; dejar SC-005 (instancia productiva) marcado "pendiente de verificación en el deploy" con su checklist en tasks/memoria.
- [ ] T030 Actualizar CLAUDE.md (mapa del código: sección admin y config IA por empresa), .env.example final, y memoria del proyecto (decisiones D1-D11 aplicadas, estado del deploy pendiente de token en Ajustes).

## Dependencies

- Phase 2 → todo lo demás. US1 → US5 (comparten Administración). US2 y US3 necesitan DOS empresas para su verificación: dependen de US1 terminada (o de un seed directo explícito — preferir US1). US4 tras US2.

## Parallel Opportunities

- Phase 2: T003, T004, T005, T006 en paralelo (archivos disjuntos); T007/T008 después.
- US1: T009→T010 secuencial; T011/T012 en paralelo tras T010.
- US3: T017→T018→(T019/T021 en paralelo)→T020→T022.

## Implementation Strategy

MVP = Phase 1-3 (US1). Luego US2 (seguridad), US3 (gastos), US4/US5, Polish.
Cada checkpoint deja la rama en verde (gate técnico) y con guiones conducidos.
