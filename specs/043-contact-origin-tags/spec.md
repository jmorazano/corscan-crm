# 043 — Etiquetas de origen en el contacto para retomar por campaña

**Estado**: en curso (28-oct-2026) · rama `043-contact-origin-tags`

## Problema

Los anuncios Click-to-WhatsApp de Meta ya marcan la **conversación** (035:
`conversation.ig_origin` + etiqueta `wa-anuncio`), pero las campañas eligen
destinatarios por **etiquetas del contacto** (004). El dueño puede filtrar la
Bandeja por `wa-anuncio` y no puede hacer nada con eso: no hay forma de
mandarle una plantilla a «los que llegaron por el anuncio de octubre y no
volvieron a escribir en 15 días».

Los de Google Ads no se identifican: Google no manda `referral`; lo único que
llega es el texto precargado del enlace `wa.me` de la landing («Hola, vi el
anuncio en Google…»).

## Decisiones del dueño (28-oct-2026)

1. **Canal + mes** en el contacto: un anuncio de Meta deja la etiqueta
   `meta-ads-AAAA-MM` (mes del clic en hora de Argentina). La etiqueta de
   conversación `wa-anuncio` se mantiene (Bandeja, agente, métricas).
2. **Reglas por frase** por empresa (Ajustes → Origen de contactos): «si el
   mensaje con el que la persona abre la charla contiene X → etiqueta Y».
   Genéricas: Google Ads, QR del local, link de la bio… Por defecto la
   etiqueta lleva el mes (`google-ads-2026-10`); se puede apagar por regla.
3. **Pasados**: los contactos de conversaciones que ya tienen un origen de
   anuncio de WhatsApp se etiquetan con el mes real del clic.
4. **Campañas**: además de las etiquetas, «llegaron hace al menos N días».

## Requisitos

- **FR-001** Un `referral` de WhatsApp que se APLICA (035: no duplicado ni
  viejo) suma al contacto `meta-ads-<AAAA-MM>` del `at` del clic, zona
  `America/Argentina/Cordoba`, y actualiza `contact.origin_at` (el mayor).
- **FR-002** Reglas por empresa: frase (3–80 caracteres), etiqueta base
  (saneada: minúsculas, sin tildes, `[a-z0-9-_]`, ≤ 32 para que con el mes
  entre en los 40 de 004), «agregar el mes» (default sí). Tope 20 reglas.
- **FR-003** Coincidencia sin mayúsculas, sin tildes y con espacios
  colapsados; se evalúa SOLO sobre el texto del mensaje que **abre** la
  charla: el primero de la conversación o el primero tras 24 h sin mensajes
  del cliente (el texto precargado de un `wa.me` siempre es ese). Cada regla
  que coincide suma su etiqueta. También actualiza `contact.origin_at`.
- **FR-004** Etiquetar jamás duplica, respeta el tope de 20 etiquetas por
  contacto (si está lleno no agrega; `origin_at` igual se actualiza) y jamás
  bloquea la ingesta (un fallo se loguea y el mensaje sigue).
- **FR-005** Sandbox (`is_test`), historial y ecos de 017 nunca etiquetan.
- **FR-006** Migración: backfill idempotente de `meta-ads-AAAA-MM` y
  `origin_at` desde `conversation.ig_origin` (`kind='ad'`,
  `channel='whatsapp'`, no `is_test`).
- **FR-007** Campaña: `arrived_min_days` opcional (1–365). Elegible solo si
  `coalesce(contact.origin_at, contact.created_at)` es de hace al menos N
  días. Aplica a la vista previa, a «elegibles hoy» del borrador y al
  congelado al lanzar. NULL = como antes.
- **FR-008** UI: Ajustes → «Origen de contactos» (solo propietario) con la
  explicación de la etiqueta automática de Meta, las reglas (alta, borrado,
  ejemplo de la etiqueta que queda) y en la campaña el campo «Llegaron hace
  al menos [N] días» con el conteo en vivo.

## Fuera de alcance

- Nombre de la campaña de Meta en la etiqueta: el `referral` no lo trae
  (solo el id del anuncio); mapearlo exige la Marketing API (otra
  categoría de dependencia, Principio II).
- Instagram: sus contactos no entran en campañas (023) y ya tienen su
  origen por conversación (030).
- Aplicar reglas nuevas a mensajes pasados.

## Criterios de aceptación

1. Un entrante con `referral` deja `meta-ads-2026-10` en el contacto y
   `wa-anuncio` en la conversación; una reentrega no cambia nada.
2. Con la regla «vi el anuncio en Google → google-ads», el mensaje «Hola,
   VÍ el anuncio en google y…» de un contacto nuevo deja `google-ads-2026-10`;
   el mismo texto en medio de una charla activa no etiqueta.
3. Campaña con etiqueta `meta-ads-2026-10` + «hace al menos 15 días»: la
   vista previa cuenta solo a los que llegaron antes de hace 15 días, y al
   lanzar congela esos mismos.
4. Un miembro no ve la pestaña ni puede escribir reglas (403).
