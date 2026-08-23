# App Review de Meta — CorScan CRM

Documento operativo para conseguir **Advanced Access** a los permisos de
WhatsApp y, con eso, el estatus de **Tech Provider** que habilita
**coexistence** (que el celular siga funcionando mientras el CRM usa la Cloud
API).

Última actualización: 5 de agosto de 2026.

## Dónde estamos

| Paso | Estado |
|---|---|
| App de Meta con caso de uso WhatsApp + portfolio conectado | ✅ App ID `2262662764507422` |
| Verificación de negocio | ✅ **Verified** — 29 de julio de 2026 |
| Ajustes básicos (ícono, privacidad, términos, borrado, categoría) | ✅ verificado vía API |
| Número emisor | ✅ **+1 555-320-3036** (número 555 de negocio, gratis, sin allowlist) en la WABA nueva **Corscan CRM** `1615824000141383` — conectado al CRM y funcionando. El test number viejo y su WABA huérfana quedan abandonados. |
| Llamada real con `whatsapp_business_management` | ✅ `GET {waba}/phone_numbers` + `POST {waba}/subscribed_apps` + validación del CRM |
| Llamada real con `whatsapp_business_messaging` | ✅ respuesta enviada desde la Bandeja del CRM al celular, entregada |
| App Review → Advanced Access de los 2 permisos | 🔜 **solo faltan los videos y el envío** |
| App en modo Live | ✅ |
| Circuito completo entrante + saliente en el CRM | ✅ probado en vivo |
| Tech Provider | 🔒 se desbloquea al aprobarse el App Review |
| Coexistence | 🔒 requiere Tech Provider + cambios de código (ver abajo) |

## Regla de oro durante todo este proceso

**No conectar el número real por Embedded Signup todavía.** El flujo normal lo
registra en Cloud API y eso deja el celular fuera de servicio, que es justo lo
que no podemos permitirnos. Para el App Review se usa el **número 555 de
negocio** (+1 555-320-3036), que es gratis y no toca el número productivo. El
número real recién se conecta cuando coexistence esté disponible y probada.

## Lo que Meta pide en el App Review

Dos permisos, ambos en Advanced Access:

- `whatsapp_business_messaging` — enviar mensajes en nombre de los clientes.
- `whatsapp_business_management` — acceder a las WABA de los clientes. Sin
  Advanced Access, toda llamada sobre una WABA que no sea del propio negocio
  devuelve el error 200.

Y dos videos:

1. Un mensaje **creado y enviado desde la app**, recibido en un cliente de
   WhatsApp (móvil o web).
2. La **creación de una plantilla** desde la app.

Requisitos de grabación (los rechazan por esto más que por el contenido):

- Interfaz **en inglés**. La nuestra está en español → hay que poner
  **subtítulos en inglés** o carteles en pantalla.
- 1080p o más, y el ancho de la ventana **no debe superar 1440 px**. Bajá la
  resolución del monitor antes de grabar.
- Sin cortes que salteen pasos: el revisor tiene que ver el flujo completo.

> Histórico: [meta-numero-de-prueba.md](meta-numero-de-prueba.md) y
> [meta-conectar-numero-prueba.md](meta-conectar-numero-prueba.md) documentan la
> saga del número de prueba, que quedó **abandonado** (su panel está roto del
> lado de Meta). El emisor definitivo es el 555 de negocio, ya conectado.

## Guion del Video 1 — enviar un mensaje

Precondición: el CRM conectado al **+1 555-320-3036** (ya está). Antes de
grabar, mandate un mensaje desde el celular al 555 para que la **ventana de
24 h esté abierta** — sin eso el compositor de texto libre no aparece. No hay
allowlist: cualquier teléfono sirve de receptor.

Tip anti-rechazo: en la toma 2 (Ajustes → WhatsApp), hacé clic en
"Reconectar con Meta" para que se vea el popup de Embedded Signup abriéndose
(cancelalo y seguí). Las notas de permisos mencionan Embedded Signup, y que el
video lo muestre existiendo evita el patrón de rechazo "el screencast no
coincide con las notas".

La opción de coexistence ("Conectar sin perder el celular") está **oculta
detrás de `COEXISTENCE_UI_ENABLED`** y NO debe verse en el video ni existir
para el revisor: hasta tener Tech Provider aprobado su popup falla al final, y
un botón que termina en error lee como "app incompleta" — causa de rechazo
documentada. Se enciende en Railway recién después de la aprobación.

| # | Toma | Subtítulo en inglés |
|---|---|---|
| 1 | Login en `crm.corscan.com.ar` | "Business owner logs into CorScan CRM" |
| 2 | Ajustes → WhatsApp, mostrando el número conectado | "The business has connected its WhatsApp number" |
| 3 | Bandeja de entrada, abrir una conversación | "Inbox with customer conversations" |
| 4 | Escribir y enviar un mensaje | "The user composes and sends a message" |
| 5 | **Split screen**: el celular recibiendo ese mismo mensaje | "The message is received in the WhatsApp client" |
| 6 | Responder desde el celular y que aparezca en la bandeja | "The customer replies and it appears in the inbox" |

La toma 5 es la que decide la aprobación: tiene que verse el **mismo texto** en
la app y en el teléfono, sin corte entre medio. Grabá el celular con otra
cámara o espejalo en pantalla.

## Guion del Video 2 — crear una plantilla

| # | Toma | Subtítulo en inglés |
|---|---|---|
| 1 | Ir a Ajustes → Plantillas | "Templates section" |
| 2 | Crear plantilla nueva: nombre, categoría, idioma, cuerpo | "The user creates a message template" |
| 3 | Guardar | "The template is submitted to Meta for approval" |
| 4 | La lista mostrando el estado devuelto por Meta | "Template status is synced from Meta" |

Esto ejercita `POST {waba}/message_templates` y el sync de estados — o sea, es
exactamente la evidencia de uso de `whatsapp_business_management`.

## Textos para el formulario

**`whatsapp_business_messaging`**

> CorScan CRM is a self-hosted WhatsApp CRM for small and medium businesses.
> Businesses connect their own WhatsApp Business Account through Embedded
> Signup. We use this permission solely to send and receive messages on behalf
> of the connected business, inside its own customer conversations: replying to
> inbound customer messages in a shared team inbox, and sending approved
> message templates when the 24-hour customer service window has closed. We
> never message users who have not written to the business first, and we never
> use the permission for any account other than the one the business itself
> authorized.

**`whatsapp_business_management`**

> We use this permission to manage the assets of the WhatsApp Business Account
> that the business authorized through Embedded Signup: reading the business
> phone numbers to confirm the connection, creating message templates from our
> Templates screen, and syncing template approval status back from Meta so the
> business can see whether a template was approved or rejected. Access is
> limited to the WABA the business granted during onboarding.

Ajustá el texto si el revisor pide más detalle, pero mantené las dos ideas que
buscan: **consentimiento explícito del negocio** y **alcance limitado a su
propia WABA**.

## Antes de enviar — checklist

Verificado contra la API de Meta el 6 de agosto de 2026 (no de memoria):

- [x] Ícono cargado — **debe ser 1024×1024**, verificar el archivo original
- [x] Categoría de la app → `BUSINESS`
- [x] URL de política de privacidad → `https://corscan.com.ar/privacidad` (200)
- [x] URL de términos → `https://corscan.com.ar/terminos` (200)
- [x] URL de eliminación de datos → `https://corscan.com.ar/eliminacion-datos` (200)
- [x] Dominio `crm.corscan.com.ar` en "Dominios permitidos para el SDK de JavaScript"
- [x] `crm.corscan.com.ar` en "URI de redireccionamiento de OAuth válidos"
- [x] Verificación de negocio → `business_verification_passes: true`
- [x] **Al menos 1 llamada exitosa por cada permiso**: management (phone_numbers,
      subscribed_apps, validación de conexión) y messaging (respuesta real desde
      la Bandeja, entregada). Ojo: valen por 30 días — no dejar pasar un mes
      antes de enviar el App Review.
- [ ] `DEMO_TOOLS_ENABLED` **apagado** antes de grabar (que no se vea la pestaña de recarga de demo)
- [ ] Cuenta de prueba para el revisor, si la piden (ver más abajo)

**No es requisito**: la verificación del correo de contacto de la app
(`contact_email_verified`). No figura en la documentación de App Review y el
endpoint de requisitos de Meta solo evalúa `has_privacy_policy` y
`business_verification_passes`. No perder tiempo ahí.

## Cuenta de prueba para el revisor

Ojo con esto: si Meta pide credenciales para entrar al CRM, **no sirve abrir el
registro público**. `ALLOW_SIGNUP=true` deja crear el usuario, pero
`onUserCreated` corta apenas existe una organización
(`src/server/auth/on-signup.ts`), así que el usuario nuevo queda sin membresía y
`requireSession` lo rechaza con "Sesión sin organización activa" en toda la app.
El revisor vería un 401 y nos rechazarían.

La vía correcta hoy: crear el usuario del revisor desde **Ajustes → Equipo**,
que sí le da membresía en la organización existente. Como la organización tiene
datos de demostración (Clima Córdoba) y ningún cliente real, no se expone nada
sensible.

## Coexistence: qué quedó implementado y qué falta

**Implementado** (el código ya está listo para el día que aprueben):

- Ajustes → WhatsApp ofrece dos caminos explícitos: *"Ya uso este número en el
  celular"* (coexistence) y *"Es un número nuevo, solo para el CRM"*. El
  segundo lleva la advertencia de que deja al celular fuera de servicio.
- El popup se lanza con `featureType: "whatsapp_business_app_onboarding"` y
  `sessionInfoVersion: "3"` — este último es el *session logging* que Meta
  exige para coexistence. Ojo: el valor `coexistence` de `featureType` quedó
  **obsoleto**, no usarlo.
- El listener acepta ambos eventos de cierre (`FINISH` y
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) e ignora los intermedios y el
  CANCEL, que antes podían pisar los assets.
- `completeEmbeddedSignup()` acepta que no venga `phone_number_id` y descubre
  el número con `GET {waba}/phone_numbers`. Si la WABA tiene **más de un
  número, rechaza en vez de adivinar**: elegir mal significaría conectar una
  línea que el negocio no autorizó.
- **Nunca se registra el número.** No hay ninguna llamada a `/register` en el
  código, y ese es justamente el paso que mata la app del celular.

**Falta**, y no se puede hacer todavía:

1. Probarlo en vivo. Requiere ser Tech Provider: hasta la aprobación, el popup
   con `featureType` de coexistence va a fallar del lado de Meta. Lo que está
   verificado hoy son los tests unitarios de la rama nueva, no el flujo real.
2. Sincronización de contactos e historial (opcional), con ventana de **24
   horas** desde el onboarding o el negocio debe empezar de nuevo:
   - contactos: `POST {phone_number_id}/smb_app_data` con `sync_type: "smb_app_state_sync"`
   - historial: mismo endpoint con `sync_type: "history"` — 180 días de
     mensajes, 14 días de archivos multimedia.
3. El negocio necesita WhatsApp Business app **2.24.17 o superior**.

### Lo que se pierde al activar coexistence

Esto conviene decidirlo con la cabeza fría antes de conectar el número real:

| Función | Con coexistence |
|---|---|
| Grupos | Siguen funcionando **en el celular**; no se sincronizan ni se ven en el CRM |
| Llamadas de voz y video | No soportadas — las llamadas **por WhatsApp** dejan de funcionar en el número (las llamadas telefónicas comunes no se ven afectadas) |
| Catálogo, pedidos y herramientas de negocio | No soportadas |
| Listas de difusión | Deshabilitadas |
| Mensajes temporales / ver una vez / ubicación en vivo | Deshabilitados en chats 1:1 |
| Throughput | Fijo en 20 mensajes por segundo |

Para el uso de CorScan (consultas entrantes y seguimiento comercial) ninguna de
estas pérdidas parece grave, pero el catálogo y las llamadas sí podrían
importarle a un cliente futuro de la agencia. Vale la pena tenerlo escrito en la
propuesta comercial.

## Fuentes

- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Onboard WhatsApp Business app users (coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
