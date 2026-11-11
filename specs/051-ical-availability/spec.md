# 051 — Disponibilidad por calendarios iCal (Airbnb)

**Estado**: implementada y verificada con mocks (11-nov-2026; falta la
prueba con los enlaces reales de Bosque Douglas en producción) — plan en
[plan.md](plan.md), tareas en [tasks.md](tasks.md) ·
**Migración**: 0038 · **Constitución**: 1.16.0 (categoría 7 de II) · **Pedido**:
Hernán (Altos de la Ciudad), 11-nov-2026, para su otro complejo **Bosque
Douglas**.

## Problema

El sistema propio de Bosque Douglas no expone ninguna API usable (la vía
MiniHotel de 028 quedó **descartada** por el dueño el 11-nov-2026). Pero el
complejo está conectado a un *channel manager* que sincroniza la
disponibilidad con Airbnb, y Hernán administra las publicaciones de Airbnb.
Cada publicación exporta su calendario como un enlace `.ics` (Airbnb →
Calendario → Disponibilidad → Conectar con otro sitio web → Paso 1).

Como el channel manager bloquea en Airbnb las noches vendidas por CUALQUIER
canal, el calendario exportado de Airbnb es un espejo de la ocupación real de
cada unidad. El agente puede responder «¿tienen lugar del 12 al 15 para 4?»
leyendo esos calendarios.

## Factibilidad (verificada el 11-nov-2026)

Se bajó un feed real (`airbnb.ae/calendar/ical/<listingId>.ics?t=<token>`):

- `GET` sin login, HTTP 200, `text/calendar`, `no-cache` (sin caché de CDN):
  lo que devuelve es el estado del momento.
- iCalendar estándar (RFC 5545), muy chico (315 bytes con un bloqueo):

  ```
  BEGIN:VEVENT
  DTSTART;VALUE=DATE:20261111
  DTEND;VALUE=DATE:20261118
  SUMMARY:Airbnb (Not available)
  UID:…@airbnb.com
  END:VEVENT
  ```

- `DTEND` es EXCLUSIVO = el día de salida (11 → 18 = noches 11 a 17), la
  misma convención que 028 (`to` = fecha de salida).

**Qué NO trae el feed** (límites que la feature respeta):

- Precios, mínimo de noches, anticipación, capacidad, nombre de la unidad.
- Distinción útil entre «reservado» y «bloqueado». Las reservas de Airbnb
  vienen como `Reserved` y pueden traer en `DESCRIPTION` la URL de la reserva
  y los últimos 4 dígitos del teléfono del huésped: **se descartan al
  parsear**, solo se guardan fechas.
- Es un espejo con demora: channel manager → Airbnb tarda minutos, y se suma
  el intervalo de lectura. Hay una ventana chica de doble venta: el agente
  informa disponibilidad, **jamás confirma una reserva** (guarda de promesas
  de 016, `src/lib/promise-guard.ts`).

**Desde producción también anda** (11-nov-2026, `railway ssh` al servicio
`app`, `fetch` de Node, sin redirecciones): 3 de 3 pedidos HTTP 200
`text/calendar` en 190–270 ms, con el User-Agent por defecto de Node, con
`VoceroCRM-CalendarSync/1.0` y con uno tipo navegador. Akamai no bloquea la
IP de datacenter. User-Agent definitivo: `VoceroCRM-CalendarSync/1.0`.

## Decisiones del dueño (11-nov-2026)

1. **MiniHotel descartado** para Bosque Douglas: esta es LA vía.
2. **Los enlaces los carga el PROPIETARIO desde Integraciones** (tarjeta
   propia en el índice, como Google Calendar y Mercado Libre), no el super
   admin. Consecuencia: NO va sobre el conector MCP de 016/028 (que habilita
   el super admin y en el que solo él fija la URL); es una integración propia
   por empresa. Se reutilizan sus piezas puras (alternativas, guarda de
   promesas, transporte protegido).
3. **Para reservar, el agente manda un enlace PROPIO del complejo**, nunca
   la publicación de Airbnb. Un enlace general por empresa y, opcional, uno
   por unidad. Puede llevar `{entrada}`, `{salida}` y `{huespedes}` si el
   sitio del complejo los acepta; si no, va tal cual.
4. **El agente nombra las unidades una por una** («Libres del 12 al 15 para
   4: Cabaña Abeto y Cabaña Pino»), con su capacidad y su descripción corta.

## Qué hace

1. **Unidades por empresa** (Integraciones → Calendarios de Airbnb, SOLO
   propietario): nombre visible, enlace `.ics`, capacidad máxima,
   descripción corta (≤ 300) y enlace propio opcional para reservar. Hasta
   50 unidades. Un enlace general de reservas para la empresa.
   - El enlace `.ics` es SECRETO (el `t=` es la llave): se guarda cifrado
     (AES-256-GCM, `lib/crypto`), nunca vuelve al navegador ni a los logs;
     la UI muestra solo la publicación y «…últimos 4» del token.
   - Validación al guardar: HTTPS, host de Airbnb (`airbnb.<tld>` y
     `www.airbnb.<tld>`, cualquier dominio de país), ruta
     `/calendar/ical/<id>.ics`. La allowlist de hosts es la defensa principal
     ahora que la URL la escribe el propietario y no el super admin; además
     el anti-SSRF sobre la IP resuelta de 016.
   - Al guardar se hace una lectura de prueba: si no es un calendario
     válido, no se guarda («Ese enlace no es el calendario de la
     publicación: copialo del Paso 1»).
2. **Lectura periódica**: un ticker in-process (como 023/042) baja cada feed
   cada 15 min, con plazo por pedido, tope de bytes (256 KB), sin
   redirecciones a otro host, un pedido a la vez por empresa y espaciado
   entre unidades (no ráfagas contra Airbnb). Lo parseado (solo rangos de
   noches ocupadas) va a un snapshot en la BD. Un feed caído conserva el
   último snapshot bueno con su antigüedad y no afecta a los demás.
3. **El turno del agente lee la BD, jamás la red** (como Mercado Libre en
   025): rápido, el Laboratorio aislado, un hipo de Airbnb no deja esperando
   al cliente. Una unidad con snapshot de más de 3 h se informa «sin
   confirmar» y no se ofrece; si todas están así, el agente deriva.
4. **Acción del agente** `check_stays` (familia propia en el loop de
   herramientas de `pipeline.ts`, 2 vueltas, como `search_listings` de 025):
   1–3 rangos (entrada/salida) + huéspedes → unidades libres que alcanzan la
   capacidad, por nombre, con el enlace propio. Sin lugar → hasta 3
   alternativas ±7 días con la misma cantidad de noches (reusar
   `src/lib/minihotel/alternatives.ts`, movido a un módulo compartido).
   Sin precios: importes, mínimos y políticas salen de la KB y del
   Entrenador. La etapa del lead avanza a interesados igual que con 044
   (`isConcreteAvailabilityQuery`).
5. **Prompt**: sección `DISPONIBILIDAD DE LAS UNIDADES` solo con la
   integración conectada: lista de unidades (nombre, capacidad,
   descripción), qué significa la consulta (disponibilidad del momento, no
   una reserva), y que para reservar se manda el enlace del complejo.
6. **Panel**: estado por unidad (última lectura OK, antigüedad, error en
   criollo: «Airbnb no respondió», «el enlace dejó de valer — se regeneró en
   Airbnb»), «Leer ahora», y una grilla de los próximos 30 días por unidad
   para que el dueño la compare contra su sistema.

## Encaje en el código

- **Puro** `src/lib/ical/`: `parse.ts` parser acotado de iCalendar (líneas
  plegadas, `VALUE=DATE` y `DATE-TIME` UTC/TZID, `DTEND` o `DURATION`,
  ignora el resto; tope de eventos; `RRULE` → feed no soportado), `nights.ts`
  normalización a noches ocupadas en la zona de la empresa y
  `freeUnits(range, guests)`, `airbnb-url.ts` validación del enlace y
  extracción del `listingId`, `booking-link.ts` reemplazo de
  `{entrada}/{salida}/{huespedes}`.
- **Transporte**: `getGuardedText` hermano de `postGuardedText` en
  `src/lib/mcp/transport.ts` (mismo socket protegido, mismo `agent: false`).
- **Servidor** `src/server/ical/`: `integration.ts` (unidades + enlaces
  cifrados), `sync.ts` (lectura + snapshot + ticker en `instrumentation.ts`),
  `agent-tools.ts` (puente con el agente; `is_test` lee el snapshot igual,
  nunca la red).
- **Tablas** (migración 0038): `ical_integration` (1 por empresa: switch
  del agente + enlace general de reservas) e `ical_unit` (nombre,
  capacidad, descripción, enlace propio, `ical_url_enc`, `listing_id`,
  orden y el snapshot: `busy_ranges` jsonb, `fetched_at`, `last_ok_at`,
  `last_error`, `content_hash`).
- **Rutas**: `/api/integrations/airbnb-calendars{,/[id],/sync}` (`withOwner`)
  + `/integrations/airbnb-calendars` (`requireOwnerPage`) + tarjeta en el
  índice.
- **Mock**: `src/app/api/dev/ical-mock/` (feeds por unidad + perillas
  `failNext`, `garbageNext`, `delayMs`, `forbidden`, `setBusy`); en modo
  pruebas la allowlist acepta el host del mock.

## Constitución

Un feed iCal no entraba en ninguna categoría de II: la 3 es OAuth y la 5
exige que el super admin habilite y fije la URL. Enmienda MINOR 1.16.0
(aprobada el 11-nov-2026): nueva categoría 7 «calendarios iCal exportados por un proveedor de
alquileres, solo lectura, por empresa» con: la carga el propietario; hosts
en allowlist por proveedor (hoy solo Airbnb); URL cifrada como credencial;
anti-SSRF sobre la IP resuelta; sin redirecciones a otro host; topes de
tamaño y frecuencia; lo que devuelve es DATO (solo fechas; el texto del
evento se descarta); el sandbox no sale a la red.

## Fuera de alcance (v1)

Escribir en Airbnb o en el channel manager (el «Paso 2» de la pantalla de
Airbnb no se usa). Precios, mínimos por fecha, reservas existentes de un
huésped, Booking/Vrbo (el parser es genérico; ampliar la allowlist es otra
decisión).

## Verificación

Unitarios del parser con feeds reales anonimizados (bloqueo, reserva con
`DESCRIPTION`, vacío, plegado, basura), de `freeUnits`/alternativas y de la
validación de enlaces. E2E con ical-mock: alta de unidades (enlace bueno,
host ajeno, no-calendario), lectura, consulta del agente con lugar / sin
lugar → alternativas / feed caído / snapshot viejo → derivación, miembro sin
acceso, sandbox sin red. Antes de cerrar: los enlaces reales de Bosque
Douglas desde producción.
