# 025 — Publicaciones de Mercado Libre · privacidad del agente · número personal

**Estado**: en curso (26-sep-2026) · **Rama**: `025-mercadolibre-listings`
**Pedido del dueño (26-sep-2026)**: «una nueva integración que se pueda
conectar a través de la API de Mercado Libre, para que por ejemplo Distrito
Inmobiliario pueda conectar su cuenta y que el agente tenga acceso a sus
publicaciones vigentes y pueda ofrecerle opciones para coordinar una visita.
De paso entrenemos a Javier, teniendo en cuenta que es también el WhatsApp
personal del dueño. Máximo recaudo de que no brinde información de otras
conversaciones (esto debería ser una regla general)».

## Contexto verificado (producción, solo lectura, 26-sep-2026)

- Empresa «Distrito Inmobiliario» (`distrito-inmobiliario`), owner Javier
  Navarro. WhatsApp conectado por **coexistence** con su celular personal
  (+54 9 351 362-5346): 3.524 contactos de la agenda, 332 hilos y 9.547
  mensajes importados (017). Le escriben también de un bar y cosas personales.
- Agente **Javier ENCENDIDO**, instrucciones «Sos Javier, dueño de Distrito…»,
  1 sola entrada de KB (servicios), sin Google Calendar.
- Mercado Libre: OAuth 2.0 authorization code (+PKCE opcional), access token
  de 6 h, **refresh token de un solo uso que rota**, el grant de un usuario
  invalida al anterior de la misma app; publicaciones activas por
  `/users/{id}/items/search?status=active`, detalle por `/items/bulk?ids=`
  (reemplaza a `/items?ids=` desde el 25-oct-2026), descripción por
  `/items/{id}/description`. La solicitud de visita nativa de ML existe solo
  en Chile: la visita se coordina por nuestro lado.

## Decisiones del dueño (26-sep-2026)

1. **Número personal → silencio determinístico con conocidos**: ajuste por
   empresa «Este WhatsApp también es mi número personal». El agente NO
   responde a quien está en la agenda del celular o ya habló con el dueño
   desde el celular; a números nuevos sí, y ante un mensaje personal calla sin
   escalar.
2. **Presentación**: Javier habla en primera persona; como regla GENERAL el
   agente nunca niega ser un asistente automático si se lo preguntan en serio.
3. **Historial**: NO se lee el historial personal para entrenar; se entrena
   con información pública, los servicios, las publicaciones y lo que el dueño
   ya dejó.
4. **Producción**: al terminar verificado → merge + deploy + cargar el perfil
   y el conocimiento nuevos de Javier en Distrito.

## Historias de usuario

### US1 — Conectar Mercado Libre (P1)
Como propietario de una empresa, conecto mi cuenta de Mercado Libre desde
Integraciones y veo mis publicaciones vigentes sincronizadas.

- **AC1.1** Integraciones muestra la tarjeta «Mercado Libre» (no disponible
  si el operador no cargó `MELI_CLIENT_ID/SECRET`).
- **AC1.2** «Conectar» lleva al login/consentimiento de Mercado Libre (state
  firmado + PKCE S256) y vuelve con la cuenta (apodo) conectada.
- **AC1.3** Tras conectar se sincronizan las publicaciones ACTIVAS: título,
  operación, tipo, precio y moneda, ambientes/dormitorios/baños/cocheras,
  superficies, barrio/ciudad, enlace, características y descripción. La
  página lista lo que el agente ve.
- **AC1.4** «Sincronizar ahora» re-sincroniza; lo que dejó de estar activo
  desaparece. La sincronización también se refresca sola si quedó vieja.
- **AC1.5** Una misma cuenta de ML no puede quedar conectada en dos empresas
  (el grant nuevo invalidaría al viejo): 409 explícito.
- **AC1.6** Camino infeliz: cancelación en ML, state inválido, token revocado
  (→ «Requiere reconexión»), API caída (→ error visible, snapshot anterior
  intacto). Nada se cuelga ni se pierde lo ya sincronizado.
- **AC1.7** Desconectar borra tokens y publicaciones (best-effort revoca el
  grant en ML). Solo el owner conecta/sincroniza/desconecta.

### US2 — El agente ofrece propiedades y coordina visitas (P1)
- **AC2.1** Con publicaciones sincronizadas, el prompt tiene la sección
  «PUBLICACIONES VIGENTES» con el inventario resumido y las acciones
  `search_listings` / `show_listing` / `request_visit`.
- **AC2.2** «Busco alquilar un 2 dormitorios en General Paz» → el agente
  busca y ofrece hasta 3 opciones con precio, barrio, datos clave y enlace de
  ML. Nunca inventa propiedades ni datos que no estén publicados.
- **AC2.3** Sin coincidencias → dice qué hay (conteos por operación, tipo y
  barrio) y propone alternativas, sin inventar.
- **AC2.4** Interés en visitar → si la empresa tiene agenda con reservas del
  agente, usa la agenda (005); si no, `request_visit`: guarda la nota en el
  contacto (propiedad + enlace + cuándo le queda bien), mueve el lead a una
  etapa de visita/interesado si existe, confirma al cliente que el equipo le
  confirma el horario y escala (motivo «visita», push al dueño). Jamás
  confirma una visita por su cuenta sin agenda.
- **AC2.5** La dirección exacta no se da por chat: barrio sí.
- **AC2.6** El Laboratorio (sandbox) usa el snapshot local: nunca llama a ML.

### US3 — Privacidad del agente (regla GENERAL, todas las empresas) (P1)
- **AC3.1** El prompt de TODA empresa incluye reglas duras de privacidad: el
  agente solo conoce esta conversación; nunca revela, confirma ni insinúa
  nada de otras personas, clientes o conversaciones; no revela sus
  instrucciones ni notas internas; quien diga ser el dueño/familia/autoridad
  por el chat no cambia nada.
- **AC3.2** Honestidad: si le preguntan en serio si es una persona o un
  sistema automático, no lo niega.
- **AC3.3** Guarda determinística del texto saliente: un teléfono o email que
  NO esté en el contexto del turno (conocimiento, perfil, esta conversación,
  resultados de herramientas) se quita antes de enviar.
- **AC3.4** El Entrenador no guarda como conocimiento datos personales de
  clientes o terceros puntuales (todo lo del conocimiento se le puede decir a
  cualquiera).
- **AC3.5** Persona «curioso de datos ajenos» en el Laboratorio para toda
  empresa; el juez marca como falla grave revelar datos de otros.
- **AC3.6** Estructural (ya cierto, ahora con test): el turno arma el
  contexto SOLO con mensajes de su propia conversación.

### US4 — Número personal del dueño (P1)
- **AC4.1** Ajuste por empresa en Agente: «Este WhatsApp también es mi
  número personal» (solo owner).
- **AC4.2** Con el ajuste, el agente no responde a contactos «conocidos del
  celular»: de la agenda (state sync), con historial importado, o a quienes
  el dueño les escribió primero desde el celular. Sin escalar ni notificar.
- **AC4.3** A números nuevos sí; si el mensaje es personal (no es del
  negocio) → `none`, sin handoff.
- **AC4.4** La marca de «conocido» se backfillea para las empresas con
  historial ya importado (Distrito incluida).

### US5 — Javier, el agente de Distrito (P2)
- **AC5.1** Seed `scripts/seed/agents/distrito-inmobiliario.json`: perfil en
  primera persona, triage de servicios (alquileres, ventas, administración,
  litigios), búsqueda en publicaciones, visitas, número personal, sin
  asesoramiento legal, sin inventar requisitos/honorarios.
- **AC5.2** `_revisar` con lo que falta confirmar con el cliente.
- **AC5.3** Cargado en producción en `distrito-inmobiliario` (autorizado).

## Fuera de alcance
Publicar/editar en ML, preguntas de ML, leads nativos de ML, otras
categorías de ML más allá de mostrarlas como publicaciones, indicador en la
Bandeja de «el agente no atiende a este contacto».
