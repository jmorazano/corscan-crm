# El agente sabe la fecha y la hora del negocio

Pedido de Altos de la Ciudad (3-nov-2026): Camila tiene reglas que dependen
de la hora (ingresos para hoy después de las 17 y después de las 22, cierre
de la reserva distinto de día y de noche, el equipo atiende desde las 9).
El prompt NO tenía la hora: solo la fecha, y únicamente dentro de la sección
del conector. El modelo adivinaba (casi siempre de día) — 31/10 22:55 aplicó
«de 17 a 22»; 1/11 23:24 y 2/11 22:35/22:52 dijo «en un momento».

Ahora cada turno lleva la sección `FECHA Y HORA` (`clockSection` en
`src/lib/agent-clock.ts`), calculada al responder y en la zona de la empresa
(`agent_profile.follow_up_timezone`, Córdoba por defecto; inválida → Córdoba):
«Ahora: martes 3/11/2026, 22:35 (hora de Córdoba, UTC−3).» + la regla de
usarla para todo lo que dependa de la hora y de no prometer «en un momento»
fuera del horario del equipo. La misma línea va al seguimiento automático
(con el reloj del barrido) y al Entrenador.

Conducción: `POST /api/dev/wa-mock/inbound` a `pn_mock_1` (panadería) + BD
por `docker exec … psql`. El ai-mock contesta «¿qué hora es?» con la línea
que encuentre en la sección (`dispatchClock`).

## Pasos

1. ✔ 3-nov-2026 13:13 UTC: entrante «Hola, ¿qué hora es?» de `5493410000881`
   → el agente responde «Según mi reloj: martes 3/11/2026, 10:13 (hora de
   Córdoba, UTC−3).» (hora local, no la del servidor en UTC).
2. ✔ Zona inválida (`Marte/Olympus`) en la empresa → misma respuesta en hora
   de Córdoba; sin errores en el log. Zona restaurada.
3. ✔ Contactos de prueba borrados.

Unitarios: `tests/unit/agent-clock.test.ts` (los cuatro casos reales en UTC,
medianoche, zona inválida, nombres/desfases de otras zonas, sección en el
prompt del agente después de las instrucciones, línea del seguimiento después
de su marcador, Entrenador, ai-mock).
