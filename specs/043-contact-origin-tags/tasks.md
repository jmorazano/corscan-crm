# Tasks — 043 etiquetas de origen en el contacto

## Fase A — Núcleo
- [x] A1 `src/lib/contact-origin.ts` (mes, etiqueta, normalización, reglas, apertura).
- [x] A2 Schema + migración 0032 (columnas, tabla, backfill) + prefijo `orr`.

## Fase B — Servidor
- [x] B1 `src/server/contact-origin.ts` (etiquetar + CRUD de reglas + aplicar).
- [x] B2 Ingesta de WhatsApp: Meta + reglas.
- [x] B3 Campañas: `arrivedMinDays` en elegibilidad, vista previa, congelado, rutas, MCP.
- [x] B4 Rutas `/api/settings/origin-rules`.

## Fase C — UI
- [x] C1 Ajustes → Origen de contactos.
- [x] C2 Campañas: campo «hace al menos N días».

## Fase D — Verificación
- [x] D1 Unit tests.
- [x] D2 Gate (tsc, eslint, vitest, build).
- [x] D3 Guion E2E conducido con mocks.
- [x] D4 CLAUDE.md (mapa + feature activa) y memoria.

## Estado

Completas (28-oct-2026) en el worktree `043-contact-origin-tags`, sin
mergear ni deployar. Gate: `tsc`, `eslint`, `vitest` (183 archivos, 2051
tests; 18 nuevos) y `next build`. E2E 30/30 + permisos de miembro + UI.
Después del deploy: la migración 0032 etiqueta a los contactos de anuncios
ya recibidos; cargar en CorScan la regla «vi el anuncio en Google» →
`google-ads` (el texto que precarga la landing de dronebiz).
