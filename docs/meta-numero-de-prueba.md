# Instructivo — número de prueba de Meta y grabación del App Review

Cómo dejar el CRM enviando mensajes reales con el **número de prueba** que Meta
regala, sin tocar el número que vive en tu celular, y cómo grabar el video del
App Review.

Complementa [meta-app-review.md](meta-app-review.md).

## Antes de empezar: qué prueba y qué NO prueba este camino

El número de prueba te deja demostrar casi todo, pero no todo:

| Evidencia que pide Meta | Con número de prueba |
|---|---|
| El negocio conecta su cuenta por **Embedded Signup** | ❌ **no se puede** |
| La app lee el número conectado y sus IDs | ✅ |
| La app crea una plantilla en la WABA real | ✅ |
| La app envía una plantilla aprobada | ✅ |
| El mensaje llega al dispositivo del destinatario | ✅ |

El número de prueba pertenece a una WABA de prueba que Meta crea junto con la
app: no se conecta autorizando en un popup, se conecta pegando credenciales.
Por eso el Embedded Signup no puede aparecer en el video, y esa es justamente la
prueba más fuerte del submission.

**Leé la sección "La decisión que te queda" al final antes de grabar.** El
instructivo sirve igual: es la forma de ensayar el flujo completo sin arriesgar
nada, y es la mitad del material que vas a necesitar en cualquier escenario.

Dato a tener en cuenta desde ahora: **las plantillas creadas con un número de
prueba no se pueden reutilizar** cuando conectes tu número real. Hay que
crearlas de nuevo.

## Parte A — Activar el número de prueba

1. Entrá a `developers.facebook.com` → tu app (`2262662764507422`) →
   **WhatsApp → API Setup**.
2. En **From**, ya vas a ver un número de prueba asignado. Anotá:
   - **Phone number ID**
   - **WhatsApp Business Account ID**
3. En **To**, abrí **Manage phone number list** y agregá tu celular personal
   como destinatario. Meta manda un código de verificación que hay que cargar
   ahí mismo. Se permiten hasta 5 destinatarios.

   Este es el teléfono que va a aparecer recibiendo el mensaje en el video. Usá
   uno **distinto** del que tiene el WhatsApp Business del negocio, para que no
   haya ninguna confusión sobre qué número es cuál.

## Parte B — El token: no uses el temporal

En API Setup hay un botón que genera un token temporal. **Dura 24 horas.** La
aprobación de una plantilla puede tardar más que eso, así que si usás el
temporal es muy probable que el día de la grabación la conexión esté caída.

Generá un token permanente de usuario del sistema:

1. `business.facebook.com` → **Configuración del negocio** → **Usuarios** →
   **Usuarios del sistema** → **Agregar**.
2. Nombre libre (ej. `corscan-crm`), rol **Administrador**.
3. **Agregar activos** → pestaña **Apps** → seleccioná tu app → permiso
   *Administrar app*.
4. **Agregar activos** → pestaña **Cuentas de WhatsApp** → seleccioná la WABA de
   prueba → control total.
5. **Generar token** → elegí la app → tildá `whatsapp_business_messaging` y
   `whatsapp_business_management` → generar.

Copiá el token **en ese momento**: no se vuelve a mostrar.

> Si la WABA de prueba no aparece en el paso 4, no insistas: generá el token
> temporal de 24 h y grabá todo el mismo día, después de que la plantilla ya
> esté aprobada.

## Parte C — Conectar el número al CRM

En `crm.corscan.com.ar` → **Ajustes → WhatsApp**, usá la **conexión manual**
(no el botón de Meta, que dispara Embedded Signup y acá no aplica):

| Campo | Valor |
|---|---|
| WhatsApp Business Account ID | el de la Parte A |
| Phone Number ID | el de la Parte A |
| Token | el permanente de la Parte B |

Probá la conexión antes de guardar. El CRM valida el token contra Meta y solo
guarda si el token realmente puede leer ese número, así que si el test pasa, la
conexión es buena de verdad.

Después, en el panel de Meta → **WhatsApp → Configuration → Webhooks**, cargá la
URL de webhook que muestra la pantalla de Ajustes y suscribí el campo
`messages`. Sin esto el CRM no recibe las respuestas y el video se corta a la
mitad.

> La URL del webhook contiene un secreto. No la muestres en pantalla al grabar.

## Parte D — Crear la plantilla y esperar la aprobación

**Ajustes → Plantillas → Nueva plantilla.**

Para el video conviene una plantilla en inglés, así el revisor lee el contenido
sin subtítulos:

| Campo | Valor sugerido |
|---|---|
| Nombre | `quote_followup` |
| Idioma | `en_US` |
| Categoría | `UTILITY (seguimiento)` |
| Cuerpo | `Hi {{1}}, we are still available. Would you like to continue with your quote?` |

Al guardar se envía sola a aprobación de Meta. El estado pasa de **Pendiente de
Meta** a **Aprobada**, normalmente en minutos, a veces en horas.

**No grabes hasta que diga Aprobada.** El envío de plantilla solo funciona con
plantillas aprobadas.

## Parte E — Preparar la escena del envío

Un detalle del CRM que hay que conocer o el video no sale: el selector de
plantillas **solo aparece cuando la ventana de 24 horas está cerrada**. Con la
ventana abierta ves el campo de texto libre, no el envío de plantilla.

Es el comportamiento correcto —es la regla de WhatsApp— pero obliga a preparar
la escena:

1. Desde tu celular, mandá un mensaje al número de prueba. Aparece la
   conversación en la bandeja.
2. **Esperá más de 24 horas** sin que ese contacto vuelva a escribir.
3. Al volver, la conversación muestra el cartel de ventana cerrada y debajo el
   selector de plantilla. Esa es la pantalla que tenés que grabar.

O sea: la conversación hay que sembrarla **un día antes** de grabar. Si la
sembrás y grabás el mismo día, el selector no va a estar.

## Parte F — Guion del video

Un solo video, lineal, de 2 a 4 minutos. Sin desvíos a consola, logs ni panel de
Meta más allá de lo necesario.

Requisitos de forma que causan rechazo por sí solos:

- Interfaz en inglés o, como en nuestro caso, **subtítulos en inglés**.
- 1080p o más, con la ventana **por debajo de 1440 px de ancho**.
- Sin cortes que salteen pasos.

| # | Toma | Narración / subtítulo |
|---|---|---|
| 1 | Landing `corscan.com.ar/crm` | "CorScan CRM is a WhatsApp CRM for small businesses." |
| 2 | Login en el CRM | "The business owner signs in." |
| 3 | Ajustes → WhatsApp con el número conectado | "The app reads the connected business phone number and its IDs." |
| 4 | Ajustes → Plantillas, lista con la plantilla **Aprobada** | "The app reads the message templates of the connected account." |
| 5 | Crear una plantilla nueva y guardarla | "The business creates a new template, which is submitted to Meta." |
| 6 | La nueva aparece **Pendiente de Meta** | "The template appears with pending status." |
| 7 | Bandeja → conversación con ventana cerrada | "This conversation is outside the 24-hour window." |
| 8 | Elegir la plantilla aprobada, completar la variable, enviar | "The business sends an approved template message." |
| 9 | **El celular recibiendo el mensaje** | "The message is delivered to the recipient device." |

La toma 9 decide la aprobación. Tiene que verse el **mismo texto** en el CRM y
en el teléfono. Grabá el celular con otra cámara o espejá la pantalla, sin corte
entre la toma 8 y la 9.

Antes de grabar, apagá `DEMO_TOOLS_ENABLED` en Railway para que no aparezca la
pestaña de recarga de demo.

## La decisión que te queda

El video de arriba prueba lectura de activos, creación de plantillas y envío
real. Le falta **una sola cosa**: el Embedded Signup. Y nuestras notas de
permisos dicen explícitamente que el negocio conecta su cuenta por Embedded
Signup, con lo cual el video no coincidiría del todo con lo escrito — que es
textualmente el patrón de rechazo más común.

Dos caminos:

**1. Conseguir un número de repuesto (recomendado).** Un chip prepago o
cualquier línea que reciba SMS o llamada y **que no esté registrada en
WhatsApp**. Con ese número corrés el Embedded Signup de verdad, grabás el flujo
completo y no tocás el número del celular en ningún momento. Es la única forma
de cubrir la lista entera de evidencia.

**2. Enviar con lo que hay.** Grabás el video de la Parte F y **ajustás las
notas de permisos** para que describan exactamente lo que se ve, sin prometer
Embedded Signup. Es más rápido y no tiene costo, pero deja afuera la prueba de
que el negocio conecta su propia cuenta, que es el corazón de lo que evalúan.

Si conseguís el número de repuesto, el guion cambia poco: se agregan dos tomas
al principio (lanzar el Embedded Signup y volver con la cuenta conectada) y el
resto queda igual.
