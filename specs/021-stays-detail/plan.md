# Plan — 021 El alojamiento completo

## Fronteras

| Pieza | Archivo |
|---|---|
| Condensado y render del proveedor | `src/server/mcp/profiles/altos.ts` |
| Guarda de precios (pura) | `src/lib/price-guard.ts` |
| Acción del agente con el nombre | `src/server/ai/actions.ts` + `pipeline.ts` |
| Regla de quién puede renombrar | `src/lib/history-import.ts` (`shouldAdoptAddressBookName`, se generaliza) |
| Marca de edición manual | `contact.name_edited_at` + `PATCH /api/contacts/[id]` |
| Fixtures del proveedor | `src/app/api/dev/mcp-mock/data.ts` (ya traen los campos) |

## Decisiones

### D1 — Los campos que faltaban ya venían; el problema era nuestro

`check-availability` devuelve por propiedad `neighborhood` (una palabra),
`details` (pares `{name, value}` cortos y de altísima señal: *«Arrollo a 300
metros: tiene un hermoso arrollo dentro del barrio»*) y `description` (1.300
a 2.500 B de copy). El condensado de 016 los descartaba entero.

Se recuperan con criterio distinto por campo:

- **`neighborhood`**: siempre, en la línea de cada propiedad. Cuesta ~15 B y
  responde una de las preguntas más frecuentes del corpus real.
- **`details[].name`**: hasta 3 por propiedad en la búsqueda. Es lo que
  convierte «no tengo esa información» en «tiene un arroyo a 300 metros».
- **`description`**: NO va en la búsqueda (5 × 2 KB arruinan el
  presupuesto). Va solo en `show_stay`, que es UNA propiedad, recortada.

### D2 — De 2 a 5 opciones, porque sin precios la línea es más corta

`MAX_PROPERTIES_FOR_MODEL` sube de 2 a 5. Dos razones:

1. Con los precios fuera del mensaje (D3), el agente no puede contestar
   «¿cuál es la más económica?» ni «¿alguna más chica?» viendo 2 de 6 — y
   el corpus muestra que esas dos preguntas aparecen todo el tiempo,
   incluido el reproche literal *«¿por qué no me ofreciste antes esas 2
   casas?»*.
2. El tope real nunca fue la cantidad de opciones sino los BYTES. Un test
   mide el render con 5 propiedades enriquecidas y lo fija.

La regla de **un solo enlace por mensaje** (#53) NO cambia: eso era un
problema de previsualización de WhatsApp, no de cuántas opciones ve el
modelo.

### D3 — Los precios los ve el agente, no el cliente

El dueño eligió mantener la regla del agente anterior. Se implementa en
tres capas, porque una sola no alcanza:

1. El `[HERRAMIENTA]` sigue trayendo los precios, **etiquetados como
   internos**: el modelo los necesita para ordenar y para decir cuál es la
   más barata sin decir cuánto sale.
2. La sección del prompt trae la regla dura.
3. `src/lib/price-guard.ts`: guarda PURA sobre el texto saliente, mismo
   patrón que `promise-guard.ts` (016, D20) — el único cinturón que no
   depende de que el modelo obedezca.

**Cómo corrige la guarda**: quita la ORACIÓN que contiene el importe, no el
importe suelto. Redactar el número en el medio deja frases rotas («La
cabaña sale ___ el total»); las oraciones de precio son autocontenidas. Si
al sacarlas no queda nada, se manda una frase segura que remite al enlace.

**Qué NO debe matchear** (los falsos positivos son el modo de falla caro):
fechas (`12/10`), cantidades (`4 personas`, `3 dormitorios`), códigos
(`AC-006`), teléfonos y horarios. Por eso la guarda exige una marca de
dinero: `$`, `ARS`, o la palabra «pesos»/«seña» junto a un número.

### D4 — Sin `search_url` no se manda un enlace general

Hoy, cuando el proveedor no puede reproducir la búsqueda, caemos a
`catalog.searchBase`: un buscador vacío que muestra TODO. Si el huésped
pidió «con bajada al río», ese enlace le muestra propiedades sin río — es
peor que no mandar nada, y es exactamente lo que el agente anterior tenía
prohibido («nunca envíes un enlace general que mezcle opciones sin esa
característica»).

El fallback se elimina: sin `search_url`, el render le dice al agente que
pase el enlace DIRECTO de la propiedad que recomienda. Armar la URL a mano
sigue descartado (016 research D8: el buscador del sitio filtra distinto
que el MCP). Si se quiere el enlace exacto también en esos casos, es un
pedido al desarrollador del MCP, no código nuestro.

### D5 — El nombre viaja con la respuesta, no en un turno aparte

`reply` y `update_lead` ganan `contact_name?`. Una acción nueva obligaría
al agente a elegir entre contestar y guardar el nombre (una acción por
turno), y elegiría contestar.

Validación pura antes de guardar: 2 a 60 caracteres, al menos una letra,
sin URLs ni dígitos largos, máximo 4 palabras. Un «mi nombre es» que el
modelo copie entero se descarta.

### D6 — Quién puede renombrar: se generaliza la regla de 017

017 ya resolvió la pregunta con `shouldAdoptAddressBookName`: un contacto
nacido de un entrante lleva el nombre del PERFIL de WhatsApp (lo eligió el
cliente), y eso es reemplazable; import/manual/API no.

Le falta un caso, y es justo el que el dueño marcó: **un nombre que el
operador editó a mano en el CRM**. Ese contacto sigue con
`consent_source = 'inbound'` y hoy la sync de la agenda del celular
también se lo pisa — un bug preexistente de 017.

Se agrega `contact.name_edited_at` (NULL = nadie del equipo lo tocó), lo
setea el PATCH de contactos, y la función pasa a llamarse
`canOverwriteContactName` y la usan las dos: la sync de 017 y el agente.

## Migración

`drizzle/0017_*.sql`: `ALTER TABLE contact ADD COLUMN name_edited_at
timestamp`. Sin backfill: NULL es el valor correcto para todo lo existente
(no sabemos quién editó qué, y el valor conservador es «reemplazable», que
es el comportamiento de hoy).

## Riesgos

- **Contexto**: 5 propiedades enriquecidas pesan más que 2 flacas. Acotado
  con un test que mide los bytes del render.
- **Falsos positivos de la guarda de precios**: cubiertos con una batería
  de frases legítimas con números, igual que hizo `promise-guard`.
- **El agente pierde una herramienta de venta** al no poder decir precios.
  Es la decisión explícita del dueño; el enlace la compensa.
