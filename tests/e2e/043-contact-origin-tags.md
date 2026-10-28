# E2E 043 — Etiquetas de origen en el contacto

Entorno: dev server del worktree `043-contact-origin-tags` en
`localhost:3000` (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock), base local `vocero` con la migración 0032
aplicada (`drizzle-kit migrate`). Usuario `e2e@vocero.test` (owner de
«Negocio de Super Admin Local», número `111111111`; miembro de «Inmobiliaria
Demo» para la prueba de permisos). Contactos de prueba `+54 9 351 043-01xx`,
borrados al final.

Conducción: script Node (entrantes por `POST /api/dev/wa-mock/inbound` con
`referral` crudo, API interna con la sesión del usuario, BD por `docker exec
… psql`) + Browser pane para la UI.

## Pasos

### Reglas (Ajustes → Origen de contactos)
1. ✔ Alta «vi el anuncio en Google» → «Google Ads» → 201 y etiqueta
   `google-ads`; ✔ frase corta y etiqueta sin letras → 422; ✔ GET la lista.
2. ✔ Como miembro (empresa cambiada por `/api/workspaces/switch`): POST y
   GET → 403, `/settings/origins` → 307 a `/inbox`.
3. UI: ✔ la vista previa muestra `#google-ads-2026-10` antes de guardar;
   ✔ la regla aparece «→ #google-ads-2026-10 (cambia cada mes)»; ✔ «Ver
   contactos» abre `/contacts?tags=meta-ads-2026-10`; ✔ móvil 375 px sin
   desborde.

### Anuncio de Meta
1. Entrante con referral fechado hace 20 días → ✔ contacto con
   `meta-ads-<mes del clic>` y `origin_at` = fecha del clic; ✔ la
   conversación conserva `wa-anuncio`.
2. ✔ Reentrega idéntica → contacto intacto (etiquetas, `origin_at`,
   `updated_at`).
3. Entrante con referral de hoy → ✔ `meta-ads-<mes actual>`.

### Regla por frase
1. Contacto nuevo: «Hola, VÍ el anuncio en google y quiero ver el CRM
   funcionando.» → ✔ `google-ads-<mes>` + `origin_at`, sin `meta-ads`.
2. Otro contacto: «Hola, buen día» y enseguida «ah, vi el anuncio en Google
   ayer» → ✔ sin etiqueta (no abre la charla).

### Campaña
1. ✔ Vista previa: etiqueta sola = 2; `days=15` = 1 (el de hace 20 días);
   `days=25` = 0; `days=abc` = sin filtro.
2. ✔ Alta con `arrivedMinDays: 15` → 201; `0` → 422; ✔ detalle y lista:
   `arrivedMinDays 15`, 1 elegible hoy, «· llegaron hace 15 días o más».
3. ✔ Lanzar → congela 1 destinatario (solo el de hace 20 días) y se envía
   por el wa-mock (`sent`).
4. UI: ✔ el campo «Llegaron hace al menos [15] días» actualiza en vivo «1
   contacto(s) elegible(s) hoy».

### Backfill de la migración
1. Sin la etiqueta ni `origin_at` → ✔ el UPDATE de 0032 la repone con el mes
   del clic y la fecha; ✔ dos veces = igual; ✔ con 20 etiquetas no agrega.

### Camino infeliz
1. ✔ Contacto con 20 etiquetas + anuncio nuevo → sigue con 20 y el mensaje
   entra. ✔ Borrar regla → 200; otra vez → 404.
2. Unit: si la escritura del contacto falla, el mensaje entra y el agente
   corre (`contact-origin-043-ingest.test.ts`).

Resultado 28-oct-2026: 30/30 del script (el miembro, aparte: 403/403/307) y
UI conducida en escritorio y móvil.
