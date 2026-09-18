# E2E 012 — CRM móvil estilo WhatsApp

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`, wa-mock, ai-mock),
usuario E2E local (owner de la org con datos). Se conduce con el Browser
pane en **375×812** (preset mobile: user-agent y touch emulados) y luego en
escritorio (≥ 1024) para la regresión. Evidencia = DOM (`read_page` /
`javascript_tool`), red y capturas.

## A. Shell móvil (US1)

1. `/inbox` en 375 px: no hay sidebar; barra inferior `mobile-tabbar` con
   Bandeja (badge `tabbar-unread` si hay no leídos), Pipeline, Contactos,
   Campañas, Más. `document.documentElement.scrollWidth <= innerWidth`.
2. Tocar «Más» → hoja `more-sheet` con Agente, Laboratorio, Integraciones,
   Ajustes, (Administración si super admin), usuario y «Salir». Navegar a
   Ajustes cierra la hoja.
3. `/manifest.webmanifest` → 200, `display: standalone`, `short_name` y
   `theme_color` de la marca; `/api/pwa/icon/192?...` → `image/png`.
4. `<meta name="viewport">` con `viewport-fit=cover` e
   `interactive-widget=resizes-content`; `<link rel="manifest"
   crossorigin="use-credentials">`; `apple-mobile-web-app-capable`.
5. Enfocar la búsqueda: `getComputedStyle(input).fontSize` ≥ 16px.
6. Escritorio ≥ 1024: sidebar visible, sin tab bar (regresión).

## B. Bandeja (US2)

1. Lista sola (`data-view="list"`); filas ≥ 56 px de alto.
2. Tocar una fila → `data-view="thread"`, URL con `?c=<id>`, tab bar
   oculta, cabecera con `thread-back` y `thread-contact`.
3. Enviar un texto por el compositor (botón `composer-send`; Enter NO envía
   en móvil) → burbuja saliente + mock recibe el POST.
4. `thread-contact` → `data-view="details"` (ficha completa, `details-back`,
   URL con `d=1`). `history.back()` → vuelve al hilo; otro `back()` → lista.
5. Gesto de borde (touch en x<32 → x>120) en el hilo → vuelve a la lista.
6. Deslizar una fila a la izquierda (touch dx ≈ −120) → acciones
   `swipe-read-toggle` / `swipe-more`. «No leída» → `row-unread` ≥ 1 y
   badge de Bandeja incrementa; abrir la conversación lo limpia.
7. `swipe-more` → `row-sheet` con IA / Ver ficha / Eliminar; «Ver ficha»
   abre hilo + ficha; «Eliminar» → `row-delete-dialog` (cancelar).
8. Long-press (touchstart 500 ms) en una fila → modo selección con la fila
   tildada y la barra de etiquetas en bloque; Escape/«Cancelar» sale.
9. Compositor: escribir `/` → `quick-replies` con plantillas aprobadas;
   tocar una → texto insertado con el nombre del contacto; `⚡`
   (`quick-replies-toggle`) abre lo mismo.
10. Subir en el hilo y simular un entrante por el wa-mock → aparece
    `jump-to-bottom` con `jump-pending`; tocarlo baja al final.
11. Long-press en una burbuja → `message-sheet` «Copiar texto».
12. Escritorio: tres columnas como antes; `⌘K` enfoca la búsqueda;
    `Alt+↓/↑` cambia de chat (URL `?c=` con replace); `Esc` cierra el panel;
    `⌘⇧U` marca no leída; Enter envía.
13. Infeliz: `/inbox?c=cv_inexistente` → vuelve a la lista sin colgarse.

## C. Pipeline (US3)

1. 375 px: `stage-strip` con etapas y conteos; columnas `stage-column`
   de ~85vw con snap; tocar una etapa desplaza el tablero.
2. Tocar un `lead-card` → `lead-sheet` con «Abrir conversación» y
   «Mover a …»; elegir una etapa → la tarjeta aparece en la otra columna y
   `PATCH /api/pipeline/leads/<id>` sale con `stageId`.
3. «Gestionar etapas» → `stage-manager` como hoja inferior con scroll.
4. Escritorio: drag con mouse funciona como antes.

## D. Resto (US4)

1. `/contacts` 375 px: cabecera apilada, búsqueda ancho completo, «⋯» por
   fila abre hoja con las acciones; «Nuevo contacto» → hoja inferior con
   scroll; sin scroll horizontal.
2. `/campaigns`: filas con acciones envueltas; «Nueva campaña» → hoja.
3. `/settings/*`: tira horizontal de pestañas; formularios en una columna.
4. `/integrations/google-calendar`, `/lab`, `/agent`, `/admin`: sin
   desborde horizontal.

## Resultado (17-sep-2026, dev server + mocks, Browser pane)

Los gestos táctiles se dispararon con `TouchEvent` sintéticos (el pane
emula el user-agent móvil pero los clics llegan como mouse); el estado se
verificó por DOM/URL/red, y con capturas donde el pane estaba visible.

- **A. Shell** ✅ sin sidebar ni scroll horizontal (scrollWidth 375);
  tab bar con badge (27 → 28 tras «No leída»); «Más» → hoja con Agente,
  Laboratorio, Integraciones, Ajustes, usuario y Salir; navegar desde la
  hoja usa replace (historial 19 → 19; atrás vuelve a /inbox). Viewport
  `viewport-fit=cover, interactive-widget=resizes-content`; theme-color
  `#3f5972`; manifest 200 (`standalone`, `short_name` Vocero, 3 íconos) e
  ícono 192 → `image/png` (3392 bytes); `mobile-web-app-capable=yes`,
  `apple-touch-icon` 180; búsqueda y compositor a 16px.
- **B. Bandeja** ✅ lista → hilo (`?c=`, tab bar oculta, «←») → ficha
  (`d=1`, ancho 375) → `history.back()` ×2 → lista. Gesto de borde
  (x 8 → 170) vuelve a la lista. Deslizar fila → `translateX(-144px)` con
  «Leída/No leída» y «Más»; «No leída» → contador 1 y badge +1. Long-press
  500 ms → selección con la fila tildada y barra bulk; Escape sale. «Más» →
  hoja (Pausar IA · Ver ficha · Eliminar); «Ver ficha» abre hilo + ficha con
  historial correcto (5 → 6); «Eliminar» → diálogo estable; Cancelar cierra.
  Entrante por wa-mock abre ventana; `/` → 3 plantillas aprobadas, filtro
  sin coincidencias, tocar inserta con nombre; Enter en móvil NO envía; el
  botón sí (burbuja + outbox con `525522223333`). Con el hilo arriba, un
  entrante + respuesta IA → «↓» con «2», sin arrastrar; tocarlo → dist 0.
  Long-press en burbuja → «Copiar texto»; portapapeles denegado → aviso «No
  se pudo copiar» sin colgar (camino infeliz).
- **C. Pipeline** ✅ tira con conteos, 5 columnas de 319 px con
  `scroll-snap-type: x mandatory`; tocar «En conversación» desplaza el
  tablero (scrollLeft 315) y marca la pestaña; tocar «Cliente A» → hoja con
  «Abrir conversación» + «Mover a …» ×4; «Mover a En conversación» → la
  tarjeta cambia de columna y `PATCH /api/pipeline/leads/<id>` → 200;
  «Gestionar etapas» → hoja inferior (6 inputs, ancho 375); Escape cierra.
- **D. Resto** ✅ /contacts: búsqueda 343 px, «⋯» 44 px por fila → hoja con
  Editar / Abrir conversación / Enviar plantilla / Archivar / Eliminar;
  «Editar» → diálogo estable y atrás lo cierra. /campaigns: «Nueva campaña»
  → hoja (375×487) con scroll; Escape cierra. /settings/*: tira horizontal
  (scrollWidth 826 en 375, pestaña activa visible), formularios en una
  columna. /integrations/google-calendar, /lab, /agent, /settings/sending,
  /settings/templates: sin desborde (corregidos el fieldset del calendario y
  el input de archivo de plantillas).
- **Escritorio (1024)** ✅ sidebar 224 px, lista 360, tab bar oculta,
  búsqueda 13px, filas 92 px (sin cambios); clic en fila → `?c=` con replace
  (historial igual); `Alt+↓/↑` cambian de chat; `⌘K` enfoca la búsqueda;
  `Esc` cierra el panel y luego deselecciona; `⌘⇧U` marca no leída.
  Pipeline: columnas 256 px sin tira ni snap. Ajustes: rail vertical 176 px.
  Contactos: clúster visible, «⋯» oculto, búsqueda 288 px.

Hallazgo corregido durante la conducción: en dev, React Strict Mode
monta→desmonta→monta los efectos y el cleanup del `Dialog` hacía
`history.back()` al instante, cerrando las hojas que se montan ya abiertas
(contactos, campañas). Ahora la vuelta atrás se difiere un tick y se cancela
si el efecto se vuelve a montar.
