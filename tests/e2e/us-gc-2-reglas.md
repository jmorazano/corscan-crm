# US-GC-2 — Reglas de turnos y vista previa

Guion E2E (feature 005, US2). Requiere us-gc-1 conectado. Hoy es sábado
5-sep-2026 en el entorno de conducción (lun 7 = primer día hábil).

1. `POST /api/dev/google-mock/state` con ocupado externo lun 7-sep
   10:00–11:00 local (`13:00Z–14:00Z`). Vista previa (o
   `GET …/availability?from=2026-09-07&days=1`).
   ✅ Aparecen 09:00, 09:30, 11:00… y NO 10:00 ni 10:30; ningún dato del
   evento (solo huecos).
2. Guardar reglas con franja invertida (lunes 12:00–09:00).
   ✅ 422 con motivo "la franja debe terminar después de empezar"; nada se
   pisa.
3. Guardar: lunes 09:00–12:00, duración 45, margen 15, instrucciones "Pedí
   nombre completo y motivo antes de agendar.".
   ✅ 200; al recargar persisten; la vista previa del lunes muestra solo la
   grilla de 60 min (09:00, 10:00, 11:00) menos los ocupados.
4. Elegir calendario inexistente por API (`calendarId: "no_existe"`).
   ✅ 422 "no existe en la cuenta conectada". Elegir "Turnos" → 200 y el
   nombre se muestra en la tarjeta de conexión.
5. Apagar "el agente puede agendar" → guardar.
   ✅ El agente sigue informando horarios pero ante la elección deriva al
   equipo (ver us-gc-3 paso 8).

## Última conducción

**5-sep-2026 — VERDE** (pasos 1–4 por API desde la sesión del navegador +
UI verificada por captura):

- Ocupado 10–11 → lunes: `09:00 09:30 11:00 11:30 … 17:30` (sin 10:00/10:30).
- Franja invertida → 422 `weeklyHours.1.0: la franja debe terminar después
  de empezar`.
- Reglas 45+15 + instrucciones → 200; lunes quedó `09:00` (10:00 ocupado
  externo, 11:00 ocupado por el turno de Lucía del guion 3); la UI muestra
  la grilla por día y la tarjeta de reglas con los valores guardados.
- Calendario inexistente → 422 (unit test de rutas); el selector real
  lista "Agenda del negocio (principal)" y "Turnos".
- Paso 5: conducido en us-gc-3 paso 8 (informa horarios, deriva al elegir,
  sin evento).
