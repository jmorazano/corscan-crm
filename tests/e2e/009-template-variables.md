# E2E 009 — Variables enriquecidas de plantillas

Entorno: dev server + mocks (como 008). Usuario E2E. Evidencia = UI, outbox
del wa-mock y respuestas HTTP.

## Feliz

1. **Alta**: crear `promo_multivar` (es_AR, MARKETING) con cuerpo
   «Hola {{1}}, somos {{2}}: {{3}}» **e imagen de encabezado** (convivencia
   008). Los bindings derivados se ajustan a {{1}} nombre del contacto,
   {{2}} nombre de tu empresa, {{3}} texto libre; el preview resuelve con
   muestras. ✅ Pendiente con bindings visibles.
2. **Aprobación** por mock → Aprobada sola.
3. **Campaña**: 2 contactos con nombres distintos y etiqueta `e2e-var`;
   el wizard informa {{1}}/{{2}} automáticas y pide SOLO el texto de {{3}};
   lanzar con «20% de descuento».
   ✅ Outbox: cada send lleva [nombre PROPIO del destinatario, nombre de la
   org, "20% de descuento"] en ese orden, más el header de imagen.
4. **1:1**: enviar `promo_multivar` a una conversación; el diálogo pide solo
   {{3}}. ✅ Outbox con el texto tipeado.

## Infeliz

5. Cuerpo `{{1}} … {{3}}` (hueco) → error en vivo y crear bloqueado; cuerpo
   con 6 variables → «Máximo 5». API directa con bindings inconsistentes →
   422.
6. Campaña sin el texto libre → botón deshabilitado; API directa → 422 y sin
   borrador.
7. **Regresión legada**: `promo_lidar_img` (008, bindings null, {{1}}) sigue:
   campaña ofrece nombre-del-contacto/texto-fijo y el 1:1 pide el texto;
   envío idéntico a hoy.

Resultado esperado: SC-002 (valores correctos por destinatario), SC-003
(rechazos claros sin registros a medias), SC-004 (legado sin cambios).
