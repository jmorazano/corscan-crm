# E2E 029 — Recuperar la contraseña por correo

Entorno: dev local con `WA_MOCK_ENABLED=true` (los correos van al mail-mock,
jamás a un SMTP real). Usuario: `e2e@vocero.test` (owner de `principal`).
SQL: `docker exec vocero-dev-postgres-1 psql -U postgres -d vocero -c "…"`.

## Preparación

1. `DELETE /api/dev/mail-mock` (bandeja vacía, knobs apagados).
2. `update "user" set must_change_password = true where email = 'e2e@vocero.test'`
   (se verifica que el reset lo limpia).
3. Sesión «vieja» por API: `POST /api/auth/sign-in/email` con un cookie jar
   → `GET /api/auth/get-session` devuelve el usuario.

## Camino feliz (US1 + US2)

4. Navegador sin sesión → `/login` muestra «¿Olvidaste tu contraseña?».
5. Click → `/forgot-password` → correo `e2e@vocero.test` → «Enviar enlace» →
   «Revisá tu correo».
6. `GET /api/dev/mail-mock` → 1 mensaje a `e2e@vocero.test`, asunto
   «Restablecé tu contraseña de …», texto con el enlace
   `http://localhost:3000/api/auth/reset-password/<token>?callbackURL=%2Freset-password`
   y «vence en 1 hora».
7. SQL: la fila de `verification` NO tiene `reset-password:<token>` en claro
   (identificador hasheado).
8. Abrir el enlace → aterriza en `/reset-password?token=…` con el formulario.
9. Contraseñas distintas → «La confirmación no coincide…» (no envía).
10. Contraseña nueva válida ×2 → «Guardar» → `/login?reset=1` con «Listo: ya
    podés entrar con tu contraseña nueva.».
11. El cookie jar de la sesión vieja → `get-session` = null (sesiones
    revocadas).
12. SQL: `must_change_password = false`.
13. Login con la contraseña NUEVA → `/inbox` (no `/change-password`); con la
    vieja → «Correo o contraseña incorrectos.».
14. Reabrir el MISMO enlace → «El enlace venció o ya se usó» + «Pedir un
    enlace nuevo».

## Camino infeliz

15. Correo sin cuenta (`nadie@vocero.test`) → misma pantalla «Revisá tu
    correo»; la bandeja NO suma mensajes.
16. `POST /api/dev/mail-mock {"failNext":true}` → pedir para
    `e2e@vocero.test` → misma pantalla; bandeja sin mensaje nuevo; el log del
    server tiene `[mail] recuperación de contraseña no enviada: mail-mock:
    fallo simulado del SMTP` (sin el correo del destinatario).
17. `POST /api/dev/mail-mock {"disabled":true}` → `/forgot-password` explica
    que hay que pedirle una contraseña temporal al administrador; `POST
    /api/auth/request-password-reset` → 400 `RESET_PASSWORD_DISABLED`.
18. Límite por correo: 6 pedidos seguidos del mismo correo (IPs distintas por
    `x-forwarded-for`) → el 6.º responde 429.
19. Token inventado: `POST /api/auth/reset-password {token:"inventado"}` →
    400 `INVALID_TOKEN`; `/reset-password?error=INVALID_TOKEN` → pantalla de
    enlace vencido.

## Cierre

20. Restaurar la contraseña de `e2e@vocero.test` (`E2eVocero2026!`) por el
    mismo flujo (pedido + token del mail-mock + `POST /api/auth/reset-password`)
    y comprobar el login. `DELETE /api/dev/mail-mock`.
