# Instagram Direct — guía del operador (023)

Los mensajes directos de la cuenta profesional de Instagram de cada empresa
entran a la misma Bandeja que WhatsApp y el agente los atiende. Se usa la
**Instagram API with Instagram Login** (host `graph.instagram.com`): la cuenta
NO necesita una página de Facebook.

## 1. Panel de Meta (una vez por instancia)

Todo dentro de la MISMA app de Meta que usás para WhatsApp.

1. **Casos de uso → «Manage messaging & content on Instagram» → Customize →
   API setup with Instagram login.** Si el caso de uso no está, agregalo con
   «Add use cases».
2. **Permisos**: «Add all required permissions» deja en *Ready for testing*
   `instagram_business_basic` e `instagram_business_manage_messages` (los
   únicos que pide Vocero).
3. Anotá el **Instagram app ID** y el **Instagram app secret** de esa misma
   pantalla → variables `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` del
   entorno (Railway/Coolify: variables de runtime). No son el ID y el secreto
   de la app de Meta.
4. **3. Configure webhooks**:
   - Callback URL: `<APP_BASE_URL>/api/webhooks/instagram`
   - Verify token: el MISMO valor de `META_WEBHOOK_VERIFY_TOKEN`.
   - «Verify and save» y suscribir el campo `messages` (y, si aparecen,
     `messaging_seen`, `messaging_postbacks`, `message_reactions`,
     `messaging_referral`).
   - La app tiene que estar publicada (*Live*) para recibir webhooks.
5. **4. Set up Instagram business login → Business login settings**:
   - OAuth redirect URI: `<APP_BASE_URL>/api/integrations/instagram/callback`
   - Deauthorize callback URL: `<APP_BASE_URL>/api/webhooks/instagram/deauthorize`
   - Data deletion request URL: `<APP_BASE_URL>/api/webhooks/instagram/data-deletion`

El webhook exige firma (`X-Hub-Signature-256` con el secreto de la app de
Instagram): sin `INSTAGRAM_APP_SECRET` la ruta responde 404.

## 2. Cada empresa (desde Vocero)

1. La cuenta de Instagram tiene que ser **profesional** (empresa o creador).
2. En la app de Instagram: **Configuración → Mensajes y respuestas a
   historias → Herramientas conectadas → «Permitir acceso a los mensajes»**.
3. El propietario entra a **Ajustes → Instagram → Conectar con Instagram**
   (al lado de WhatsApp: es un canal, no una integración) y autoriza con el
   usuario de Instagram del negocio.
4. Al conectar por primera vez se importa solo el **historial**: las
   conversaciones de los últimos 60 días, con los 20 mensajes más recientes
   de cada una (límite de la Conversations API de Meta; las solicitudes de
   mensaje sin actividad en 30 días no las devuelve). Se puede repetir con
   «Volver a importar»: no duplica. Lo importado no genera no leídos, avisos,
   leads ni respuestas del agente.

## 3. Acceso estándar vs. avanzado (App Review)

Hasta que Meta aprueba el App Review, la app tiene **Standard Access**: solo
funciona con cuentas que tienen rol en la app. Para probar:

- **App roles → Roles → Instagram Testers**: agregar la cuenta del negocio
  (p. ej. `@corscan.ing`) y la cuenta personal con la que se simula al
  cliente. Cada una acepta la invitación en Instagram → Configuración →
  Apps y sitios web → Invitaciones de evaluador.
- Meta exige **al menos una llamada exitosa por permiso en los 30 días
  previos al envío**: conectar la cuenta (usa `instagram_business_basic`) y
  responder un mensaje desde Vocero (usa `instagram_business_manage_messages`)
  alcanza.

Para el App Review se piden `instagram_business_basic`,
`instagram_business_manage_messages`, `instagram_business_manage_comments`
(030) y la función **Human Agent**. Guion del video y textos:
`specs/023-instagram-direct/app-review.md`.

## 4. Reglas del canal (lo que ve el equipo)

- Ventana de **24 h** desde el último mensaje del cliente: el agente y el
  equipo responden libremente.
- Entre **24 h y 7 días** solo una persona puede responder: el envío sale con
  la etiqueta `HUMAN_AGENT` (requiere la función Human Agent aprobada). El
  agente de IA NUNCA la usa: deriva a una persona (motivo «ventana»).
- Después de 7 días no se puede escribir: Instagram no tiene plantillas.
- Sin campañas ni API pública por Instagram. Los contactos de Instagram no
  tienen teléfono (se muestra el @usuario).
- Lo que el equipo responde desde la app de Instagram aparece en la Bandeja
  como «Desde Instagram».
- El token dura 60 días y se renueva solo (cada 6 h se revisan los que
  vencen en menos de 15 días). Si Meta lo rechaza, la tarjeta pide
  «Reconectar»; los mensajes entrantes se siguen guardando.

## 5. Instagram que vende (030): comentarios, primer contacto y links

Todo vive en **Ajustes → Instagram**, en pestañas (solo el propietario):

- **Comentarios**: reglas «comentá INFO y te mando el link». Por regla: en
  qué publicaciones (las elegidas, todas, o los vivos), palabras clave (sin
  mayúsculas ni tildes; vacío = cualquier comentario), el DM privado (con
  `{usuario}`), un botón opcional (respuesta rápida), un seguimiento que sale
  cuando la persona responde, y respuestas públicas (una al azar). Una sola
  respuesta privada por comentario (regla de Meta) y una vez por persona,
  publicación y regla. Tope: 700 por hora y cuenta (Meta: 750).
- **Ocultar comentarios**: lista de palabras; el comentario se oculta y no
  recibe DM. La actividad reciente permite mostrarlo de nuevo.
- **Primer contacto**: hasta 4 preguntas frecuentes (ice breakers) y un menú
  fijo de hasta 5 opciones (pregunta → la responde el agente; enlace;
  «hablar con una persona» → escala sin pasar por el modelo).
- **Links con origen**: `https://ig.me/m/<cuenta>?ref=<slug>` con QR (SVG) e
  instrucción opcional para el agente. La conversación queda etiquetada
  `ig-<slug>` y el agente recibe el origen. Los anuncios «Enviar mensaje»
  quedan como `ig-anuncio` con el título del anuncio.

Cómo llegan los comentarios: con acceso **avanzado** por webhook (`comments`,
`live_comments`, al instante). Con acceso **estándar** Meta no manda esos
webhooks: el CRM consulta los comentarios de las publicaciones con reglas
cada minuto (y cada 15 minutos como respaldo cuando el webhook funciona). Los
vivos solo funcionan por webhook.

Conexiones anteriores a 030 no tienen el permiso de comentarios: la pestaña
pide **Reconectar con Instagram** (Business Login vuelve a pedir los tres
permisos). Al reconectar, el primer contacto guardado se vuelve a aplicar.

El agente en Instagram puede responder con botones de enlace, carrusel y
respuestas rápidas (solo enlaces que estén en su contexto: conocimiento,
herramientas o la conversación), entiende respuestas y menciones de
historias (la imagen se baja y se describe) y guarda el email y el teléfono
que la persona da en el chat (sin pisar lo que cargó el equipo).

### Convivencia con otras apps (ManyChat y similares)

Instagram usa **Conversation Routing**: cada conversación la maneja UNA sola
app. Si otra herramienta es la app principal, los mensajes llegan al CRM
como `standby` (se guardan, el agente no responde) y Ajustes avisa «Otra app
maneja conversaciones de esta cuenta». Para que responda el CRM: Meta
Business Suite → Configuración → Integraciones → Conversation Routing → app
principal, o desconectar la otra herramienta. Dos contestadores automáticos
no conviven en la misma cuenta.
