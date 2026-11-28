# Modo de prueba del agente («solo en las que yo prenda»)

Caso: una empresa nueva (Distrito Inmobiliario) quiere prender el agente para
algunos contactos conocidos antes de abrirlo a todos.

Automatizado en `tests/e2e/fixtures/agent-scope-e2e.mjs` (dev server en :3000
con mocks; deja la empresa como estaba):

1. `GET /api/agent/scope` → modo `all` y conteo de conversaciones reales.
2. Un miembro no cambia el modo (403); «todas» sin `enableExisting` → 400.
3. `PUT {scope:"selected", enableAgent:true}` → todas las conversaciones con la
   IA apagada y el agente de la empresa prendido.
4. Mensaje de un número nuevo → la conversación nace apagada, el turno calla
   con `ai_silent`/`paused` y no sale nada.
5. El miembro prende la IA del chat → el siguiente mensaje se responde.
6. `GET /api/conversations?filter=ai_on` → solo ese chat, `aiOnTotal = 1`, sin
   Entrenador.
7. Repetir `selected` no apaga lo que el equipo prendió.
8. `all` sin prender las apagadas → las existentes quedan igual, la nueva nace
   prendida y el agente responde.
9. `all` con `enableExisting` → todas prendidas.

Manual en el navegador (verificado): al prender el agente en `/agent` aparece
el diálogo «¿En qué conversaciones responde el agente?»; con el modo de prueba
la tarjeta dice «todavía no prendiste la IA en ninguna conversación», la
Bandeja muestra la pastilla «IA prendida» y prender la IA desde la ficha la
suma al filtro.
