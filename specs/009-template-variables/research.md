# Research — Variables enriquecidas (009)

## D1 — Dónde viven los bindings

**Decision**: columna `variable_bindings` (jsonb, array de strings del
catálogo, posición i = variable `{{i+1}}`) en la MISMA fila de `template`;
`NULL` = plantilla legada.

**Rationale**: es un atributo 1:1 de la plantilla, chico y de lectura
conjunta (todo listado/envío lo necesita); una tabla aparte solo agregaría un
JOIN. jsonb permite validación por Zod en el borde.

**Alternatives**: tabla `template_variable` por fila — normalización sin
beneficio a N≤5; columnas fijas var1..var5 — rígido y feo.

## D2 — Textos libres de campañas

**Decision**: columna `variable_values` (jsonb, array de strings) en
`campaign`: un valor por cada binding `free_text`, EN ORDEN de aparición.
Solo aplica a plantillas con bindings; `variableMode`/`variableText` quedan
para el flujo legado (sin migrar campañas existentes).

**Rationale**: mismo patrón que el `variableText` actual (valor común por
campaña — asunción de la spec); congelarlo en la campaña evita que editar la
plantilla cambie campañas en curso.

**Alternatives**: valores por destinatario — fuera del alcance elegido;
reusar `variableText` con JSON adentro — tipo mentiroso.

## D3 — Dónde se resuelven los valores

**Decision**: en `sendTemplateCore` (embudo único): recibe `freeTexts?:
string[]` y resuelve `contact_name` → `contact.name`, `contact_phone` →
`formatPhone(contact.phone)`, `org_name` → `organization.name` (consulta
liviana solo si algún binding la pide), `free_text` → shift de `freeTexts`.
La función pura `resolveVariableValues(bindings, ctx)` vive en
`template-body.ts` para que el preview del cliente use LA MISMA lógica con
muestras.

**Rationale**: defensa en profundidad — campañas y 1:1 ya pasan por ahí; la
resolución pegada a los datos del destinatario evita duplicar en runner y
route. Costo: un SELECT del nombre de la org por envío con `org_name` (con
pacing de 4s, irrelevante).

**Alternatives**: resolver en el runner y pasar el array final — duplica la
lógica en el 1:1 y separa la validación del punto de envío.

## D4 — Compatibilidad legada

**Decision**: `variable_bindings NULL` ⇒ TODO el camino actual intacto:
`needsVariable` (una `{{1}}`), `input.variable`, `variableMode/variableText`
de campañas, diálogo 1:1 con texto tipeado. Las plantillas nuevas SIEMPRE
llevan bindings si el cuerpo tiene variables (el alta lo exige).

**Rationale**: FR-007 pide cero cambio observable; el discriminador NULL es
explícito y no requiere backfill (idempotencia trivial).

**Alternatives**: backfillear las viejas como `["free_text"]` — cambiaría la
UI de campañas legadas (hoy ofrece "nombre del contacto"), violando FR-007.

## D5 — Ejemplos hacia Meta

**Decision**: `example.body_text = [[muestra por binding]]`, con muestras del
catálogo (`María`, `+54 9 351 123-4567`, `Tu Empresa`, `ejemplo`). Se envía
siempre que N≥1 (hoy solo cubría N=1).

**Rationale**: Meta exige un ejemplo por variable para revisar; muestras
realistas reducen rechazos.

## D6 — Validación del cuerpo (regla pura compartida)

**Decision**: índices usados = exactamente `1..N` contiguos, `N ≤ 5`,
repeticiones permitidas; `countVariables(body)` pasa a devolver N (índices
DISTINTOS). Mensajes: «Las variables deben ser {{1}}..{{5}} sin huecos» y
«Máximo 5 variables por plantilla».

**Rationale**: es la regla del canal (posicionales contiguas) y mantiene una
sola fuente de verdad editor/server.

## Sin cambios en wa-mock

El alta ya persiste `components` (008) — los examples viajan adentro — y el
outbox ya registra los `parameters` del send: el guion E2E tiene toda la
evidencia sin tocar el mock.
