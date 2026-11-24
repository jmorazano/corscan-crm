# 053 — Acuse de comprobante en atención humana (CRM-6)

**Pedido**: cuando entra un comprobante de pago en un chat en «Atención humana»,
que el agente igual conteste un acuse, sin sacarlo de atención humana y sin seguir
la conversación. Si el equipo ya respondió, no se repite.

## Decisiones del dueño

- **Texto fijo, sin modelo**: «Recibí el comprobante, gracias. Ahora corroboramos el
  ingreso del pago.»
- **Dónde**: chats en «Atención humana» (haya escrito el equipo o no, aunque su
  ventana haya vencido) y también con la IA del chat apagada a mano.
- **Para quién**: depende de la opción de 049 «Etiquetar comprobantes de pago»
  (`tagPaymentReceipts`). Sin opción nueva ni migración. Apagada, todo queda como hoy.

## Requisitos

- **FR-001** Con la opción encendida y el agente de la empresa encendido, un
  comprobante (imagen o PDF leído, según 049 o confirmado por la planilla de 034)
  en un chat con `handoffAt` o con `aiEnabled = false` recibe el acuse.
- **FR-002** No cambia `handoffAt`, `handoffReason` ni `aiEnabled`. Con un
  comprobante esto reemplaza la retoma de 031 mientras siga la marca.
- **FR-003** No se acusa si el equipo ya respondió después del comprobante, si ya
  hay un acuse posterior, si el comprobante tiene más de 15 minutos o si la ventana
  de 24 h está cerrada.
- **FR-004** Dos comprobantes en la misma ráfaga → un acuse; uno posterior al acuse
  → otro.
- **FR-005** El acuse (`details.receiptAck`) no cierra la espera de 048.
- **FR-006** Nunca en conversaciones `is_test`.

## Fuera de alcance

- Video, adjunto ilegible, «ya transferí» escrito.
- Responder preguntas del mismo mensaje o ráfaga: queda para la persona.
