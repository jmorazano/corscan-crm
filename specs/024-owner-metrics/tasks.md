# Tasks — 024 Métricas para el propietario

- [x] T1 `src/lib/metrics.ts` puro (rangos, ventana local, serie, formatos)
      + `tests/unit/metrics.test.ts`.
- [x] T2 `src/server/metrics/overview.ts` (totales, serie por canal,
      tiempos de respuesta, espera configurada) +
      `tests/unit/metrics-overview.test.ts` (SQL renderizado: scoped,
      exclusiones, reintento de zona).
- [x] T3 `GET /api/metrics` con `withOwner` + `tests/unit/metrics-route.test.ts`.
- [x] T4 Página `/metrics` con `requireOwnerPage()`.
- [x] T5 Navegación: `OWNER_ONLY_SECTIONS`, sidebar, hoja «Más» +
      `tests/unit/roles.test.ts`.
- [x] T6 UI: tarjetas con cambio vs. período anterior, selector en la URL,
      histograma apilado SVG con tooltip/teclado/tabla/estado vacío.
- [x] T7 Seed de números conocidos `tests/e2e/fixtures/seed-metrics.mjs` +
      guion `tests/e2e/024-owner-metrics.md` conducido en verde.
- [x] T8 Gate: typecheck + lint + build + 1.135 unit.
- [x] T9 Pedido del dueño (26-sep): la MEDIANA es el número principal del
      tiempo de respuesta (promedio debajo) y se compara mediana contra
      mediana (`previousMedianMs`). Seed pasado a ESM (`.mjs`): el `.cjs`
      rompía el lint con `require()`.
