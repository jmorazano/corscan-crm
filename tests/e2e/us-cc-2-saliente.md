# US-CC-2 — Conversación saliente por plantilla (feature 004, US2)

Prerequisito: us-cc-1 (contactos importados). Plantilla aprobada
`seguimiento_cotizacion` (con {{1}}) y `promo_rechazada` (rejected).

## Pasos

1. Contactos → fila "Cliente Dos" (importado, SIN conversación) → botón
   **Plantilla** → elegir la aprobada, variable "Cliente Dos" → Enviar. ✔
   navega a la bandeja con la conversación NUEVA y el mensaje saliente; el
   outbox del wa-mock registra el template con el wamid literal.
2. Ticks: `POST /api/dev/wa-mock/status` delivered → read sobre ese wamid.
   ✔ `message.status` termina `read`, `template_id` persistido.
3. **Reintento** (POST /api/conversations mismo contacto+plantilla) → ✔
   **200 con el MISMO messageId y `deduped:true`** — sin re-envío (FR-009).
4. Plantilla RECHAZADA → ✔ 422 `template_not_approved`.
5. **Sandbox**: envío a contacto del Laboratorio → ✔ 403
   `sandbox_violation`; desarchivarlo por PATCH → ✔ 403 (la marca
   `is_test` es inviolable).
6. Inbound de un número NUEVO por wa-mock → ✔ contacto creado con
   `consentSource='inbound'` (FR-007 para futuros).
7. Respuesta de Cliente Dos por wa-mock → ✔ cae en el MISMO contacto
   (count=1, sin duplicados) y en la misma conversación.
8. **Reconciliación wa_id** (rama divergente): contacto legacy MX sembrado
   `525598765432` → envío → el mock (emulando a Meta) devuelve wa_id
   `5215598765432` → ✔ el phone del contacto queda reconciliado al wa_id.

## Evidencia

Conducido VERDE el 5-sep-2026 (Playwright + curl + asserts en BD).
