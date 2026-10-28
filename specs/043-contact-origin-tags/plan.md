# Plan — 043 etiquetas de origen en el contacto

## Datos (migración 0032)

- `contact.origin_at timestamp` — último origen registrado (anuncio o regla).
- `campaign.arrived_min_days integer` — NULL = sin filtro.
- Tabla `contact_origin_rule` (`id` `orr_…`, `organization_id` FK cascade,
  `phrase`, `tag`, `append_month` bool default true, timestamps; índice por
  organización).
- Backfill en la misma migración (re-ejecutable: solo agrega lo que falta).

## Puro — `src/lib/contact-origin.ts`

`ORIGIN_TIMEZONE`, `META_ADS_TAG`, `originMonth(at, tz)`,
`originTag(base, at, appendMonth)`, `normalizeOriginText`,
`sanitizeRuleTag`, `originRuleInput` (Zod), `matchOriginRules`,
`opensConversation(prevLastInboundAt, at)`.

## Servidor

- `src/server/contact-origin.ts`: `addContactOriginTags` (UPDATE atómico
  scoped, sin duplicar, con tope, `origin_at = greatest`), `listOriginRules`,
  `createOriginRule`, `deleteOriginRule`, `applyOriginRules`.
- `ingestInboundMessage`: tras `applyWhatsAppAdOrigin` aplicado →
  `meta-ads-…`; si el mensaje abre la charla y trae texto → reglas. Todo
  con `.catch`.
- `recipients.ts`: `eligibilityWhere(org, tags, arrivedMinDays)`;
  `previewSegment(org, tags, days)`; `freezeRecipients` lee
  `campaign.arrivedMinDays`.
- Rutas: `/api/settings/origin-rules` (GET/POST, `withOwner`),
  `/api/settings/origin-rules/[id]` (DELETE); campañas y segment-preview
  aceptan/devuelven `arrivedMinDays` (`days=` en la vista previa).
- Asistente MCP (040): `arrived_min_days` en el detalle de campaña.

## UI

- `/settings/origins` + `src/components/settings/origins-client.tsx`
  (pestaña «Origen de contactos» después de «Envíos y campañas»).
- Campañas: campo numérico en el alta, línea en la lista y en el detalle.

## Verificación

Unit (`tests/unit/contact-origin-043.test.ts`) + guion
`tests/e2e/043-contact-origin-tags.md` con wa-mock (referral y texto) +
gate.
