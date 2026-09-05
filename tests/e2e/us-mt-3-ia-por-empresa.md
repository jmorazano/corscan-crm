# US-MT-3 — Token de IA por empresa

Guion E2E de comportamiento (feature 003, US3). Requiere us-mt-2 conducido
(A=principal con 111111111, B=inmobiliaria-demo con 222222222; ai-mock
interceptando OPENROUTER_BASE_URL). `AGENT_COALESCE_MS=2000` en el .env dev.

## Empresa sin token (B)

1. Como socio: Ajustes → Inteligencia artificial.
   ✅ Estado "agente apagado" con guía de cómo activarlo; sin last4.
2. Inbound a 222222222.
   ✅ El mensaje entra a la bandeja de B; pasado el coalesce NO hay
   respuesta del agente (ningún saliente nuevo); nada se cuelga.

## Empresa con token (A)

3. Como superadmin: Ajustes → Inteligencia artificial → pegar token de
   prueba y guardar.
   ✅ Queda "agente activo" con los últimos 4 del token; modelos muestran
   los defaults de producto.
4. Inbound a 111111111 (texto que amerite respuesta).
   ✅ Tras el coalesce, el agente responde: aparece un mensaje SALIENTE en
   la conversación (vía ai-mock). El gasto viaja con el token de A.

## Caminos infelices

5. Rotar el token de A a uno terminado en `-invalid` (el ai-mock simula el
   401 del proveedor). Inbound a 111111111.
   ✅ El turno degrada sin colgarse: no hay respuesta, el server sigue
   vivo, la bandeja manual opera; el error queda en el log del server (con
   API keys redactadas).
6. DELETE de la config de A (botón borrar con confirmación).
   ✅ Vuelve a "agente apagado"; el siguiente inbound no dispara nada.

## Última conducción

**5-sep-2026 — VERDE los 6 pasos** (entorno quickstart 003, ai-mock):

- B sin token: Ajustes → IA con guía y formulario vacío; inbound entró y el
  agente NO actuó (corte limpio antes del proveedor).
- A: token guardado por la UI (last4 7788, cifrado); con el perfil del
  agente HABILITADO (interruptor de la pantalla Agente — el seed lo deja
  apagado, no es bug), el inbound produjo respuesta saliente del agente vía
  ai-mock con el token de A.
- Token `-invalid`: el turno degradó sin colgarse (sin respuesta, health
  200) y el log registró `[agente] fallo del proveedor … 401`.
- DELETE: config null y el siguiente inbound no disparó nada.

Nota de conducción: el contador de wamid del wa-mock vive en memoria — tras
reiniciar el dev server, mandar `waMessageId` explícito único o los inbound
se dedupean en silencio.
