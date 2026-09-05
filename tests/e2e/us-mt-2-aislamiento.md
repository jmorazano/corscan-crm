# US-MT-2 — Aislamiento entre empresas

Guion E2E de comportamiento (feature 003, US2). Requiere us-mt-1 conducido
(dos empresas: `principal` con superadmin@vocero.test e `inmobiliaria-demo`
con socio@vocero.test). Números mock: `111111111` (A/principal) y
`222222222` (B/Inmobiliaria Demo).

## Preparación

1. Como superadmin (empresa A): Ajustes → WhatsApp, conexión manual
   `waba_a` / `111111111` / token `test-token-a`.
   ✅ Estado "Conectado" con el número del mock.
2. Como socio (empresa B): igual con `waba_b` / `222222222` /
   `test-token-b`.
   ✅ Conectado; la conexión de A no se altera.

## Ruteo multi-número

3. `POST /api/dev/wa-mock/inbound` con `phoneNumberId 111111111`
   (from 5215550001111) y luego con `222222222` (from 5215550002222).
   ✅ El mensaje de 111111111 aparece SOLO en la bandeja de A; el de
   222222222 SOLO en la de B.
4. Con la sesión de B abierta en la bandeja: disparar OTRO inbound para A.
   ✅ La bandeja de B no muestra nada nuevo (ni conversación ni badge) —
   los eventos SSE de A no llegan a B.

## Cross-org negado

5. Como B, con un `conversationId` de A: `GET /api/conversations/{id}` y
   `DELETE /api/conversations/{id}`.
   ✅ 404 en ambos; la conversación de A sigue intacta.
6. Como B: `POST /api/auth/organization/create` y
   `POST /api/auth/organization/invite-member`.
   ✅ Denegados por el gate (FR-013).

## Demo reload scoped (el bug corregido)

7. Cargar datos de demostración en A y también en B (comparten teléfonos
   demo). Recargar demo en A.
   ✅ Los contactos/conversaciones demo de B siguen existiendo (antes del
   fix, la recarga de A los borraba).

## Caminos infelices

8. `POST /api/dev/wa-mock/inbound` con `phoneNumberId 999999999`
   (desconocido).
   ✅ Ignorado limpio: ninguna bandeja cambia, el server no se cae.

## Última conducción

**5-sep-2026 — VERDE los 8 pasos** (entorno quickstart 003, dev server con
migraciones 0001+0002):

- Conexión manual mock en ambas empresas (111111111→A, 222222222→B).
- Ruteo verificado desde AMBOS lados: B con exactamente su conversación
  (5215550002222); A con exactamente las suyas (…1111 y …3333).
- SSE: con la sesión de B abierta, dos inbounds para A no produjeron nada
  en B (ni conversación ni badge).
- Cross-org: DELETE de una conversación de A como B → 404 sin efectos.
  (GET /api/conversations/[id] no existe como endpoint → 405; el contrato
  de lectura pasa por el listado, que ya va scoped.)
- FR-013 en vivo: organization/create e invite-member → 403 "Operación no
  disponible en esta instancia".
- Demo reload scoped: con demo cargado en B, la recarga FORZADA en A dejó
  los 8 contactos demo de B intactos (pre-fix, esta operación los borraba).
- Número desconocido (999999999) → 200 ignorado limpio, server vivo.

Nota operativa: la recarga forzada exige `DEMO_TOOLS_ENABLED=true` (solo en
el .env local del entorno E2E).
