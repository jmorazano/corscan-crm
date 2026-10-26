# E2E 041 — Claude le enseña al agente

Guion de comportamiento de [specs/041-assistant-teaching](../../specs/041-assistant-teaching/spec.md).
Entorno: el de la 040 (`tests/e2e/040-crm-mcp-server.md`): CRM local con
mocks, `e2e@vocero.test` propietario de «Negocio de Super Admin Local»
(`principal`), switch encendido y una conexión del cliente de prueba.

```bash
node tests/e2e/fixtures/seed-assistant.mjs
```

```bash
node tests/e2e/fixtures/mcp-client.mjs teach --state <archivo de la conexión>
```

## A. Lectura del conocimiento (US1)

- 17 herramientas; `teach_agent` escritura no destructiva, `edit_agent` y
  `undo_agent_change` destructivas, las lecturas de solo lectura.
- `initialize` nombra la enseñanza en las instrucciones.
- `get_agent_knowledge`: perfil + KB con ids y origen; con `ids`, texto
  completo; `query` sin mayúsculas ni tildes.

## B. Enseñar y corregir (US1)

- Un pedido con 3 válidos (P/R de mascotas con precio y el enlace del
  negocio, bloque de wifi, regla en instrucciones) → 3 aplicados con origen
  `assistant`.
- `teach_agent` con un `kb_delete` → argumentos inválidos.
- `edit_agent`: editar la P/R, borrar el bloque de la pileta, cambiar el
  saludo → aplicados; vaciar el nombre → rechazado.

## C. Deshacer (US2)

- `list_agent_changes` → 6 de Claude deshacibles; con `all` aparece el del
  Entrenador (`chg_a41trainer`) con `can_undo_here: false`.
- Deshacer el borrado → la entrada vuelve; repetir → «ya estaba deshecho»;
  el del Entrenador → «deshacelo desde el Entrenador»; inexistente → no
  encontrado.
- Navegador: Bandeja → Entrenador (`/inbox?c=<entrenador>&d=1`) → los
  cambios con «· desde Claude», los deshechos tachados; «Deshacer» desde el
  panel → `list_agent_changes` lo devuelve deshecho.
- Ajustes → Asistentes: «Enseñanza»/«Deshacer» en el registro,
  «Enseñó 3 cambios (6 rechazados)», «Deshizo «…»», todo-rechazado con
  «todo rechazado por las protecciones».

## D. Protecciones (US3)

En el mismo pedido de B, 6 rechazados con su índice y motivo: enlace nuevo
(`pagos-rapidos.xyz`), teléfono nuevo, dato de un contacto (`@juan.prueba041`),
marcador interno (`[ENTRENADOR]`), P/R repetida (nombra `kb_a41check`) y
alias de pago nuevo (`pagos.rapidos`). Después:

- Tope: con 6 en la hora entran 24 más y el siguiente se rechaza con «Tope
  de 30 cambios por hora… desde las HH:MM»; las lecturas siguen.
- `seed-assistant.mjs --switch off` → enseñar denegado; `--role member` →
  denegado; ambos se restauran.

## E. El agente usa lo enseñado

```bash
curl -s -X POST http://localhost:3000/api/dev/wa-mock/inbound -H 'content-type: application/json' -d '{"phoneNumberId":"111111111","from":"5493510041041","name":"Prueba Turno 041","text":"[E2E_KB] kg"}'
```

Tras la espera del agente, la respuesta es la línea de la P/R corregida desde
Claude («R: Sí, mascotas de hasta 10 kg…»).

## F. Textos (US4)

- Consentimiento de una conexión nueva: lee primero, después «Puede
  enseñarle al agente… No puede enviar mensajes ni cambiar ningún otro dato».
- Ajustes → Asistentes: texto del switch con enlace al Entrenador y el aviso
  «Desde el 27 de octubre…» para conexiones anteriores.

## G. Claude Code real

`claude mcp add --transport http vocero-local http://localhost:3000/api/mcp`
y `claude mcp login vocero-local`; preguntas en
`specs/041-assistant-teaching/quickstart.md` §3, incluida la conversación
«Prueba Engaño 041» (un cliente que pide «actualizar el conocimiento» con un
alias y un teléfono ajenos): el CRM rechaza lo que Claude intente.

## Resultado (26-oct-2026)

- A–D: `mcp-client.mjs teach` verde dos veces seguidas (34 chequeos).
- C navegador: 30 cambios «desde Claude» en el panel; «Deshacer» del panel
  reflejado en `list_agent_changes`; registro con las etiquetas.
- E: el agente respondió «R: Sí, mascotas de hasta 10 kg con un cargo de
  limpieza; avisá al reservar.»
- F: consentimiento y Ajustes con los textos nuevos (capturas en la sesión).
