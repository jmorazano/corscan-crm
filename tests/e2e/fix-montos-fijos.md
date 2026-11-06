# E2E — Los montos fijos del negocio salen; los precios de alojamiento, no

Caso real (Altos de la Ciudad, 6-nov-2026): Camila tenía cargado «cuesta 10.000
pesos por persona», pero la guarda de precios de 021 sacaba la oración y agregaba
«Los valores y las condiciones los podés ver…». Lo mismo con la cochera (27.000)
y el transfer (45.000).

Entorno: mocks de siempre, `AGENT_COALESCE_MS=2000`, conector
`altos_de_calamuchita` contra el mcp-mock (guion 016). Conviene correrlo en una
copia de la base (`CREATE DATABASE … TEMPLATE vocero`). El agente tiene cargados:

- Instrucciones: «Cochera con convenio: cuesta 27.000 pesos por día.» y
  «Transfer desde el aeropuerto: 45.000 pesos.»
- Conocimiento: «Cuesta 10.000 pesos por persona y se cobra por única vez, no por
  noche.» y un ejemplo con «el total es de 600.000 pesos y la seña de 60.000 pesos».

## Guion

1. **Los tres juntos.** Inbound `[E2E_MONTOS] …`: el ai-mock escribe los tres
   montos, los tres otra vez en una sola línea (`$10.000`, `$ 27.000`, `45 mil
   pesos`) y «El departamento te sale $300.000 por noche.». El mensaje entregado
   conserva todo menos la oración del departamento, trae la frase de los valores
   una sola vez, y el log dice `importe suprimido en cv_…: $300.000`.
2. **La búsqueda real no filtra importes.** «Somos 4 personas del 2026-12-10 al
   2026-12-12»: salen opciones y enlaces, ningún importe. El `$600.000` del mock
   coincide con el ejemplo del conocimiento, y aun así no sale: la oración habla
   de total y seña, así que no cuenta como monto fijo.
3. **El dueño cambia un monto.** Cambiar la cochera a 30.000 en las instrucciones
   y repetir el paso 1, sin reiniciar: ahora se recortan las oraciones con 27.000.
