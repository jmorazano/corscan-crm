# Tasks — 030 Instagram que vende

## Fase 0 — Gobierno y panel
- [x] T001 Diagnóstico ManyChat (Conversation Routing) con datos de producción
- [x] T002 Panel de Meta: `instagram_business_manage_comments` agregado al caso de uso (Ready for testing); campos del webhook de la app ya suscriptos (comments, live_comments, standby, messaging_handover…)
- [x] T003 Constitución 1.11.0 (renumerada: la 029 entró como 1.10.0) (VIII + II.1(i)) + CLAUDE.md

## Fase 1 — Datos
- [x] T010 Migración 0024: `instagram_comment_rule`, `instagram_comment_event`, `instagram_entry_link`; `instagram_integration` (+granted_scopes, subscribed_fields, moderation_words, ice_breakers, persistent_menu, profile_synced_at, profile_error, standby_seen_at, comments_webhook_at, comments_polled_at); `conversation.ig_origin`; `message.details`; `contact.email`, `contact.contact_phone`; ids

## Fase 2 — Reglas puras (unit)
- [x] T020 `src/lib/instagram/comments.ts`: normalización, match de palabras, elección de regla, validación de reglas
- [x] T021 `src/lib/instagram/interactive.ts`: botones/tarjetas/respuestas rápidas, guarda de URLs del corpus, payloads de Meta, texto de respaldo
- [x] T022 `src/lib/instagram/entry-links.ts` + `src/lib/qr.ts` (codificador QR propio)
- [x] T023 `src/lib/instagram/profile.ts`: ice breakers + menú (validación y payload)
- [x] T024 `src/lib/contact-data.ts`: email/teléfono
- [x] T025 webhook: comentarios (changes y field/value), standby, referral (suelta/en message/en postback), reply_to.story, quick_reply, ecos de plantillas

## Fase 3 — Servidor
- [x] T030 Cliente: scopes, permisos concedidos, suscripción con caída, media, comentarios, respuesta privada, respuesta pública, ocultar, messenger_profile, plantillas y respuestas rápidas
- [x] T031 `src/server/instagram/comments.ts`: motor (reserva → regla → DM → pública → conversación), moderación, seguimiento, consulta periódica
- [x] T032 Ingesta: origen (link/anuncio/historia), historias con imagen, standby, postback «persona», seguimiento antes del agente
- [x] T033 Envío interactivo (`sendText` con extras) + agente (acciones, prompt, guardas, email/teléfono)
- [x] T034 Perfil de mensajería (aplicar/borrar) y links (CRUD + QR + conteo)
- [x] T035 Rutas API (owner): reglas, publicaciones, actividad, ocultar, moderación, primer contacto, links

## Fase 4 — UI
- [x] T040 Ajustes → Instagram con secciones: Conexión · Comentarios · Primer contacto · Links con origen
- [x] T041 Hilo: nota del comentario, historia, botones/respuestas rápidas, plantillas de otras apps; ficha: email/teléfono

## Fase 5 — Mocks, tests, E2E
- [x] T050 ig-mock: media, comentarios, respuestas privadas/públicas, ocultar, messenger_profile, plantillas, inyección de comentarios/standby/referral/historias
- [x] T051 Unit de las reglas puras + webhook
- [x] T052 Guion E2E `tests/e2e/030-instagram-growth.md` conducido en verde (feliz + infeliz)
- [x] T053 Gate: typecheck · lint · build · test

## Fase 6 — Docs y App Review
- [x] T060 `specs/023-instagram-direct/app-review.md`: texto de `instagram_business_manage_comments` + guion del video actualizado
- [x] T061 `docs/integraciones/instagram.md`
- [x] T062 Merge + deploy (OK del dueño 5-oct): `74a4fc7` (Railway 65efa39f SUCCESS, migración 0024 aplicada, health 200) + fix `ed04a17` (borrar un contacto borra sus comentarios)
- [x] T063 Política de privacidad y eliminación de datos (dronebiz `9ee13c1`, Netlify `index-fZ9ZCwJJ.js`, 5-oct)
- [ ] T064 Producción: reconectar @corscan.ing (y Altos) para conceder el permiso; recién ahí corre la consulta de comentarios
