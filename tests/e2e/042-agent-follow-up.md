# E2E 042 — Seguimiento automático del agente

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock), BD local `vocero` con la migración 0031, org «Negocio de Super
Admin Local» (`org_m9651yzzrnaw62lwo4lm`) con el agente encendido y espera
1 s. Entrantes por `/api/dev/wa-mock/inbound`; el reloj del barrido se
adelanta con `POST /api/dev/follow-up {"now": "<ISO>"}` (el envío real sigue
validando la ventana con la hora del servidor). Conducido por un script Node
(`fetch` + `postgres`) que restaura el perfil al terminar.

Perillas del ai-mock: con la sección `SEGUIMIENTO AUTOMÁTICO:` del prompt
cada respuesta sale con `awaiting_reply: true`; «[E2E_CIERRE]» → `false`;
«[E2E_SIN_MARCA]» → sin marca; «[E2E_NO_INTERESA]» → despedida + `opt_out`.
En el turno `[SEGUIMIENTO]`: «[E2E_SEG_NADA]» → `none`; «[E2E_SEG_ROTO]» →
JSON inválido; «[E2E_SEG_PRECIO]» → el texto trae un importe.

## Casos

- **Interruptor**: `PUT /api/agent/follow-up {enabled:true}` (propietario).
- **A (AC1/AC4/AC13)**: «Hola… Lo pienso» con perfil «juan pérez» → la
  respuesta queda con `details.awaitingReply = true`. Barrido a +1 h: nada.
  A +2 h 3 min: sale «¡Hola, Juan! … (recordatorio 1 de la IA)» como
  mensaje de la IA con `details.followUp.step = 1`. Dos barridos en paralelo
  no lo duplican. A +20 h 5 min sale el 2; a +22 h nada más. Registro: 2
  `sent` con `source = agent`.
- **B (AC5)**: tras el 1 el cliente contesta «Gracias, después te escribo
  [E2E_CIERRE]» → respuesta con `awaitingReply = false`, el 1 queda con
  `replied_at`, el 2 no sale y el ciclo nuevo se registra `not_awaiting`.
- **C (AC2)**: lead movido a una etapa `won` → `stage_closed`, nada sale.
- **D (AC3 + decisión 2)**: «[E2E_NO_INTERESA] no me interesa, gracias» →
  despedida, `contact.opted_out_source = agent`, línea «La IA dio de baja al
  contacto…», lead en `lost`, ningún seguimiento. Si el cliente vuelve a
  escribir, el agente RESPONDE. Con la palabra exacta «BAJA» (011) el agente
  sigue mudo.
- **E (AC6)**: una persona responde desde el CRM → `team`, nada sale.
- **F (AC9)**: «[E2E_SIN_MARCA]» → respuesta sin marca → `unmarked`.
- **G (AC10)**: «basta, stop» → el filtro frena (línea «No se mandan
  seguimientos en esta charla… (filtro de seguridad)») y el contacto NO queda
  dado de baja.
- **H (AC11)**: a +24 h la conversación ni entra al barrido; a +23 h 55 min
  (sin margen antes del cierre) → `no_slot`.
- **I (AC7)**: mensajes corridos al día anterior 21:29/21:30 → a las 08:59
  no sale; a las 09:01 sale el 1.
- **J (respaldos)**: JSON roto con perfil «🌸🌸» → texto de respaldo con
  «¡Hola!» y `source = fallback`; importe en el texto → respaldo sin `$`;
  `none` del modelo → omitido con línea «La IA decidió no mandar…».
- **K (AC14)**: `failSends: 3` → `failed` + línea «El seguimiento 1 no salió:
  Meta no está disponible ahora»; sin reintento ni 2.
- **L (AC12)**: interruptor apagado → la respuesta del agente no lleva marca
  (prompt intacto) y no hay registro ni seguimiento.
- **M (registro)**: `GET /api/agent/follow-up` trae el resumen (enviados, sin
  marca); `GET /api/agent/follow-up/export` baja el CSV con encabezado.
- **UI**: tarjeta «Seguimiento automático» en `/agent` (interruptor, horario,
  zona, textos de respaldo, resumen de 7 días, «Descargar registro»); en el
  hilo, «Seguimiento automático 1/2 · 2/2» bajo la burbuja y la línea del
  filtro.

## Resultado (28-oct-2026)

40/40 verdes en una corrida (la primera tuvo 3 rojos del guion: dos
carreras al leer la respuesta y H esperando un registro de una charla que
pasadas las 24 h no es candidata; corregido el guion, sin cambios de
código). UI verificada en el Browser pane a 1400 px: el interruptor prende y
apaga, el resumen muestra enviados/omitidos/sin marca, y el hilo muestra las
etiquetas y la línea del filtro.
