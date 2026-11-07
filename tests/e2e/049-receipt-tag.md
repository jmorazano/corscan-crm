# E2E 049 — Etiqueta automática de comprobantes de pago

Entorno: mocks de siempre, `AGENT_COALESCE_MS=2000`, usuario E2E local. El ai-mock
describe `mediamock_image_<n>` como comprobante, `mediamock_image_photo_<n>` como
foto común, y un PDF como comprobante si su nombre lo dice. Conviene correrlo en
una copia de la base (`CREATE DATABASE … TEMPLATE vocero`).

## Guion

1. **Apagada por defecto.** `GET /api/agent/profile` → `tagPaymentReceipts: false`.
   Entra un comprobante → la conversación NO tiene la etiqueta.
2. **Se activa desde la pantalla.** `/agent`, tarjeta «Etiquetar comprobantes de
   pago»: el switch pasa a «Activado…» y sobrevive a recargar la página.
3. **Comprobante en imagen.** Entra `mediamock_image_<n>` → aparece
   `registro-pago-pendiente`, y el agente responde igual.
4. **Comprobante en PDF.** Entra `comprobante.pdf` en otra conversación → etiquetada.
5. **Lo que no es comprobante.** Una foto (`mediamock_image_photo_<n>`) y un PDF
   cualquiera → sin etiqueta.
6. **Se filtra como cualquier etiqueta.** `GET /api/conversations?tags=registro-pago-pendiente`
   trae las dos del paso 3 y 4, y no las del paso 5.
7. **El equipo la saca a mano.** `POST /api/conversations/bulk-tags` con
   `remove` → desaparece; la conversación sigue igual.
8. **Otro comprobante la vuelve a poner.** Entra otro en la misma conversación →
   vuelve la etiqueta, una sola vez aunque lleguen dos.
9. **Solo la empresa que la activó.** Con el switch apagado de nuevo, un comprobante
   nuevo no etiqueta.
10. **El propietario decide.** Un miembro recibe 403 al intentar cambiar la opción.
