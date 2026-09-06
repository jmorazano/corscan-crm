# US-GC-3 — El agente ofrece y agenda turnos por WhatsApp

Guion E2E (feature 005, US3/US4). Requiere us-gc-1 conectado, org A con
agente encendido y token de IA (ai-mock), `AGENT_COALESCE_MS=2000`.
Inbounds vía `POST /api/dev/wa-mock/inbound` (`phoneNumberId: 111111111`,
`waMessageId` único por mensaje).

## Camino feliz

1. Inbound de un número nuevo: "Hola, quiero un turno para el 2026-09-07".
   ✅ Tras el coalesce, saliente del agente con 3 horarios REALES del lunes
   (respeta reglas y descuenta el ocupado externo 10–11: p. ej. 09:00,
   09:30, 11:00). Nada de eventos ajenos.
2. Inbound "Dale, el de las 11".
   ✅ Saliente de confirmación "…lun 7 sep 11:00…"; `GET
   /api/dev/google-mock/state` muestra el evento `Turno: <nombre>` con
   descripción (cliente, WhatsApp, motivo, "Agendado desde Vocero CRM")
   en 14:00Z–14:30Z; tabla `appointment` con la fila confirmed/agent;
   `contact.notes` con "[IA] Turno agendado: lunes 7 de septiembre a las
   11:00 — …"; la lista "Turnos agendados desde el CRM" lo muestra.

## Caminos infelices

3. Otro número: "quiero un turno para el 2026-09-10" → huecos; ANTES de
   elegir, ocupar 09:00 en el mock (`busy 12:00Z–12:30Z`); inbound "Dale,
   el de las 9".
   ✅ NO se crea evento; saliente "ese horario se acaba de ocupar… Te puedo
   ofrecer: 09:30, 10:00, 10:30"; sin handoff.
4. Inbound "Bueno, el de las 9:30 entonces".
   ✅ Evento creado a las 09:30 y confirmación.
5. `POST /api/dev/google-mock/state {"failNextApi":true}` → otro número
   pide turno.
   ✅ Saliente "Te confirmo el turno con el equipo en un momento", la
   conversación queda en handoff, `/api/health` 200, log
   `[agente] disponibilidad falló: … 500`.
6. `{"revokeAll":true}` → otro número pide turno.
   ✅ Deriva igual que 5; la integración pasa a "Requiere reconexión" (UI
   e índice). Reconectar (us-gc-1 paso 8) restablece.
7. Cancelar un turno desde la lista (o `POST …/appointments/<id>/cancel`).
   ✅ 200; el evento desaparece del mock; el turno figura "Cancelado"; un
   segundo cancel → 404 (monotónico).
8. Reglas: "el agente puede agendar" apagado → otro número pide turno y
   elige.
   ✅ Informa horarios; ante la elección responde que el equipo confirma y
   deriva (handoff), sin crear evento. Volver a encender.
9. Laboratorio: **Ejecutar pruebas**.
   ✅ Corrida verde (6 personas) y el mock NO registra eventos nuevos
   (sandbox offline).

## Última conducción

**5-sep-2026 — VERDE pasos 1–7 y 9** (google-mock + ai-mock + wa-mock):

- Paso 1–2: Lucía → "Tengo estos horarios disponibles: lun 7 sep 09:00,
  09:30, 11:00" → "Dale, el de las 11" → evento `evt_3` 14:00Z, fila
  `apt_…` confirmed/agent, nota `[IA] Turno agendado…`, lista OK.
- Paso 3–4: Pablo → 09:00 ocupado entre oferta y elección → "Uy, ese
  horario se acaba de ocupar. Te puedo ofrecer: jue 10 sep 09:30, 10:00,
  10:30" sin evento ni handoff → "el de las 9:30" → `evt_5` 12:30Z.
- Paso 5: failNextApi → deriva + handoff `modelo`, health 200, error en log.
- Paso 6: revokeAll → deriva, `reconnect_required`, availability 502;
  reconectar → connected.
- Paso 7: cancelar Marcos → 200, `evt_4` fuera del mock, 2do cancel 404.
- Paso 9: corrida `run_dxyjwghp91xu1c29lpmr` done, score 100, 6 verdes,
  eventos del mock sin cambios.
- Paso 8: con "el agente puede agendar" apagado → "Tengo estos horarios
  disponibles: mar 15 sep 09:00, 10:00, 11:00" → "Dale, el de las 9" →
  "Perfecto, un compañero del equipo te confirma ese turno enseguida."
  (handoff), sin evento nuevo; la bandera se volvió a encender.

Gotchas de conducción: el ai-mock necesita la fecha en algún mensaje del
cliente (`YYYY-MM-DD`) para elegir el día; sin ella usa los próximos 3
días. El ocupado externo hay que cargarlo en UTC.
