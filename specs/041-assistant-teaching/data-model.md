# Data Model: Claude le enseña al agente (041)

**Sin migración.** Todas las columnas que cambian son `text` sin CHECK en la
base; los valores nuevos son solo de los enums de TypeScript (drizzle). La
próxima migración libre sigue siendo la **0030**.

## kb_entry (existente, 012/015)

| Campo | Cambio |
|---|---|
| `source` | enum TS `["manual", "lab", "trainer"]` → suma `"assistant"`. Lo pone `createEntry(org, input, "assistant", tx)` cuando la entrada nace de `teach_agent`. Una entrada editada desde Claude conserva su origen (el origen es de la creación, como hoy). |

`KbSource` (`src/server/kb/service.ts`) suma `"assistant"`.

## agent_change (existente, 015)

| Campo | Cambio |
|---|---|
| `source` | enum TS `["trainer", "manual", "lab"]` → suma `"assistant"`. |
| `conversation_id`, `message_id` | `null` en los cambios de Claude (no nacen de un mensaje del Entrenador). |
| `reverted_by` | id del usuario propietario que deshizo (desde Claude o desde el panel). |

Índice existente `agent_change_org_created_idx (organization_id, created_at)`
sirve para el tope por hora:

```sql
select count(*) from agent_change
where organization_id = $org and source = 'assistant'
  and created_at > (now() at time zone 'utc') - interval '1 hour';
```

(Timestamps de la base en UTC sin zona: comparar contra `now() at time zone
'utc'` o un ISO `::timestamp`, nunca un `Date` crudo en `sql```.)

`ChangeDto` (`src/server/trainer/changes.ts`) suma `source`. `ApplyCtx` suma
`source?: "trainer" | "assistant"` (default `"trainer"`).

## assistant_access_log (existente, 040)

| Campo | Cambio |
|---|---|
| `tool` | nuevos valores `get_agent_knowledge`, `teach_agent`, `edit_agent`, `list_agent_changes`, `undo_agent_change`. |
| `reason` | enum TS suma `"rejected"` (todos los cambios del pedido rechazados por guarda o motor). |
| `summary` | lo arma el servidor: «Enseñó N cambios (M rechazados)», «Corrigió…», «Deshizo «<resumen del cambio>»». Nunca el texto enseñado completo. |

## Reglas de validación (de la spec)

- Pedido: 1–10 cambios (`MAX_CHANGES_PER_TURN`); más → pedido inválido.
- Topes por campo: los de `KB_LIMITS` y `PROFILE_LIMITS` (rechazo, nunca recorte).
- Tope por empresa: 30 cambios aplicados con `source='assistant'` por hora móvil.
- Guardas por cambio (research D3): enlaces con host conocido, teléfonos y
  correos presentes en el corpus, nada de datos de contactos, nada de
  marcadores internos, sin P/R o bloque repetido.
- Deshacer desde Claude: solo `source='assistant'`; idempotente.

## Transiciones

```text
cambio de Claude:  (pedido) ──guardas+motor──▶ aplicado ──undo──▶ deshecho
                                     └─────────▶ rechazado (no se guarda en agent_change)
```

Un cambio deshecho no vuelve a «aplicado» (para rehacerlo, se enseña de nuevo).
