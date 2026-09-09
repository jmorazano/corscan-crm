# Data Model — Variables enriquecidas (009)

## Cambios de columnas

| Tabla | Columna nueva | Tipo | Reglas |
|---|---|---|---|
| `template` | `variable_bindings` | jsonb, nullable | Array de orígenes (`contact_name` \| `contact_phone` \| `org_name` \| `free_text`); posición i ↔ `{{i+1}}`; longitud == N variables del cuerpo; **NULL = plantilla legada** (flujo actual). |
| `campaign` | `variable_values` | jsonb, nullable | Array de strings: un valor no vacío por cada binding `free_text`, en orden de aparición; NULL para campañas legadas o plantillas sin textos libres. |

Sin tablas nuevas. `variableMode`/`variableText` de `campaign` se conservan
(flujo legado) — no se migran ni borran.

## Invariantes

- Alta de plantilla: si `countVariables(body) > 0` ⇒ bindings obligatorios y
  de esa longitud exacta; orígenes ∈ catálogo. Cuerpo: índices contiguos
  desde 1, máx 5, repeticiones permitidas.
- Alta de campaña con plantilla nueva: `variable_values.length ==` cantidad
  de `free_text` en los bindings; todos no vacíos (trim).
- Envío 1:1 con plantilla nueva: ídem con los valores tipeados.
- Envío con plantilla legada: exactamente el contrato actual
  (`variable` única).

## Resolución (pura, `resolveVariableValues`)

```
(bindings, { contactName, contactPhone, orgName, freeTexts }) →
  { ok: true, values: string[] }        // values[i] para {{i+1}}
| { ok: false, error: "Faltan N texto(s) libre(s)…" }
```

- `contact_name` → nombre del contacto (puede ser su teléfono si el import
  no traía nombre — se envía igual).
- `contact_phone` → teléfono en formato legible (`formatPhone`).
- `org_name` → nombre de la organización que envía.
- `free_text` → siguiente valor de `freeTexts` (error si falta o vacío).

## Estados

Sin estados nuevos: los bindings son inmutables tras el alta (recrear la
plantilla = nuevos bindings, mismo upsert org+name+language de siempre); los
`variable_values` se congelan al crear la campaña.
