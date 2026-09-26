# Mercado Libre — publicaciones vigentes para el agente (025)

Cada empresa conecta **su** cuenta de Mercado Libre y el agente conoce sus
publicaciones activas: busca las que coinciden con lo que pide el cliente,
ofrece hasta 3 con precio, barrio y enlace, y junta los pedidos de visita
para que una persona confirme el horario. Es **solo lectura**: el CRM no
publica, no edita y no responde preguntas de Mercado Libre.

La app de Mercado Libre es **del operador** de la instancia (una sola); la
cuenta la conecta cada empresa desde **Integraciones → Mercado Libre**.

## 1. Crear la app (una vez por instancia)

1. Entrá con la cuenta de Mercado Libre del operador (con los datos
   validados) a <https://developers.mercadolibre.com.ar> → **Mis
   aplicaciones** → **Crear aplicación**.
2. Completá nombre (p. ej. «Corscan CRM»), nombre corto, descripción y logo.
3. **URI de redirect** — EXACTA, sin nada variable:
   `https://<tu-dominio>/api/integrations/mercadolibre/callback`
   (en producción: `https://crm.corscan.com.ar/api/integrations/mercadolibre/callback`).
4. **PKCE**: podés activarlo; el CRM ya manda `code_challenge` S256 siempre.
5. **Scopes**: lectura + **acceso offline** (`offline_access`). Sin
   offline_access Mercado Libre no entrega refresh token y la conexión se
   rechaza.
6. **Permisos funcionales**: los de lectura de publicaciones (ítems) y
   usuarios. No hace falta escritura, notificaciones ni tópicos.
7. Copiá el **App ID** y la **Clave secreta**.

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
