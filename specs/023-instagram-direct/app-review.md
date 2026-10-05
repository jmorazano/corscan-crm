# App Review — Instagram (023 + 030)

App de Meta `2262662764507422` · Instagram app «Corscan CRM-IG» `2135730170674257`.
Se piden: `instagram_business_basic`, `instagram_business_manage_messages`,
`instagram_business_manage_comments` (agregado el 5-oct-2026, feature 030) y
la función **Human Agent** (se agrega sola al pedir mensajes).

Prerrequisitos (verificar por MCP antes de enviar — `devtools_app_review
requirements` y `privileges`, y la columna «API Calls» del panel):

- [x] ≥1 llamada exitosa de basic y manage_messages (45 y 37 al 5-oct-2026).
- [ ] ≥1 llamada exitosa de `instagram_business_manage_comments`: reconectar
      `@corscan.ing` en producción (para conceder el permiso nuevo) y dejar
      una regla de comentarios activa: la consulta de comentarios y la
      respuesta privada del video generan las llamadas.
- [x] Política de privacidad publicada con la sección de Instagram
      (corscan.com.ar/privacidad). ⚠ Sumarle una línea sobre comentarios
      (ver «Política de privacidad» abajo) antes de enviar.
- [x] Webhook de Instagram verificado; campos `messages`, `comments`,
      `live_comments`, `standby` y demás suscriptos a nivel app.
- [x] Redirect URI, deauthorize y data deletion cargados en Business login settings.
- [ ] Human Agent: decidir si va en esta solicitud (ver nota del paso 9 del guion).

Las respuestas van en INGLÉS (las leen revisores de Meta).

## App verification (instrucciones para el revisor)

> Corscan CRM is a web CRM (https://crm.corscan.com.ar) where small businesses
> manage customer conversations from WhatsApp and Instagram Direct in a single
> inbox, with an optional AI assistant and a human team.
>
> Test login: https://crm.corscan.com.ar/login — user and password in the
> "Credentials" field (company "Meta Review", owner role, no data).
>
> 1. Log in. Go to **Ajustes** (Settings, left menu) → **Instagram** →
>    **Conectar con Instagram**.
> 2. Log in with an Instagram professional (Business or Creator) test account
>    and accept the requested permissions. You return to the CRM and the card
>    shows "Conectada" with the account's @username and profile picture
>    (instagram_business_basic).
> 3. From another Instagram account, send a Direct message to the connected
>    account. It appears in real time in **Bandeja** (inbox), marked with the
>    Instagram icon, with the sender's name and @username
>    (instagram_business_manage_messages, webhook `messages`).
> 4. Type a reply in the composer and send it. The customer receives it in
>    Instagram. When they read it, the message shows the "read" ticks
>    (`messaging_seen`).
> 5. Comments (instagram_business_manage_comments): open **Ajustes →
>    Instagram → Comentarios → Nueva regla**. Pick one of the account's posts
>    from the grid (GET /me/media), type the keyword `INFO`, a private
>    message, an optional button label and a public reply, and save.
> 6. From the other Instagram account, comment `INFO` on that post. Within a
>    minute the commenter receives ONE private reply in Direct (Private
>    Replies API, one message per comment) and the comment gets the public
>    reply. The conversation appears in **Bandeja** with a note of the
>    comment. If the commenter replies, the configured follow-up message is
>    sent and the conversation continues normally inside the 24-hour window.
> 7. Moderation: in **Comentarios → Ocultar comentarios**, add a word (for
>    example `spam`). A new comment containing it is hidden automatically;
>    the activity list lets the business show it again.
> 8. Human Agent: if the customer's last message is older than 24 hours (but
>    less than 7 days), the composer explains that only a human can reply and
>    the message is sent with the HUMAN_AGENT tag. The AI assistant never uses
>    this tag; outside 24 h it hands the conversation to a human instead.
> 9. **Ajustes → Instagram → Desconectar** removes the token and stops
>    receiving messages and comments.

## instagram_business_basic — How will your app use it?

> We use instagram_business_basic to identify the Instagram professional
> account that a business connects to our CRM through Business Login for
> Instagram. After login we read the account's user_id, username, name and
> profile picture (GET /me) to: (1) show the business which account is
> connected ("Conectada · @username"), (2) route incoming webhook events to
> the right company (the account id is unique per company in our system),
> (3) read the name and username of customers who message the business (User
> Profile API) so the team sees who they are talking to, and (4) list the
> account's recent posts (GET /me/media: id, caption, thumbnail, permalink)
> so the business can choose which posts a comment-reply rule applies to. We
> never publish or edit media, and we do not read insights. Tokens are stored
> encrypted (AES-256-GCM) and are never exposed to the browser.

## instagram_business_manage_messages — How will your app use it?

> Our product is a customer-service inbox. With
> instagram_business_manage_messages the business receives the Direct
> messages that customers send to its Instagram professional account (via
> the `messages`, `messaging_seen`, `message_reactions`,
> `messaging_postbacks` and `messaging_referral` webhooks) in the same inbox
> where it already handles WhatsApp, and replies from there — either a team
> member or an optional AI assistant trained with the business's own
> information. Replies are only sent within the 24-hour standard messaging
> window (or up to 7 days by a human agent). We never send bulk or
> promotional messages. The business can also set up to 4 ice breakers and a
> persistent menu (messenger_profile), and replies may include quick replies,
> link buttons or a carousel. Messages that the business sends from the
> Instagram app also appear in the inbox (echoes), and messages a customer
> deletes are deleted from our database.

## instagram_business_manage_comments — How will your app use it?

> Many small businesses ask people to "comment INFO and we'll send you the
> link". With instagram_business_manage_comments, the business creates a
> rule in our CRM (Settings → Instagram → Comments): which of its own posts
> (or its live videos), which keywords, the private message and an optional
> short public reply. When someone comments a keyword on one of the
> business's posts, we receive the comment (`comments` / `live_comments`
> webhooks, or by reading the post's comments when webhooks are not
> available) and send exactly ONE private reply to that comment with the
> Private Replies API, within the 7-day limit, plus the optional public reply
> (POST /{comment-id}/replies). Each person receives the automatic message at
> most once per post and rule, and we follow up only if they answer. The
> business can also hide comments that contain words it chooses (spam,
> insults) and show them again from an activity list. We only act on
> comments on the business's own media; we never comment, like, publish or
> message people who did not interact with the business first.

## Human Agent — How will your app use it?

> Human Agent lets a member of the business's team answer a customer's
> Instagram message after the 24-hour window, up to 7 days, for issues that
> could not be resolved in time (for example a question received on a
> weekend or one that requires checking availability with the owner). In our
> inbox, when the last customer message is between 24 hours and 7 days old,
> the composer shows that only a human can reply and the message is sent with
> the HUMAN_AGENT tag. Automated replies from the AI assistant never use the
> tag: outside the 24-hour window the assistant stops and flags the
> conversation for a human.

## Política de privacidad (agregar antes de enviar)

Una línea en la sección de Instagram de corscan.com.ar/privacidad (repo
dronebiz, `components/PrivacyPolicy.tsx`):

> Si el negocio activa las respuestas a comentarios, el CRM lee los
> comentarios de las publicaciones del negocio que coinciden con sus reglas
> (texto, @usuario y publicación) para responderlos y registrar la
> actividad, y puede ocultar los comentarios que contienen las palabras que
> el negocio elija. No publicamos contenido ni comentamos por nuestra cuenta.

## Guion del video (4–5 min, pantalla del CRM + celular)

Grabar en `crm.corscan.com.ar` con la empresa «Meta Review» (o la real si se
prefiere) y un segundo celular/cuenta que hace de cliente. Mostrar la URL.
La cuenta conectada tiene que tener al menos una publicación.

1. (0:00) Login en el CRM → Ajustes → Instagram.
2. (0:20) «Conectar con Instagram» → ventana de Instagram (se ven el nombre de
   la app y los TRES permisos, incluido comentarios) → «Permitir» → vuelve a
   Ajustes → Instagram: «Conectada · @corscan.ing» con foto.
   **(instagram_business_basic)**
3. (0:50) En el celular del «cliente»: abrir Instagram → DM a @corscan.ing:
   «Hola, ¿hacen relevamientos con dron?».
4. (1:05) En el CRM: la conversación aparece sola en la Bandeja con el ícono
   de Instagram, nombre y @usuario del cliente; abrirla. **(manage_messages,
   recepción)**
5. (1:25) Responder desde el composer: «¡Hola! Sí, contanos la zona y la
   superficie». Mostrar en el celular del cliente que llegó; el cliente lo
   lee → ticks de leído en el CRM. **(envío)**
6. (1:50) **Comentarios**: Ajustes → Instagram → pestaña «Comentarios» →
   «Nueva regla» → elegir una publicación de la grilla (se ven las fotos de
   la cuenta), palabra `INFO`, mensaje privado «¡Hola {usuario}! Te paso la
   info por acá 👇», botón «Quiero la info», seguimiento con un enlace, y una
   respuesta pública «¡Te escribimos por privado! 📩» → Guardar.
   **(instagram_business_basic: lista de publicaciones)**
7. (2:30) En el celular del cliente: comentar `INFO` en esa publicación.
   Esperar (hasta 1 minuto si Meta todavía no manda el aviso instantáneo):
   llega el DM con el botón y aparece la respuesta pública debajo del
   comentario. En el CRM: Bandeja → la conversación con la nota «Comentó en
   tu publicación» y el DM marcado «Respuesta automática a un comentario»; en
   Ajustes → Comentarios → Actividad, el comentario «Respondido».
   **(instagram_business_manage_comments: respuesta privada + pública)**
8. (3:10) El cliente toca «Quiero la info» → le llega el seguimiento con el
   enlace (dentro de la ventana de 24 h que abrió su respuesta).
9. (3:30) **Moderación**: Comentarios → «Ocultar comentarios» → agregar
   `spam` → Guardar. El cliente comenta «esto es spam» → en la Actividad
   aparece «Ocultado» y, desde la cuenta del negocio, el comentario ya no se
   ve; tocar el ojo para mostrarlo de nuevo. **(manage_comments: ocultar)**
10. (3:55) **Primer contacto** (opcional, suma para manage_messages):
    pestaña «Primer contacto» → dos preguntas frecuentes → «Guardar en
    Instagram» → en el celular, abrir un chat nuevo con la cuenta y mostrar
    las preguntas.
11. (4:15) **Human Agent**: mostrar una conversación con el último mensaje de
    hace más de 24 h (preparar una de prueba el día anterior) → el composer
    explica que solo una persona puede responder → enviar. ⚠ Desde 027 el
    CRM cierra Instagram a las 24 h mientras `INSTAGRAM_HUMAN_AGENT` esté
    apagado: para grabar este paso hay que encenderlo en Railway (Meta va a
    rechazar el envío hasta aprobarlo; se graba la pantalla del composer y el
    intento). Si preferís no hacerlo, sacá «Human Agent» de esta solicitud y
    pedilo después.
12. (4:40) Ajustes → Instagram → «Desconectar» → confirmar.

Checklist del video: sin datos personales reales de terceros, subtítulos o
narración en inglés opcional (los textos de arriba explican cada paso),
resolución ≥720p, que se vea la URL del CRM al menos una vez.
