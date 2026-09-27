# Mercado Libre — publicaciones vigentes para el agente (025)

Cada empresa conecta **su** cuenta de Mercado Libre y el agente conoce sus
publicaciones activas: busca las que coinciden con lo que pide el cliente,
ofrece hasta 3 con precio, barrio y enlace, y junta los pedidos de visita
para que una persona confirme el horario. Es **solo lectura**: el CRM no
publica, no edita y no responde preguntas de Mercado Libre.

La app de Mercado Libre es **del operador** de la instancia (una sola); la
cuenta la conecta cada empresa desde **Integraciones → Mercado Libre**.

## 1. Crear la app (una vez por instancia)

Formulario de <https://developers.mercadolibre.com.ar/devcenter/create-app>
(verificado el 27-sep-2026), con la cuenta de Mercado Libre del operador:

**Paso 1 — Información básica**
- Nombre: «Corscan CRM» · Nombre corto: `corscan-crm` · Descripción (≤150):
  «CRM de WhatsApp: el asistente de cada negocio consulta sus publicaciones
  vigentes para responder consultas y coordinar visitas.»
- Propósito: **Negocios** · Usuarios: el rango más chico que corresponda.
- Logo: opcional (PNG ≤ 1 MB).

**Paso 2 — Configuración y scopes**
- **Redirect URIs**: una sola, EXACTA:
  `https://<tu-dominio>/api/integrations/mercadolibre/callback`
  (producción: `https://crm.corscan.com.ar/api/integrations/mercadolibre/callback`).
- **Flujos OAuth**: ✅ Authorization Code · ✅ Refresh Token · ⬜ Client
  Credentials. Sin «Refresh Token» ML no entrega refresh y la conexión se
  rechaza (es lo que antes se llamaba `offline_access`).
- **Requiere PKCE**: ✅ recomendado (el CRM manda `code_challenge` S256 y
  `code_verifier` siempre, así que funciona con o sin).
- **Negocios**: ✅ Mercado Libre · ✅ **VIS** (Vehículos, Inmuebles y
  Servicios: las publicaciones de inmuebles son de VIS).
- **Permisos**:
  - Usuarios: viene por defecto; si el desplegable lo permite, **Solo
    lectura**.
  - **Publicación y sincronización: Solo lectura** (cubre `items`,
    `items/search` y descripciones). Sin esto ML responde 403
    `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
  - Todo lo demás (Comunicaciones, Publicidad, Facturación, Métricas,
    Promociones, Ventas y envíos): **Sin acceso**.
- **Tópicos**: ninguno. **Notificaciones callbacks URL**: vacía. El CRM no
  usa notificaciones: sincroniza solo.
- Aceptar términos, reCAPTCHA y **Crear**. Copiá el **App ID** y la **Clave
  secreta** (Client Secret) de la app creada.

## 2. Configurar la instancia

Variables de entorno (runtime, no build):

```
MELI_CLIENT_ID=<App ID>
MELI_CLIENT_SECRET=<Clave secreta>
```

En Railway se cargan en el servicio `app`; el redeploy habilita la tarjeta.
Sin ellas la tarjeta dice «No disponible» y no ofrece «Conectar».

## 3. Conectar una empresa

El **propietario** de la empresa entra a Integraciones → Mercado Libre →
**Conectar con Mercado Libre** e inicia sesión con la cuenta **principal**
donde publica (un colaborador/operador no puede autorizar apps: Mercado
Libre responde `invalid_operator_user_id`). Al volver, las publicaciones
activas se traen solas; la página lista exactamente lo que ve el agente.

## Cómo funciona

- **Snapshot local**: el agente consulta una copia en la base
  (`meli_listing`), nunca la API en el turno. Se refresca al conectar, con
  «Sincronizar ahora» y sola cuando tiene más de 3 horas (al abrir la
  página o cuando el agente la usa). El Laboratorio usa el snapshot y jamás
  llama a Mercado Libre.
- **Tokens**: access token de 6 h y refresh de **un solo uso** que rota en
  cada renovación; los dos cifrados (AES-256-GCM). La renovación va bajo un
  lock por empresa para no quemar el refresh dos veces.
- **Una cuenta = una empresa**: el grant nuevo de una cuenta invalida el
  anterior de la misma app, así que la misma cuenta no puede quedar en dos
  empresas (el segundo intento responde «ya está conectada en otra
  empresa» y los tokens recién emitidos quedan en la empresa dueña, que no
  se rompe).
- **Texto ajeno = dato**: título, descripción y características se sanean y
  la descripción va encerrada como dato en el prompt. Los enlaces solo
  sobreviven si son https del dominio de Mercado Libre del sitio.
- **Qué NO dice el agente**: la dirección exacta (el barrio sí), requisitos,
  garantías, honorarios ni nada que no esté publicado. Sin Google Calendar
  no confirma visitas: anota el pedido (propiedad + día/franja + nombre),
  mueve el lead a «Visita…»/«Interesado» si existe, y escala con motivo
  «Pidió coordinar una visita» (push al dueño). Con Google Calendar y
  «el agente puede agendar», agenda la visita en la agenda.

## Problemas frecuentes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| «Requiere reconexión» | Mercado Libre rechazó el refresh: permiso revocado, contraseña cambiada, 4 meses sin uso o la cuenta se autorizó en otro lado | Reconectar desde la tarjeta. Mientras tanto el agente usa el último inventario. |
| «Mercado Libre no completó la autorización» | Redirect distinto al de la app, colaborador en vez de cuenta principal, o datos pendientes de validar en la cuenta | Revisar la URI exacta y entrar con la cuenta principal. |
| «Ya está conectada en otra empresa» | La misma cuenta de ML ya está en otra empresa de la instancia | Desconectarla allá primero. |
| Más de 1.000 publicaciones | La paginación de ML llega hasta 1.000 | El agente ve las primeras 1.000 (aviso en la tarjeta). |

## Self-test

`WA_MOCK_ENABLED=true` + `MELI_AUTH_URL`/`MELI_API_BASE_URL` apuntando al
meli-mock (`/api/dev/meli-mock/*`): OAuth con PKCE verificado, refresh
rotativo, 8 publicaciones de Córdoba y perillas en
`POST /api/dev/meli-mock/state` (`nextAuthError`, `failNextApi`,
`expireAccess`, `revoked`, `bulkMissing`, `setStatus`, `setPrice`). Guion:
`tests/e2e/025-mercadolibre-listings.md`.
