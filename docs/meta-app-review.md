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
| Ajustes básicos de la app (ícono, privacidad, categoría) | ⚠️ verificar ícono y categoría |
| App Review → Advanced Access de los 2 permisos | 🔜 **el trabajo de ahora** |
| Tech Provider | 🔒 se desbloquea al aprobarse el App Review |
| Coexistence | 🔒 requiere Tech Provider + cambios de código (ver abajo) |

## Regla de oro durante todo este proceso

**No conectar el número real por Embedded Signup todavía.** El flujo actual lo
registra por la vía normal y eso deja el celular fuera de servicio, que es
justo lo que no podemos permitirnos. Para el App Review se usa el **número de
prueba** que Meta regala con cada app de WhatsApp: manda mensajes gratis hasta
a 5 destinatarios y no toca el número productivo. El número real recién se
conecta cuando coexistence esté disponible y probada.

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

## Guion del Video 1 — enviar un mensaje

Precondición: número de prueba conectado en Ajustes → WhatsApp, y un teléfono
propio agregado como destinatario permitido en el panel de Meta.

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

- [ ] Ícono de la app cargado (no puede quedar el genérico)
- [ ] Categoría de la app elegida
- [ ] URL de política de privacidad → `https://corscan.com.ar/privacidad`
- [ ] URL de términos → `https://corscan.com.ar/terminos`
- [ ] URL de eliminación de datos → `https://corscan.com.ar/eliminacion-datos`
- [ ] Dominio `crm.corscan.com.ar` en "Dominios permitidos para el SDK de JavaScript"
- [ ] `crm.corscan.com.ar` en "URI de redireccionamiento de OAuth válidos"
- [ ] `DEMO_TOOLS_ENABLED` **apagado** antes de grabar (que no se vea la pestaña de recarga de demo)
- [ ] Cuenta de prueba para el revisor, si la piden (ver más abajo)

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

## Después de la aprobación: lo que falta para coexistence

Confirmado en la documentación de Meta, y **no** es solo prender una bandera:

1. El evento del popup es distinto: `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`,
   y trae **solo `waba_id`** — no viene `phone_number_id`. Nuestro
   `completeEmbeddedSignup()` hoy exige ambos y valida con `testConnection`,
   así que necesita una rama nueva que descubra el número vía
   `GET {waba}/phone_numbers` después de canjear el token.
2. Hay que **saltear el registro del número**. Es el paso que mata al celular.
3. Sincronización opcional, con ventana de **24 horas** desde el onboarding o
   el negocio debe empezar de nuevo:
   - contactos: `POST {phone_number_id}/smb_app_data` con `sync_type: "smb_app_state_sync"`
   - historial: mismo endpoint con `sync_type: "history"` — 180 días de
     mensajes, 14 días de archivos multimedia.
4. El negocio necesita WhatsApp Business app **2.24.17 o superior**.

### Lo que se pierde al activar coexistence

Esto conviene decidirlo con la cabeza fría antes de conectar el número real:

| Función | Con coexistence |
|---|---|
| Grupos | No soportados, no se sincronizan |
| Llamadas de voz y video | No soportadas |
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
