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
bueno a los 90 s, e historial importado (ver US3); conversación
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

### US3 — El pasado del celular (ampliación, 20-oct-2026)

El seed suma historial importado de WhatsApp (`source='history'`): 1
entrante hace 5 días, 6 hace 20 días (+ una reacción, que no cuenta), 2 el
mismo día que el grupo de hace 3 días (día de la conexión), un saliente;
y 2 entrantes del historial de Instagram (no cuentan nunca).

11. **API**: `received {total 5, whatsapp 4, instagram 1, previous 1,
    past 9}` — tarjeta, comparación y `responseTime` IDÉNTICOS a US1; las
    barras traen `past` 6 / 1 / 2 en los días de hace 20, 5 y 3 días (este
    último con `whatsapp 3`). Semanal: «Sin datos de las 12 semanas
    anteriores» (el pasado no cuenta como período anterior). ✅
12. **Página**: tarjeta «Mensajes recibidos 5 · +400 %» + «Además 9 del
    pasado, importados del celular»; leyenda «Pasado (celular) · WhatsApp
    · Instagram»; barra gris de 6 en el 30/9; barra del 17/10 apilada gris
    2 abajo + verde 3 arriba; nota «Pasado: mensajes de WhatsApp que
    llegaron al celular antes de conectar el CRM…». ✅
13. **Tooltip y tabla**: 17/10 → «0 Instagram · 3 WhatsApp · 2 Pasado
    (celular) · 5 Total»; 30/9 → «6 Pasado (celular) · 6 Total»; la tabla
    suma la columna «Pasado». Un día sin pasado no muestra esa línea. ✅
14. **Móvil 375 px**: sin scroll horizontal, la leyenda baja de línea y
    «Ver tabla» no se parte. ✅

### US4 — En cuántas conversaciones (ampliación, 26-oct-2026)

Pedido del dueño mirando «Mensajes recibidos 4.472»: además, en cuántas
conversaciones se dieron. El seed suma la conversación WhatsApp C, que solo
escribe (nadie le contesta, no toca el tiempo de respuesta): 3 recibidos
hace 8 días y 2 hace 1 día → SIEMPRE dos semanas distintas. Con C los
recibidos del rango diario pasan a 10 (WhatsApp 9) y US1/US3 cambian en
consecuencia; el tiempo de respuesta queda IDÉNTICO.

15. **API diario**: `received.conversations {total 3, whatsapp 2,
    instagram 1, previous 1, previousWhatsapp 1, previousInstagram 0}` —
    A con 4 recibidos y C con 5 cuentan UNA vez cada una; el historial
    importado no suma conversaciones. `agentSent {total 3, whatsapp 2,
    instagram 1, previous 1, allSent 4, conversations {total 2, whatsapp 1,
    instagram 1, previous 1}}`. Barras: `conversations` 1 / 1 / 1 / 2 en
    los días de hace 8, 3, 2 y 1 días; 0 en las barras solo de pasado.
    Coincide EXACTO con lo que imprime el seed. ✅
16. **API semanal**: `received.conversations.total 3`, y C cuenta en DOS
    barras (12–18 oct → 1, 19–25 oct → 3): la suma de las barras (5) no es
    el total (3). Coincide con `weekConversations` del seed. ✅
17. **Página diario**: «Mensajes recibidos 10 en 3 conversaciones»,
    «↗ +900 % mensajes · ↗ +200 % conversaciones vs. los 30 días
    anteriores», «WhatsApp 9 en 2 conversaciones · Instagram 1 en 1
    conversación»; «Enviados por el agente 3 en 2 conversaciones» (+200 % ·
    +100 %), una línea por canal y «75 % de todo lo que envió la empresa
    (4)». ✅
18. **Tooltip**: 23/10 → «0 Instagram · 3 WhatsApp · 2 Pasado (celular) ·
    5 Total · en 1 conversación (sin el pasado)»; 16/10 → «en 0
    conversaciones». ✅
19. **Tabla semanal**: columna «Conversaciones» (19 al 25 de octubre → 3,
    12 al 18 → 1); tarjetas «11 en 3 conversaciones» y «Sin datos de las
    12 semanas anteriores». ✅
20. **Móvil 375 px**: sin scroll horizontal (`scrollWidth` 375) con el
    texto nuevo de las tarjetas. ✅

Limpieza: `node tests/e2e/fixtures/seed-metrics.mjs --cleanup`.
