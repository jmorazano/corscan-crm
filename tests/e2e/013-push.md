# E2E 013 — Notificaciones push

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`: wa-mock, ai-mock y el
push-mock `/api/dev/push-mock`), usuario E2E local. El Browser pane tiene
las notificaciones BLOQUEADAS (`Notification.permission === "denied"`), así
que el alta real por UI no se puede conducir ahí: el camino de envío se
verifica con una suscripción FALSA (clave P-256 real generada con WebCrypto)
cuyo endpoint es el push-mock, y la UI se verifica en su camino infeliz.

## Guion

1. **Página**: `/settings/notifications` renderiza (`notifications-settings`),
   pestaña «Notificaciones» en Ajustes, ítem en la hoja «Más» (móvil).
2. **Service worker**: `/sw.js` → 200 `application/javascript`;
   `navigator.serviceWorker.getRegistration('/')` → `activated`, scope `/`.
3. **VAPID**: `GET /api/push/vapid` → clave pública de 87 caracteres; una
   segunda llamada devuelve LA MISMA (generada una vez por empresa).
4. **Alta**: `POST /api/push/subscriptions` con endpoint
   `http://localhost:3000/api/dev/push-mock`, `p256dh` (65 bytes) y `auth`
   → 200; `GET` la lista con modo `all`. Endpoint `ftp://` → 422.
5. **Entrante, modo todos**: `DELETE /api/dev/push-mock` → inbound por
   wa-mock → en ≤ 2,5 s el push-mock registra UNA entrega con
   `Authorization: vapid t=…, k=…`, `Content-Encoding: aes128gcm`,
   `TTL: 3600`, `Urgency: high`, cuerpo cifrado (~300 bytes), 201.
6. **Modo handoff**: `PATCH` modo `handoff` → inbound con IA activa → 0
   entregas; `PATCH` conversación `aiEnabled:false` → inbound → 1 entrega.
7. **Escalado**: IA activa de nuevo; inbound «Quiero hablar con una
   persona» → la conversación queda con `handoffReason: cliente` y el
   push-mock registra la entrega del aviso «Atención humana».
8. **Poda**: segunda suscripción con endpoint `…push-mock?status=410` →
   inbound → el mock registra 201 y 410 → `GET /api/push/subscriptions`
   solo conserva la viva.
9. **Prueba**: `POST /api/push/test` → `{sent: 1, total: 1}`.
10. **Baja**: `DELETE` → `{removed: true}`; lista vacía; `test` → `0/0`.
11. **UI infeliz**: con permiso bloqueado la página muestra «Bloqueadas por
    el navegador» y el botón queda deshabilitado; nada se cuelga.
12. **Móvil (375 px)**: sin desborde; hoja «Más» incluye «Notificaciones».

## Resultado (17-sep-2026)

Todo ✅ tal como está descrito arriba (valores observados: clave 87
caracteres estable; entrega `{status: 201, contentEncoding: "aes128gcm",
ttl: "3600", urgency: "high", vapid: true, bodyLength: 304}`; modo handoff
0 → 1; escalado `handoffReason: "cliente"` + 1 entrega; poda `[201, 410]` →
queda 1; prueba 1/1 → 0/0 tras la baja; página móvil scrollWidth 375).

Pendiente de verificación humana (intrínsecamente no automatizable acá):
recibir la notificación en un iPhone con la app instalada y tocarla para
que abra la conversación. Unit tests: `tests/unit/push-payload.test.ts`
(8) y `tests/unit/push-notify.test.ts` (2, firma/cifrado/poda con
transporte falso).
