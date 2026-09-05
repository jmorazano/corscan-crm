# Quickstart — entorno E2E local para 003 (primer self-test de comportamiento)

Diagnóstico del 5-sep-2026: TODO está instalado (Docker Desktop, Playwright
1.61.1 con browsers, compose de dev con postgres:16). Los tres bloqueos
históricos eran: daemon de Docker apagado, `.env` sin bloque dev, y pnpm roto
bajo el node default v22.9.0.

## Arranque (≈5 min, sin instalar nada)

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"   # pnpm funciona en 22.22.1
open -a Docker                                               # esperar el socket
docker compose -f docker-compose.dev.yml up -d postgres      # postgres:16, db "vocero"
```

Bloque dev en `.env` (literal — drizzle.config.ts y el seed lo parsean a
mano; NO usar `.env.test`). Generar secretos con `openssl rand -base64 32`
(ENCRYPTION_KEY exacto 32 bytes base64):

```bash
APP_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vocero
BETTER_AUTH_SECRET=<generado>
ENCRYPTION_KEY=<generado 32 bytes base64>
META_WEBHOOK_VERIFY_TOKEN=<generado>
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
AGENT_COALESCE_MS=2000
SUPER_ADMIN_EMAILS=<email del usuario que registres primero>
```

```bash
npx pnpm db:migrate && npx pnpm dev
```

Registrar el primer usuario en `/register` (instancia vacía ⇒ registro
abierto ⇒ nace la empresa "principal"). Ese email debe estar en
`SUPER_ADMIN_EMAILS` para ver Administración.

## Guiones E2E de la feature (conducidos con Playwright)

- `tests/e2e/us-mt-1-crear-empresa.md` — super admin crea "Masterbrand" +
  admin inicial (contraseña temporal mostrada UNA vez); logout; login del
  admin nuevo; ve su CRM vacío sembrado; NO ve Administración ni datos de la
  otra empresa. Infeliz: email duplicado → error claro sin efectos.
- `tests/e2e/us-mt-2-aislamiento.md` — dos empresas con números mock
  distintos (wa-mock `POST /api/dev/wa-mock/inbound` con cada phoneNumberId);
  cada mensaje aparece SOLO en su bandeja; API cross-org (GET/DELETE de
  conversación ajena) → 404 sin efectos; recarga demo de A no toca contactos
  de B; sesión SSE de A no recibe eventos de B. Infeliz: webhook de un
  número desconocido → ignorado limpio.
- `tests/e2e/us-mt-3-ia-por-empresa.md` — empresa A configura token en
  Ajustes (last4 visible), agente responde vía ai-mock; empresa B sin token:
  agente apagado con aviso y bandeja manual operativa; DELETE de la config
  apaga el agente de A. Infeliz: token "-invalid" → turno degrada sin
  colgarse.

Los guiones existentes (us1-us5) se re-conducen al final como regresión
sobre la empresa original.

## Gate técnico (siempre antes del self-test)

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"
npx pnpm typecheck && npx pnpm lint && npx pnpm build && npx pnpm test
```
