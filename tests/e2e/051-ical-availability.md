# E2E 051 — Disponibilidad por calendarios iCal (Airbnb)

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock + ical-mock), BD local `vocero`, empresa «Inmobiliaria Demo»
(`org_x063bgv6kib0cum49tz7`, número mock `222222222`, propietario
`socio@vocero.test`, miembro `e2e@vocero.test`), espera del agente en 1 s
durante la corrida (se restaura). Guion: `tests/e2e/fixtures/ical-e2e.mjs`
(`fetch` + `postgres`; borra sus contactos y unidades al terminar). Entre dos
corridas esperar 1 min («Leer ahora» tiene enfriamiento).

Perillas: ical-mock `POST /api/dev/ical-mock/state` (`setBusy`, `failNext`,
`failAlways`, `garbageNext`, `redirectNext`, `guestData`, `delayMs`, `reset`);
`POST /api/dev/ical-sync {organizationId, ageMs, tick}` envejece lecturas y
corre una vuelta del ticker; ai-mock con la sección `DISPONIBILIDAD DE LAS
UNIDADES` → `check_stays` ante dos fechas, `[E2E_STAYS_PROMESA]` afirma una
reserva.

## Corrida 11-nov-2026: TODO VERDE (44/44)

A — alta: host ajeno 400 · HTML en vez de calendario 422 sin guardar · alta
con su ocupación · la llave no vuelve al navegador (solo «…1234») · mismo
calendario 409 · enlace propio por unidad · enlace general (y uno inválido
400) · grilla de 30 días · GET sin URLs · miembro 403 · tarjeta «3
unidades» · enlace cifrado en la BD.

B — agente: «¿lugar del 12 al 15/12 para 4?» → nombra solo Cabaña Pino
(Abeto ocupada, Roble para 2) con
`https://bosque.example/pino?in=2026-12-12&out=2026-12-15&p=4`, nunca Airbnb,
el turno no pidió nada al ical-mock, lead a Interesado (044) · «te la
reservé» → la guarda de promesas lo cambia por el enlace del complejo · sin
lugar → fechas cercanas con las mismas noches.

C — lecturas de 4 h → «Dejame confirmar…» sin ofrecer nada · reserva con
`DESCRIPTION` y teléfono → en la BD solo fechas · 404 → `link_revoked`,
conserva el último dato bueno, tarjeta «Requiere reconexión» y texto en
criollo · 302 a metadata → `invalid` sin seguirla · «Leer ahora» y 429 al
repetirlo.

D — switch apagado → el agente no consulta calendarios.

E — editar sin enlace conserva el calendario · quitar · miembro 403.

UI (Browser pane, 1280 px y 375 px): tarjeta en Integraciones, switch,
enlace general con ayuda de los marcadores, unidades con estado, grilla
(13–15 y 27/11–1/12 ocupados), diálogo con la guía del Paso 1; sin scroll
horizontal en móvil.
