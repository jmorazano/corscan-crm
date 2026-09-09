# Contratos de API — Variables enriquecidas (009)

## `POST /api/templates` (multipart, extendido)

Campo nuevo `variables` (opcional): **JSON string** de un array de orígenes,
p. ej. `["contact_name","org_name","free_text"]`.

- Si el cuerpo tiene N variables ⇒ `variables` obligatorio con longitud N y
  orígenes del catálogo; si no ⇒ debe omitirse o ser `[]`.
- `422` con mensaje claro ante: huecos/`>5` en el cuerpo, longitud
  inconsistente, origen desconocido.
- La respuesta y `GET /api/templates` suman
  `variableBindings: string[] | null` a cada plantilla.

## `POST /api/campaigns` (extendido)

Campo nuevo `freeTexts` (opcional): array de strings.

- Plantilla CON bindings: se ignoran `variableMode`/`variableText`;
  `freeTexts` debe traer un valor no vacío por cada `free_text` (422 si
  falta). Se persiste en `variable_values`.
- Plantilla legada (bindings null): contrato actual intacto
  (`variableMode`/`variableText`); `freeTexts` se rechaza si viene.
- `GET /api/campaigns` expone `variableValues` en el detalle (para el
  stepper).

## `POST /api/conversations/[id]/messages/template` (extendido)

Body: `{ templateId, variable?, freeTexts? }`.

- Plantilla CON bindings: `freeTexts` con un valor por `free_text`
  (`variable` se ignora); 422 si falta alguno.
- Plantilla legada: contrato actual (`variable`).

## Payload a Graph (interno)

`buildTemplateSendPayload` pasa de `variable: string | null` a
`bodyParams: string[]` (vacío = sin componente body). El header de imagen
(008) no cambia. Ejemplo con 3 variables:

```json
"components": [
  { "type": "body", "parameters": [
    { "type": "text", "text": "María" },
    { "type": "text", "text": "Corscan Ingeniería" },
    { "type": "text", "text": "20% de descuento" }
  ]}
]
```

## Alta en Meta (interno)

`example.body_text = [["María", "Corscan Ingeniería", "ejemplo"]]` — una
muestra por binding, generada del catálogo.
