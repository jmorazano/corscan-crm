# 047 — Respuestas rápidas propias

**Estado**: implementada · **Migración**: 0034 · **Pedido**: Altos de
Calamuchita (2-nov-2026): «¿podemos crear respuestas rápidas? Veo el rayo y
la `/` pero no dónde se crean».

## Problema

El rayo y la `/` del compositor (012, FR-008) listaban SOLO las plantillas de
WhatsApp aprobadas por Meta, y al elegir una pegaban su texto como mensaje
común. Para tener una respuesta rápida («Te paso el alias para la seña…»)
había que darla de alta como plantilla en Meta, esperar la aprobación (que
puede rechazarla o clasificarla como marketing) y ser propietario.

Las «respuestas rápidas» de la app WhatsApp Business viven en el teléfono:
la Cloud API no las expone, así que no se pueden traer ni sincronizar. El
CRM necesita las suyas.

## Qué hace

- **Respuesta rápida** = atajo (`/seña`) + texto, por empresa. Se crea al
  instante, sin pasar por Meta. Tabla `quick_reply` (`qr_…`), atajo único por
  empresa, hasta 200 por empresa, texto hasta 2.000 caracteres.
- **Quién**: todo el equipo (propietario y miembros) las crea, edita y borra.
  Son herramienta de OPERACIÓN (como etiquetar), no configuración del
  negocio: `withAuth`, y la pestaña está en `MEMBER_SETTINGS_PATHS`.
- **Dónde se crean**: Ajustes → Respuestas rápidas, y el enlace
  «Administrar» al pie del selector del compositor (también en su estado
  vacío).
- **Variable**: `{nombre}` se reemplaza por el primer nombre del contacto al
  insertarla; si el contacto no tiene nombre (o el «nombre» es su teléfono)
  desaparece sin dejar «Hola ,».
- **Selector**: el rayo y la `/` muestran primero las respuestas propias y
  después las plantillas aprobadas (marcadas «Plantilla»), filtradas por
  atajo o texto. Insertar NO envía: el texto queda en la caja para revisarlo.
  Viaja como mensaje común (ventana de 24 h, igual que antes) por WhatsApp o
  Instagram.
- El rayo ya no queda deshabilitado sin plantillas: abre el selector vacío
  con el enlace para crear la primera.

## Fuera de alcance

Adjuntos en la respuesta rápida, carpetas, contador de uso, enviarlas desde
el agente de IA.

## Mapa

`src/lib/quick-replies.ts` (puro: atajo, Zod, `{nombre}`, filtro y orden) ·
`src/server/quick-replies.ts` · `/api/quick-replies` + `/[id]` ·
`src/components/settings/quick-replies-client.tsx` ·
`src/components/inbox/quick-replies.tsx` + `composer.tsx` ·
guion `tests/e2e/us-047-quick-replies.md`.
