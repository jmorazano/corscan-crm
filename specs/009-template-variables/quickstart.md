# Quickstart — Variables enriquecidas (009)

Mismo entorno que 008 (dev server + mocks + `META_APP_ID` local).

## Feliz

1. Ajustes → Plantillas: crear `promo_multivar` (es_AR, MARKETING) con cuerpo
   «Hola {{1}}, somos {{2}}: {{3}}» eligiendo Nombre del contacto / Nombre de
   tu empresa / Texto libre en el autocompletado; el panel muestra los
   bindings y el preview los resuelve. Queda Pendiente.
2. Aprobar por mock (`template-status` APPROVED).
3. Crear DOS contactos con nombres distintos y etiqueta `e2e-var`; campaña
   con la plantilla: la UI informa {{1}}/{{2}} automáticas y pide solo el
   texto de {{3}}; lanzar.
4. `GET /api/dev/wa-mock/outbox`: cada send lleva `parameters` = [nombre DEL
   destinatario, nombre de la org, texto de la campaña] en ese orden.
5. 1:1 desde una conversación: el diálogo pide solo {{3}}; el outbox suma el
   send con el texto tipeado.

## Infeliz

6. Cuerpo `{{1}} … {{3}}` (hueco) y cuerpo con 6 variables → 422 con mensaje
   claro, nada creado.
7. Campaña sin el texto libre → 422 al crear; no hay borrador a medias.
8. Regresión legada: plantilla vieja (bindings null) por campaña
   (contact_name/fixed) y 1:1 tipeado → idéntico a hoy.
9. Convivencia 008: plantilla con imagen + variables → header y body juntos
   en el outbox.

## Gate

typecheck + lint + build + tests (binarios de node_modules/.bin — pnpm roto
en esta máquina).
