<!--
SYNC IMPACT REPORT
==================
Versión: 1.8.0 → 1.8.1

Cambios (feature 025-mercadolibre-listings, 26-sep-2026) — PATCH, sin
categoría nueva:
  - Principio II, categoría 3: se nombra a **Mercado Libre** como segunda
    integración opcional POR EMPRESA vía OAuth (publicaciones vigentes de la
    cuenta, SOLO LECTURA: el conector no publica, no edita ni responde
    preguntas). Cumple (a..g) tal como están: la app es del operador por
    entorno (`MELI_CLIENT_ID/SECRET`), la conecta cada empresa, tokens
    cifrados, adaptador dedicado `src/lib/meli/`, el instalador no la
    necesita, y el sandbox jamás la toca (el agente consulta un snapshot en la
    base, nunca la red en el turno).
  - Lista de adaptadores dedicados (Principio II y restricciones): se agrega
    el adaptador OAuth/REST de Mercado Libre.
  - Sin cambios en otros principios. Plantillas: sin cambios.

Versión anterior: 1.7.0 → 1.8.0

Cambios (feature 023-instagram-direct, 25-sep-2026):
  - Principio II: la categoría 1 deja de ser solo "WhatsApp Cloud API" y pasa
    a ser **las APIs de mensajería de Meta**: WhatsApp Cloud API y, como canal
    OPCIONAL POR EMPRESA, la **Instagram Messaging API** (Instagram API with
    Instagram Login, host graph.instagram.com, misma app de Meta que WhatsApp).
    Condiciones duras (a..i): el producto funciona completo sin Instagram; lo
    habilita el operador con las credenciales de la app de Instagram por
    entorno; cada empresa conecta SU cuenta profesional con consentimiento
    explícito (Business Login for Instagram) y la desconecta cuando quiere;
    token cifrado en reposo que jamás sale al cliente ni a logs; aislado tras
    un adaptador dedicado; el instalador no lo necesita; el sandbox jamás lo
    toca; el webhook se autentica por firma y es idempotente por `mid` POR
    TENANT; se respetan las reglas del canal (ventana de 24 h, etiqueta
    HUMAN_AGENT solo para personas y hasta 7 días, sin envíos iniciados por
    el negocio) y los borrados que ordena Meta.
  - Principio VIII: el foco vertical pasa a ser "CRM de conversaciones y leads
    de WhatsApp E INSTAGRAM DIRECT". Instagram entra SOLO para atender,
    organizar y convertir mensajes directos que el cliente inicia; quedan
    FUERA publicar contenido, moderar comentarios y cualquier envío masivo o
    iniciado por el negocio por Instagram.
  - Restricciones de Plataforma: el aislamiento de integraciones suma el
    cliente de Instagram, y los entornos de prueba tampoco alcanzan la API
    real de Instagram.
  - Motivación escrita: pedido explícito del dueño (25-sep-2026) de gestionar
    los mensajes de la cuenta de Instagram de un negocio desde la misma
    Bandeja — sirve a "atender y convertir conversaciones" (Principio VIII).
  - Bump: MINOR (expansión material del alcance de II y VIII).

Plantillas dependientes (1.8.0):
  - .specify/templates/plan-template.md — ✅ compatible.
  - .specify/templates/spec-template.md — ✅ compatible.
  - .specify/templates/tasks-template.md — ✅ compatible.
  - CLAUDE.md — ⚠ actualizar la línea de soberanía, el foco y la tabla "Mapa
    del código" con la frontera de Instagram.

Versión anterior: 1.6.0 → 1.7.0

Cambios (feature 016-mcp-connector, 21-sep-2026):
  - Principio II: se agrega una QUINTA categoría de dependencia externa en
    runtime: **servidores MCP de terceros POR EMPRESA** (Model Context
    Protocol, JSON-RPC 2.0 sobre HTTP). El agente consulta herramientas de
    SOLO LECTURA del sistema que la empresa cliente ya opera —el primero, el
    PMS de Altos de Calamuchita— para responder con disponibilidad, precios y
    enlaces reales en lugar de conocimiento estático. Condiciones duras (a..j):
    el producto funciona completo sin el conector; lo habilita el SUPER ADMIN
    empresa por empresa y es el único que fija la URL (la empresa solo aporta
    su credencial y puede desconectarse); credencial cifrada que nunca sale al
    cliente, a logs ni a errores; validación anti-SSRF sobre la IP resuelta, en
    cada conexión, sin seguir redirecciones; aislamiento tras transporte
    genérico + perfil por proveedor; SOLO LECTURA con allowlist propia —el
    agente nunca promete una reserva—; el instalador no lo necesita; el
    sandbox del Laboratorio jamás lo toca; lo que devuelve el servidor es DATO
    y nunca instrucción; un fallo degrada la respuesta sin tumbar el turno, la
    ingesta ni el envío.
  - Se actualiza la lista de adaptadores dedicados del Principio II y la regla
    verificable de "Aislamiento de integraciones" en Gobernanza, que arrastraban
    desde 1.5.0 la omisión del adaptador de Google.
  - Motivación escrita: pedido explícito del dueño (21-sep-2026) de que el
    agente conteste con la disponibilidad y los precios reales del PMS del
    cliente — sirve a "convertir conversaciones" (Principio VIII).
  - Bump: MINOR (expansión material del alcance de II).

Plantillas dependientes (1.7.0):
  - .specify/templates/plan-template.md — ✅ compatible (Constitution Check
    genérico; el gate de soberanía ahora admite la quinta categoría).
  - .specify/templates/spec-template.md — ✅ compatible (sin secciones nuevas).
  - .specify/templates/tasks-template.md — ✅ compatible.
  - CLAUDE.md — ⚠ actualizar la línea de soberanía del bloque "Reglas de la
    constitución" y la tabla "Mapa del código" con la frontera nueva.

Versión anterior: 1.5.0 → 1.6.0

Cambios (feature 013-push-notifications, 17-sep-2026):
  - Principio II: se agrega una CUARTA categoría de dependencia externa en
    runtime: **Web Push estándar** (RFC 8030/8291/8292). El servidor envía
    notificaciones al push service que ELIGE EL NAVEGADOR DEL USUARIO
    (Apple, Google, Mozilla…), firmadas con claves VAPID propias generadas
    por la instancia y guardadas cifradas. Condiciones duras: sin cuenta,
    contrato ni costo con terceros; el operador no configura nada; cada
    usuario la activa (permiso del navegador) y la desactiva cuando quiere;
    el producto funciona completo sin activarla; un fallo del push jamás
    afecta la ingesta ni el envío de mensajes; el sandbox nunca notifica.
  - Motivación escrita: pedido explícito del dueño (17-sep-2026) tras el
    CRM móvil (012): «necesitamos que los usuarios puedan usarlo desde su
    celular» exige enterarse de un mensaje sin la app abierta.
  - Bump: MINOR (expansión material del alcance de II).

Versión anterior: 1.4.0 → 1.5.0

Cambios (feature 005-integrations-google-calendar, 5-sep-2026):
  - Principio II: se agrega una TERCERA categoría de dependencia externa en
    runtime: **integraciones opcionales POR EMPRESA vía OAuth** (la primera:
    Google Calendar para que el agente agende turnos). Condiciones duras:
    sin ellas el producto funciona completo; las habilita el operador de la
    instancia con credenciales propias de app (env); las conecta cada
    empresa con consentimiento explícito; tokens cifrados en reposo;
    aisladas tras adaptador dedicado; el instalador NO las necesita. La
    prohibición de S3/R2, email y Stripe/billing se mantiene; "servicios de
    Google" deja de estar prohibido en bloque y pasa a regirse por esta
    categoría.
  - Motivación escrita: pedido explícito del dueño (5-sep-2026) de que el
    agente consulte disponibilidad y agende turnos en el Google Calendar del
    negocio — sirve a "convertir conversaciones" (Principio VIII).
  - Bump: MINOR (expansión material del alcance de II).

Versión anterior: 1.3.0 → 1.4.0

Cambios (feature 004-contacts-campaigns, 5-sep-2026):
  - Principio VIII: se refina el alcance del canal. Las CAMPAÑAS DE PLANTILLAS
    CON CONSENTIMIENTO a la cartera propia del negocio (listas propias con
    declaración de consentimiento, o clientes que ya escribieron) SÍ sirven a
    "convertir" y entran al alcance, con guardrails obligatorios: opt-out
    automático respetado, límite de volumen por empresa y exclusión del
    sandbox. Siguen FUERA: scraping de números, envío a listas frías o
    compradas, y flujos visuales genéricos.
  - Motivación escrita: pedido explícito del dueño (5-sep-2026) de importar su
    lista de clientes y enviarle plantillas de marketing, con la calidad del
    número real (coexistence) protegida por los guardrails.
  - Bump: MINOR (expansión material del alcance de VIII).

Versión anterior: 1.2.0 → 1.3.0

Cambios (feature 003-multitenancy, 5-sep-2026):
  - Descripción del producto y Principio VIII: "una instancia = un negocio" →
    "una instancia = un operador con una o más empresas". El Principio III ya
    anticipaba esta evolución ("no cerrar la puerta a evoluciones"); no se
    agrega nada de plataforma centralizada (sin billing, sin planes, sin
    multi-instancia).
  - Bump: MINOR (expansión material del alcance de VIII).

Versión anterior: 1.1.0 (plantilla starter) → 1.2.0

Cambios:
  - Título y descripción del producto: Vocero CRM (CRM de WhatsApp con agente de
    IA, open source MIT, self-hosted, gratuito; una instancia = un negocio).
  - Principio II "Soberanía / Self-Hosted" → ENDURECIDO: se elimina la excepción
    de almacenamiento de objetos S3-compatible; lista cerrada de dependencias
    externas en runtime (WhatsApp Cloud API + proveedor LLM opcional vía
    adaptador OpenRouter-compatible); prohibición explícita v1 de S3/R2, email,
    Stripe y Google; requisitos mínimos del instalador fijados.
  - Principio VIII "Foco Vertical" → definido: CRM de conversaciones y leads de
    WhatsApp que las agencias despliegan para negocios.
  - Principios I, III, IV, V, VI, VII y IX: íntegros (sin cambio semántico).
  - Governance: Ratified / Last Amended = 2026-07-09.

Bump: MINOR (1.1.0 → 1.2.0) — expansión material del Principio II y definición
del Principio VIII; sin eliminaciones ni redefiniciones incompatibles.

Plantillas dependientes:
  - .specify/templates/plan-template.md — ✅ compatible (Constitution Check
    genérico; los gates se evalúan contra esta versión).
  - .specify/templates/spec-template.md — ✅ compatible (sin secciones nuevas).
  - .specify/templates/tasks-template.md — ✅ compatible.
  - CLAUDE.md — ⚠ se personaliza para el usuario final del repo en la fase de
    implementación (tarea planificada de la feature 001).

TODOs diferidos: ninguno.
-->

# Vocero CRM Constitution

Vocero CRM es un CRM de WhatsApp (e Instagram Direct, desde 1.8.0) con agente de IA, open source (MIT), self-hosted y
gratuito, diseñado para que las agencias de IA lo desplieguen en el VPS de sus
clientes: una instancia = un operador con una o más empresas (multi-tenant real,
gestionadas por el super admin de la instancia). Esta constitución define las reglas no
negociables del producto. Aplica a todas las fases del flujo de trabajo (specify,
plan, tasks, implement). Cualquier conflicto entre una decisión de implementación y
esta constitución SE RESUELVE A FAVOR de esta constitución.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Si el producto es multi-tenant, todo dato de un tenant está aislado de los demás:
  ninguna consulta, endpoint o tarea en segundo plano debe devolver o modificar datos
  de un tenant distinto al del solicitante. El aislamiento se aplica por defecto.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.

### II. Soberanía / Self-Hosted (ENDURECIDO)

Vocero CRM opera completo sobre la infraestructura del operador. La lista de
dependencias externas en runtime es CERRADA:

- Dependencias externas permitidas en runtime, ÚNICAMENTE:
  1. **Las APIs de mensajería de Meta** — el canal es la razón de ser del
     producto: la **WhatsApp Cloud API** (Meta Graph API) y, desde 1.8.0, la
     **Instagram Messaging API** (Instagram API with Instagram Login, host
     `graph.instagram.com`, misma app de Meta). Instagram es un canal
     OPCIONAL POR EMPRESA con condiciones NO negociables: (a) sin Instagram el
     producto funciona completo; (b) lo habilita el operador de la instancia
     con las credenciales de la app de Instagram inyectadas por entorno; (c)
     cada empresa conecta SU cuenta profesional con consentimiento explícito
     (Business Login for Instagram) y la desconecta cuando quiere; (d) el
     token se cifra en reposo y jamás sale al cliente ni a logs; (e) se aísla
     tras un adaptador dedicado; (f) el instalador NO lo necesita; (g) el
     sandbox del Laboratorio jamás lo toca; (h) el webhook se autentica por
     firma y la ingesta es idempotente por `mid` POR TENANT; (i) se respetan
     las reglas del canal: ventana de 24 h, etiqueta HUMAN_AGENT solo para
     personas del equipo y hasta 7 días, ningún envío iniciado por el negocio
     ni por el agente fuera de la ventana, y los borrados que ordena Meta
     (mensaje borrado por el cliente, pedido de eliminación de datos) se
     cumplen.
  2. **El proveedor LLM**, opcional, accedido EXCLUSIVAMENTE a través del adaptador
     OpenRouter-compatible (`OPENROUTER_BASE_URL` / `OPENROUTER_MODEL`). Sin token
     configurado, el producto funciona como CRM sin agente de IA.
  3. **Integraciones opcionales POR EMPRESA vía OAuth** (desde 1.5.0; la
     primera: Google Calendar; la segunda, desde 1.8.1: Mercado Libre, solo
     lectura de las publicaciones vigentes de la cuenta). Condiciones NO negociables: (a) sin la
     integración el producto funciona completo; (b) la habilita el operador de
     la instancia con credenciales de app propias inyectadas por entorno; (c)
     la conecta cada empresa con consentimiento explícito y puede
     desconectarla cuando quiera; (d) los tokens se cifran en reposo y jamás
     salen al cliente ni a logs; (e) se aísla tras un adaptador dedicado; (f)
     el instalador NO la necesita; (g) el sandbox del Laboratorio jamás la
     toca.
  4. **Web Push estándar** (desde 1.6.0): notificaciones al push service que
     ELIGE EL NAVEGADOR DE CADA USUARIO (RFC 8030/8291/8292), firmadas con
     claves VAPID propias generadas por la instancia y guardadas cifradas.
     Condiciones NO negociables: (a) sin cuenta, contrato ni costo con
     terceros; (b) el operador y el instalador no configuran nada; (c) cada
     usuario la activa con el permiso del navegador y la desactiva cuando
     quiere; (d) el producto funciona completo sin activarla; (e) un fallo
     del push jamás afecta la ingesta ni el envío de mensajes; (f) el
     sandbox del Laboratorio nunca notifica.
  5. **Servidores MCP de terceros POR EMPRESA** (desde 1.7.0; el primero: el
     PMS de Altos de Calamuchita). Un servidor Model Context Protocol remoto
     —JSON-RPC 2.0 sobre HTTP— que la empresa cliente YA opera, cuyas
     herramientas de SOLO LECTURA el agente consulta para responder con datos
     reales del negocio (disponibilidad, precios, enlaces). Condiciones NO
     negociables: (a) sin el conector el producto funciona completo y el
     agente sigue atendiendo con su conocimiento propio; (b) el SUPER ADMIN de
     la instancia lo habilita empresa por empresa —no aparece para las demás—
     y es el ÚNICO que fija la URL del servidor: jamás la escribe un usuario
     de empresa; la empresa conecta su credencial con consentimiento explícito
     y puede desconectarla cuando quiera; (c) la credencial se guarda cifrada
     en reposo (AES-256-GCM), jamás sale al cliente, a un log ni a un mensaje
     de error, y viaja únicamente al origen exacto validado, nunca a través de
     una redirección; (d) el destino se valida contra SSRF al guardarlo y DE
     NUEVO en cada conexión, sobre la IP resuelta (solo HTTPS —salvo loopback
     bajo el gate de mocks del self-test—, sin userinfo, fuera de rangos
     privados, de loopback, link-local y de metadata de nube; 3xx rechazados),
     con timeout, tope de tamaño de respuesta y límite de tasa por empresa;
     (e) se aísla tras un transporte MCP genérico más un perfil por proveedor,
     sin acoplar el dominio; (f) las herramientas son de SOLO LECTURA y el
     conector solo invoca las de una allowlist propia: no ejecuta escrituras,
     reservas, pagos ni acciones irreversibles en el sistema del tercero, y el
     agente nunca promete una reserva; (g) el instalador NO lo necesita; (h)
     el sandbox del Laboratorio JAMÁS lo toca: las conversaciones `is_test` se
     responden con datos simulados; (i) todo lo que devuelve el servidor es
     DATO, nunca instrucción: no altera el contrato de acciones del agente, se
     acota en tamaño, se le quitan los marcadores del sistema y los enlaces se
     validan contra los dominios del proveedor antes de enviarse a un
     contacto; (j) un fallo o una caída del servidor degrada la respuesta —el
     agente lo dice y sigue—, y jamás tumba el turno, la ingesta ni el envío.
- **PROHIBIDO en v1**: almacenamiento de objetos externo (S3/R2), servicios de
  email, Stripe u otro billing. Cualquier feature que los requiera queda fuera
  del alcance de v1. Cualquier servicio externo que no encaje en las cinco
  categorías anteriores también queda fuera.
- El instalador solo necesita: un VPS con Coolify o Docker, un dominio, credenciales
  de Meta y (opcional) un token de OpenRouter. Nada más.
- Las funciones core —autenticación y base de datos— corren self-hosted (Better
  Auth + PostgreSQL propios de la instancia).
- Las integraciones externas permitidas se aíslan tras adaptadores dedicados
  (cliente Graph API propio; adaptador LLM; adaptador OAuth/REST de Google;
  adaptador OAuth/REST de Mercado Libre; transporte MCP genérico + perfil por
  proveedor) para no acoplar el dominio a ellas.

**Rationale**: El producto se regala para que agencias lo desplieguen en VPS de
clientes; cada dependencia externa adicional es un costo, un punto de fallo y una
fuga de soberanía que rompe la promesa "gratis y tuyo".

### III. Multi-Tenancy Real

El sistema sirve a organizaciones independientes desde una sola instancia lógica.
En Vocero cada instancia sirve a UN operador (dueño + socios) con una o más
empresas; el modelo de datos es multi-tenant real (organización del plugin de
auth) y desde la feature 003 el perímetro (creación de empresas por el super
admin) también lo es.

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant (`organization_id`) es un parámetro de primer nivel en
  el modelo de datos y en la capa de acceso a datos, no un campo opcional añadido a
  posteriori. Toda tabla de dominio lo lleva NOT NULL e indexado org-first.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks, notificaciones de
terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, registros duplicados, acciones del agente repetidas).
- Cada evento entrante se identifica de forma única (p. ej. `wa_message_id` UNIQUE)
  y su procesamiento se registra para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código

Ninguna feature se implementa sin una especificación previa.

- La especificación describe el comportamiento observable por el usuario, no la
  implementación.
- El orden del flujo es specify → plan → tasks → implement; el código de una feature
  no comienza antes de existir su spec.
- Correcciones triviales y cambios sin comportamiento observable nuevo (typos,
  formato, refactors internos sin cambio de contrato) están exentos.

**Rationale**: Especificar el comportamiento observable antes de codificar previene
retrabajo y mantiene alineadas todas las fases del flujo.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical — CRM de Conversaciones y Leads de WhatsApp e Instagram Direct

Es un CRM de conversaciones y leads de WhatsApp —y, desde 1.8.0, de los mensajes
directos de Instagram— que las agencias despliegan para negocios. No es plataforma
de marketing masivo indiscriminado, ni constructor visual de flujos, ni herramienta
de scraping, ni gestor de redes sociales. Lo que no ayude a *atender, organizar y
convertir conversaciones de WhatsApp o de Instagram Direct de las empresas del
operador* se rechaza.

- Instagram entra SOLO como segundo canal de conversación: mensajes directos que
  el cliente inicia, atendidos en la misma Bandeja, con el mismo agente, pipeline
  y etiquetas. Quedan FUERA publicar contenido, moderar comentarios, métricas de
  la cuenta y cualquier envío masivo o iniciado por el negocio por Instagram.

- El modelo de datos y los flujos MUST reflejar ese dominio: contactos que escriben
  por WhatsApp, conversaciones con ventana de 24h, leads en un pipeline, un agente
  de IA que atiende con el conocimiento del negocio y escala a humanos.
- WhatsApp Cloud API es el canal; el producto es el CRM. Las campañas de
  plantillas CON consentimiento a la cartera propia del negocio (listas propias
  importadas con declaración de consentimiento, o clientes que ya escribieron)
  sirven a "convertir" y entran al alcance — SIEMPRE con sus guardrails:
  opt-out automático respetado, límite de volumen por empresa y exclusión del
  sandbox. Features de canal que no sirvan a atender/organizar/convertir
  (scraping de números, envío a listas frías o compradas, flujos visuales
  genéricos) quedan FUERA del alcance de v1.
- Toda feature MUST servir a la agencia que despliega o al negocio que opera UNA
  instancia. Lo que solo sirva a una plataforma centralizada (billing, planes,
  multi-instancia) queda FUERA.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado con el
negocio real y da un criterio claro para aceptar o rechazar alcance.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo.
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I y II y son verificables en revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant**: la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados (cliente Graph API propio, cliente de
  Instagram propio, adaptador LLM OpenRouter-compatible, adaptadores OAuth/REST
  de Google y de Mercado Libre, transporte MCP genérico + perfil por
  proveedor), no dispersas por el dominio.
- **Instancia pública endurecida**: las rutas de mock/desarrollo devuelven 404
  incondicional en producción; el registro se cierra tras la primera organización
  (salvo habilitación explícita); los entornos de prueba internos JAMÁS alcanzan la
  API real de WhatsApp ni la de Instagram.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo**: specify → plan → tasks → implement. Cada fase consume el
  artefacto de la anterior.
- **Puerta constitucional (Constitution Check)**: el plan de cada feature evalúa el
  cumplimiento de estos principios antes de la Fase 0 y se re-evalúa tras el diseño de
  la Fase 1. Las violaciones se registran y justifican en Complexity Tracking o se
  eliminan.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX).
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 1.8.1 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-09-26
