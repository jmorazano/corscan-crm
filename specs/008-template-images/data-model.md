# Data Model — Plantillas con imagen de encabezado (008)

## Tabla nueva: `template_media`

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | text PK | nanoid con prefijo `tm_` (nuevo kind `templateMedia` en `ids.ts`); es el segmento público no adivinable de la URL |
| `organization_id` | text NOT NULL | FK → `organization.id` ON DELETE CASCADE (constitución III) |
| `template_id` | text NOT NULL **UNIQUE** | FK → `template.id` ON DELETE CASCADE — 1:1 real; borrar la plantilla arrastra su imagen (FR-008) |
| `mime` | text NOT NULL | `image/jpeg` \| `image/png` |
| `byte_size` | integer NOT NULL | ≤ 5 * 1024 * 1024 |
| `bytes` | bytea (custom type Drizzle) NOT NULL | el binario |
| `created_at` | timestamp NOT NULL default now() | |

Sin cambios de columnas en `template`: la existencia del encabezado se deriva
del JOIN 1:1 (evita doble fuente de verdad). `serializeTemplate` incorpora
`headerImageUrl: "/api/template-media/{id}" | null` a partir de ese JOIN.

## Ciclo de vida

- **Alta con imagen** (D5): tras el OK de Meta, en UNA transacción: upsert de
  `template` + DELETE del media previo de esa plantilla + INSERT del nuevo.
  Re-crear la misma plantilla (org+name+language) con otra imagen reemplaza
  el binario; sin imagen, elimina el media anterior (la plantilla re-enviada
  a revisión es de solo texto).
- **Borrado de plantilla**: cascade elimina el media — la URL pública deja de
  resolver (404), coherente con que la plantilla ya no puede enviarse.
- **Envío**: `sendTemplateCore` resuelve el media (JOIN al cargar la
  plantilla) y, si existe, antepone el componente `header` con el link
  público. Los guards (aprobada, sandbox, opt-out, reconexión) no cambian.

## Estados

`template.status` no cambia (`draft|pending|approved|rejected`): la imagen no
introduce estados nuevos; su presencia es ortogonal al ciclo de aprobación.

## Validación (pura, `src/lib/template-header.ts`)

- MIME declarado ∈ whitelist Y magic bytes coinciden (JPEG `FF D8 FF`, PNG
  `89 50 4E 47`).
- `byte_size` > 0 y ≤ 5MB.
- Errores tipados → `TemplateError("invalid", …)` con mensaje en español.
