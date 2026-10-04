# Plan — 029 Recuperar la contraseña por correo

## Enfoque

Usar el reset NATIVO de Better Auth 1.6 (`/request-password-reset`,
`/reset-password/:token`, `/reset-password`): token de un solo uso
(`consumeVerificationValue` transaccional), vencimiento, respuesta idéntica
exista o no la cuenta (con simulación de timing). Lo único que falta es
quién mande el mail → adaptador SMTP propio.

## Constitution Check

- **II (Soberanía)** — viola la prohibición «servicios de email» de v1 →
  **enmienda MINOR 1.9.0 → 1.10.0** aprobada por el dueño (4-oct-2026):
  categoría 6 «Correo transaccional por SMTP estándar», con condiciones:
  (a) opcional, sin él el producto funciona completo y el login explica a
  quién pedirle; (b) lo configura el operador por entorno con el servidor
  SMTP que elija (protocolo estándar, sin SDK ni cuenta con un proveedor
  puntual); (c) SOLO correos transaccionales de la propia cuenta —hoy, la
  recuperación de contraseña—: jamás a contactos/leads ni campañas; (d) la
  contraseña del SMTP vive en el entorno y jamás va al cliente ni a logs;
  (e) adaptador dedicado `src/lib/mail/`; (f) el instalador NO lo necesita;
  (g) el self-test jamás toca un SMTP real (mail-mock); (h) un fallo del
  correo no revela si la cuenta existe ni tumba el login.
- **I (Seguridad)** — token hasheado en reposo (`storeIdentifier` con
  override `reset-password:` → `hashed`), sesiones revocadas al restablecer,
  respuesta uniforme, límites por IP y por correo, envío en segundo plano
  (sin oráculo de timing).
- **III (Multi-tenancy)** — no hay tabla de dominio nueva: `verification` y
  `user` son de Better Auth (fuera de tenant, como el login).
- **IV (Idempotencia)** — el token se consume una sola vez; pedir otro enlace
  crea uno nuevo, los anteriores vencen solos.
- **IX** — E2E con el mail-mock (enlace real leído del outbox).

## Piezas

1. `src/lib/mail/` — `config.ts` (lee `SMTP_*`, placeholders cuentan como
   vacío, `isMailConfigured()`), `index.ts` (`sendMail` → nodemailer SMTP, o
   el outbox del mock con `isMockEnabled()`: el self-test NUNCA llega a un
   SMTP real), timeouts cortos.
2. `src/lib/password-reset-email.ts` — PURO: asunto, texto y HTML (escape) a
   partir de `{ appName, url, name, expiresInMinutes }`.
3. `src/lib/auth/index.ts` — `sendResetPassword` (solo si hay correo;
   fire-and-forget con log), `onPasswordReset` (limpia
   `must_change_password`), `revokeSessionsOnPasswordReset`,
   `resetPasswordTokenExpiresIn: 3600`, `verification.storeIdentifier`,
   rate limit de `/request-password-reset` (IP + correo) y `/reset-password`
   (IP).
4. UI `(auth)`: enlace en el login + aviso `?reset=1`; `/forgot-password`
   (server: decide formulario o instrucciones); `/reset-password` (form +
   estado de enlace inválido).
5. Mock: `src/server/dev/mail-mock-state.ts` + `/api/dev/mail-mock`
   (GET outbox, DELETE limpiar, POST knobs `failNext` / `disabled`).
6. Entorno: `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` en `env.ts`,
   `.env.example` con guía; placeholders en `.env`.
7. Docs: `docs/correo-smtp.md` (proveedores, Railway Pro, SPF/DKIM).
8. Constitución 1.10.0 + CLAUDE.md (soberanía + mapa).

## Riesgos

- Entregabilidad (spam): depende del dominio del remitente (SPF/DKIM del
  proveedor). Documentado.
- SMTP bloqueado por el hosting: Railway Pro lo permite; en VPS propio
  depende del proveedor. El fallo se loguea y la UI no cambia.
