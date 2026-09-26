# Plan — 024 Métricas para el propietario

## Enfoque

Una lectura agregada sobre `message` ⨝ `conversation`, sin tablas nuevas ni
migración: todo lo que hace falta ya está en las columnas (`direction`,
`ai_generated`, `source`, `status`, `type`, `created_at`, `conversation.kind`,
`conversation.is_test`). Un solo endpoint devuelve tarjetas + serie, para
que el selector de período recorte todo junto.

## Piezas

| Capa | Archivo | Qué hace |
|---|---|---|
| Reglas puras | `src/lib/metrics.ts` | Rangos (`day`/`week`/`year` → día/semana/mes), `metricsWindow` (claves locales de las barras + bordes UTC con `zonedToUtc` de `src/lib/time.ts`; comparación = misma duración transcurrida justo antes), `fillSeries`, `parseMetricsQuery` (zona validada con `Intl`), formatos (`formatDuration`, `formatDelta`, etiquetas del eje y del tooltip, `niceTicks`) y el contrato `MetricsOverview` |
| Consultas | `src/server/metrics/overview.ts` | 3 consultas en paralelo, todas con `scoped()`: totales con `count(*) filter`, serie con `date_trunc(unidad, created_at AT TIME ZONE 'UTC' AT TIME ZONE tz)` agrupada por canal, y tiempos de respuesta con una función de ventana (`out_seq`) + `percentile_cont(0.5)`; más la espera configurada (query mínima, sin importar `server/ai/trigger.ts`, que arrastra el pipeline) |
| API | `src/app/api/metrics/route.ts` | `GET` con `withOwner` (403 a miembros), 400 `invalid_range` |
| Página | `src/app/(app)/metrics/page.tsx` | `requireOwnerPage()` |
| UI | `src/components/metrics/metrics-client.tsx` · `stacked-bars.tsx` | Selector en la URL (`?range=`), 3 tarjetas con cambio vs. período anterior, histograma SVG propio (sin dependencias) con tooltip por barra, teclado, tabla y estado vacío |
| Navegación | `src/lib/roles.ts` · `app-nav.tsx` · `app-shell.tsx` | `/metrics` en `OWNER_ONLY_SECTIONS`; ítem en el sidebar y en la hoja «Más» |

## Tiempo de respuesta (SQL)

Por conversación, `out_seq` = cantidad de salientes (no fallidos) hasta cada
mensaje inclusive. Los entrantes con el mismo `out_seq = k` esperan
respuesta; la respuesta es el saliente `k+1`. Si es `ai_generated`, se mide
`reply.created_at − min(created_at de los entrantes del grupo)`. El escaneo
arranca 7 días antes del período de comparación para acotarlo.

## Decisiones de diseño del gráfico

Colores del canal (los del `ChannelIcon`: `#25D366`, `#d62976`), validados
con el validador de paleta (CVD ΔE 18,2; el verde queda < 3:1 sobre blanco →
la vista de tabla es obligatoria y está). Barras ≤ 24 px, punta de datos
redondeada 4 px, base recta, hueco de 2 px entre segmentos apilados, grilla
de 1 px recesiva, etiquetas del eje X ancladas a la barra actual y
espaciadas por ancho real (ResizeObserver).

## Riesgos

- Volumen: sin índice `(organization_id, created_at)`; usa el prefijo de
  `message_org_conv_idx`. Suficiente para el volumen actual; si una empresa
  pasa los cientos de miles de mensajes, sumar ese índice.
- Zonas que `Intl` acepta y Postgres no: reintento con Buenos Aires.
