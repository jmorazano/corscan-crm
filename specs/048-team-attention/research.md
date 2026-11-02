# Research — 048 Quién atiende

Decisiones de diseño tomadas sobre el código existente (2-nov-2026). Cada una
con su motivo y lo descartado.

## R1. Esperas en una tabla propia, no derivadas al leer

- **Decisión**: tabla `attention_wait` con una fila por espera (abierta o
  cerrada).
- **Motivo**: el aviso necesita una marca durable de «ya avisé» (at-most-once
  ante reinicios, constitución IV), y «por qué empezó» (derivación) se pierde
  cuando 031 limpia `conversation.handoff_at` al volver el agente. Además,
  Métricas lee filas ya cerradas en vez de recorrer mensajes.
- **Descartado**: calcular las esperas al leer, desde mensajes y
  `conversation_event`. No da dónde guardar el «ya avisé», y la consulta del
  período sería cara y difícil de testear.

## R2. Abrir en dos ganchos, cerrar por conciliación

- **Decisión**: la espera se ABRE en los dos únicos lugares donde nace:
  - `ingestInboundCore`, cuando entra un mensaje del cliente en una
    conversación derivada o con la IA apagada;
  - `applyHandoff` de `pipeline.ts`, cuando el agente deriva.

  Se CIERRA con una conciliación (`reconcileWait`) que mira los mensajes
  posteriores al inicio. La conciliación corre en el barrido de cada minuto,
  antes de abrir una espera nueva en la ingesta y antes de mostrar «esperando
  ahora».
- **Motivo**: los mensajes del equipo salen por muchos caminos (`sendText`,
  `send-media`, plantillas, Instagram, reintentos). Engancharse en todos
  invita a olvidarse alguno. Mirando los mensajes, el cierre usa la hora real
  del mensaje: la demora es exacta aunque el barrido pase un minuto después.
- **Descartado**: cerrar desde cada camino de envío (frágil), y abrir también
  por barrido (perdería derivaciones que 031 limpia antes del barrido).

## R3. Qué cierra una espera

- **Respondida**: el primer mensaje saliente con `ai_generated = false` que
  sea del equipo:
  - con `sent_by_user_id` y no difusión → persona (`via = crm`);
  - con `source = phone` → «Desde el celular» (`via = phone`, sin persona).

  Los fallidos no cuentan.
- **Retomada por el agente**: el primer saliente `ai_generated = true`
  posterior al inicio.
- **Sin respuesta**: `now ≥ last_inbound_at + 24 h` sin ninguna de las
  anteriores (WhatsApp e Instagram usan 24 h).
- **Difusiones**: se reutiliza la detección de 036. Hoy `isTeamBroadcast` es
  privada en `src/server/ai/events.ts`; se exporta como
  `isTeamBroadcastMessage` y se respeta `details.broadcast` si ya está
  marcada.
- **Campañas y API**: `sent_by_user_id` NULL (campañas) o `api_key_id`
  (014). No cumplen ninguna condición: no cierran.

## R4. Cuándo NO se abre

- `is_test`, o `kind` distinto de `whatsapp`/`instagram`.
- Mensajes que no son turno del cliente (`isCustomerTurnMessage`: las
  reacciones de 038 no cuentan).
- El mensaje que activa la baja por palabra clave (011), y contactos con
  `opted_out_source = 'keyword'`.
- Derivación por `ventana` (la ventana está cerrada: nadie puede responder
  texto libre).
- Que el equipo esté en la charla (031, `team_active`): no es una espera
  (decisión de la spec).

«Necesita una persona» se decide así: `handoff_at` no nulo, o
`ai_enabled = false` en la conversación, o `agent_profile.enabled = false` en
la empresa (incluye empresas sin perfil del agente).

## R5. Aviso: barrido con reserva-primero

- **Decisión**: el barrido (`startAttentionTicker`, 60 s, como 042 y 044)
  concilia las esperas abiertas. Para cada una todavía abierta con
  `started_at + minutos ≤ now`, reserva con
  `UPDATE … SET alerted_at = now WHERE id = ? AND alerted_at IS NULL AND
  status = 'open' RETURNING`. Solo quien gana la reserva envía.
- **Motivo**: un aviso por espera aun con reinicios o dos réplicas (FR-009).
  Si el envío falla después de reservar, no se reintenta (spec: edge case
  «no se pudo entregar»).
- **Destinatarios**: `notifyOrganization(org, payload, sub => ownerIds.has(sub.userId))`
  de 013, sin importar el modo del dispositivo (`all`/`handoff`): el aviso
  es para el dueño. `tag = wait-<id>` para no apilar notificaciones
  repetidas.
- **Descartado**: un `setTimeout` por espera (se pierde al reiniciar; 036 lo
  usa con re-agendado, pero el barrido ya existe y alcanza con precisión de
  1 minuto, SC-001).

## R6. Firma: nombre copiado en el mensaje

- **Decisión**: columna `message.sent_by_name`, que se llena al insertar
  donde ya se pone `sent_by_user_id` (4 lugares: `send.ts`, `send-media.ts`,
  `whatsapp/templates.ts`, `instagram/send.ts`). Backfill en la migración
  desde `user.name`. `serializeMessage` la expone como `sentByName`.
- **Motivo**: `serializeMessage` es síncrona y se usa también en el SSE, sin
  join posible. Y el FK `sent_by_user_id` es `ON DELETE SET NULL`: al
  eliminar la cuenta (019) se perdería el nombre, contra FR-022.
- **Descartado**: join con `user` al listar (no sirve en el SSE y pierde el
  nombre de cuentas eliminadas), o copiar el nombre solo al eliminar la
  cuenta (dos caminos para lo mismo).

## R7. «Última vez que abrió el CRM»

- **Decisión**: `member.last_seen_at`, que actualiza `/api/events` (el SSE
  que abre `AppShell` en toda pantalla de la app) al conectar y como mucho
  cada 5 minutos con el latido. Hay un freno en memoria por
  (empresa, usuario) y un `UPDATE … WHERE last_seen_at IS NULL OR
  last_seen_at < now − 5 min`.
- **Motivo**: es exactamente «usó la app». Guarda solo el último momento
  (FR-019, sin historial). No suma escrituras por pedido.
- **Descartado**: actualizar en `withAuth` (una escritura en cada pedido), y
  una tabla de conexiones (historial: fuera de alcance).
- **Verificar al implementar**: que `AppShell` abra el SSE también en
  Métricas y Ajustes. Si alguna pantalla no lo abre, se toca ahí.

## R8. Métricas: agregación en TypeScript puro

- **Decisión**: `src/server/metrics/team.ts` trae las esperas del período
  por `started_at` (con `metricsWindow` de 024, mismo corte y zona).
  `summarizeTeamAttention` (puro, en `src/lib/team-attention.ts`) calcula
  totales, a tiempo o tarde con los minutos de la empresa, la mediana del
  equipo y la de cada persona. Los mensajes y las conversaciones por
  persona salen de un `GROUP BY sent_by_user_id` en SQL.
- **Motivo**: las esperas del período son cientos, no millones, y el
  cálculo puro se testea con números conocidos (SC-003). Los mensajes sí
  pueden ser muchos: van agrupados en SQL.
- **Tope**: 20.000 esperas por consulta. Si se supera, la respuesta lo dice
  (`truncated`), como las demás listas.

## R9. Acceso del miembro: «Mi atención» en Ajustes

- **Decisión**: Métricas sigue siendo solo del propietario
  (`OWNER_ONLY_SECTIONS` intacto). El miembro ve su fila en Ajustes → Mi
  atención (`/settings/attention`, agregada a `MEMBER_SETTINGS_PATHS`), al
  lado de Notificaciones, que es lo que más va a tener que corregir. La API
  `GET /api/me/attention` devuelve SOLO la fila de la sesión.
- **Motivo**: abrir Métricas a miembros obliga a ocultar sección por sección
  y es fácil filtrar algo. Una ruta propia que solo sabe devolver la fila de
  quien pregunta no puede filtrar datos ajenos (FR-025, SC-006).

## R10. Configuración del aviso

- **Decisión**: tabla por empresa `attention_settings` (patrón de
  `pipeline_settings` y `send_settings`): `alert_enabled` (falso por
  defecto) y `alert_minutes` (15; 5–120). Va en una tarjeta en Ajustes →
  Equipo (`team-client.tsx`, ya es del propietario), con
  `GET/PUT /api/settings/attention` (`withOwner`).
- La respuesta incluye `ownerHasPush`: si la sesión tiene suscripciones
  (FR-012).

## R11. Cuentas de plataforma y personas que se fueron

- Quien respondió o envió en el período y no es miembro de la empresa:
  - si es cuenta de plataforma (`SUPER_ADMIN_EMAILS`), va a «Soporte de la
    plataforma»;
  - si no, es «ya no está en el equipo», con el nombre copiado
    (`responder_name` / `sent_by_name`).

## R12. Pruebas de tiempo

- `POST /api/dev/attention { now }` corre el barrido con un reloj inyectado
  (gate `dev-guard`, 404 en producción), igual que `POST /api/dev/follow-up`
  de 042.
- La derivación se provoca con el ai-mock: un mensaje con «humano» →
  `handoff`.
- El push se observa en el push-mock de 013.
