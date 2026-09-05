# Contrato — Contactos: alta manual, import y opt-out

Todos los endpoints con `withAuth` (sesión + membresía → organizationId) y
Zod server-side. Errores en el formato estándar `{ error: { code, message } }`.

## POST /api/contacts (EXTENDIDO)

Body: `{ name: string(1..120), phone: string, notes?: string(..4000),
tags?: string[](..20, c/u 1..40), consent?: boolean }`.
- `phone` se normaliza server-side a formato wa_id (lib compartida
  `src/lib/phone.ts`); inválido → 422 `invalid_phone`.
- `consent: true` estampa `consent_source='manual'` + `consent_at`.
- Duplicado org+phone → 409 (existente).

## POST /api/contacts/import (NUEVO)

El archivo se parsea en el navegador (read-excel-file / papaparse); acá
llegan filas ya estructuradas. El wizard normaliza y el server RE-normaliza
(nunca confía en el cliente).

Body:
```json
{
  "rows": [{ "phone": "…", "name": "…", "tags": ["…"], "notes": "…" }],
  "consentDeclared": true
}
```
- `rows` 1..5000; `consentDeclared` debe ser `true` → si no, 422
  `consent_required` (FR-004).
- Por fila: normalizar phone (D3). Inválido → cuenta en `invalid` con
  motivo, NO aborta el resto.
- Upsert por (org, phone): nuevo → crea con `consent_source='import'`;
  existente → merge (tags = unión saneada; name/notes solo si estaban
  vacíos; consent solo si era NULL; jamás pisa `opted_out_at`). Si el
  teléfono corresponde a un contacto de prueba del Laboratorio
  (`is_test`), la fila se rechaza con motivo `contacto_de_prueba` (el
  import no puede blanquear el sandbox).
- Duplicados DENTRO del archivo: la primera fila gana, las siguientes
  cuentan como `updated` (idempotente).

Respuesta 200:
```json
{ "created": 120, "updated": 15,
  "invalid": [{ "index": 3, "phone": "…", "reason": "telefono_invalido" }] }
```

## PATCH /api/contacts/[id] (EXTENDIDO)

Acepta además `tags?: string[]` (reemplazo completo, saneado). Desarchivar
(`archived: false`) un contacto `is_test` → 403 `sandbox_violation` (la
única marca visible del Lab no puede levantarse a mano).

## POST /api/contacts/[id]/opt-out-revert (NUEVO)

Revierte la baja (FR-011): `opted_out_at=NULL`, estampa
`opt_out_reverted_at/by`. 409 `not_opted_out` si no estaba de baja. La UI
exige confirmación explícita antes de llamar.

## GET /api/contacts (EXTENDIDO)

Cada item incluye `tags`, `consentSource`, `optedOutAt`. Filtro opcional
`?tag=`. El filtro de archivados y la búsqueda se aplican en el WHERE (hoy
el filtro corre en JS DESPUÉS del limit(200) — corregirlo), y la respuesta
incluye `total` para que la UI muestre "N de M" tras un import grande.
