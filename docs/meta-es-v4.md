# Migración a Embedded Signup v4 — pasos del panel

> **Estado (4-sep-2026)**: Pasos 1–3 y 5 HECHOS. Configuration v4 creada:
> **`2178471596350641`** (solo Cloud API, asset permission MANAGE por defecto,
> token sin expiración). Webhook fields `history` + `smb_app_state_sync` +
> `smb_message_echoes` suscriptos. Railway rotado:
> `META_ES_CONFIG_ID=2178471596350641` + `COEXISTENCE_UI_ENABLED=true`.
> Falta: la prueba del popup (Paso 4, ahora en producción) y conectar el
> número real. Rollback vigente: config vieja `1051070220642813`.

El código ya está migrado (ver commit de esta fecha). Lo que falta es de
**panel de Meta + Railway**, y lo hace el dueño a mano. Verificado contra las
docs vivas de Meta el 3 de septiembre de 2026.

**Por qué importa**: las Configurations v2/v3 dejan de funcionar el
**15-oct-2026**. Coexistence está en la lista de features que NO se
auto-migran: pasada la fecha, el popup de "Conectar sin perder el celular"
caería al flujo estándar — que registra el número y **desconecta la app móvil
del cliente**. Es el único escenario donde nuestro guardrail de servidor no
alcanza (el registro lo haría el propio popup). Meta: hacerlo antes del
**1-oct** con margen.

**Dato clave de la investigación**: en v4 NO hay Configurations separadas por
flujo — coexistence se sigue eligiendo en runtime con
`featureType: "whatsapp_business_app_onboarding"`. La migración es crear UNA
Configuration v4 y rotar `META_ES_CONFIG_ID`. (Si la prueba empírica
demostrara lo contrario, existe el plan B sin redeploy: la env var opcional
`META_ES_COEX_CONFIG_ID`.)

## Paso 1 — Crear la Configuration v4

1. `developers.facebook.com/apps` → app **2262662764507422**.
2. Menú izquierdo → **Inicio de sesión de Facebook para empresas** → **Configuraciones**.
3. **Crear configuración**. Elegí la variación "WhatsApp Embedded Signup".
   **NO** elijas la plantilla *"…With 60 Expiration Token"*: emite tokens que
   expiran a los 60 días y los clientes verían "reconectar" cada dos meses.
4. Permisos: `whatsapp_business_management` + `whatsapp_business_messaging`.
5. Productos del flujo: **Cloud API**. Si aparece "WhatsApp Business app user
   onboarding" como producto, marcalo también (cubre la ambigüedad de la doc;
   marcarlo de más no rompe el flujo estándar). NO marques Marketing
   Messages, Conversions API ni otros.
6. Guardá y verificá que la fila diga **v4** (seleccionar productos ya te
   pone en v4; no hay selector de versión).
7. **Copiá el ID** de la config nueva → es el valor nuevo de `META_ES_CONFIG_ID`.

## Paso 2 — Verificar dominios (2 min)

Mismo producto → **Configuración**: `crm.corscan.com.ar` debe seguir en
"Dominios permitidos para el SDK de JavaScript" y en "URI de
redireccionamiento de OAuth válidos". Sin esto el popup no manda el evento y
el wizard muestra "Meta no informó qué número se conectó".

## Paso 3 — Webhook fields de coexistence

WhatsApp → Configuración → Webhooks → **Administrar**: además de `messages`,
suscribir **`history`**, **`smb_app_state_sync`** y **`smb_message_echoes`**.
Son requisito de coexistence; sin ellos el onboarding no sincroniza.

## Paso 4 — Probar ANTES de rotar producción

Con `META_ES_CONFIG_ID=<id nuevo>` (staging o local con la app real):

- Botón "Conectar sin perder el celular" → la pantalla de selección de WABA
  debe estar **reemplazada** por la de conectar la app de WhatsApp Business
  (QR / vincular teléfono). Si ves el flujo estándar de crear WABA, esa
  config no honra el featureType → plan B: crear una segunda config y ponerla
  en `META_ES_COEX_CONFIG_ID`.
- Botón "Conectar con Meta" (estándar) → debe terminar en "Conectado".

## Paso 5 — Rotar producción

1. Railway: `META_ES_CONFIG_ID=<id nuevo>` (runtime) + restart. Ahí mismo:
   `COEXISTENCE_UI_ENABLED=true` (Tech Provider aprobado el 3-sep-2026).
2. Verificar con `railway deployment list` (no comparar hashes de chunks).
3. **NO borrar** la config vieja `1051070220642813` hasta verificar v4 en
   producción con una conexión real: es el rollback instantáneo (volver a
   poner el ID viejo). Muere sola el 15-oct.

## Bloqueo encontrado en el Paso 4 y su salida (investigado el 4-sep-2026)

Al abrir el popup coexistence, el portfolio "Corscan Ingeniería" aparece
deshabilitado: *"This Meta Business Account owns the app"*. Es una
restricción real de plataforma (reproducida por otros Tech Providers en el
foro oficial, sin excepción conocida ni vía Direct Support): **Embedded
Signup no permite onboardear al portfolio dueño de la app** — está diseñado
para clientes, y el patrón esperado por Meta es que el flujo genere
portfolios adicionales.

**Decisión: usar "Create a Business portfolio" en el popup** (a nombre real
del negocio — razón social/CUIT de Corscan, dirección y web reales, jamás
como agencia genérica). Costo real, bajo para un CRM inbound:

- El portfolio nuevo arranca sin verificar → solo limita las conversaciones
  INICIADAS por el negocio (~250/día); las respuestas dentro de la ventana
  de 24 h son ilimitadas. Reversible: verificar el portfolio nuevo con los
  mismos documentos del CUIT (sube a 2.000 y destraba tiers).
- El display name NO se pierde: coexistence hereda nombre y perfil de la app
  del celular.
- Irreversible: la WABA quedará para siempre en el portfolio nuevo (no hay
  migración de WABAs entre portfolios). Mitigable compartiéndola como
  partner con el portfolio verificado para gestión centralizada.

**Prerrequisitos antes de reintentar el popup**:

1. App de WhatsApp Business del celular en versión ≥2.24.17, con foto de
   perfil y nombre definitivos YA cargados (la foto no se puede cambiar
   después del onboarding en coexistence).
2. El número debe tener actividad orgánica real (el error #3441045 "more
   activity needed" es el blocker más frecuente; ideal 30+ días de uso).
3. **Sanear la WABA vieja `1777760663660067`**: en WhatsApp Manager de
   Corscan Ingeniería, eliminar el número +54 9 351 688-2234 de esa WABA (o
   la WABA entera si no tiene nada más). Es solo config de Business Manager
   — NO tocar la app del celular. Esperar 24–72 h de propagación.
4. Opcional en paralelo: ticket informativo en Direct Support
   (business.facebook.com/direct-support) preguntando el flujo oficial de
   self-onboarding — sin expectativa, no bloquea.

**Durante el popup**: elegir "Create a Business portfolio" → debe aparecer
la pantalla de conectar la cuenta de WhatsApp Business existente (QR). Si
pide registrar un número desde cero: **ABORTAR** (ese flujo mata el
celular). Completar pairing + sync dentro de las 24 h.

**Después**: verificar que el celular siga funcionando y que el CRM reciba y
responda; iniciar Business Verification del portfolio nuevo; considerar
compartir la WABA como partner con Corscan Ingeniería.

## Después de esto

El gran momento: en Ajustes → WhatsApp, conectar **+54 9 351 688-2234** con
"Ya uso este número en el celular" (con la app de WhatsApp Business
actualizada a ≥2.24.17). Tras el FINISH hay una ventana de **24 h** para la
sincronización de contactos/historial. Recordatorios del costo: dispositivos
vinculados se desvinculan; llamadas POR WhatsApp dejan de andar en el número
(las comunes no); los grupos siguen en el celular (solo no se ven en el CRM).

Contexto general del proceso en [meta-app-review.md](meta-app-review.md).
