# 034 — Google Sheets por empresa: comprobantes a la planilla y planillas de consulta

**Estado**: en curso (8-oct-2026) · **Rama**: `034-google-sheets`

## Contexto

Los clientes de los negocios mandan comprobantes de transferencia por foto o
PDF (ya lo vimos en el corpus de Altos de Calamuchita). Hoy el agente los ve
como «un comprobante de transferencia bancaria» —020 prohíbe a propósito que
los datos bancarios entren al contexto— y el equipo tiene que abrir cada foto
y pasar el importe, el titular y el número de operación a mano a su planilla
de conciliación. Además, muchos negocios tienen información que cambia todas
las semanas (precios, stock, fechas de salida, cupos) en una planilla de
Google; cargarla en el conocimiento del agente queda viejo enseguida.

## Decisiones del dueño (8-oct-2026)

1. **Acceso mínimo `drive.file` + selector de Google**: Vocero solo ve las
   planillas que la empresa elige con el selector de Google (o las que crea
   Vocero). Sin verificación nueva del consent screen.
2. **El agente NO ve los datos del comprobante**: la lectura completa la hace
   el servidor y va directo a la planilla. El agente solo sabe «comprobante
   anotado» y confirma recepción. Se mantiene la defensa de origen de 020.
3. **Columnas = encabezados de la hoja + indicaciones de la KB**: la fila 1 de
   la hoja define las columnas; el conocimiento del agente dice cómo
   completarlas. Vocero ofrece crear la planilla con columnas sugeridas.

## Historias

### US1 — Conectar Google Sheets (propietario)
En Integraciones → Google Sheets el propietario conecta su cuenta de Google
(OAuth, permiso `drive.file`), ve la cuenta conectada y puede desconectar.
- AC1.1 Sin `GOOGLE_CLIENT_ID/SECRET` en la instancia, la tarjeta dice «No
  habilitada» y no ofrece conectar.
- AC1.2 Un miembro no ve la página (redirige a /inbox) y la API le da 403.
- AC1.3 Cancelar el consentimiento vuelve con un aviso, sin conexión a medias.
- AC1.4 Refresh rechazado (`invalid_grant`) → estado «Requiere reconexión»;
  nada se cuelga: los comprobantes quedan como fallidos con reintento y las
  planillas de consulta siguen sirviendo su última copia.
- AC1.5 Es una conexión SEPARADA de Google Calendar: desconectar una no toca
  la otra.

### US2 — Comprobantes de transferencia a la planilla
El propietario activa «Anotar comprobantes» y elige destino: crea una
planilla nueva con columnas sugeridas, o elige una existente con el selector
de Google (y la pestaña). Desde ahí, cada imagen o PDF que un cliente manda
por WhatsApp o Instagram y que resulta ser un comprobante se lee completo y
se agrega como fila.
- AC2.1 La fila sigue los encabezados de la fila 1. Recibido, Contacto,
  Teléfono y Conversación los completa el servidor (si existen esas
  columnas); el resto lo lee el modelo de visión siguiendo las indicaciones
  del conocimiento del agente. Columna desconocida o dato ilegible → vacío,
  jamás inventado.
- AC2.2 El agente NO recibe importe, titular, CBU ni número de operación: el
  aviso del adjunto dice «comprobante anotado en la planilla» (o «ya estaba
  anotado» / «no se pudo anotar, el equipo lo revisa») y el agente confirma
  recepción sin dar el pago por acreditado.
- AC2.3 Idempotente: el mismo mensaje nunca genera dos filas; el mismo
  comprobante reenviado (mismo número de operación e importe) queda como
  «repetido» sin fila nueva.
- AC2.4 Una imagen que no es un comprobante (foto de la cabaña) no genera
  fila ni registro.
- AC2.5 Fallo de Google (caída, permiso quitado, planilla borrada) → el
  registro queda «fallido» con el motivo; el propietario lo reintenta desde
  la página. Ningún fallo deja mudo al agente (regla de 020).
- AC2.6 Valores que empiezan con `=`, `+`, `-`, `@` (no numéricos) se
  escriben como texto: un titular «=IMPORTXML(…)» no ejecuta una fórmula.
- AC2.7 La página muestra los últimos comprobantes con estado, contacto,
  enlace a la conversación y a la fila.
- AC2.8 El Laboratorio (`is_test`) jamás toca Google.
- AC2.9 Funciona con el agente apagado o en atención humana: el registro es
  del negocio, no del agente.

### US3 — Planillas de consulta para el agente
El propietario agrega una o más planillas (selector de Google → pestaña →
«para qué sirve», p. ej. «precios por temporada»). El agente las consulta en
cada turno.
- AC3.1 Datos chicos van completos al contexto del agente como DATO (nunca
  instrucción), con la antigüedad de la copia. Los grandes van recortados y
  el agente busca el resto con `search_sheet`.
- AC3.2 La copia se refresca sola si tiene más de 5 minutos (con timeout
  corto); si Google falla, el agente usa la última copia y la página muestra
  el error. «Actualizar ahora» la refresca a mano.
- AC3.3 El turno nunca se cae por una planilla: sin copia, la sección no
  aparece. El Laboratorio usa la copia guardada, sin salir a la red.
- AC3.4 Se puede pausar, editar la descripción y quitar cada planilla.
- AC3.5 Límites: 2.000 filas × 30 columnas y 200 KB por copia; 16 KB en el
  contexto por turno entre todas.

## Fuera de alcance
- Escribir en planillas de consulta (solo lectura) y otros formatos (Excel).
- Conciliar contra el extracto bancario (lo hace el equipo con la planilla).
- Leer comprobantes que manda el equipo o que llegan por el historial (017).
