# E2E 052 — Editar plantillas

Mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock. Usuario
propietario de la empresa con WhatsApp conectado (`waba_a` en local).
El wa-mock guarda las plantillas en memoria: crearlas en la misma corrida
del dev server (las de antes de reiniciar no existen para el mock).

## Preparación

1. Crear por `POST /api/templates` (multipart): `e2e052_promo_<s>` con
   `{{1}}` = nombre del contacto + imagen PNG; `e2e052_texto_<s>` sin imagen.
2. `POST /api/dev/wa-mock/template-status`: la primera `APPROVED`, la
   segunda `REJECTED`.

## Caminos felices

| # | Paso | Esperado |
|---|---|---|
| 1 | Miembro (otra empresa): `PATCH /api/templates/x` | 403 `forbidden` |
| 2 | Ajustes → Plantillas → «Editar» en la rechazada | Editor con nombre e idioma deshabilitados, categoría libre |
| 3 | Cuerpo `Hola {{1}}, … ¿La retomamos?`, categoría MARKETING, Guardar | Fila: MARKETING, «Pendiente de Meta», «Editar» deshabilitado con «Meta la está revisando…» |
| 4 | «Editar» en la aprobada con imagen | Categoría bloqueada, «Se conserva la imagen actual», vista previa con la imagen |
| 5 | Guardar sin tocar nada | «No cambiaste nada», Meta no recibe nada |
| 6 | Cambiar el cuerpo y guardar (acepta el `confirm`) | Mock: HEADER con handle NUEVO + BODY nuevo, `edits: 1`, PENDING; CRM: misma `tm_…`, «Pendiente de Meta» |
| 7 | Meta la re-aprueba (template-status) | «Editar» deshabilitado: «…una vez por día. Podés editarla de nuevo desde el <fecha> h.»; `PATCH` → 409 `not_editable` con `nextEditAt` |
| 8 | Plantilla rechazada con imagen → «Quitar imagen» → Guardar | Mock sin HEADER; CRM `headerImageUrl: null` |
| 9 | Rechazada otra vez → elegir otro PNG → Guardar | Vista previa `blob:`; mock HEADER nuevo; `tm_…` nuevo servido 200 `image/png` |

## Caminos infelices

| # | Paso | Esperado |
|---|---|---|
| 10 | Knob `failTemplateEdit: true` + editar la rechazada | 422 `meta_error` con el mensaje de Meta; la fila local NO cambia |
| 11 | Borrador de campaña con la plantilla + editar cambiando las variables | 409 `in_use` con el borrador enlazado |
| 12 | Mismo borrador + editar con las mismas variables | 200 |
| 13 | Campaña en curso o pausada | 409 `in_use` (unit: `templates-edit.test.ts`; lanzar una campaña exige plantilla aprobada y destinatarios) |

## Resultado (12-nov-2026)

Todo verde en el Browser pane contra el dev server del worktree. Móvil
(375 px) sin scroll horizontal. Limpieza: las tres plantillas de prueba y
el borrador se borraron.
