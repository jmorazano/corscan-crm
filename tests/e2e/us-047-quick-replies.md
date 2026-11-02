# Guion E2E — 047: Respuestas rápidas propias

> Conducido en el Browser pane contra `next dev` del worktree con wa-mock
> (2-nov-2026). Usuario `e2e@vocero.test`: propietario en «Negocio de Super
> Admin Local», miembro en «Inmobiliaria Demo».

## Alta en Ajustes (propietario)

1. `/settings/quick-replies` → pestaña «Respuestas rápidas» entre Plantillas
   y Equipo; estado vacío «Todavía no hay respuestas rápidas».
2. Atajo `/Seña Total`.
   ✅ Aviso «Va a quedar: /seña-total».
3. Texto `Hola ` + botón «+ Nombre del contacto» + `! Para confirmar…`.
   ✅ El marcador entra donde estaba el cursor y lo que se tipea después
   sigue a continuación (el botón no le roba el foco a la caja).
   ✅ Vista «Con María: Hola María! …».
4. «Crear respuesta rápida» → la fila `/seña-total` aparece en la lista.
5. Camino infeliz por API: mismo atajo (`SEÑA total`) → 409 `duplicate`;
   atajo `///` → 422; PATCH a un atajo ya usado → 409; PATCH válido sanea
   (`Bé 2` → `be-2`); DELETE de un id ajeno/inexistente → 404.

## Uso en la Bandeja

6. Entrante simulado (`/api/dev/wa-mock/inbound`, María Gómez) → ventana
   abierta. En la caja: `/sen`.
   ✅ El selector muestra `/seña-total` (sin tildes ni mayúsculas).
7. Tab → la caja queda con «Hola María! Para confirmar…» y el selector se
   cierra. Insertar NO envía.
8. Rayo → lista completa: propias primero (por atajo), después las
   plantillas aprobadas con la marca «PLANTILLA»; al pie «Administrar
   respuestas rápidas» → `/settings/quick-replies`.
9. Enviar → el wa-mock `/outbox` recibe `type: text` con el texto ya
   reemplazado.

## Miembro y aislamiento

10. Cambiar a «Inmobiliaria Demo» (rol `member`).
    ✅ Ajustes muestra solo Respuestas rápidas, Notificaciones y Mi
    contraseña; `/settings/quick-replies` abre (no redirige).
    ✅ POST `/api/quick-replies` → 201; una escritura de configuración
    (`/api/settings/origin-rules`) sigue en 403.
    ✅ La lista solo trae las de esa empresa (las de la otra no aparecen).
