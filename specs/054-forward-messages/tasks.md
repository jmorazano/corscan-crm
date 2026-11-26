# 054 — Tareas

## Reglas puras
- [x] T01 `src/lib/contact-card.ts` (tipo, lectura de Meta, saneo, payload, textos) + test
- [x] T02 `src/lib/forward.ts` (forwardability, topes, destino, resumen) + test
- [x] T03 `MessageDetails`: `forwarded`, `contacts`

## Servidor
- [x] T04 `sendText` / Instagram: `details.forwarded`
- [x] T05 `sendMedia`: `details`, transcripción copiada, caché de subida por reenvío
- [x] T06 `send-contacts.ts` (WhatsApp tarjeta nativa, Instagram texto)
- [x] T07 `forward.ts` (orquesta mensajes × destinos, resultado por chat)
- [x] T08 Ingesta de `contacts` (webhook, ecos e historial del celular)
- [x] T09 Agente: línea `[ADJUNTO]` para tarjetas (entrantes y salientes)
- [x] T10 `POST /api/conversations/forward`
- [x] T11 `POST /api/conversations/[id]/messages/contacts`

## UI
- [x] T12 Hilo: menú por mensaje (escritorio) + hoja (móvil), modo selección, marca «Reenviado»
- [x] T13 Hilo: tarjeta de contacto (copiar número)
- [x] T14 Diálogo «Reenviar a…» (buscador, tope 5, ventana cerrada, resultado)
- [x] T15 Compositor: botón «Contacto» + selector (CRM / otro contacto)

## Mocks y pruebas
- [x] T16 wa-mock `inbound` con `contacts`
- [x] T17 Guion `tests/e2e/us-054-forward.md`
- [x] T18 Gate técnico (typecheck, lint, test, build)
- [x] T19 Self-test en vivo (feliz + infeliz) con evidencia

## Cierre
- [x] T20 CLAUDE.md (mapa + feature activa)

## Verificación (26-nov-2026)

- Gate: `tsc --noEmit`, `eslint .`, `vitest run` (210 archivos, 2.535 tests; 54 nuevos), `next build` — verde.
- Self-test en vivo contra `next dev` del worktree (3053) con wa-mock e ig-mock: guion `tests/e2e/us-054-forward.md` completo (WhatsApp ↔ WhatsApp, WhatsApp ↔ Instagram, selección múltiple, resultado parcial, Meta caída, subida rechazada + reintento, tarjetas, celular 375 px, aislamiento entre empresas).
- El dueño aprobó el merge a `main` y el deploy el 26-nov-2026.
- Pendiente: probar con un WhatsApp real que la tarjeta muestre «Enviar mensaje» y que una nota de voz reenviada llegue como nota de voz.
