# 049 — Etiqueta automática de comprobantes de pago

**Pedido del dueño (7-nov-2026)**: que la conversación se etiquete sola cuando el
cliente manda un comprobante, para filtrar los pagos que falta registrar.

## Decisiones del dueño

- **Etiqueta**: `registro-pago-pendiente`, sin `#`. Es una etiqueta normal de la
  conversación.
- **Quién la saca**: el equipo a mano, al registrar el pago. Nada la saca solo.
- **Para quién**: opción por empresa, apagada por defecto, en `/agent`.

## Requisitos

- **FR-001** Con la opción activa, una imagen o un PDF entrante cuya descripción
  diga que es la prueba de un pago hecho etiqueta la conversación.
- **FR-002** La etiqueta la pone el CRM, no el modelo: no depende de que el agente
  esté prendido, ni de lo que decida responder.
- **FR-003** Lo que todavía no es un pago hecho no se etiqueta: datos para
  transferir, cedulones, boletas, facturas, constancias de otra cosa.
- **FR-004** Si la planilla de 034 ya confirmó el comprobante (`recorded` o
  `duplicate`), se etiqueta aunque la descripción no lo diga con esas palabras.
- **FR-005** Un comprobante nuevo vuelve a etiquetar una conversación a la que el
  equipo ya le quitó la etiqueta.
- **FR-006** Nunca en conversaciones `is_test`. Un fallo al etiquetar no frena el
  adjunto ni el turno del agente.

## Por qué no se usa `looksLikeReceipt` de 034

Ese filtro es amplio porque después lo confirma una lectura completa. Sobre 960
adjuntos reales de 60 días marcaba 161; entre ellos cedulones, constancias de
Catastro y capturas con «los datos para hacer una transferencia». El detector de
049 (`src/lib/payment-receipt-tag.ts`) marca 125 y deja afuera ese ruido. Se midió
contra descripciones, no contra los archivos: es una estimación, no una tasa de
acierto. Sin lectura completa no hay costo extra de IA.

## Fuera de alcance

- Quitar la etiqueta sola al registrar el pago.
- Word, Excel y videos: no pasan por esta detección.
