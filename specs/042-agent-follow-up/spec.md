# 042 — Seguimiento automático del agente (dos recordatorios dentro de la ventana de 24 h)

Pedido de Altos de Calamuchita (Hernán Colocini, 24-oct-2026, documento
«Seguimiento automático de conversaciones»), revisado con el dueño el
28-oct-2026. Cuando un cliente escribe (por ejemplo desde un anuncio),
Giuliana responde y el cliente deja de contestar, el CRM manda **como máximo
dos seguimientos** para reactivar la charla, **solo cuando corresponde** y
siempre **dentro de la ventana de 24 h** de WhatsApp (texto libre, sin
plantilla).

## Reglas de Meta (verificadas el 26/28-oct-2026)

- WhatsApp permite texto libre, también automático y también comercial,
  dentro de las 24 h desde el **último mensaje del cliente**. Desde jul-2025
  esos mensajes no se cobran. Los dos seguimientos caen siempre ahí.
- Pasadas las 24 h solo van plantillas aprobadas (fuera de alcance; cuando se
  haga, por la vía de marketing de la 037).
- Meta exige respetar los pedidos de baja: quien pidió que no le escriban no
  recibe nada iniciado por la empresa.
- Riesgo a cuidar: bloqueos y reportes bajan la calidad del número. Por eso:
  tope de dos, horario permitido, nunca a quien pidió que no le escriban.

## Decisión de diseño: sin estados nuevos (dueño, 28-oct-2026)

El documento proponía un estado propio por conversación (Abierta / Cerrada /
No contactar). **No se crea**: se reutiliza lo que el CRM ya tiene.

| Documento del cliente | Qué se usa en el CRM | Seguimientos | Campañas |
|---|---|---|---|
| **Cerrada** (reservó) | Lead en una etapa `won` del pipeline (el agente ya mueve etapas con `move_stage`) | No | Sí |
| **Cerrada** (no quiere / se perdió) | Lead en una etapa `lost` del pipeline | No | Sí (como hoy) |
| **No contactar** | La **baja del contacto** de la 004/011 (`contact.opted_out_at`): ya excluye de todo envío iniciado por la empresa y muestra «Dado de baja» | No | No |
| **Abierta** | Lead en una etapa `open` **y** el último mensaje de Giuliana quedó **marcado «espera respuesta»** | Sí | Sí |
| «Sin estado» = no se manda | Mensaje de Giuliana **sin la marca** = no se manda | No | — |

Lo único que el pipeline no puede expresar es «después de ESTE mensaje estoy
esperando que el cliente conteste»: cambia en cada turno y el pipeline
describe la etapa comercial del contacto (un lead por contacto, que el equipo
también mueve a mano). Mover tarjetas en cada respuesta ensuciaría el
pipeline. Esa señal va **en el propio mensaje saliente** del agente
(`message.details`), no como estado de la conversación: si el cliente
contesta, el siguiente mensaje del agente trae su propia marca, así que no
hay que sincronizar ni limpiar nada.

## Objetivos

1. **Marca por respuesta**: en cada respuesta, Giuliana indica si quedó
   esperando una respuesta del cliente (pidió fechas, pasó precio o
   disponibilidad, hizo una pregunta). Sin marca, no hay seguimiento.
2. **La baja la puede declarar el agente**: si el cliente pide claramente que
   no le escriban o dice que no le interesa, el agente lo da de baja por el
   mismo camino que «BAJA»/«STOP» (011). La reversión sigue siendo manual y
   queda auditada.
3. **Dos seguimientos con tiempos y horario**, revisados por una tarea
   periódica en el proceso (como los otros tickers del CRM: sin colas
   externas), registrados como mensajes de Giuliana.
4. **Filtro de seguridad** sobre el último mensaje del cliente: frena los
   seguimientos del ciclo ante expresiones de rechazo, **sin** dar de baja.
5. **Registro** de cada seguimiento enviado u omitido, con motivo, visible en
   el hilo y exportable.
6. **Interruptor por empresa**, apagado por defecto. Solo WhatsApp en esta
   versión (Instagram queda preparado: misma regla de 24 h, sin «Human
   Agent»).

## Cuándo sale un seguimiento (todas las condiciones)

1. La conversación es de WhatsApp, real (no `is_test`, no Entrenador) y el
   cliente escribió primero en el ciclo (no aplica a quien solo recibió una
   campaña y nunca contestó).
2. El interruptor de la empresa está encendido y el agente está encendido en
   esa conversación (sin atención humana pendiente).
3. El contacto no está dado de baja y el lead no está en una etapa `won` ni
   `lost`.
4. El **último mensaje de la conversación es de Giuliana** y está marcado
   «espera respuesta» (los seguimientos cuentan como mensajes de Giuliana pero
   no reemplazan la marca original del ciclo).
5. **Nadie del equipo** escribió después del último mensaje del cliente
   (misma detección que 031/036: envío desde el CRM con usuario, o eco desde el
   celular en coexistencia; las difusiones de 036 cuentan como equipo para
   esto: si el equipo le mandó algo, el CRM no se mete).
6. Sigue abierta la ventana de 24 h desde el último mensaje del cliente.
7. Es horario permitido en la zona horaria de la empresa (por defecto 09:00 a
   21:00, America/Argentina/Cordoba).
8. Ese seguimiento no salió todavía en este ciclo y el filtro de seguridad no
   se activó.

| | Cuándo |
|---|---|
| **Seguimiento 1** | ≥ 2 h desde el último mensaje de Giuliana. Si cae fuera de horario, a la apertura siguiente, siempre que siga la ventana. |
| **Seguimiento 2** | ≥ 20 h desde el último mensaje del cliente y ≥ 3 h después del 1, dentro de la ventana y en horario. Si no hay horario permitido dentro de la ventana, se omite. |

Un **ciclo** empieza con cada mensaje nuevo del cliente. Si el cliente
contesta, lo pendiente se cancela; si Giuliana vuelve a marcar «espera
respuesta» y el cliente se calla, arranca un ciclo nuevo.

## Textos

- Por defecto, los dos textos del documento, con el primer nombre del perfil
  si parece un nombre de persona (si no, «¡Hola!»). El nombre que cargó el
  equipo tiene prioridad (021).
- El texto lo escribe Giuliana según la charla; el fijo es solo respaldo
  (ver Decisiones): el seguimiento 1 fijo («decime para qué fechas estás
  mirando») no encaja cuando Giuliana ya cotizó.

## Filtro de seguridad

Lista del documento («no me interesa», «no me escribas», «basta», «stop»,
«baja», «spam»…), sin mayúsculas ni tildes, por **palabra completa** («me
gusta bastante» o «¿baja el precio?» no lo disparan). Si se activa: no sale
ningún seguimiento de ese ciclo y queda el motivo en el registro. **No da de
baja** ni saca de campañas (eso lo decide el agente o la palabra exacta de
011); un error del filtro solo cuesta un seguimiento.

## Criterios de aceptación (casos del documento)

- **AC1** Cliente escribe, Giuliana pide fechas (marca «espera respuesta»), el
  cliente no contesta → seguimiento 1 a las 2 h y seguimiento 2 a las 20 h.
- **AC2** Cliente reserva, Giuliana agradece y el lead pasa a `won` → nada.
- **AC3** «No me interesa, no me escribas más» → el agente da de baja: nada de
  seguimientos y fuera de campañas; «Dado de baja» en la Bandeja.
- **AC4** Giuliana pasó precio y el cliente respondió «lo pienso» → 1 y 2.
- **AC5** El cliente contesta después del 1 → el 2 no sale.
- **AC6** Una persona del equipo respondió → nada.
- **AC7** El 1 vence a las 23:30 → sale a las 09:00 si sigue la ventana.
- **AC8** El 2 caería a las 02:00 y no hay horario dentro de la ventana → se
  omite con motivo.
- **AC9** Mensaje de Giuliana sin marca → nada; cuenta en «sin marca».
- **AC10** Último mensaje del cliente «basta, stop» sin que Giuliana marque
  baja → el filtro frena el ciclo; el contacto NO queda dado de baja.
- **AC11** Pasaron más de 24 h → nunca sale texto libre.
- **AC12** Interruptor apagado → nada.
- **AC13** Un reinicio del servidor no duplica ni pierde seguimientos: lo que
  venció mientras estaba caído sale una sola vez si todavía cumple todo
  (reserva antes de enviar, como el runner de campañas).
- **AC14** Un fallo de Meta al enviar usa el reintento de 036; si igual
  falla, queda la línea de error y no se reintenta en otro ciclo.

## Registro

Cada seguimiento enviado u omitido deja una línea en el hilo
(`conversation_event`) con tipo (1/2), texto o motivo de omisión (no espera
respuesta, etapa, baja, equipo, filtro, fuera de horario, ventana, apagado), y
si el cliente contestó después. Exportable a CSV desde la configuración, con
el conteo de respuestas del agente **sin marca** para detectar si Giuliana se
olvida de marcar.

## Fuera de alcance

- Plantillas para después de las 24 h.
- Instagram (preparado, no activado).
- Envío masivo manual filtrado por anuncio (lo hablado para Instagram): es
  otra feature.

## Decisiones (dueño, 28-oct-2026)

1. **Texto de los seguimientos**: los escribe Giuliana con el contexto de la
   charla (un turno propio del agente, con tope de largo y las guardas de
   siempre: privacidad, precios, promesas, sin repetir el último saliente). Si
   el proveedor falla o devuelve algo fuera de contrato, sale el **texto fijo
   del documento** como respaldo. El agente también puede decidir no mandar
   nada (`none`): se registra como omitido con su motivo.
2. **Baja declarada por el agente**: bloquea todo lo que inicia la empresa
   (seguimientos y campañas), pero si el cliente vuelve a escribir, el agente
   **responde**: fue el cliente quien escribió. La baja por palabra exacta
   («BAJA»/«STOP», 011) mantiene su comportamiento actual (agente mudo).
