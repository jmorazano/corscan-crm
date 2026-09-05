# Guion E2E — US6: Plantillas acotadas

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock.

## Ciclo de aprobación

1. En `/settings/templates`: crear `seguimiento_cotizacion` (es_MX, UTILITY,
   cuerpo con `{{1}}`).
   ✅ Queda en estado "Pendiente de Meta" (el mock devuelve PENDING).
2. Simular la aprobación: `POST /api/dev/wa-mock/template-status`
   `{ wabaId, name, language, event: "APPROVED" }`.
   ✅ El estado pasa a "Aprobada" (evento webhook enrutado por entry.id).
3. Camino infeliz: crear `promo_rechazada` y simular `REJECTED` con razón.
   ✅ Estado "Rechazada" mostrando la razón.
4. `POST /api/templates/sync` → 200 (pull por Graph; cubre modo agencia).

## Editor con preview y variables (mejora post-004)

8. En `/settings/templates`, con el cuerpo vacío el preview (burbuja saliente
   sobre fondo de chat, a la derecha del formulario) muestra el placeholder.
9. Escribir `Hola {{` en el cuerpo.
   ✅ Aparece el menú «Variables disponibles» con `{{1}}` (Nombre del
   contacto). Tab/Enter lo inserta y deja el cursor después del token.
10. Completar `, *seguimos disponibles*. ¿Retomamos tu _cotización_?`.
    ✅ El preview muestra `{{1}}` como chip con el valor de ejemplo (María,
    editable en «Probar {{1}} con») y aplica negrita/cursiva.
    ✅ Con `{{1}}` ya en el cuerpo, el botón «Variable» y la opción del menú
    quedan deshabilitados («v1 admite una sola variable»); un `{{2}}` muestra
    el error inline y bloquea el botón de crear.
11. Crear → la fila nueva aparece con estado, categoría, cuerpo crudo y su
    preview compacto.

## Borrado

12. «Borrar» en una plantilla → `window.confirm`; cancelar no borra.
13. Confirmar en una plantilla sin campañas activas.
    ✅ `DELETE /api/templates/:id` → 200; la fila desaparece; el wa-mock
    recibe `DELETE {waba}/message_templates?name=…&hsm_id=…` y la quita de su
    estado (una que Meta ya no tiene responde 404 y se limpia igual).
    ✅ Las campañas terminadas que la usaban siguen mostrando su nombre
    (snapshot `template_name`; `template_id` queda NULL por FK `set null`).
14. Camino infeliz: plantilla usada por una campaña en borrador/en curso/pausada.
    ✅ 409 `in_use` con el motivo inline en la fila; nada se toca en Meta.

## Envío con ventana cerrada

5. Abrir una conversación con ventana cerrada en la bandeja.
   ✅ El composer bloqueado ahora lista la plantilla aprobada.
6. Elegirla, llenar la variable y enviar.
   ✅ El mensaje aparece en el hilo (tipo plantilla, cuerpo renderizado).
   ✅ El outbox del wa-mock registra `type: "template"` con `components`
   (`parameters[0].text` = valor de la variable).
7. Validaciones: enviar plantilla no aprobada → 422; variable faltante → 422.
