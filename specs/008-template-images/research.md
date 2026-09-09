# Research — Plantillas con imagen de encabezado (008)

## D1 — Cómo llega la imagen de ejemplo a la revisión de Meta

**Decision**: Resumable Upload API en dos pasos con el token de la org y
`META_APP_ID`: (1) `POST {META_GRAPH_BASE_URL}/{ver}/{app_id}/uploads?file_length={n}&file_type={mime}`
→ `{ id: "upload:…" }`; (2) `POST {META_GRAPH_BASE_URL}/{ver}/{upload_session_id}`
con header `Authorization: OAuth {token}`, `file_offset: 0` y el binario como
body → `{ h: "<handle>" }`. Ese handle va en el alta de la plantilla:
`components: [{ type: "HEADER", format: "IMAGE", example: { header_handle: ["<h>"] } }, { type: "BODY", … }]`.

**Rationale**: es el único mecanismo que Meta acepta para el ejemplo de un
encabezado multimedia; el token del system user de la org (obtenido por ES)
está autorizado para la app y es el mismo que ya usa el alta de plantillas.

**Alternatives considered**: subir como media del número
(`/{phone_number_id}/media`) — rechazado: los media ids NO sirven como
`header_handle` de ejemplo; URL directa en `example` — no existe en la API.

**Detalle de implementación**: `graphRequest` solo habla JSON; se agrega
`uploadResumable(appId, token, bytes, mime)` en `src/lib/meta/client.ts`
(la única frontera con Graph) usando `fetch` con body binario. Si
`META_APP_ID` no está configurado, el alta con imagen falla con
`TemplateError("invalid")` y mensaje claro (sin imagen sigue funcionando).

## D2 — Cómo viaja la imagen en cada ENVÍO

**Decision**: componente `header` con **link público** servido por el propio
CRM: `{ type: "header", parameters: [{ type: "image", image: { link: APP_BASE_URL + "/api/template-media/" + mediaId } }] }`.
El handle de ejemplo NO sirve para enviar: cada mensaje debe adjuntar la
imagen.

**Rationale**: el link es sin estado y estable — no expira, no requiere
re-subidas ni tabla de vencimientos. `APP_BASE_URL` ya es público por
requisito de webhooks. Meta descarga la imagen por mensaje; a la escala del
producto (campañas de cientos, pacing de 4s) es tráfico despreciable, con
`Cache-Control: immutable`.

**Alternatives considered**: media id pre-subido a `/{phone_number_id}/media`
— rechazado en v1: expira (~30 días) y obliga a lógica de re-subida y estado
extra; optimización futura si el volumen lo pidiera.

## D3 — Dónde vive el binario

**Decision**: Postgres, tabla `template_media` (bytea) 1:1 con `template`,
`ON DELETE CASCADE`, fuera de la fila de template para no arrastrar blobs en
los listados.

**Rationale**: constitución II prohíbe S3/R2; el filesystem de Railway es
efímero (se pierde en cada deploy). Un JPEG ≤5MB × decenas de plantillas por
org es carga trivial para Postgres.

**Alternatives considered**: volumen persistente — atado a la plataforma de
hosting y fuera del contrato del instalador; base64 en la fila de template —
infla todos los SELECT del listado.

## D4 — Cómo sube el archivo del navegador al CRM

**Decision**: `POST /api/templates` pasa a **multipart/form-data**
(`req.formData()`): campos de texto + `headerImage` opcional (File). El
cliente arma `FormData`; sin imagen el flujo es idéntico al actual.

**Rationale**: App Router lee FormData nativo sin límite artificial de body;
evita el +33% de base64 y mantiene UN solo endpoint de alta (idempotencia y
errores ya resueltos ahí).

**Alternatives considered**: JSON con base64 — payload inflado y parsing
manual; endpoint aparte de upload en dos pasos — deja imágenes huérfanas si
el paso 2 nunca llega (viola FR-008).

## D5 — Atomicidad del alta (sin fantasmas ni huérfanas)

**Decision**: orden estricto: (1) validar imagen (pura, `template-header.ts`);
(2) upload resumable a Meta → handle; (3) `POST {waba}/message_templates`
con HEADER+BODY; (4) recién con el OK de Meta, transacción local: upsert de
`template` (mismo `onConflictDoUpdate` org+name+language) + reemplazo de su
`template_media` (DELETE + INSERT en la misma tx). Si (2) o (3) fallan, no se
escribió nada local; el handle remoto huérfano expira solo en Meta (sin costo).

**Rationale**: reproduce la garantía actual del alta (Meta primero, DB
después) y cumple FR-008/SC-004 sin sagas.

**Alternatives considered**: guardar la imagen antes de llamar a Meta y
limpiar en el catch — más caminos de fallo (crash entre medio) para cero
beneficio.

## D6 — Extensión del wa-mock (self-test E2E)

**Decision**: en el catch-all `wa-mock/graph/[...path]`: (a)
`POST {app_id}/uploads` (path len 2, `uploads`) → `{ id: "upload:mock-<n>" }`;
(b) `POST upload:mock-<n>` (path len 1 con prefijo `upload:`) → lee el body
binario y responde `{ h: "MOCK_HANDLE:<n>" }`; (c) el alta de plantilla
acepta y guarda `components` (incluido HEADER con `header_handle`); (d) el
send del mock registra en el outbox los `components` del payload para que el
guion E2E verifique el header con el link público.

**Rationale**: el guion E2E (Definición de Hecho REFORZADA) necesita
verificar el resultado observable (outbox con header) y el camino infeliz
(upload que falla → sin fantasma), todo tras el gate único de `dev-guard`.

**Alternatives considered**: mockear a nivel `fetch` en tests unitarios —
no reemplaza el E2E de comportamiento exigido por la constitución/CLAUDE.md.

## Límites y validación

- Tipos aceptados: `image/jpeg`, `image/png` (whitelist por magic bytes
  además del MIME declarado — la extensión no alcanza, edge case de la spec).
- Peso máximo: 5MB (límite de imagen del canal); validado en cliente (aviso
  temprano) y en server (autoridad).
- Dimensiones: sin mínimo impuesto en v1 (Meta recomienda ~800×418 para
  previews; se documenta en la ayuda del formulario, no se bloquea).
