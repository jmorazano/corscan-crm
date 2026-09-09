# E2E 008 — Plantillas con imagen de encabezado

Entorno: dev server local + wa-mock (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `META_APP_ID` seteado). Usuario E2E
(`e2e@vocero.test`). Conducido con Playwright; evidencia = outbox del mock y
respuestas HTTP.

## Feliz

1. **Alta con imagen**: Ajustes → Plantillas → crear `promo_lidar_img`
   (es_AR, MARKETING, cuerpo con `{{1}}`) adjuntando un JPEG < 5MB.
   ✅ Fila "Pendiente de Meta" con miniatura (`template-preview-header-image`).
   ✅ En el mock quedó el componente HEADER con `example.header_handle`.
2. **Aprobación**: `POST /api/dev/wa-mock/template-status`
   `{wabaId, name, language, event: "APPROVED"}`.
   ✅ La fila pasa a "Aprobada" sin refetch manual (webhook → SSE/refetch).
3. **Campaña**: contacto con consentimiento + etiqueta `e2e-img`; campaña con
   la plantilla y ese segmento; lanzar.
   ✅ En `GET /api/dev/wa-mock/outbox` el send lleva
   `template.components[0].type === "header"` con
   `image.link = http://localhost:3000/api/template-media/tm_…`.
4. **1:1 ventana cerrada**: desde la conversación creada por la campaña,
   "Enviar plantilla" con la misma plantilla.
   ✅ Segundo send en el outbox con el mismo header.
5. **URL pública**: `curl` del `image.link` SIN cookies.
   ✅ 200, `Content-Type: image/jpeg`, `Cache-Control: immutable`.

## Infeliz

6. **Archivo falso** (`.jpg` con texto adentro): el form lo envía y el server
   responde 422 "no es una imagen JPEG o PNG válida".
   ✅ Mensaje visible; el listado no agrega filas.
7. **Meta caída en el upload**: `POST /api/dev/wa-mock/knobs`
   `{failUploads: true}` y crear otra plantilla con imagen.
   ✅ Error claro; sin plantilla fantasma (listado y `template_media` sin
   huérfanas).
8. **Regresión texto**: crear plantilla sin imagen.
   ✅ Flujo idéntico (pendiente, sin miniatura; payload de envío sin
   `components` extra).

Resultado esperado global: SC-002 (100% de sends con header), SC-003/004
(cero fantasmas) y SC-005 (regresión verde).
