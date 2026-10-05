# Tasks — 029 Recuperar la contraseña por correo

- [x] T1 Constitución 1.9.0 → 1.10.0 (categoría 6: correo transaccional por
      SMTP estándar) + Sync Impact Report.
- [x] T2 Dependencia `nodemailer` 10 (+ `@types/nodemailer`) y `SMTP_*` en
      `env.ts` + `.env.example` + placeholders en `.env`. (pnpm 11.5 exige
      Node ≥ 22.13: se corrió con el Node 22.23 de nvm.)
- [x] T3 `src/lib/mail/` (config + envío + outbox del mock) +
      `tests/unit/mail.test.ts`.
- [x] T4 `src/lib/password-reset-email.ts` puro +
      `tests/unit/password-reset-email.test.ts`.
- [x] T5 Better Auth: `sendResetPassword`, `onPasswordReset`, revocar
      sesiones, token hasheado, límites por IP y por correo +
      `tests/unit/password-reset-auth.test.ts`.
- [x] T6 UI: enlace + aviso en el login (página server + `login-form.tsx`),
      `/forgot-password`, `/reset-password` (`referrer: no-referrer`).
- [x] T7 mail-mock (`/api/dev/mail-mock`, knobs `failNext`/`disabled`).
- [x] T8 Docs `docs/correo-smtp.md` + CLAUDE.md (soberanía + mapa + env).
- [x] T9 Gate: typecheck + lint + build + 1.423 unit (151 archivos).
- [x] T10 Guion `tests/e2e/029-password-reset.md` conducido en verde
      (4-oct-2026, dev local desde el worktree): enlace del login → pedido →
      mail en el outbox → token HASHEADO en `verification` (1 h) → formulario
      (confirmación distinta rechazada) → login con aviso → sesión vieja
      revocada (`get-session` null, 0 sesiones) → `must_change_password`
      limpio (entra directo a `/inbox`) → contraseña vieja 401 → enlace
      reusado = «venció o ya se usó». Infeliz: correo sin cuenta = misma
      respuesta y mismo tiempo (44 ms) sin mail; SMTP caído = misma
      respuesta + línea `[mail] … no enviada` sin destinatario; token
      inventado 400 `INVALID_TOKEN`; 6.º pedido del mismo correo 429; sin
      SMTP = pantalla de instrucciones + 400 `RESET_PASSWORD_DISABLED`;
      móvil 375 px sin scroll horizontal. Contraseña del usuario E2E
      restaurada por el mismo flujo.
- [x] T11 Producción (OK del dueño 5-oct-2026): merge de main (fix IP
      3bc4ad9) + smoke E2E, `main` → f94a6ca, deploy 350dfc16 SUCCESS. El
      dueño cargó Resend (`smtp.resend.com`, dominio corscan.com.ar). Primer
      envío real: `ETIMEDOUT` — Railway bloquea 465/587 (probado desde el
      contenedor: 465/587 timeout, 2465/2587 abiertos) → `SMTP_PORT=2465` +
      `SMTP_SECURE=true`, deploy 16f792b4 SUCCESS, envío real a la cuenta del
      dueño sin error en los logs. Guía y `.env.example` corregidas.
