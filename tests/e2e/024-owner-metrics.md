# E2E 024 — Métricas para el propietario

Entorno: dev server del worktree en el puerto 3024 (`next dev -p 3024`),
BD local, usuario `e2e@vocero.test` (owner de «Negocio de Super Admin
Local», MEMBER de «Inmobiliaria Demo»). La empresa de números conocidos se
siembra con `node tests/e2e/fixtures/seed-metrics.mjs` (owner: el mismo
usuario, espera del agente 15 s; los mensajes son relativos a AHORA). La
UI se conduce en el Browser pane (escritorio y móvil 375 px); los pasos de
API con `fetch` desde la propia página (misma cookie).

Lo sembrado (rango diario): conversación WhatsApp A con un grupo de 2
entrantes respondido por el agente a los 120 s del primero, un entrante
respondido por una PERSONA, un saliente del agente FALLIDO seguido del
bueno a los 90 s, y 2 mensajes del historial importado; conversación
Instagram B respondida por el agente a los 40 s + una reacción con emoji;
una conversación del Laboratorio y la del Entrenador; y hace 40 días un
entrante respondido por el agente a los 60 s (período anterior).

## Guion

### US1 — El propietario ve cómo viene el negocio

1. **API diario**: `GET /api/metrics?range=day&tz=America/Cordoba` (zona
   del navegador) → `received {total 5, whatsapp 4, instagram 1,
   previous 1}`, `agentSent {total 3, previous 1, allSent 4}`,
   `responseTime {medianMs 90000, avgMs 83333, count 3, previousMedianMs
   60000, replyDelayMs 15000}`, 30 barras con WhatsApp 3 / 1 / 0 e
   Instagram 0 / 0 / 1 en los días de hace 3, 2 y 1 días. Coincide EXACTO
   con lo que imprime el seed: no suman el Laboratorio, el Entrenador, el
   historial, la reacción ni el saliente fallido; el grupo respondido por
   una persona no entra en el tiempo. ✅
2. **Semanal / anual**: 12 barras que arrancan en lunes (`2026-07-06` →
   `2026-09-21`) y 12 meses (`2025-10-01` → `2026-09-01`); el mensaje de
   hace 40 días cae en su semana (17/8) y en agosto; totales 6 / 4
   respuestas. `?range=month` → 400 `invalid_range`. ✅
3. **Página** `/metrics` (escritorio): selector Diario·Semanal·Anual +
   «Últimos 30 días · 28 ago – 26 sep 2026»; tarjetas «Mensajes recibidos
   5» (+400 % vs. los 30 días anteriores, WhatsApp 4 · Instagram 1),
   «Enviados por el agente 3» (+200 %, 75 % de todo lo que envió la
   empresa (4)), «Tiempo de respuesta 1 min 30 s» — la MEDIANA — (flecha
   roja +50 % contra la mediana anterior de 1 min, «Promedio 1 min 23 s ·
   3 respuestas», «incluye la espera de 15 s»);
   histograma «Mensajes recibidos por día» con leyenda. ✅
4. **Tooltip**: puntero sobre la barra del 23/9 → «miércoles 23 de
   septiembre · 0 Instagram · 3 WhatsApp · 3 Total», al costado de la
   barra (no la tapa). ✅
5. **Teclado**: foco en el gráfico → ← muestra «sábado 26 de septiembre (en
   curso)», ← otra vez el 25 (1 Instagram), → vuelve al 26, Esc cierra. ✅
6. **Tabla**: «Ver tabla» → tabla más reciente primero con «(en curso)» y
   los mismos números; «Ver gráfico» vuelve. ✅
7. **Cambio de período**: Semanal → `?range=week`, barra apilada 21/9 con
   4 WhatsApp + 1 Instagram separadas por el hueco de 2 px y la punta
   redondeada; «Sin datos de las 12 semanas anteriores». Anual → meses
   «oct … ene 26 … sep». Lo anterior queda atenuado mientras carga. ✅
8. **Datos reales de desarrollo** (org A): 115 recibidos (107 + 8), 77 del
   agente (41 % de 188), mediana 3 s (titular) con promedio 2 min 21 s — los casos
   largos son clientes que escribieron con el agente apagado (medido desde
   el primer mensaje sin responder; el agente respondió 2–5 s después del
   último). ✅

### US2 — Un miembro no ve las métricas

9. **Móvil owner**: 375 px sin scroll horizontal (`scrollWidth` 375),
   tarjetas en una columna, histograma de 301 px legible; la hoja «Más»
   lista «Métricas» primero. ✅
10. **Miembro** (`POST /api/workspaces/switch` a «Inmobiliaria Demo»):
    `GET /api/metrics` → 403 `forbidden`; `/metrics` → redirige a
    `/inbox`; el sidebar muestra solo Bandeja, Pipeline, Contactos y
    Campañas. ✅

Limpieza: `node tests/e2e/fixtures/seed-metrics.mjs --cleanup`.
