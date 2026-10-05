# E2E 030 — Instagram que vende (comentarios, primer contacto, links, extras)

Entorno: worktree en `localhost:3030` contra una COPIA de la base local
(`vocero_030`, clonada con `CREATE DATABASE … TEMPLATE vocero` + migración
0024), `WA_MOCK_ENABLED=true`, `OPENROUTER_BASE_URL` → ai-mock,
`AGENT_COALESCE_MS=2000` e Instagram contra el ig-mock (mismas variables que
023). Usuario `e2e@vocero.test` (owner de «Negocio de Super Admin Local», con
la cuenta simulada `@negocio.demo` conectada desde 023, SIN el permiso de
comentarios).

Conducción: script `e2e030.mjs` (API interna con la sesión del usuario +
`/api/dev/ig-mock/*` + lecturas de la base), más revisión en el navegador
(Ajustes → Instagram en escritorio y 375 px, Bandeja).

Mecánica nueva del ig-mock: `POST /api/dev/ig-mock/inbound` con
`kind: "comment"` (`mediaId2`, `commentId`, `parentId`, `live`,
`commentFormat: "changes"|"field"`, `pollOnly` = solo para la consulta),
`kind: "referral"`, `ref` / `adId`+`adTitle` en un mensaje, `storyMediaId`
(respuesta a historia), `attachment: "story_mention"`, `standby: true`,
`payload` (respuesta rápida / postback), eco con `templateText` (plantilla de
otra app). Perillas: `denyComments`, `failNextPrivateReply`
(`error|routing|down|invalid`), `rejectQuickRepliesInPrivateReply`,
`rejectTemplates`, `profileSaveFails`, `commentsReadFails`. El outbox expone
`comments`, `publicReplies`, `hiddenComments`, `messengerProfile`,
`lastScope`.

## Guion

1. **Conexión vieja** (antes de 030): `commentsEnabled=false`; la pestaña
   Comentarios pide «Reconectar con Instagram».
2. **Reconectar**: el Business Login pide los TRES permisos; la suscripción
   suma `comments,live_comments,standby,messaging_handover`;
   `commentsEnabled=true`.
3. **Regla**: la grilla trae las publicaciones (con miniatura); sin
   publicaciones → 422 «Elegí al menos una publicación»; se crea «Link Alba»
   (INFO, link · DM con `{usuario}` · botón · seguimiento con enlace · pública).
4. **Comentario «INFO por favor!»** (webhook) → evento `replied`; respuesta
   privada «¡Hola @sofi.viajera! …» con la respuesta rápida «Quiero el link»;
   respuesta pública; Bandeja: nota `comment` + DM marcado como automático;
   conversación SIN no leídos, SIN ventana abierta, etiqueta `ig-comentario`,
   origen `comment`; contacto «@sofi.viajera»; el agente NO habla.
5. **Idempotencia**: el mismo comentario otra vez y otro comentario de la
   misma persona → sin otro DM (`skipped`).
6. **Ignorados**: sin palabra, respuesta a otro comentario y comentario de la
   propia cuenta.
7. **Toca el botón** → sale el seguimiento con el enlace, el agente no habla
   encima, el nombre se completa con el perfil («Sofía Viajera»).
8. **Agente con contexto**: «¿qué comenté?» → «Comentaste «INFO por favor!»…»
   (marcador `[COMENTARIO]`); «pasame los botones» → plantilla de botones con
   SOLO el enlace del contexto (el inventado se descarta) y el hilo guarda los
   botones.
9. **Respuestas rápidas** (`text,text,user_email`) y «mi email es …» →
   `contact.email`.
10. **Consulta periódica**: regla «todas · precio», webhook de comentarios
    vencido → comentario solo en la API → el ticker lo encuentra y responde
    (`replied|poll`); la vista dice «consulta» con la hora.
11. **Moderación**: «son una ESTAFA, INFO» → ocultado en Instagram, sin DM,
    evento `hidden`; «Mostrar» lo vuelve visible.
12. **Infelices de la respuesta privada**: otra app maneja el hilo → `failed`
    con «Otra app (por ejemplo ManyChat)…»; Instagram rechaza la respuesta
    rápida → reintenta SOLO texto y responde; Meta caído → `failed` sin
    colgarse.
13. **Vivos** (formato `field/value`): DM, sin respuesta pública.
14. **Primer contacto**: 2 preguntas + menú (pregunta, enlace, persona) →
    aplicado en Instagram; Meta falla → 502 con motivo y queda guardado; 5
    preguntas → 422. En la UI: agregar «Hablar con una persona» y «Guardar en
    Instagram» → «Guardado y aplicado en Instagram».
15. **«Hablar con una persona»** del menú → handoff `cliente`, sin modelo.
16. **Links**: «Flyer Cabañas» con instrucción → `https://ig.me/m/negocio.demo?ref=flyer-cabanas`;
    slug repetido → 409; QR SVG descargable; mensaje con ese `ref` → el agente
    responde con el origen y la instrucción; etiqueta `ig-flyer-cabanas`;
    1 conversación; reabrir desde el mismo link no suma.
17. **Anuncio** → etiqueta `ig-anuncio`, origen «Anuncio: Promo primavera cabañas».
18. **Historias**: respuesta → tipo `story`, historia bajada y descripta, el
    agente agradece y sabe qué se veía; mención → el agente agradece.
19. **Standby** → se guarda con `standby`, el agente no responde, Ajustes avisa.
20. **Eco de plantilla de otra app** → texto y botón legibles (no burbuja vacía).
21. **Instagram rechaza el formato** → el agente sale como texto con el enlace escrito.
22. **Sin sesión** → 401.
23. **Reconectar sin aceptar comentarios** → `commentsEnabled=false` y la
    suscripción no pide `comments`.

## Resultado (5-oct-2026)

**64/64 ✅** tras dos vueltas de corrección:

- La guarda de enlaces aceptaba `https://..` (resto del EJEMPLO del propio
  prompt) — un modelo real podía copiarlo y mandar un botón roto. Ahora exige
  un dominio real y el prompt usa `https://…`. Además dejó de rechazar
  enlaces válidos seguidos de `»`.
- Ajustes del simulador de IA (orden de ramas frente al conector MCP, tilde
  en «qué») y de dos chequeos del guion.

QR propio verificado aparte con `BarcodeDetector` de Chrome: 7/7 lecturas
correctas (versiones 1–13, UTF-8 y emoji). Revisión visual: pestañas, aviso de
standby, reglas, actividad, primer contacto, diálogo del QR, hilo (nota del
comentario, DM automático, chips de botones y respuestas rápidas, historia) y
ficha (origen, email); móvil 375 px sin scroll horizontal y editor como hoja
inferior.

Gate técnico: typecheck ✅ · lint ✅ · build ✅ · unit 1.450 ✅ (31 nuevos en
`instagram-growth.test.ts` + 4 ajustados en `instagram-webhook`/`instagram-client`).

Tras mergear `main` (029, recuperar contraseña; constitución renumerada a
1.11.0): gate ✅ (unit 1.476) y E2E 64/64 ✅ de nuevo.
