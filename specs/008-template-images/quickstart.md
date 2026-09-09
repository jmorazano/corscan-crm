# Quickstart — Plantillas con imagen de encabezado (008)

Self-test local con mocks (mismo entorno que 004/006/007):

```bash
# .env de pruebas (además de lo habitual):
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
META_APP_ID=mock-app            # el upload resumable lo requiere
pnpm dev
```

## Flujo feliz

1. Login (usuario E2E) → Ajustes → Plantillas.
2. Crear plantilla `promo_lidar_img` con cuerpo con `{{1}}` y adjuntar un
   JPEG < 5MB → queda **Pendiente** con miniatura visible.
3. Aprobarla: `POST /api/dev/wa-mock/template-status` (evento
   `message_template_status_update` → APPROVED) → pasa a **Aprobada** sola.
4. Campaña: crear campaña con esa plantilla a una etiqueta de prueba y
   lanzarla; envío 1:1: desde una conversación con ventana cerrada, "Enviar
   plantilla".
5. Verificar en `GET /api/dev/wa-mock/outbox` que cada send incluye
   `template.components[0].type === "header"` con
   `image.link = {APP_BASE_URL}/api/template-media/tm_…`, y que ese link
   responde `200` con `Content-Type: image/jpeg` sin sesión (curl).

## Caminos infelices

- Subir un `.txt` renombrado `.jpg` y un PNG de 6MB → mensaje claro, el
  listado no crea nada.
- Forzar fallo del upload: `POST /api/dev/wa-mock/status` (modo fallo) y
  crear plantilla con imagen → error claro; `GET /api/templates` sin
  fantasma; la tabla `template_media` sin huérfanas.
- Plantilla de solo texto: alta + envío idénticos a 007 (regresión).
- Borrar la plantilla con imagen → su `headerImageUrl` responde 404.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```
