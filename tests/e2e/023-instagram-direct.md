# E2E 023 — Instagram Direct en la Bandeja

Entorno: worktree en `localhost:3023` con `WA_MOCK_ENABLED=true`,
`OPENROUTER_BASE_URL` → ai-mock, `AGENT_COALESCE_MS=2000` e Instagram contra el
ig-mock (`INSTAGRAM_APP_ID=mock-ig-app`, `INSTAGRAM_APP_SECRET=mock-ig-secret-local`,
`INSTAGRAM_AUTH_URL`/`INSTAGRAM_TOKEN_URL`/`INSTAGRAM_GRAPH_BASE_URL` →
`/api/dev/ig-mock/...`). Usuario `e2e@vocero.test` (owner de «Negocio de Super
Admin Local», agente con IA configurada).

Mecánica del mock: `POST /api/dev/ig-mock/inbound` inyecta eventos FIRMADOS con
el secreto real (`kind`: `message` | `echo` | `deleted` | `read` | `reaction` |
`postback`; `attachment` + `mediaId` para adjuntos, `…gone…` = 404 de la CDN;
`name`/`username` = lo que devolverá el User Profile API; `accountId` = cuenta
ajena; `badSignature`). El graph simulado exige el token LARGO y manda el eco de
cada envío al webhook (como Instagram real). `GET /api/dev/ig-mock/outbox` =
envíos y suscripciones. **Knobs** (`POST /api/dev/ig-mock/state`, one-shot):
`nextAuthError`, `failNextSend` (`auth`|`error`|`down`), `profileFails`,
`refreshFails`, `subscribeFails`; `echoSends` persistente.

## Guion

1. **Ajustes → Instagram (canal, al lado de WhatsApp) y conecta.** La pestaña
   «Instagram» figura segunda en Ajustes; `/integrations/instagram` redirige
   a `/settings/instagram` y la tarjeta ya NO está en Integraciones.
   «Conectar con Instagram» → vuelve con `?connected=1`, «Conectada ·
   @negocio.demo». BD: fila
   `instagram_integration` con `token_cipher` cifrado (no empieza con `mock`),
   vence en 60 días; outbox: suscripción a
   `messages,messaging_seen,messaging_postbacks,message_reactions,messaging_referral`.
2. **Entra un DM y el agente responde por Instagram.** Inbound de «Lucía Gómez
   (@lucia.gomez)»: contacto `phone=ig:<IGSID>`, `channel=instagram`,
   `ig_username`, consentimiento `inbound`, lead nuevo, conversación
   `kind=instagram` con 1 no leído; a los ~2 s el agente contesta y el outbox
   de Instagram tiene el texto; el eco que manda Instagram NO duplica la fila
   (2 mensajes en BD, ambos `source=cloud`).
3. **La Bandeja distingue y filtra.** Filas con marca de canal (Instagram
   rosa, WhatsApp verde); chips «WhatsApp» / «Instagram»; `?channel=instagram`
   deja solo las de Instagram y oculta al Entrenador. Encabezado del hilo:
   «Lucía Gómez [IG] · @lucia.gomez · Instagram · ventana abierta»; ficha con
   @usuario.
4. **Responder como persona.** Composer → sale por Instagram (outbox) y queda
   `sent`; con el `read` del cliente pasa a `read` (ticks).
5. **Eco desde la app de Instagram** → saliente «Desde Instagram»
   (`source=phone`) EN VIVO por SSE.
6. **Foto** → se baja de la CDN simulada, `media_state=ready`, descripción del
   ai-mock bajo la imagen; **reacción** → nota «Reaccionó 😍 a un mensaje» sin
   despertar al agente; **borrado** → «Mensaje eliminado por el cliente» y el
   contenido se borra de la BD.
7. **Texto largo** (2.640 bytes) → 4 mensajes de ≤1.000 bytes cortados en
   párrafo/oración; 4 filas `cloud`, sin duplicados por los ecos.
8. **24 h – 7 días** (`last_inbound_at` = −30 h): el composer dice «Pasaron más
   de 24 h: … una persona responda hasta 7 días (el agente de IA no)»; el envío
   sale con `tag: HUMAN_AGENT`.
9. **Más de 7 días**: banner «Instagram no permite escribirle ahora» sin
   plantillas; la API responde 409 `window_closed`.

### Caminos infelices

10. Firma inválida → 401, nada guardado. Cuenta no conectada → 200 e ignorado
    con log `evento para una cuenta sin conectar`.
11. `failNextSend=down` durante un turno del agente → el turno falla limpio
    («Instagram no está disponible ahora»); envío de persona → 503
    `meta_unavailable` y la conexión sigue `connected`.
12. `failNextSend=auth` → 409 `reconnect_required`; la tarjeta pasa a
    «Requiere reconexión» y «Reconectar con Instagram» la recupera.
13. Token por vencer (10 días, emitido hace 50) → el siguiente envío lo
    renueva (vence a +60 días). Con `refreshFails` → `reconnect_required`.
14. Foto con `…gone…` (CDN 404) → `media_state=failed` y el agente pide que
    describa la imagen. `profileFails` → contacto «Instagram · …3444» que se
    completa («Marta Sinperfil», @marta.sp) con el mensaje siguiente.
15. BAJA por Instagram → `opted_out_at`, lead a «Perdido», sin respuesta.
16. Plantillas: `POST /api/conversations` con contacto de Instagram → 422
    `instagram_contact`; `…/messages/template` → 403 «Las plantillas son solo
    de WhatsApp». Contactos: @usuario y sin botón «Plantilla».
17. Desconectar (confirmación) → «No conectada»; enviar → 409 `not_connected`.
    `nextAuthError=access_denied` → «Cancelaste la autorización en Instagram».
18. Callbacks de Meta: `data-deletion` con `signed_request` válido → borra la
    conexión y responde `{url, confirmation_code}`; firma falsa → 400; cuenta
    ajena → 200 sin borrar nada.
19. Móvil (375 px): chips de canal como íconos y marca de canal en las filas.

### Historial (Conversations API)

20. **Al conectar por primera vez se importa solo.** El ig-mock trae 3
    conversaciones: Sofía (25 mensajes, hace 2 h), Martín (4, hace 10 días)
    y una de hace 90 días. Resultado: «Importado · 2 conversaciones y 24
    mensajes» (20 de Sofía —Meta solo deja leer los 20 últimos— + 4 de
    Martín; la de 90 días queda fuera de la ventana de 60). BD: fechas
    originales, `source=history`, `unread_count=0`, sin leads, sin IA;
    `last_inbound_at` avanza con `greatest`.
21. **Reimportar no duplica** (sigue en 24) y el resumen muestra el total; dos
    POST seguidos → el segundo 409 `in_progress`.
22. **Meta caída durante la importación** (`historyFails`) → «Con error ·
    Instagram no respondió; probá de nuevo en un rato. Lo que alcanzó a
    entrar quedó guardado (24 mensajes)».
23. **Cuenta conectada ANTES de esta función** (`history_status=idle`): al
    reiniciar el servidor el ticker la importa sola (2 / 24).
24. En la Bandeja las conversaciones importadas aparecen en su orden
    cronológico, sin no leídos ni etapa de lead.

## Resultado (25-sep-2026)

Todo ✅. Bug encontrado y corregido en la conducción: el eco guardaba la fila
pero no la publicaba por SSE (un `Date` crudo dentro de un `sql` fallaba en
postgres-js); ahora usa `::timestamp` como la ingesta de historial.

Gate técnico (con historial y Ajustes, 26-sep): typecheck ✅ · lint ✅ ·
build ✅ · unit 1.104 ✅. Antes: unit 1.096 ✅ (43 nuevos:
`instagram-webhook`, `instagram-messaging`, `instagram-signed-request`,
`instagram-client`, `instagram-integration`, + casos en `campaign-runner`).
