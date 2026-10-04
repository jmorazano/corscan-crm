# 029 — Recuperar la contraseña por correo

**Estado**: en curso · **Pedido**: 4-oct-2026 (un usuario olvidó su
contraseña y no tenía cómo restablecerla) · **Constitución**: enmienda
1.9.0 → 1.10.0 aprobada por el dueño en el mismo pedido («Autoservicio por
correo»).

## Contexto

Hasta 028, una contraseña olvidada solo se recuperaba si el super admin la
restablecía a mano desde Administración (temporal + `must_change_password`).
El login no ofrecía nada: la persona quedaba trabada hasta que alguien de la
plataforma la atendiera. La constitución prohibía «servicios de email» en v1,
por eso no existía un correo de recuperación.

## Historias

### US1 — Pedir el enlace (P1)

Como persona que olvidó su contraseña, desde el login toco «¿Olvidaste tu
contraseña?», escribo mi correo y recibo un mail con un enlace para elegir
una nueva.

- **AC1.1** El login muestra el enlace «¿Olvidaste tu contraseña?» junto al
  campo de contraseña.
- **AC1.2** `/forgot-password` pide el correo y, al enviarlo, SIEMPRE muestra
  el mismo mensaje («Si hay una cuenta con ese correo, te mandamos un
  enlace…»), exista o no la cuenta: la pantalla no revela quién tiene cuenta.
- **AC1.3** Si la cuenta existe, llega UN mail al correo de la cuenta con el
  enlace, el nombre de la instancia y el vencimiento (1 hora). Si no existe,
  no se manda nada.
- **AC1.4** Límite de pedidos: 10 por IP cada 10 minutos (como el login) y 5
  por correo por hora → «Demasiados intentos. Esperá unos minutos.».
- **AC1.5** Un fallo del servidor de correo NO cambia la respuesta ni la
  demora (el envío corre en segundo plano) y queda en el log sin la
  contraseña del SMTP.

### US2 — Elegir la contraseña nueva (P1)

Como la misma persona, abro el enlace del mail, elijo una contraseña nueva y
entro con ella.

- **AC2.1** El enlace pasa por `/api/auth/reset-password/<token>` (valida el
  token) y aterriza en `/reset-password?token=…` con el formulario
  «Contraseña nueva» + «Repetir».
- **AC2.2** Al guardar: la contraseña cambia, se cierran TODAS las sesiones
  abiertas de la cuenta, se limpia `must_change_password` (la eligió la
  persona) y se vuelve al login con «Listo: ya podés entrar con tu contraseña
  nueva».
- **AC2.3** El enlace es de UN solo uso y vence a la hora: usado o vencido,
  la página dice «El enlace venció o ya se usó» y ofrece pedir otro.
- **AC2.4** Mínimo 8 caracteres y confirmación igual (en el cliente y en el
  servidor).
- **AC2.5** El token se guarda HASHEADO en la base (`verification`): una
  copia de la base no permite usar enlaces vigentes.

### US3 — Instancia sin correo configurado (P2)

Como operador que no configuró SMTP, la instancia sigue funcionando completa.

- **AC3.1** Sin `SMTP_HOST` + `SMTP_FROM` (o con placeholders `REEMPLAZA_…`),
  el enlace del login sigue y `/forgot-password` explica que hay que pedirle
  una contraseña temporal al administrador de la plataforma (o preguntarle
  al propietario quién es): el camino de 003 sigue vigente.
- **AC3.2** El endpoint de Better Auth responde `RESET_PASSWORD_DISABLED`
  (no se manda nada) si alguien lo llama igual.

## Fuera de alcance

- Verificación de correo al crear cuentas, cambio de correo, magic links,
  2FA.
- Correos de cualquier otro tipo (avisos, campañas, marketing): la enmienda
  habilita SOLO el correo transaccional de la cuenta.
- Que el propietario restablezca contraseñas de su equipo desde Ajustes →
  Equipo (sigue siendo del super admin).

## Supuestos (Principio VII)

- Vencimiento de 1 hora (default de Better Auth): suficiente para revisar el
  mail sin dejar enlaces vivos días.
- Remitente e identidad: `SMTP_FROM` del operador; el nombre visible del mail
  es el de la marca de la instancia (`getBranding()` sin empresa), igual que
  el login.
- Producción en Railway: el plan Pro permite SMTP saliente (los planes
  Hobby/Free lo bloquean). La instancia ya usa IPs estáticas (Pro).
