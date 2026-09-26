# Tasks — 025 Publicaciones de Mercado Libre · privacidad · número personal

## Fase 0 — Datos y entorno
- [x] T0 Migración 0021: `meli_integration`, `meli_listing`,
      `agent_profile.shared_personal_number`, `contact.known_from_phone_at`
      (+ backfill). Prefijos de id `mli`/`mll`.
- [x] T1 Env: `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_AUTH_URL`,
      `MELI_API_BASE_URL`; `isMeliConfigured()` (ignora `REEMPLAZA_…`).

## Fase A — Adaptador Mercado Libre (puro + REST)
- [x] A1 `src/lib/meli/oauth.ts`: URL de autorización, PKCE derivado,
      canje, refresh rotativo, errores tipados. Tests.
- [x] A2 `src/lib/meli/client.ts`: users/me, items/search paginado, bulk con
      fallback, descripción, errores tipados, timeouts. Tests.
- [x] A3 `src/lib/meli/listing.ts`: normalización pura. Tests.
- [x] A4 `src/lib/meli/search.ts`: búsqueda pura + resumen del inventario.
      Tests.
- [x] A5 `src/lib/meli/render.ts`: sección, toolText, ficha, clientSummary.
      Tests.

## Fase B — Servidor + API + UI
- [x] B1 `src/server/meli/integration.ts`: vista, connect (409 cuenta usada),
      disconnect, token vigente con lock y rotación, ajustes.
- [x] B2 `src/server/meli/sync.ts`: sync con lock, diff por `last_updated`,
      descripciones con concurrencia acotada, stale-while-revalidate.
- [x] B3 Rutas `/api/integrations/mercadolibre{,/connect,/callback,/sync}` +
      índice.
- [x] B4 UI `/integrations/mercadolibre` + tarjeta del índice.
- [x] B5 meli-mock + estado/knobs.

## Fase C — Agente
- [x] C1 Acciones `search_listings`/`show_listing`/`request_visit`.
- [x] C2 `src/server/meli/agent-tools.ts` (load/render/execute, nunca lanza).
- [x] C3 Pipeline: familia «publicaciones», `request_visit` (nota, etapa,
      handoff `visita`), sección en el prompt.
- [x] C4 Privacidad general en el prompt + `src/lib/privacy-guard.ts` en toda
      entrega del modelo. Tests.
- [x] C5 Número personal: perfil (schema/ruta/UI), marca `known_from_phone_at`
      en agenda/historial/ecos, corte en `runAgentTurn`, sección del prompt.
      Tests.
- [x] C6 Entrenador: regla de datos de terceros.
- [x] C7 Laboratorio: personas `busca_propiedad` (listings) y
      `datos_ajenos` (todas), juez con `liveListings` y privacidad.
- [x] C8 ai-mock: publicaciones, privacidad, número personal, fuga forzada.
- [x] C9 Push: texto del handoff `visita`; etiqueta en la Bandeja.

## Fase D — Javier (Distrito)
- [x] D1 `scripts/seed/agents/distrito-inmobiliario.json` + `_revisar`;
      el seed acepta `sharedPersonalNumber`.
- [x] D2 Test del seed (sin datos inventados, primera persona honesta).

## Fase E — Verificación y entrega
- [x] E1 Guion `tests/e2e/025-mercadolibre-listings.md` conducido con mocks.
- [x] E2 Gate: typecheck + lint + build + test.
- [x] E3 Docs: `docs/integraciones/mercadolibre.md`, `.env.example`,
      CLAUDE.md, constitución 1.8.1, memoria.
- [ ] E4 Merge + deploy + verificación en Railway; cargar Javier en
      `distrito-inmobiliario` (autorizado por el dueño).

## Estado

A–D y E1–E3 completas (26-sep-2026). Guion `tests/e2e/025-mercadolibre-listings.md`
conducido y verde en el worktree (puerto 3025) con meli-mock + ai-mock +
wa-mock: conexión OAuth/PKCE, sync con cambios/pausadas/401/fallback/API
caída/revocado, conflicto de cuenta, desconexión, rol miembro, búsqueda →
ficha → pedido de visita con handoff, privacidad (negativas + guarda de
teléfono), número personal (conocido calla, nuevo personal calla, ajuste
apagado responde) y Laboratorio sin tráfico a ML. Gate: typecheck + lint +
build + 1.190 tests.
