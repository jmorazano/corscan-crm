# MiniHotel (PMS hotelero) — conectar, probar en el sandbox y pasar a producción

El conector MiniHotel deja que el asistente de WhatsApp de un hotel responda
con la **disponibilidad y las tarifas reales** del PMS, busque **fechas
alternativas** si no hay lugar, **compare rangos** y mande el **enlace al
motor de reservas** con la búsqueda cargada. Es de **solo lectura**: no crea,
modifica ni cancela reservas, ni toca pagos.

Usa cuatro operaciones de MiniHotel: *Immediate ARI* y *Bulk ARI* (API ARI) y
`getRoomTypes` / `getRooms` (API de contenido). Nada más.

---

## 1. Habilitar el sandbox (super admin)

Administración → Empresas → la empresa del hotel → **Conector** →
«Habilitar conector»:

| Campo | Valor para el sandbox |
|---|---|
| Perfil del proveedor | **MiniHotel (hotel)** |
| Dirección de la API | botón **Sandbox (pruebas)** → `https://sandbox.minihotel.cloud/gds` |
| Código de hotel | `sandbox` |
| Código de tarifa | `USD` |
| Enlace del motor de reservas | `https://sandbox.minihotel.cloud/BookingFrameClient/hotel/B263C4CD7A30D45315E78416F6F4F942/153f2c6a-a062-4c7b-97d7-c6bb89533ae6/book/rooms` |

Guardar. La tarjeta aparece en **Integraciones** de esa empresa (y en ninguna
otra). La dirección de la API de contenido no se carga: se deriva sola.

## 2. Cargar las credenciales del sandbox (propietario de la empresa)

Integraciones → el conector → **Usuario** y **Contraseña** de la API. Las del
sandbox las publica MiniHotel en su documentación, en la página
**Preface & Authentication** de la API ARI
(<https://minihotel.readme.io/reference/ari-api>).

Tocar **Conectar**: guarda las credenciales cifradas y verifica en el mismo
gesto pidiendo las habitaciones del hotel. Tiene que quedar **Conectada** y
mostrar la lista de habitaciones con su capacidad.

## 3. Pruebas para la validación de MiniHotel

Cada consulta queda registrada en Administración → **Conectores MCP** → la
empresa → últimas llamadas (es la evidencia para mostrarle a MiniHotel).

Desde **Probar una consulta** (Integraciones):

1. **Disponibilidad simple**: 2 adultos, 2 noches, dentro de los próximos 30 a
   60 días → habitaciones con el total por régimen y el enlace al motor.
2. **Con chicos**: 2 adultos + 1 niño (y 1 bebé).
3. **Una noche**: confirma que la fecha de salida se interpreta como salida
   (el total tiene que ser el de UNA noche). *Verificación pendiente del
   sandbox real.*
4. **Grupo grande**: 5 adultos → lo que no alcanza aparece marcado «No
   alcanza para el grupo».
5. **Fecha pasada**: la consulta se rechaza con un texto propio, sin llamar al
   hotel.

Por WhatsApp (con el agente encendido en la empresa de prueba):
«¿tienen lugar del 10 al 12 de noviembre para 2 adultos?», «¿y del 17 al 19
o del 24 al 26?», «¿cuánto sale?», «reservámela vos» (el agente NO promete:
manda el enlace).

**Qué contarle a MiniHotel**: integración de solo lectura (Immediate ARI,
Bulk ARI, getRoomTypes, getRooms), sin reservas ni pagos. Frecuencia: una
consulta *Immediate* por pregunta de huésped (hasta 3 si compara rangos; si no
hay lugar, un *Bulk* y hasta 3 *Immediate* más para las alternativas) y el
catálogo de habitaciones cada 60 minutos.

## 4. Pasar a producción

1. MiniHotel entrega las **credenciales de producción** y **autoriza las IPs**
   del servidor. En Railway (servicio `app`): `152.55.176.240`,
   `162.220.232.252`, `152.55.177.181`. Se usan desde el primer deploy
   posterior al 28-sep-2026.
2. Super admin → **Editar** el conector: botón **Producción**
   (`https://api.minihotel.cloud/gds`), el **código de hotel real**, la
   **tarifa real** y el **enlace real del motor** (`https://frame2.hotelpms.io/BookingFrameClient/hotel/…/book/rooms`
   para Latinoamérica). Cambiar la dirección **borra la credencial** a
   propósito: hay que volver a cargarla.
3. Propietario → carga usuario y contraseña de producción → **Conectar**.
4. Propietario → **Agente**: decidir si el asistente informa precios por
   WhatsApp y si menciona la tarifa no reembolsable.

## Si algo falla

| Lo que se ve | Qué es | Qué hacer |
|---|---|---|
| «Requiere reconexión» · «…rechazó el usuario o la contraseña» | Credencial inválida | Volver a cargarla |
| «…todavía no autorizó la IP de este servidor» | MiniHotel no habilitó las IPs | Pedirle que agregue las IPs del servidor |
| «…no reconoce el código de hotel» | Código de hotel mal cargado | Super admin corrige el código |
| «…no reconoce el código de tarifa» | Tarifa mal cargada | Super admin corrige la tarifa |
| El agente dice que el sistema no responde | MiniHotel caído o lento | Nada: el agente ofrece el motor de reservas o una persona, y vuelve solo |

## Pruebas locales (sin MiniHotel)

Con `WA_MOCK_ENABLED=true`, el simulador vive en
`http://localhost:3000/api/dev/minihotel-mock/gds` (hotel `sandbox`, tarifa
`USD`, cualquier usuario y contraseña no vacíos). Perillas en
`/api/dev/minihotel-mock/state`: `soldOut` (`{from,to}` sin lugar),
`ipNotAuthorized`, `nextUnauthorized`, `failNext`, `garbageNext`, `delayMs`.
Guion E2E: `tests/e2e/028-minihotel-pms.md`.
