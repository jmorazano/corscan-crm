# US-CC-4 — Campañas con freno y tracking (feature 004, US4)

Prerequisito: us-cc-1..3. `CAMPAIGN_PACE_MS=200` (E2E). Cupo inicial del
guion: límite 3 con 2-5 contactos ya iniciados en la ventana.

## Pasos

1. Campañas → **Nueva campaña**: preview del segmento EN VIVO — con tag
   inexistente ✔ 0 elegibles; con `clientes-2025` ✔ 5 (el contacto CON la
   tag pero SIN consentimiento queda excluido ✔). Crear borrador → detalle.
2. **Lanzar** con cupo disponible=1 → ✔ congela 5, envía 1 (Cliente Seis)
   y se **pausa sola** con "Pausada por cupo de 24h (reanuda sola)" — el
   badge apareció por SSE sin refrescar la página.
3. Lanzar con segmento vacío (tag inexistente): cubierto por el preview=0 +
   422 `segment_empty` del contrato (unit T034).
4. **BAJA a mitad de campaña**: inbound "BAJA" de un destinatario pending →
   ✔ su fila pasa a `skipped/opted_out` al instante y su wamid JAMÁS
   aparece en el outbox.
5. **La pausa manual gana**: click Pausar SOBRE la pausada por cupo →
   motivo `manual`; subir el límite a 100 (dispara la reanudación
   automática de las pausadas por cupo) → ✔ sigue `paused(manual)` — el
   ticker la respeta. Reanudar manual → ✔ completa: 4 enviados / 1
   omitido; **Cliente Dos salió EXENTO de cupo** (ya iniciado en la
   ventana).
6. **Tracking fusionado**: status `failed` asíncrono sobre un enviado → ✔
   figura "falló la entrega" con motivo y suma a counts.failed; delivered→
   read en otro ✔; inbound de un destinatario → ✔ `respondió`.
7. **Cupo compartido** individual+campaña: la aritmética conducida cierra
   exacta — 5 contactos únicos previos (envíos individuales US2 incluidos)
   + 15 de campaña = 20 = límite → pausa en el envío 16.
8. **SC-004 / reinicio**: campaña "Masiva E2E" (4.995 congelados, límite
   20) → `kill -9` al dev server en pleno envío → estado en BD íntegro
   (15 sent / resto pending) → reinicio → ✔ el revive del boot NO toca
   pausadas, retoma running; subir el límite reanudó al instante (PUT).
   **At-most-once con fault-injection del estado post-crash**: fila
   `sending` CON wamid → ✔ promovida a `sent` SIN re-envío + initiated_send
   REPUESTO; fila `sending` SIN wamid → ✔ `failed` "Interrumpido por un
   reinicio del servidor (no se reintenta solo)". Assert global en BD: ✔
   **0 conversaciones con más de 1 plantilla saliente** sobre 4.995
   destinatarios y 2 reinicios.
9. **Cancelar** (con confirmación) → ✔ terminal: 4.958 pending →
   `skipped/cancelled`; resume sobre cancelada → 409.
10. Sender EXISTENTE con cupo agotado → ✔ 429 `quota_exceeded` con
    `retryInSeconds`.

## Evidencia

Conducido VERDE el 5-sep-2026 (Playwright + wa-mock + kill -9 real +
asserts SQL). Aislamiento multi-tenant de campañas/cupo en
us-mt-2-aislamiento.md (extensión 004).


## Gestión de campañas (007) — verificado 7-sep-2026 con mocks

G1. `/campaigns` muestra el panel «¿Cómo funciona una campaña?» (colapsable,
    recuerda el estado en localStorage) con los 5 pasos y, abajo, el ritmo
    real (`CAMPAIGN_PACE_MS`) y el cupo de 24h (`disponibles/límite/usados`).
G2. Filtros: chips por estado (Todas/Borradores/En curso/Pausadas/
    Completadas/Canceladas) y búsqueda por nombre con debounce; ambos viven
    en la URL (`?status=draft&q=gesti`) y se restauran al recargar.
    ✅ `GET /api/campaigns?status=draft` trae solo borradores; `q` es
    ILIKE literal (comodines escapados).
G3. Nueva campaña: el segmento se elige con el selector de etiquetas
    (catálogo de contactos con conteo, sin texto libre); el texto explica
    «con AL MENOS una» y muestra los elegibles hoy.
G4. Borrador en la lista y en el detalle: «N elegible(s) hoy · la lista se
    congela al lanzar» (antes decía «0 destinatarios», que confundía).
    Con 0 elegibles el botón Lanzar queda deshabilitado con tooltip.
G5. Acciones por fila y en el detalle, SIEMPRE con confirmación que explica
    el efecto (Lanzar: congela N y empieza a enviar cada X; Pausar; Reanudar
    sin duplicar; Cancelar: pendientes omitidos, irreversible; Borrar).
    ✅ Lanzar → running → completed con 1 destinatario.
    ✅ Pausar a mano → badge «Pausada por vos» + texto de qué sigue.
    ✅ Reanudar → al agotarse el cupo se pausa sola: badge ámbar «Pausada
    por cupo de 24h · reanuda sola» y explicación con `usados/límite`.
    ✅ Cancelar → «Cancelada», pendientes → omitidos; solo queda «Borrar».
G6. `DELETE /api/campaigns/:id` → 200 en borrador/completada/cancelada (el
    tracking cae por FK cascade; los mensajes quedan en las conversaciones);
    409 `in_progress` en curso/pausada (cancelar primero); 404 de otra org.
    ✅ Tras borrar desde el detalle, la URL vuelve a la lista sin la fila.
G7. Ajustes → Plantillas: el 409 `in_use` lista las campañas que bloquean
    (nombre · estado) con enlace a `/campaigns?campaign=<id>`; borrado el
    borrador, la plantilla se borra aunque existan campañas completadas o
    canceladas que la usaron (snapshot `template_name`).
