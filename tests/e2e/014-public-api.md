# E2E 014 — API pública por empresa

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`, wa-mock + ai-mock,
`AGENT_COALESCE_MS=2000`), usuario E2E local (owner). La UI se conduce en
el Browser pane; la API pública se ejercita desde fuera del navegador
(Node `fetch`, equivalente a `curl`), que es la superficie real del
integrador. Estado del guion: `scratchpad/e2e.mjs` con fases.

## Guion

1. **Plantilla del caso**: `recordatorio_checkin` (UTILITY, es_AR, cuerpo
   «Hola {{1}}, te esperamos en {{2}} el {{3}}…», orígenes
   `[contact_name, free_text, free_text]`) creada por `/api/templates` y
   aprobada con `POST /api/dev/wa-mock/template-status`.
2. **Ajustes → API (UI)**: pestaña «API» en Configuración; página con
   estado (canal `+52 55 0000 0000`, cupo `40 / 40`, plantillas aprobadas),
   «Todavía no hay claves», guía con un `curl` por plantilla aprobada.
   Escribir «Sistema de reservas» → «Nueva clave» → caja con el secreto
   `vk_…` (43 chars tras el prefijo) + «Copiar clave»; la fila muestra
   `Activa · vk_xxxxxxxx… · nunca usada`.
3. **Auth**: `GET /api/v1/templates` sin header → 401 `invalid_api_key`;
   con una clave inexistente bien formada → 401 mismo código.
4. **Listado**: 200 con SOLO `approved`; `recordatorio_checkin` trae
   `variables` `[1 contact_name crm, 2 free_text caller, 3 free_text
   caller]` y `example.params {"2","3"}`; `?status=all` suma `rejected`.
5. **Envío feliz**: `POST /api/v1/messages` a `+54 9 351 555 0101`,
   `name: Ana Prueba`, `params {2,3}`, `Idempotency-Key: res-1:checkin` →
   201 con `message.id`, `contact {phone 5493515550101, created true}`,
   `conversation {id, url}`. Outbox del wa-mock: 1 envío `template` con 3
   parámetros de body resueltos («Ana Prueba», «Cabaña Los Pinos»,
   «viernes 25/10 a las 14:00»).
6. **Idempotencia**: mismo request → 201, cuerpo semánticamente idéntico
   (jsonb reordena claves) + header `Idempotent-Replayed: true`, outbox
   sigue en 1; misma clave con otro cuerpo → 422 `idempotency_mismatch`.
7. **Validaciones sin tocar Meta**: teléfono corto → 422 `invalid_body`;
   con letras → 422 `invalid_phone` (`reason: caracteres_invalidos`);
   plantilla inexistente → 404 `template_not_found`; `promo_rechazada` →
   422 `template_not_approved`; falta `{{3}}` → 422 `missing_params`
   `missing: ["3"]`; mandar `{{1}}` → 422 `unknown_params` `unknown:
   ["1"]`; salto de línea → 422 `invalid_param` `index: "2"`; body sin
   `template` → 422 `invalid_body`; JSON roto → 422. Outbox sigue en 1.
   Formato nacional AR «0351 15 555 0199» → 201 con wa_id `5493515550199`.
8. **Estado**: `GET /api/v1/messages/{id}` → `pending`; wa-mock status
   `delivered` → `delivered`; `failed` con «Message Undeliverable.» →
   `failed` + `error` amable («El número no puede recibir…») + `error_raw`;
   id inexistente → 404.
9. **Meta caída**: knob `failNextSend` → `POST` a un segundo contacto con
   `res-2:checkin` → 503 `meta_unavailable`, sin envío; reintento con la
   MISMA clave → 201 (la reserva se liberó); outbox = 2.
10. **Cupo**: `PUT /api/settings/sending {3}` con 3 iniciados → tercer
    contacto nuevo → 429 `quota_exceeded` + `retryInSeconds` (86354);
    subir a 40 → misma `Idempotency-Key` → 201.
11. **Baja**: inbound «BAJA» de Ana → `opted_out_at` set, `consent_source`
    sigue `api`, nombre «Ana Prueba» conservado; con la ventana cerrada
    (SQL: `last_inbound_at` − 2 días) → `POST` → 409 `opted_out`.
12. **Agente (FR-011)**: outbox limpio; inbound de Beto «Gracias!» → 0
    salientes (heurística, sin proveedor); «Buenísimo, ya lo agendé» → 0
    (pasa al modelo con la sección «NOTIFICACIÓN AUTOMÁTICA», el ai-mock
    responde `none`); «¿A qué hora es el check-in?» → 1 respuesta
    («Respuesta de prueba sobre: …»); luego «Gracias!» → responde (el
    último saliente ya es del agente: comportamiento normal).
13. **Rate limit**: bucle de `GET /api/v1/templates` → 429 `rate_limited`
    (`retryInSeconds: 60`) en la llamada 58 del minuto (las 3 anteriores
    del mismo minuto cuentan): 60/min por clave.
14. **Bandeja (UI)**: `/inbox?c=<cv>` muestra la burbuja de la plantilla
    con «Enviado por API · Sistema de reservas» y la línea «No entregado…»
    del estado fallido.
15. **Ajustes → API tras el uso**: fila `último uso 18/9/26, 12:25 a. m.`,
    cupo `36 / 40`, 4 plantillas, `curl` de `recordatorio_checkin` con el
    nombre real, `language`, `params {"2","3"}` y el prefijo de la clave.
16. **Móvil (375 px)**: sin desborde horizontal (`scrollWidth` 375), tira
    de pestañas con «API», tarjetas apiladas.
17. **Revocar (UI)**: «Revocar» → diálogo de confirmación → fila
    «Revocada» sin botón; `GET /api/v1/templates` con la clave → 401
    `invalid_api_key`.

## Resultado (18-sep-2026)

Todo ✅ tal como está descrito arriba (valores observados en cada paso).
Unit tests: `api-keys` (5), `with-api-key` (6), `acknowledgment` (27),
`public-api-templates` (11) — 505 en total en verde.

Pendiente de verificación humana: nada intrínseco; el flujo real con Meta
usa el mismo embudo que campañas y envíos 1:1 ya probados en producción.
