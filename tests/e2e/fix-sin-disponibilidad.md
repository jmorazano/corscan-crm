# E2E — «Sin disponibilidad» no deriva y `update_lead` sin nota (15-oct-2026)

Incidente del 14-oct-2026 en Altos de Calamuchita: dos conversaciones que
preguntaban por fechas sin lugar terminaron en atención humana.

1. «8, 10 o 6 personas» del 21 al 23 de noviembre: el agente buscó para 6 y
   para 8 (las dos vacías), pidió una tercera búsqueda, agotó las consultas
   del conector (eran 2) y el pipeline mandó la frase cableada «Estoy
   consultando la disponibilidad y te confirmo en un ratito» + atención
   humana. El cliente esperó a una persona.
2. «Alejandra … 10 personas»: el modelo devolvió `update_lead` con
   `contact_name` y una respuesta correcta pero sin `note` (obligatoria), tres
   veces → «el modelo devolvió una respuesta que no se pudo leer» + atención
   humana.

Entorno: dev server del worktree + mocks (wa-mock, ai-mock, mcp-mock), BD
clonada de `vocero`, org «Inmobiliaria Demo» (`org_x063bgv6kib0cum49tz7`,
número `222222222`) con el conector de Altos habilitado por el super admin
contra `/api/dev/mcp-mock/assistant`, agente encendido con espera de 1 s.
Conducido por un script Node (`fetch` + `postgres`). El mcp-mock entra hasta
10 personas: 11 o más devuelve vacío.

## A — Sin lugar: el modelo insiste, se lo corrige y contesta
Perilla `[E2E_SIN_LUGAR]`: el modelo pide 11, 12, 13… personas.
- 3 consultas al conector (antes cortaba en 2).
- Al cuarto pedido el pipeline le dice que no quedan consultas y el modelo
  contesta «no me quedó lugar…». Sin «te confirmo en un ratito», sin
  `ai_handoff`, `handoff_at` nulo. Log: `consultas del conector agotadas`.

## B — Sin lugar y el modelo terco
Perilla `[E2E_SIN_LUGAR_TERCO]`: sigue pidiendo después de la corrección.
- Sale UN mensaje propio: «Lamentablemente no tengo disponibilidad del 21/11
  al 23/11 para 11, 12 ni para 13 personas. ¿Querés que te busque otras
  fechas cercanas?». Sin `ai_handoff`.

## C — `update_lead` sin nota
Perilla `[E2E_SIN_NOTA]`: el JSON del caso real.
- Sale la respuesta, se guarda el nombre «Alejandra», sin `ai_handoff`.

## D — Regresión: con lugar
«somos 4 personas del 2026-11-21 al 2026-11-23» → opciones + enlace, sin
derivar.

## E — Camino infeliz: el sistema de reservas se cae
`failNextCall` en el mcp-mock → `ai_error/tool` en el hilo, aviso al cliente
y atención humana (ahí sí hace falta una persona). NO dice «no hay lugar»:
no lo sabe.

## Resultado (15-oct-2026)
20/20 verdes. Gate: typecheck + lint + build + 1714 tests.
