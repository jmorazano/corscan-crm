# E2E 053 — Acuse de comprobante en atención humana

## Preparación

Empresa con el agente encendido y «Etiquetar comprobantes de pago» encendido.
Chat de WhatsApp con ventana de 24 h abierta.

## Casos

1. **Imagen**: chat en «Atención humana», el cliente manda la foto de una
   transferencia → sale «Recibí el comprobante, gracias. Ahora corroboramos el
   ingreso del pago.»; `handoff_at` intacto y sin línea «La IA no respondió».
2. **PDF**: igual con un PDF de transferencia.
3. **IA del chat apagada** (switch): con o sin atención humana, el comprobante
   recibe el acuse y el switch sigue apagado.
4. **Equipo ya respondió**: una persona escribió después del comprobante → no hay acuse.
5. **Foto común** (no comprobante): sin acuse; sigue el flujo de hoy.
6. **Opción apagada**: sin acuse; todo como antes.
7. **Retoma posterior**: vencida la ventana del equipo, un texto del cliente hace
   que la IA retome y quite la marca (031).
8. Dos comprobantes seguidos → un acuse; otro comprobante después del acuse → otro acuse.
9. El acuse no cancela el aviso al propietario de 048.
