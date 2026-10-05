# Correo: recuperar la contraseña (SMTP)

Desde la feature 029, el login ofrece **«¿Olvidaste tu contraseña?»**: la
persona escribe su correo y recibe un enlace de un solo uso (vence en 1 hora)
para elegir una contraseña nueva. Al guardarla se cierran todas sus sesiones.

Es **opcional** (constitución II, categoría 6). Sin SMTP la pantalla explica
que hay que pedirle una contraseña temporal al super admin (Administración →
empresa → «Restablecer contraseña»), como antes. El correo se usa SOLO para la
propia cuenta: jamás a contactos ni campañas.

## Variables (runtime, no build)

| Variable | Ejemplo | Notas |
|---|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` | Obligatoria. |
| `SMTP_PORT` | `587` | Default 587 (STARTTLS). 465 = TLS directo. |
| `SMTP_SECURE` | *(vacío)* | `true` fuerza TLS directo; vacío = se deduce del puerto. |
| `SMTP_USER` | `usuario` | Con contraseña, o ninguno de los dos (relay sin auth). |
| `SMTP_PASS` | `••••` | Nunca va al navegador ni a los logs. |
| `SMTP_FROM` | `Vocero <no-reply@tudominio.com>` | Obligatoria. Un dominio verificado en el proveedor. |

Un valor `REEMPLAZA_…` cuenta como vacío.

## Elegir un servidor

Sirve cualquier SMTP. Algunas opciones:

- **Proveedor transaccional** (recomendado: mejor entregabilidad): Brevo,
  Resend, Mailgun, Postmark, Amazon SES. Todos dan host/usuario/contraseña
  SMTP. Hay que verificar el dominio del remitente (registros **SPF** y
  **DKIM** que te da el proveedor, y en lo posible **DMARC**). Sin eso el
  correo cae en spam.
- **Gmail / Google Workspace**: `smtp.gmail.com`, puerto 465, usuario = la
  casilla, contraseña = una **contraseña de aplicación** (requiere 2FA en la
  cuenta). `SMTP_FROM` debe ser esa misma casilla. Sirve para volúmenes
  chicos.
- **Servidor propio** (Postfix, etc.): host/puerto del servidor.

## Hosting

- **Railway**: el SMTP saliente solo está habilitado en el plan **Pro**
  (Hobby y Free bloquean los puertos 25/465/587). Cargar las variables en el
  servicio `app` → Variables y redeployar.
- **VPS propio**: algunos proveedores bloquean el puerto 25 por defecto; 587 y
  465 suelen estar abiertos.

## Probar

1. Con las variables cargadas, abrí `/forgot-password` y pedí un enlace para
   tu propia cuenta.
2. Si no llega: mirá los logs del servicio — un fallo deja una línea
   `[mail] recuperación de contraseña no enviada: <código>: <mensaje>` (sin el
   correo del destinatario ni la contraseña del SMTP). La pantalla responde
   igual exista o no la cuenta, a propósito.

En el entorno de pruebas (`WA_MOCK_ENABLED=true`, fuera de producción) los
correos NO salen: quedan en `GET /api/dev/mail-mock`.
