# App Review — Instagram (023)

App de Meta `2262662764507422` · Instagram app «Corscan CRM-IG» `2135730170674257`.
Se piden SOLO: `instagram_business_basic`, `instagram_business_manage_messages`
y la función **Human Agent** (se agrega sola al pedir mensajes).

Prerrequisitos (verificar por MCP antes de enviar — `devtools_app_review
requirements` y `privileges`):

- [ ] ≥1 llamada exitosa de cada permiso en los últimos 30 días (conectar
      `@corscan.ing` en producción + responder un DM desde el CRM).
- [ ] Política de privacidad publicada con la sección de Instagram
      (corscan.com.ar/privacidad).
- [ ] Webhook de Instagram verificado y suscripto a `messages`.
- [ ] Redirect URI, deauthorize y data deletion cargados en Business login settings.

Las respuestas van en INGLÉS (las leen revisores de Meta).

## App verification (instrucciones para el revisor)

> Corscan CRM is a web CRM (https://crm.corscan.com.ar) where small businesses
> manage customer conversations from WhatsApp and Instagram Direct in a single
> inbox, with an optional AI assistant and a human team.
>
> Test login: https://crm.corscan.com.ar/login — user and password in the
> "Credentials" field (company "Meta Review", owner role, no data).
>
> 1. Log in. Go to **Integraciones** (left menu) → **Instagram Direct** →
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
> 5. Human Agent: if the customer's last message is older than 24 hours (but
>    less than 7 days), the composer explains that only a human can reply and
>    the message is sent with the HUMAN_AGENT tag. The AI assistant never uses
>    this tag; outside 24 h it hands the conversation to a human instead.
> 6. **Integraciones → Instagram Direct → Desconectar** removes the token and
>    stops receiving messages.

## instagram_business_basic — How will your app use it?

> We use instagram_business_basic to identify the Instagram professional
> account that a business connects to our CRM through Business Login for
> Instagram. After login we read the account's user_id, username, name and
> profile picture (GET /me) to: (1) show the business which account is
> connected ("Conectada · @username"), (2) route incoming webhook events to
> the right company (the account id is unique per company in our system),
> and (3) read the name and username of customers who message the business
> (User Profile API) so the team sees who they are talking to. We do not read
> or publish media, comments or insights. Tokens are stored encrypted
> (AES-256-GCM) and are never exposed to the browser.

## instagram_business_manage_messages — How will your app use it?

> Our product is a customer-service inbox. With
> instagram_business_manage_messages the business receives the Direct
> messages that customers send to its Instagram professional account (via
> the `messages`, `messaging_seen`, `message_reactions` and
> `messaging_postbacks` webhooks) in the same inbox where it already handles
> WhatsApp, and replies from there — either a team member or an optional AI
> assistant trained with the business's own information. Replies are only
> sent within the 24-hour standard messaging window (or up to 7 days by a
> human agent). We never start conversations, send bulk or promotional
> messages, or message users who did not write first. Messages that the
> business sends from the Instagram app also appear in the inbox (echoes), and
> messages a customer deletes are deleted from our database.

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

## Guion del video (3–4 min, pantalla del CRM + celular)

Grabar en `crm.corscan.com.ar` con la empresa «Meta Review» (o la real si se
prefiere) y un segundo celular/cuenta que hace de cliente. Mostrar la URL.

1. (0:00) Login en el CRM → Integraciones → tarjeta «Instagram Direct».
2. (0:20) «Conectar con Instagram» → ventana de Instagram (se ve el nombre de
   la app y los permisos) → «Permitir» → vuelve a Integraciones: «Conectada ·
   @corscan.ing» con foto. **(instagram_business_basic)**
3. (0:50) En el celular del «cliente»: abrir Instagram → DM a @corscan.ing:
   «Hola, ¿hacen relevamientos con dron?».
4. (1:05) En el CRM: la conversación aparece sola en la Bandeja con el ícono
   de Instagram, nombre y @usuario del cliente; abrirla. **(manage_messages,
   recepción)**
5. (1:25) Responder desde el composer: «¡Hola! Sí, contanos la zona y la
   superficie». Mostrar en el celular del cliente que llegó. **(envío)**
6. (1:50) El cliente lo lee → volver al CRM y mostrar los ticks de leído.
7. (2:05) Responder desde la app de Instagram del negocio (otro celular o la
   app) → aparece en el CRM como «Desde Instagram».
8. (2:25) Human Agent: mostrar una conversación con el último mensaje de hace
   más de 24 h (preparar una de prueba el día anterior) → el composer explica
   que solo una persona puede responder → enviar. **(Human Agent)**
9. (2:50) Integraciones → Instagram Direct → «Desconectar» → confirmar.

Checklist del video: sin datos personales reales de terceros, subtítulos o
narración en inglés opcional (los textos de arriba explican cada paso),
resolución ≥720p.
