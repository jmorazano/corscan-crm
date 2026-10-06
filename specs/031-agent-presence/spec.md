# 031 — El agente a la vista: motivos en el hilo, sin promesas vacías y de vuelta cuando el equipo se va

Pedido del dueño (6-oct-2026), a partir de dos casos reales de «Altos de
Calamuchita»:

- **Agustina**: el agente dijo «Busco opciones disponibles…» y no volvió a
  hablar. Diagnóstico: eligió `update_lead` (nota + texto), que es terminal;
  nunca consultó el sistema de reservas. No hubo error, y nada en el CRM lo
  explicaba.
- **Guillermo**: el equipo tomó el chat, la IA quedó pausada y cuando el
  cliente mandó el comprobante al día siguiente nadie contestó. La pausa y la
  «Atención humana» no vencen nunca.

## Objetivos

1. **Ver por qué el agente no respondió**, en el propio hilo, y **quién prendió
   o apagó la IA**.
2. **Que el agente no prometa buscar sin buscar.**
3. **Equipo presente (opción C del dueño)**: si alguien del equipo escribe en
   el chat, el agente se calla; pasados N minutos (10 por defecto,
   configurable por empresa) sin que el equipo escriba, si el cliente escribe
   el agente vuelve a responder. Aclaración del dueño (6-oct-2026): el
   **switch apagado** es fijo (lo prende una persona) y la **atención
   humana** espera a que una persona del equipo responda; desde ahí corre la
   misma regla y después la IA vuelve sola.
4. **Enlaces clicables en el hilo**: los `http(s)://` y `www.` de cualquier
   mensaje se ven y se abren como enlaces.

## Historias y criterios

### US1 — Registro en el hilo

- AC1.1 El hilo muestra, intercaladas por hora con los mensajes, **líneas de
  evento** grises y centradas (no burbujas). No cuentan como no leídos, no
  aparecen como último mensaje de la lista, no entran a métricas ni al
  contexto del agente.
- AC1.2 Al prender o apagar la IA de un chat (interruptor, hoja «Más» de la
  fila o «Reactivar IA») queda: «{Nombre} pausó la IA en este chat» /
  «{Nombre} activó la IA en este chat» / «{Nombre} reactivó la IA (salió de
  atención humana)».
- AC1.3 Cuando entra un mensaje del cliente y el agente NO responde, queda el
  motivo:
  - el equipo está atendiendo (alguien escribió hace < N min) — con la hora
    desde la que vuelve;
  - la IA está pausada en este chat — con la hora desde la que vuelve;
  - la conversación está en atención humana — ídem;
  - decidió que el mensaje no necesitaba respuesta (con el motivo breve que da
    el modelo, si lo da);
  - acuse de una notificación automática (014);
  - conocido del celular con «número personal» (025);
  - contacto dado de baja (011);
  - otra app maneja el chat de Instagram (030);
  - iba a repetir su último mensaje y no lo mandó (011).
- AC1.4 Cuando el agente pasa a atención humana queda el motivo (pidió una
  persona / decidió derivar / ventana cerrada / pidió visita / error del
  proveedor) y, si fue un error, **qué error** en lenguaje claro:
  OpenRouter sin crédito (402), token inválido (401/403), límite de pedidos
  (429), modelo inexistente (404), no respondió (5xx/tiempo), respuesta
  ilegible.
- AC1.5 Si la consulta al sistema de reservas (MCP) falla por transporte
  (tiempo agotado, credencial rechazada, límite, conexión) queda «El sistema
  de reservas no respondió: …», aunque el agente haya contestado igual.
- AC1.6 Si la respuesta del agente no sale (Meta caído o error de envío) queda
  «La respuesta de la IA no salió: …» con el texto que iba a mandar
  (desplegable), para que el equipo lo pueda copiar.
- AC1.7 Un error inesperado del turno deja «La IA tuvo un error inesperado y
  no respondió».
- AC1.8 Silencios consecutivos con el mismo motivo no se repiten: una línea
  por tramo (hasta que la IA vuelva a hablar o cambie el motivo).
- AC1.9 Sin eventos cuando la empresa no tiene IA configurada o el agente
  está apagado en la página Agente (no es «no respondió», es «no hay agente»),
  ni en el Laboratorio, ni en el Entrenador.
- AC1.10 Las líneas llegan en vivo (SSE) y se recuperan al reabrir el hilo.

### US2 — Sin promesas vacías

- AC2.1 Las acciones-herramienta (`search_stays`, `show_stay`,
  `check_availability`, `search_listings`, `show_listing`) aceptan
  `lead_note`: la nota del lead se guarda y la consulta corre en el mismo
  turno.
- AC2.2 Si la respuesta final anuncia una consulta futura («busco…»,
  «consulto…», «me fijo…», «te confirmo en un rato»), sin enlaces, con
  herramientas disponibles y sin haber consultado nada en el turno: no se
  manda; la nota (si la había) se guarda y se le pide al modelo UNA vez que
  consulte ahora o responda sin prometer.
- AC2.3 Si insiste en prometer, se manda y la conversación pasa a atención
  humana («avisó que iba a consultar y no lo hizo») con aviso push.
- AC2.4 El prompt prohíbe anunciar búsquedas: no existe «después».

### US3 — Equipo presente y vuelta automática

- AC3.1 Mensaje del equipo = saliente, no generado por la IA, y enviado por
  una persona: desde el CRM (queda quién: `message.sent_by_user_id`) o desde
  el celular/la app (`source` `phone`/`history`, ecos de WhatsApp e
  Instagram). Campañas, API pública, seguimientos automáticos de Instagram y
  el Entrenador NO son el equipo.
- AC3.2 Ventana del equipo por empresa: `agent_profile.team_silence_ms`
  (vacío = 10 min; 1–1440 min). Tarjeta «Cuando alguien del equipo
  interviene» en la página Agente (solo propietario).
- AC3.3 Turno del agente:
  - switch apagado → no responde nunca («Vuelve cuando alguien la prenda»);
  - atención humana sin un mensaje del equipo POSTERIOR a la derivación →
    no responde («Vuelve sola N min después de que alguien del equipo
    responda»), aunque pasen horas;
  - el equipo escribió hace menos de N min (con o sin atención humana) → no
    responde, con la hora de vuelta;
  - si no → responde; si venía de una atención humana ya atendida, se limpia
    sola con la línea «La IA retomó la conversación: pasaron N min sin que el
    equipo escriba».
- AC3.4 La vuelta ocurre SOLO cuando el cliente escribe: el agente no
  contesta mensajes viejos al vencer la ventana.
- AC3.5 Al retomar después de una intervención, el prompt aclara que esos
  mensajes los escribió el equipo: no se vuelve a presentar, no contradice lo
  acordado (precios, reservas, pagos).
- AC3.6 Comprobantes de pago: manda lo que diga el conocimiento del negocio
  (Altos ya tiene su respuesta); si no dice nada, agradece y dice que el
  equipo lo verifica y confirma. Nunca da un pago por acreditado ni confirma
  una reserva. Sin derivar: el push de cada entrante ya avisa al equipo.
- AC3.7 El panel dice qué falta para que vuelva: «El equipo está atendiendo ·
  vuelve a responder si el cliente escribe desde las HH:MM»; en atención
  humana sin respuesta, «La IA vuelve sola N min después de que alguien del
  equipo responda»; con el switch apagado, «En pausa · no responde hasta que
  la prendas».
- AC3.8 Las pausas y atenciones humanas que ya existen al deployar siguen
  las reglas nuevas tal cual (el switch sigue apagado; la atención humana
  vuelve solo si hay un mensaje del equipo posterior y vencido).

### US4 — Enlaces clicables

- AC4.1 Texto, epígrafes, historias/comentarios y «lo que iba a decir» la IA
  muestran sus enlaces subrayados y clicables (nueva pestaña,
  `noopener noreferrer nofollow`). Solo `http(s)://` y `www.` (este último
  como https); la puntuación final no entra al enlace.

## Fuera de alcance

- Responder sin un mensaje nuevo del cliente al vencer la ventana.
- Distinguir los mensajes automáticos de la app WhatsApp Business del celular
  (bienvenida/ausencia): llegan como ecos y cuentan como equipo — se avisa al
  dueño.
- Mostrar el autor en cada burbuja (queda el dato para más adelante).
