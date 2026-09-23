# E2E 021 — El alojamiento completo

Entorno: el de `016-mcp-connector.md` (empresa «Negocio de Super Admin
Local» con el conector `altos_de_calamuchita` conectado contra el mcp-mock,
`agent_tools_enabled = true`) más los mocks de siempre. `AGENT_COALESCE_MS=2000`.

El ai-mock hace de modelo INGENUO a propósito: repite las líneas que le
pasa la herramienta, precios incluidos. Es lo que hace verificable la
guarda — un paso de prueba que no puede fallar no prueba nada.

## Guion

1. **Barrio y entorno en la búsqueda.** «Somos 4 personas del 2026-10-10 al
   2026-10-12» → el agente responde con las opciones y cada una trae su
   **barrio** y sus **destacados**:
   `Casa Camiare (AC-004) — hasta 8 personas, 3 hab, 3 baños, Camiare,
   Potrero de Garay. Arrollo a 300 metros · Campo de lavandas.` y
   `Casa del Arroyo (AC-014) — … Villa del Condor, Potrero de Garay. Cancha
   de Tennis · Cancha de Futbol · Cancha de Basquet.`
   Antes de 021 el condensado tiraba los dos campos y el agente contestaba
   «no tengo esa información» a una pregunta por barrio.
2. **Ningún importe sale a WhatsApp.** El mock escribió las líneas con
   `Valor INTERNO … total $600.000 ($300.000/noche, seña $60.000)` y el
   mensaje entregado NO tiene un solo importe. En el log:
   `[agente] importe suprimido en cv_…: $600.000`.
3. **Ficha con detalles y entorno.** «Contame de la AC-003, ¿en qué barrio
   está y qué tiene de entorno?» → `show_stay` y el agente responde con los
   `details` reales del proveedor: «Salamandra Interior (Si esta habilitada
   para el uso); Minipiscina volada en la terrada (Tiene 3 x 2 metros solo
   para verano); Cochera Techada…». La ficha además trae el barrio («Casa,
   en Villa del Condor, Potrero de Garay») y la descripción recortada.
4. **Le piden el precio de frente.** «¿Y cuánto sale?» → el agente responde
   «Los valores y las condiciones los podés ver en la ficha del alojamiento
   👉 <enlace de la búsqueda>». Ver la nota de abajo: este paso encontró un
   silencio real y lo corrigió.
5. **El nombre del huésped se guarda.** Contacto con el nombre del perfil de
   WhatsApp («santi 🏔️»); el huésped escribe «Mi nombre es Santiago
   Pintos» → el contacto pasa a llamarse **Santiago Pintos**.
6. **…pero no se pisa el del equipo.** Con `PATCH /api/contacts/[id]` una
   persona lo cambia a «Santiago Pintos (Altos)»: se guarda
   `name_edited_at`. El huésped insiste con «perdón, me llamo Santi nomás»
   y el contacto **no cambia**.
7. **Ni el de un import.** Contacto `consent_source = 'import'` llamado
   «Tarres, Cecilia»; el huésped dice «me llamo Ceci» → no cambia.
8. **Sin `search_url` no hay enlace general** (unit
   `mcp-profile-altos`): el render deja de caer a `catalog.searchBase` —el
   buscador vacío— y le pide al agente el enlace DIRECTO de la propiedad.

## Hallazgo del paso 4: el silencio

Al quitarle los importes a la respuesta del modelo, lo que quedaba era
IDÉNTICO al mensaje anterior, y la guarda anti-duplicado de 011 lo
silenciaba. Resultado: el huésped preguntaba el precio y **no recibía
nada** — lo peor de los dos mundos.

Corrección: cuando la guarda de precios interviene, se lleva una respuesta
alternativa (la frase de los valores con el enlace). Si lo que quedó
resulta duplicado, se manda esa: es información nueva para quien preguntó.
En el log, `[agente] respuesta idéntica en cv_…: se manda la alternativa`.

## Otro hallazgo: el punto de los miles

La guarda corta por ORACIÓN, y el `.` de «$600.000» la partía al medio:
descartaba «$600» y dejaba un «.000).» colgado en el mensaje que salía a
WhatsApp. Se corrigió el cortador (un punto entre dígitos no termina una
oración) y quedó fijado en `price-guard` («el punto de los miles NO parte
la oración»).

## Resultado (23-sep-2026)

Todo ✅ tal como está descrito arriba. Gate verde: typecheck, lint, build y
1.001 tests. Unit nuevos: `price-guard` (33), `contact-name` (26), más 2
casos en `mcp-profile-altos` (43) y los 5 que fijaban el comportamiento
viejo, actualizados.
