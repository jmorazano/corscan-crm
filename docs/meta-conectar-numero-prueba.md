# Conectar el número de prueba al CRM

El número de prueba **ya existe**. Lo que falta es suscribir la app a la WABA
para que aparezca en el panel y en el CRM.

| Activo | Valor |
|---|---|
| App ID | `2262662764507422` |
| WABA de prueba | `1596377001926229` |
| Número de prueba | `+1 555-659-8579` ("Test Number") |
| Business portfolio | `2204251553278204` |

## Por qué el panel se veía vacío

API Setup solo lista las WABA a las que **la app está suscrita**. La WABA de
prueba vivía en el portfolio pero sin vínculo con la app, así que el desplegable
"From" no tenía nada que mostrar y "Get new test number" ofrecía crear un número
que ya existía. No era un bug del navegador ni de Meta.

## Paso 1 — Suscribir la app a la WABA

En el **Graph API Explorer** (`developers.facebook.com/tools/explorer`):

1. En *Meta App*, elegí **Corscan CRM**.
2. En *User or Page*, dejá **User Token**.
3. En *Permissions*, agregá `whatsapp_business_management` y
   `whatsapp_business_messaging`.
4. **Generate Access Token** y aceptá el diálogo.

Primero, obtené el ID del número (y de paso ya hacés una llamada real con
`whatsapp_business_management`):

```
GET  1596377001926229/phone_numbers
```

Anotá el `id` que devuelve: ese es el **Phone Number ID**.

Después, suscribí la app a la WABA:

```
POST  1596377001926229/subscribed_apps
```

Respuesta esperada: `{"success": true}`. Con eso, el desplegable "From" de API
Setup deja de estar vacío.

> Estas dos llamadas cuentan para el requisito de App Review de **al menos una
> llamada exitosa por permiso dentro de los 30 días previos al envío**.

## Paso 2 — Token permanente

El token del Explorer dura poco. Para el CRM, generá uno de usuario del sistema
siguiendo la Parte B de [meta-numero-de-prueba.md](meta-numero-de-prueba.md),
asignándole la **WABA de prueba** `1596377001926229`.

## Paso 3 — Conectar en el CRM

`crm.corscan.com.ar` → **Ajustes → WhatsApp** → conexión **manual** (no el botón
de Meta: Embedded Signup no aplica a una WABA de prueba).

| Campo | Valor |
|---|---|
| WhatsApp Business Account ID | `1596377001926229` |
| Phone Number ID | el del paso 1 |
| Token | el permanente del paso 2 |

Probá la conexión antes de guardar: el CRM valida contra Meta y solo guarda si
el token realmente puede leer ese número.

## Paso 4 — Webhook y destinatarios

- En el panel de Meta → **WhatsApp → Configuration → Webhooks**, cargá la URL que
  muestra Ajustes → WhatsApp y suscribí el campo `messages`.
  **La URL del webhook es un secreto: no la muestres al grabar.**
- En **API Setup → To**, agregá tu celular como destinatario permitido (hasta 5).
  Ese teléfono es el que va a aparecer recibiendo el mensaje en el video, y
  recibir no registra nada: tu número sigue intacto en la app móvil.

## Cuidado

En Configuración del negocio hay una tercera WABA etiquetada **"Corscan
Ingenieria — WhatsApp Business App"**: es el número que vive en tu celular y es
el candidato a coexistence. **No la toques.** Todo esto va sobre la de prueba.

Y en WhatsApp → Configuration, el botón **"Delete your business"** de la sección
Test account borra el **portfolio entero**, con la verificación de negocio
adentro. Nunca.

## Pendiente de confirmar

El número de prueba figura con estado **Unverified**. Es lo habitual en números
de prueba (se refiere al nombre para mostrar, no a la capacidad de enviar), pero
no lo damos por cierto hasta que salga el primer mensaje.

## Actualización (verificado con investigación adversarial)

Lo aprendido después de escribir este documento, que corrige partes de arriba:

- **La allowlist de destinatarios es exclusiva del panel** (API Setup → "To" →
  "Manage phone number list"). No hay endpoint de Graph API ni pantalla en
  WhatsApp Manager: usa la API interna del dashboard con la sesión del
  navegador. Si el panel está roto, no hay rodeo.
- **La ventana de 24 h NO exime de la allowlist.** Aunque el cliente escriba
  primero, todo saliente del número de prueba falla con
  `(#131030) Recipient phone number not in allowed list` (reportado por dos
  fuentes independientes, una con números argentinos).
- **El matching de la allowlist es exacto contra el `wa_id`.** Gotcha
  argentino: registrar `549...` tal cual llega en el webhook, no `54...`.
  Máximo 5 números y según reportes no se pueden borrar después.
- **El desplegable "From" no lee `subscribed_apps`** (eso solo suscribe
  webhooks); lee la conexión app↔WABA que crea el propio flujo del panel. Hay
  hilos del foro de Meta con paneles rotos por semanas donde ni incógnito ni
  otros navegadores ayudaron: cuando falla así, suele ser server-side de Meta.
- **Los webhooks de mensajes reales no llegan con la app en modo desarrollo**
  (dashboard nuevo, reportes 2025-2026 consistentes; lo oficial dice "some
  webhooks will not be sent" sin especificar). Hay que pasar la app a **Live**:
  es un toggle, es reversible, no requiere App Review y con acceso standard la
  app sigue operando sus propios activos igual.
- Los entrantes al número de prueba **sí** llegan y generan webhook desde
  cualquier teléfono (reportado). Si el número no aparece como contacto de
  WhatsApp (numeración 555 ficticia), probar el link directo
  `wa.me/15556598579`, que saltea el descubrimiento de contactos.

### Plan B si el panel no revive: número real por API, sin panel

Con un **número real no existe allowlist** (el 131030 es exclusivo del número
de prueba). Y todo el alta se puede hacer por API, sin tocar el panel:

1. Chip prepago nuevo, jamás registrado en WhatsApp.
2. Alta en la WABA vacía "Corscan Ingeniería" (NO la de prueba, NO la del
   celular): `POST /{waba_id}/phone_numbers`.
3. Verificación: `POST /{phone_id}/request_code` (SMS) →
   `POST /{phone_id}/verify_code`.
4. Registro en Cloud API: `POST /{phone_id}/register` (con PIN).
5. Webhook ya está; conectar el CRM con ese phone_id.

Costos: los entrantes y las respuestas free-form dentro de la ventana de 24 h
no requieren método de pago. Solo el ENVÍO de plantillas lo requiere — y el
Video 2 del App Review solo necesita la CREACIÓN de la plantilla, no su envío.
