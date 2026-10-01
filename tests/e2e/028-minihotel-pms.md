# E2E 028 — Conector MiniHotel

**Entorno**: dev server del worktree en `:3000` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock,
`AGENT_COALESCE_MS=2000`. Simulador: `/api/dev/minihotel-mock/gds` (perillas en
`/api/dev/minihotel-mock/state`). Empresa: `principal` (WhatsApp de prueba
`111111111`), super admin `superadmin@vocero.test`. Antes de empezar se guarda
la fila `mcp_integration` de `principal` (conector de Altos) y al final se
restaura tal cual.

Fechas: `D1` = hoy + 30, `D2` = D1 + 2 (2 noches).

| # | Paso | Resultado esperado |
|---|---|---|
| 1 | Admin → principal → Conector → Editar: perfil MiniHotel, dirección `http://localhost:3000/api/dev/minihotel-mock/otra` | 422 «…termina en /gds» |
| 2 | Igual con dirección `…/minihotel-mock/gds` y motor `https://evil.example/x` | 422 `invalid_booking_url` |
| 3 | Dirección `…/gds`, hotel `sandbox`, tarifa `USD`, motor del sandbox | 200; la tarjeta dice «MiniHotel (hotel)» |
| 4 | Integraciones: la tarjeta muestra hotel, tarifa y host del motor; cargar usuario/contraseña de prueba → Conectar | «Conectada»; habitaciones DBL/FAM/SUITE con capacidad; DBL con «Vista al jardín» y SIN «Balcón» (no lo tienen todas) |
| 5 | `GET /api/integrations/mcp` | `credentialLast4` = últimos 4 de la contraseña; la contraseña no aparece en ningún lado |
| 6 | Probar una consulta D1→D2, 2 adultos | Hay lugar; DBL/FAM/SUITE con totales USD por régimen; enlace con `from`,`to`,`nAdults` |
| 7 | Probar con 5 adultos | Todo marcado «No alcanza para el grupo»; sin enlace |
| 8 | WhatsApp: «¿tienen lugar del D1 al D2 para 2 adultos?» | El agente responde con habitaciones, montos y UN enlace del motor con la búsqueda |
| 9 | Apagar «Informar precios» y repetir | Respuesta SIN importes, con el enlace |
| 10 | `soldOut` = D1..D2-1 y preguntar | «no me queda lugar, pero…» + alternativas + enlace con otras fechas; el simulador registra Immediate + Bulk + Immediate |
| 11 | `soldOut` = D1-7..D2+7 | «tampoco en los días cercanos», sin inventar |
| 12 | «¿del D1 al D2 o del D3 al D4?» | Compara los dos rangos |
| 13 | «reservámela vos» | No promete; manda el enlace |
| 14 | `failNext` y preguntar | El agente dice que no pudo consultar / deriva; el turno no se cae; la siguiente consulta anda |
| 15 | `ipNotAuthorized` → Verificar | «…todavía no autorizó la IP de este servidor»; estado «Requiere reconexión»; al sacar la perilla y verificar, vuelve a «Conectada» |
| 16 | `nextUnauthorized` → Verificar | «…rechazó el usuario o la contraseña» |
| 17 | Laboratorio: persona de alojamiento | Cero llamadas al simulador; filas `is_test` en la bitácora |
| 18 | Logs del servidor | La contraseña de prueba no aparece |
| 19 | Restaurar el conector de Altos desde la copia | Fila idéntica a la original |

## Corrida 1-oct-2026 — 19/19 ✅

Evidencia (dev server del worktree, empresa `principal`):
- 1–3: 422 `not_ari`, 422 `invalid_booking_url`, 422 sin hotel/tarifa; alta OK → «MiniHotel (hotel) · Sin conectar» (la credencial de Altos se borró).
- 4–5: «Conectada», «contraseña terminada en ••••1234»; DBL 2a/1n/1b con «Vista al jardín» y SIN «Balcón»; `GET /api/integrations/mcp` sin usuario ni contraseña.
- 6–7: 3 tipos con total por régimen en USD + no reembolsable; enlace `?from=20261031&to=20261102&nAdults=2&currency=USD&language=es-ES`; con 5 adultos todo «No alcanza para el grupo» y sin enlace.
- 8: respuesta con 2 habitaciones, montos y UN enlace; simulador: 1 Immediate.
- 9: precios apagados → respuesta sin importes, con el enlace y la frase de valores.
- 10: Immediate 13→15 (lleno) → Bulk 06→22 → 3 Immediate (10→12, 11→13, 15→17) → «no me queda lugar, pero…» + enlace de la primera.
- 11: Immediate + Bulk, sin confirmaciones → «tampoco en los días cercanos», ofrece persona.
- 12: 2 Immediate (sin Bulk) → «Hay lugar del 13…» / «Del 20 al 22: NO hay lugar».
- 13: «reservámela vos» → no promete.
- 14: 500 del simulador → «Dejame consultarlo con el equipo…» (handoff); la siguiente consulta anda y el estado sigue «Conectada».
- 15–16: «…todavía no autorizó la IP de este servidor…» / «…rechazó el usuario o la contraseña…» con «Requiere reconexión»; Verificar recupera.
- 17: Laboratorio 8/8 casos (incluida `consulta_alojamiento`), 0 llamadas al simulador, 2 filas `is_test`.
- 18: la contraseña de prueba no aparece en el log del servidor ni en la bitácora.
- 19: fila de Altos restaurada idéntica (credencial cifrada incluida); Verificar → 3 herramientas; búsqueda → 6 alojamientos.
- Móvil 375 px: sin desborde; vista previa con alternativas legible.
- Gotchas del guion: el número `5493515550101` ya existía con BAJA (el agente calla, correcto); usar números nuevos. `javascript_tool` corta a los 45 s: mandar y sondear en llamadas separadas. El `<select>` controlado de React no toma `form_input`: setter nativo + `change`.
