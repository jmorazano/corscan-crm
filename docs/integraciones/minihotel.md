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

Una empresa tiene **un** conector (una fila): habilitar MiniHotel en una
empresa que ya tenía otro conector (p. ej. un MCP) lo **reemplaza**. Cada hotel
va en su propia empresa, con su propio WhatsApp.

## 2. Cargar las credenciales del sandbox (propietario de la empresa)

Integraciones → el conector → **Usuario** y **Contraseña** de la API. Las del
sandbox las publica MiniHotel en su documentación, en la página
**Preface & Authentication** de la API ARI
(<https://minihotel.readme.io/reference/ari-api>).

Tocar **Conectar**: guarda las credenciales cifradas y verifica en el mismo
gesto, en dos pasos: pide las habitaciones del hotel (API de contenido) y hace
una consulta de prueba de una noche a 30 días (API ARI) que valida la
**tarifa**. Tiene que quedar **Conectada**, mostrar la lista de habitaciones
con su capacidad y, al lado de la tarifa, **en qué moneda cotiza** según
MiniHotel.

### Código de hotel y tarifa (los cambia la empresa)

Integraciones → **Cambiar hotel o tarifa** → **Guardar y verificar**. El
super admin carga los valores iniciales al habilitar; después los ajusta el
propietario. La tarifa define la moneda: para cotizar en pesos va el código
de la tarifa en pesos que tenga el hotel en MiniHotel (los códigos son propios
de cada hotel: «ARS», «Standard», «Hotdeal»…; MiniHotel no publica una lista,
los ve el hotel en su configuración). Cambiar de hotel borra el catálogo del
anterior y obliga a verificar de nuevo; la credencial no se toca.

## 3. Pruebas para la validación de MiniHotel

Cada consulta queda registrada en Administración → **Conectores MCP** → la
empresa → últimas llamadas (es la evidencia para mostrarle a MiniHotel).

Desde **Probar una consulta** (Integraciones):

1. **Disponibilidad simple**: 2 adultos, 2 noches, dentro de los próximos 30 a
   60 días → habitaciones con el total por régimen y el enlace al motor.
2. **Con chicos**: 2 adultos + 1 niño (y 1 bebé).
3. **Una noche**: confirma que la fecha de salida se interpreta como salida
   (el total tiene que ser el de UNA noche). *Verificado en el sandbox real el
   1-oct-2026: 10→11 = 490 contra 10→12 = 980.*
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
hay lugar, un *Bulk* y hasta 3 *Immediate* más para las alternativas), el
catálogo de habitaciones cada 60 minutos y, al verificar, el catálogo más una
consulta de prueba.

**Para preguntarle a MiniHotel** (visto en el sandbox real): con
`rateCode="ARS"` el sandbox devuelve otra lista de precios (doble, 2 noches:
40.580 contra 980 con `USD`) pero informa `Currency="USD"` en las dos: ¿el
atributo `Currency` de la respuesta es la moneda de la tarifa o la del hotel?
De eso depende la moneda con la que el asistente escribe los importes.

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
| «…no reconoce el código de hotel» | Código de hotel mal cargado | Corregirlo en «Cambiar hotel o tarifa» |
| «…no reconoce el código de tarifa» | Tarifa mal cargada (o borrada en MiniHotel) | Corregirla en «Cambiar hotel o tarifa» |
| «cotiza en dólares» con una tarifa que debería ser en pesos | La tarifa está en dólares en MiniHotel (o ver la pregunta de arriba) | Confirmar con el hotel cuál es el código de la tarifa en pesos |
| «El servidor no respondió a tiempo» al verificar | MiniHotel lento (en el sandbox, de 0,3 s a más de 10 s) | Reintentar; si es habitual, el super admin sube el plazo del conector |
| El agente dice que el sistema no responde | MiniHotel caído o lento | Nada: el agente ofrece el motor de reservas o una persona, y vuelve solo |
| Habitaciones sin capacidad en la tarjeta | El hotel no cargó la ocupación máxima por tipo en MiniHotel | Pedirle al hotel que la cargue: sin eso decide MiniHotel y el asistente no filtra por tamaño del grupo |

## Pruebas locales (sin MiniHotel)

Con `WA_MOCK_ENABLED=true`, el simulador vive en
`http://localhost:3000/api/dev/minihotel-mock/gds` (hotel `sandbox`, tarifa
`USD`, cualquier usuario y contraseña no vacíos). Perillas en
`/api/dev/minihotel-mock/state`: `soldOut` (`{from,to}` sin lugar),
`ipNotAuthorized`, `nextUnauthorized`, `failNext`, `garbageNext`, `delayMs`.
Guion E2E: `tests/e2e/028-minihotel-pms.md`.
