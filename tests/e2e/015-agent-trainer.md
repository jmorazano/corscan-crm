# E2E 015 — Entrenar al agente desde la Bandeja (texto + panel + deshacer)

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`, wa-mock + ai-mock,
`AGENT_COALESCE_MS=2000`), usuario E2E local (owner de «Negocio de Super
Admin Local», agente «Ari», IA configurada). La UI se conduce en el Browser
pane (escritorio 1280 px y móvil 375 px); los pasos de API se ejecutan con
`fetch` desde la propia página (misma cookie de sesión). La rama del ai-mock
`[ENTRENADOR]` es determinista (ver `src/server/dev/ai-mock.ts`).

## Guion

1. **Fila fija**: `/inbox` muestra arriba «Entrená a Ari» con avatar de
   chispas y «Contale cómo tiene que responder»; `inbox-total` (113) no la
   cuenta; `GET /api/conversations` devuelve `trainer.kind = "trainer"`.
2. **Enseñar un precio (UI)**: abrir la fila → header «Ari · TU AGENTE»,
   subtítulo «Tu asistente de WhatsApp · lo que le digas se aplica al
   instante», composer sin plantillas ni respuestas rápidas, placeholder
   «Decile a Ari qué tiene que saber…», pie «Los cambios se aplican al
   instante y se pueden deshacer». Escribir «cuando pregunten por precio de
   mensura decí que arranca en 150 mil» → burbuja a la derecha SIN ticks →
   «Ari está pensando…» → respuesta a la izquierda con chip IA «Guardé el
   precio de mensura…». Panel derecho «ENTRENADOR»: Encendido, «15.136
   caracteres» (antes 15.031), «Cambios recientes: Nueva P/R: ¿Cuál es el
   precio de mensura?» con «Deshacer». `GET /api/kb` trae la entrada con
   `source: "trainer"`.
3. **Comportamiento**: «no uses emojis» → «Anotado: no uso más emojis.»;
   `profile.tone` termina en «- No usar emojis.»; cambio «Tono: se agregó
   «No usar emojis.»».
4. **Actualizar en vez de duplicar**: «el precio de mensura ahora es 200
   mil» → «Actualicé la respuesta sobre el precio.»; el conteo del KB no
   cambia y la P/R existente pasa a la respuesta nueva (`kb_update`).
5. **Ambigüedad**: «¿qué sabés de mensuras?» → «Contame un poco más…»;
   `GET /api/trainer/changes` no crece.
6. **Ráfaga**: dos `POST …/messages` en paralelo («ráfaga uno», «ráfaga
   dos») → exactamente UNA respuesta del agente (debounce 2,5 s). Con 1,5 s
   entre mensajes (dev lento) el segundo llega durante el turno y se
   responde aparte gracias a la marca de cobertura (antes se perdía).
7. **Cliente por wa-mock**: `POST /api/dev/wa-mock/inbound`
   (`phoneNumberId 111111111`, «¿precio de mensura?») → el agente de
   clientes responde (outbox del mock con `type text` a 5493515550199) con
   el KB actualizado; el hilo del entrenador NO recibe nada.
8. **Proveedor caído**: `PUT /api/settings/ai` con token `mock-invalid` →
   escribir → «No pude procesar eso ahora: el proveedor de IA no respondió.
   Probá de nuevo en un momento.», `handoffAt` sigue `null`; restaurar el
   token.
9. **Badge**: con el hilo cerrado, la respuesta del agente sube
   `unreadMessages` 29 → 30 y `trainer.unreadCount = 1`; abrir el hilo →
   0.
10. **Token borrado**: `DELETE /api/settings/ai` → `trainer: null` en la
    lista; `POST …/messages` → 409 `ai_not_configured`; volver a
    configurar → reaparece con el MISMO id y sus 22 mensajes.
11. **Filtros**: `?q=Ari` → `trainer: null`; `?tags=Nuevo` → null;
    `?filter=unread` → visible solo con no leídos; con cursor → null.
12. **Deshacer (API y UI)**: revert del `kb_add` → 200, la P/R desaparece
    de `/api/kb`, el hilo muestra «Deshice: Nueva P/R: …»; segundo revert
    → 409 `already_reverted`; revert de un `kb_update` cuyo objetivo ya no
    existe → 409 `target_conflict` («La entrada ya no existe» en el panel);
    revert del `profile_update` → el tono vuelve sin la línea.
13. **Guardrails**: `DELETE /api/conversations/<trainer>` → 409
    `trainer_conversation`; `DELETE /api/contacts/<sintético>` → 409
    `trainer_contact`; `/api/contacts?archived=true` no lo lista;
    `normalizeToWaId("trainer")` falla (unit) → import/API pública no lo
    alcanzan.
14. **Móvil (375 px)**: fila fija arriba de la lista; hilo apilado
    (`?c=`), sin ticks, chips IA, `scrollWidth 375`; tocar el header →
    `?d=1` panel «ENTRENADOR» a pantalla completa con 4 cambios (uno ya
    deshecho, tachado); «Deshacer» desde el panel; «←» vuelve al hilo.

## Resultado (21-sep-2026)

Todo ✅ tal como está descrito arriba (valores observados en cada paso).
Unit tests nuevos: `trainer-visibility` (7), `trainer-actions` (9),
`trainer-prompt` (5), `kb-service` (4), `ai-mock-trainer` (6),
`trainer-changes` (6), `agent-skips-trainer` (1), `send-sandbox` (+1).

Pendiente de verificación humana: nada intrínseco; el modelo real
(OpenRouter) reemplaza al mock con el mismo contrato JSON, con extracción
robusta y reintentos del adaptador.
