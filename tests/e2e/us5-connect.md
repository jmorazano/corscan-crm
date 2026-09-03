# Guion E2E — US5: Conexión del número (wizard)

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock
> (`META_GRAPH_BASE_URL` → wa-mock/graph).

## Camino feliz

1. Abrir `/settings/whatsapp`.
   ✅ El wizard explica los DOS orígenes del token (modo directo / modo
   agencia Tech Provider).
2. Llenar WABA ID + Phone Number ID + token (sin sufijo `-invalid`) →
   "Probar conexión".
   ✅ "Token válido para +52 …". El botón Guardar se habilita SOLO tras la
   prueba.
3. Guardar.
   ✅ Estado "Conectado" con display number y token …last4; el token quedó
   cifrado en BD (unit test) y se llamó subscribed_apps (best-effort).
4. Sección Webhook:
   ✅ URL COMPLETA con el verify token como segmento + botón copiar; aviso
   informativo (no error) si META_APP_SECRET no está configurado; nota de
   seguridad del token en la URL.

## Embedded Signup en modo mock (v4)

> Requiere `WA_MOCK_ENABLED=true` + las tres vars de Embedded Signup con
> valores de prueba (META_APP_ID / META_ES_CONFIG_ID / META_APP_SECRET). En
> mock el wizard no carga el SDK de Meta: los botones llaman a `simulate()`.

7. Camino estándar: botón "Conectar con Meta".
   ✅ `simulate(false)` manda code + waba_mock_1 + pn_mock_1; el server canjea
   el code contra el mock (`oauth/access_token`), valida el número y termina
   en estado "Conectado" con pn_mock_1.
8. Camino coexistence: botón "Conectar sin perder el celular" (visible
   siempre en mock, sin necesidad de COEXISTENCE_UI_ENABLED).
   ✅ `simulate(true)` manda code + waba_mock_1 SIN phoneNumberId; el server
   descubre el número vía `GET {waba}/phone_numbers` del mock (pn_mock_1) y
   termina en "Conectado". GUARDRAIL: la conexión debe completarse sin
   ninguna llamada a `{phone_number_id}/register` (registrar el número
   desconectaría la app móvil del cliente). Ojo: el wa-mock no registra las
   rutas desconocidas que recibe, así que este run NO lo demuestra por sí
   solo — verificarlo por inspección: `grep -rn "/register" src/` debe dar
   cero resultados en el código de WhatsApp.

## Caminos infelices

9. Token con sufijo `-invalid` → "Probar conexión".
   ✅ Error claro de token inválido; NO se guarda (la conexión previa queda
   intacta).
10. Webhook GET handshake con verify token correcto → challenge; segmento
    incorrecto → 404 (cubierto también en guion US1).
