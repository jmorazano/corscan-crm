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
