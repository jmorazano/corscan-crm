# US-CC-3 — Opt-out automático (feature 004, US3)

Prerequisito: us-cc-2 (Cliente Dos con conversación real).

## Pasos

1. Inbound `"BAJA"` de Cliente Dos por wa-mock → ✔ `opted_out_at`
   estampado; el badge **"Dado de baja"** aparece en Contactos y el botón
   "Plantilla" desaparece para ese contacto.
2. Inbound `"me quiero dar de baja del gimnasio"` (frase larga) de otro
   contacto → ✔ NO marca baja (coincidencia exacta solamente).
3. Inbound `"  stop  "` (minúsculas + espacios) → ✔ SÍ marca baja.
4. Envío INICIADO al dado de baja (POST /api/conversations) → ✔ 409
   `opted_out`. En el sender de conversación EXISTENTE con ventana
   cerrada → ✔ 409 `opted_out` (el motivo correcto, no un 429 de cupo —
   guard reordenado y re-conducido).
5. **FR-012**: el dado de baja vuelve a escribir → responderle texto libre
   desde la bandeja DENTRO de la ventana → ✔ 200 (la conversación sigue
   normal; solo se bloquea lo iniciado por la empresa). Nota: el agente de
   IA también respondió el "BAJA" dentro de la ventana — permitido por
   FR-012; afinar el prompt del agente para bajas queda como mejora de
   producto, no de esta feature.
6. **Reversión**: click en el badge → diálogo con fecha y advertencia →
   "Sí, revertir la baja" → ✔ `opted_out_at=NULL` con auditoría
   (`opt_out_reverted_by` = userId, `reverted_at` estampado).
7. La omisión de PENDIENTES de campaña por BAJA se conduce en us-cc-4
   (paso 4), que es cuando existen campañas.

## Evidencia

Conducido VERDE el 5-sep-2026.
