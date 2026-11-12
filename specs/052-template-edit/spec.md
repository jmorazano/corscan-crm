# 052 — Editar plantillas de WhatsApp desde el CRM

**Estado**: implementada y verificada con mocks (12-nov-2026; falta probarla contra Meta real) — tareas en [tasks.md](tasks.md) ·
**Migración**: 0039 · **Pedido**: dueño, 12-nov-2026 («¿se puede editar una
plantilla desde el CRM?» → «armalo como feature»).

## Problema

Ajustes → Plantillas permite crear, sincronizar y borrar. Para corregir un
texto hay que crear otra plantilla con otro nombre, esperar la aprobación y
borrar la vieja, o ir al WhatsApp Manager de Meta (y el CRM nunca se entera
del texto nuevo: la sincronización solo trae el estado).

## Lo que permite Meta (doc «Template management», verificada 12-nov-2026)

- `POST /{template-id}` con `components` (y `category`). **Reemplaza TODOS
  los componentes**: el encabezado de imagen hay que volver a mandarlo.
- Se pueden editar plantillas **APPROVED, REJECTED o PAUSED**. Las que
  están en revisión, no.
- Solo cambian **categoría, componentes** (y TTL). Nombre e idioma son fijos.
- **La categoría de una aprobada no se puede cambiar.**
- Aprobadas: **1 edición cada 24 h y 10 cada 30 días**. Rechazadas o
  pausadas: sin límite.
- Una aprobada editada vuelve a revisión y Meta la re-aprueba si pasa.

## Comportamiento

1. Cada fila de plantilla tiene **«Editar»** (solo propietario, como el
   resto de la configuración). Abre el mismo editor del alta, con los datos
   actuales: nombre e idioma de solo lectura, categoría bloqueada si está
   aprobada, cuerpo con el autocompletado de variables (009), orígenes de
   cada variable y encabezado de imagen (008): **conservar / reemplazar /
   quitar**.
2. Si no se puede editar, el botón queda deshabilitado y la fila dice por
   qué: «Meta la está revisando», «Ya la editaste hoy: podés de nuevo desde
   el …», «Llegaste a las 10 ediciones del mes: podés de nuevo desde el …».
   Los límites se cuentan en el CRM (`template.approved_edits`); Meta sigue
   siendo la autoridad: si rechaza igual, se muestra su mensaje.
3. Guardar una **aprobada** pide confirmación: vuelve a revisión de Meta y
   mientras tanto no se puede usar para campañas ni envíos 1:1.
4. Al guardar: se manda a Meta, se lee el estado que Meta informa después
   (`GET /{template-id}`; si no se puede leer, «Pendiente de Meta») y se
   actualiza la fila local (texto, categoría, orígenes, imagen, estado).
   Orden Meta-primero como el alta: si Meta falla, nada cambia en el CRM.
5. **Sin cambios** → 422 «No cambiaste nada» (no gasta la edición del día).
6. **Campañas**: en curso o pausadas que usan la plantilla → 409 `in_use`
   con los enlaces (como el borrado). Borradores: se permite solo si los
   orígenes de las variables quedan IGUALES (sus textos libres congelados
   siguen sirviendo); si cambian → 409 con los borradores.
7. Plantilla sin id de Meta (`wa_template_id` nulo) → 422 «Tocá Sincronizar
   primero».

## Fuera de alcance

- Traer al CRM el texto de ediciones hechas en el WhatsApp Manager.
- Cambiar nombre o idioma (Meta no lo permite: eso es crear otra).
- TTL / botones / otros formatos de encabezado (el CRM no los crea).
