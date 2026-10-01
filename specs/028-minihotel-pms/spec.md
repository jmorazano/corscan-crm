# 028 — Conector MiniHotel (PMS hotelero) · Fase 1

**Estado**: en curso (1-oct-2026) · **Rama**: `028-minihotel-pms`
**Cliente**: Bosque Douglas (hotel), que opera con el PMS **MiniHotel**.
**Pedido del dueño (24/28-sep-2026)**: integrar el CRM con el PMS del cliente
según la propuesta de Fase 1 acordada (Google Doc «Propuesta Fase 1:
integración MiniHotel con el asistente de WhatsApp»). **1-oct-2026**: MiniHotel
respondió que primero hay que hacer las pruebas en su **sandbox** para
entregar las credenciales de producción.

## Contexto verificado (1-oct-2026)

- Documentación: índice en `https://minihotel.readme.io/llms.txt` (cada
  página tiene versión `.md`). Tres APIs: **ARI** (disponibilidad y tarifas,
  XML por POST), **Content & Data** (habitaciones y datos estáticos, XML por
  POST) y **Reverse** (escritura, fuera de alcance), más el **motor de
  reservas** por enlace.
- Endpoints:
  - ARI: sandbox `https://sandbox.minihotel.cloud/gds`, producción
    `https://api.minihotel.cloud/gds`. *Immediate ARI* = `<AvailRaterq>` con
    `DateRange`, `Guests` (adults/child/babies), `RoomTypes` (`*ALL*`) y
    `Prices rateCode` + `Price boardCode="*ALL*"`; devuelve por tipo de
    habitación `Inventory Allocation` y `price board/boardDesc/value/value_nrf`
    (`value` = **total de la estadía**, no por noche). *Bulk ARI* = el mismo
    pedido con `ResponseType="05"`: por día `Mavailability`, `Mprice`,
    `Minngt`, `Mclose`, `McloseArr`, `McloseDep` (máximo 2 años).
  - Content: sandbox `https://sandbox.minihotel.cloud/agents/ws/settings/rooms/RoomsMain.asmx/{getRoomTypes|getRooms}`,
    producción el mismo camino en `https://api2.minihotel.cloud`.
    `getRooms` trae por habitación el tipo, el máximo de adultos/niños/bebés
    (`rgm_gst_type` A/C/B + `rgm_max`), atributos (`rnm_attribute
    code/description`) e `is_mapped`.
  - Motor de reservas: `https://frame2.hotelpms.io/BookingFrameClient/hotel/{HotelID}/{InstanceID}/book/rooms`
    (Latam; `frame1` internacional; sandbox en `sandbox.minihotel.cloud`),
    con `from`/`to` (YYYYMMDD), `nAdults`, `nChilds`, `nBabies`, `roomType`,
    `currency`, `language`.
- **Probado contra el sandbox SIN credenciales** (1-oct-2026, nada que la doc
  diga): `/gds` exige `Content-Type: text/xml` (con form urlencoded responde
  500 de ASP.NET «potentially dangerous Request.Form»); los errores de ARI
  llegan como **texto plano** `ERR 863: Wrong User Code (Gds Central)` con
  HTTP 200 y `content-type: text/html`; la API de contenido responde
  `text/xml` con `<Errors><Error code="013" description="Invalid XML Request."/></Errors>`.
- Acceso: usuario + contraseña de API (dentro del XML) + código de hotel. Las
  credenciales de producción llegan después de validar en sandbox, y
  MiniHotel exige **IPs autorizadas** (`ERR A01`): las IPs estáticas de
  salida de Railway quedaron activadas el 28-sep-2026 (152.55.176.240,
  162.220.232.252, 152.55.177.181; en uso desde el próximo deploy).

## Decisiones del dueño

1. **Enmienda de la constitución APROBADA (1-oct-2026)**: la categoría 5 del
   Principio II pasa de «servidores MCP de terceros» a «sistemas de terceros
   POR EMPRESA vía MCP **o vía la API del proveedor**», con las mismas
   condiciones (a)–(j). Versión 1.8.1 → **1.9.0** (MINOR).
2. **Sandbox con las credenciales públicas de la documentación**, que el
   dueño carga desde la interfaz. Claude no ingresa contraseñas de servicios
   externos: la verificación automática corre contra un simulador local.
3. MiniHotel no pidió casos de prueba puntuales.
4. Alcance = **Fase 1 de la propuesta**, con dos agregados posteriores del
   dueño: fechas alternativas y comparación de rangos ENTRAN en la Fase 1; la
   capacidad y los atributos de las habitaciones salen de MiniHotel (las
   políticas y descripciones van a la base de conocimiento y el hotel las
   mantiene con el Entrenador).

## Historias de usuario

### US1 — Habilitar MiniHotel para una empresa (P1)
Como super admin habilito el conector MiniHotel para una empresa; como
propietario de esa empresa cargo las credenciales y verifico la conexión.

- **AC1.1** En Administración → empresa → conector, el super admin elige el
  perfil «MiniHotel (hotel)» y fija la dirección de la API ARI (sandbox,
  producción o, en modo pruebas internas, el simulador). La dirección de la
  API de contenido se deriva de esa (nadie más la escribe).
- **AC1.2** El super admin carga también el **código de hotel**, el **código
  de tarifa** (`rateCode`, define la moneda) y el **enlace del motor de
  reservas** del hotel. Esos son los únicos destinos y enlaces posibles.
- **AC1.3** El propietario carga **usuario y contraseña** de la API en
  Integraciones. Se guardan cifrados; la interfaz solo muestra que hay
  credencial y los últimos 4 caracteres de la contraseña.
- **AC1.4** «Verificar conexión» pide los tipos de habitación y las
  habitaciones a MiniHotel: si responde, queda **Conectado** y la tarjeta
  muestra tipos, capacidad y atributos. Si MiniHotel rechaza, el estado y el
  motivo son claros y propios (usuario o contraseña, código de hotel, IP no
  autorizada, servicio caído), nunca el texto crudo del proveedor.
- **AC1.5** El propietario decide si el asistente **informa precios** por
  WhatsApp y si **menciona la tarifa no reembolsable**.
- **AC1.6** El catálogo de habitaciones se refresca solo (TTL), sin esperas
  en el turno.

### US2 — Disponibilidad y tarifas reales (P1)
Como huésped que escribe por WhatsApp, recibo la disponibilidad y las
tarifas reales del hotel y un enlace para reservar con mi búsqueda cargada.

- **AC2.1** Ante una consulta por fechas, el asistente pide lo que falte
  (entrada, salida, adultos; niños y bebés si los menciona) y consulta
  MiniHotel en ese momento.
- **AC2.2** Responde con los tipos de habitación que MiniHotel informa
  disponibles para esa estadía, sin ofrecer un tipo cuya capacidad conocida
  no alcance para el grupo.
- **AC2.3** Si la empresa informa precios: el **total de la estadía** por
  régimen tal como lo devuelve MiniHotel (y la no reembolsable si la empresa
  lo eligió). Si no: ningún importe sale en el mensaje (guarda de precios).
- **AC2.4** Respeta lo que MiniHotel restringe (mínimo de noches, cierres): lo
  que no está disponible no se ofrece.
- **AC2.5** Envía **un** enlace al motor de reservas con fechas, huéspedes y,
  si corresponde, el tipo de habitación; jamás un enlace que no sea del
  motor configurado.
- **AC2.6** Nunca confirma ni promete una reserva: la reserva se completa en
  el motor.

### US3 — Fechas alternativas y comparación de rangos (P1)
- **AC3.1** Si no hay lugar en las fechas pedidas, el sistema busca por su
  cuenta hasta **3 alternativas** con la **misma cantidad de noches** dentro
  de los **7 días** anteriores o posteriores, respetando mínimo de noches y
  cierres, y confirma cada una con MiniHotel antes de ofrecerla (con su
  precio si la empresa informa precios).
- **AC3.2** Si tampoco hay alternativas, lo dice con claridad y ofrece hablar
  con una persona del equipo.
- **AC3.3** Si el huésped duda entre varios rangos, el asistente compara
  **hasta 3** en un mismo mensaje y responde la disponibilidad de cada uno.
- **AC3.4** Límites duros: nada a más de 7 días, nada con otra cantidad de
  noches, nada de más de 3 rangos por mensaje.

### US4 — Degradación, seguridad y Laboratorio (P1)
- **AC4.1** Si MiniHotel no responde, tarda, devuelve un error o algo
  ilegible, el asistente lo dice sin inventar, ofrece el motor de reservas o
  una persona, y el turno nunca se cae.
- **AC4.2** Las conversaciones del Laboratorio (`is_test`) jamás tocan
  MiniHotel: responden con datos de ejemplo y dejan su fila de evidencia.
- **AC4.3** Solo lectura: el conector solo puede invocar *Immediate ARI*,
  *Bulk ARI*, `getRoomTypes` y `getRooms`. Nada de reservas, pagos ni
  escritura.
- **AC4.4** Credenciales cifradas que jamás aparecen en la interfaz, en logs,
  en errores ni en la bitácora (el XML con la credencial no se registra).
  Validación anti-SSRF del destino en cada conexión, sin redirecciones.
- **AC4.5** Lo que devuelve MiniHotel (nombres de habitaciones, atributos)
  es DATO: se sanea y acota antes de llegar al modelo o a un cliente.

### US5 — Pruebas en el sandbox de MiniHotel (P1)
- **AC5.1** Guía corta (`docs/integraciones/minihotel.md`): cómo habilitar el
  sandbox, cargar las credenciales públicas, verificar y qué consultas correr
  para la validación de MiniHotel; y cómo pasar a producción (credenciales,
  IPs autorizadas, dirección de producción, enlace real del motor).
- **AC5.2** Cada consulta queda en la bitácora del conector (panel de
  Conectores del super admin) para mostrarle a MiniHotel qué se consultó.

## Fuera de alcance (Fase 1)

Crear, modificar o cancelar reservas; cobros o tarjetas; webhooks de
reservas y de ocupación; consultas sobre reservas existentes; más de una
tarifa o moneda; más de una propiedad por empresa; búsqueda por área; envío
de fotos; la API *Reverse*.

## Criterios de éxito

- **SC1** Gate técnico verde (tipos, lint, build, tests).
- **SC2** E2E de comportamiento verde contra el simulador local: habilitar,
  cargar credenciales, verificar, consultar disponibilidad con y sin precios,
  alternativas, comparación, sin alternativas, MiniHotel caído/credencial
  inválida/IP no autorizada, Laboratorio sin red.
- **SC3** Con las credenciales del sandbox cargadas por el dueño, una
  consulta real devuelve disponibilidad del hotel `sandbox` (verificación
  final, después de esta rama).
