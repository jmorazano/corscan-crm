# Plan — 025 Publicaciones de Mercado Libre · privacidad · número personal

## Constitución

- **II (Soberanía)**: Mercado Libre entra en la **categoría 3** (integración
  opcional POR EMPRESA vía OAuth): la app es del operador (`MELI_CLIENT_ID/
  SECRET` por env), la conecta cada empresa, tokens cifrados, adaptador
  dedicado `src/lib/meli/`, el instalador no la necesita. Sin categoría nueva
  → enmienda PATCH 1.8.0 → 1.8.1 (se nombra a ML en la categoría 3 y en la
  lista de adaptadores).
- **I (Seguridad)**: access + refresh token AES-256-GCM; jamás al cliente ni a
  logs. PKCE S256 con verifier derivado por HMAC del nonce del state (sin
  almacenamiento, el verifier nunca viaja en la URL).
- **III (Multi-tenancy)**: `organization_id` NOT NULL en `meli_integration` y
  `meli_listing`; todo por `scoped()`.
- **IV (Idempotencia)**: sync = upsert por `(org, item_id)` + borrado de lo
  que dejó de estar activo; re-ejecutable. Callback upsert.
- **Sandbox**: el agente consulta el SNAPSHOT local (base), nunca la red en el
  turno → el Laboratorio queda naturalmente aislado de ML.

## Decisiones técnicas

- **D1 Snapshot en base, no consulta en vivo por turno.** Una inmobiliaria
  tiene decenas/cientos de publicaciones; filtrar localmente es instantáneo,
  sin cupo de ML en el turno y sin latencia de tercero. Frescura: sync al
  conectar, manual, y stale-while-revalidate (> 3 h) disparado por el turno y
  por la página.
- **D2 Refresh token rotativo.** Cada refresh devuelve uno nuevo y el viejo
  muere: se persiste EN EL MISMO update que el access token, y hay un lock
  en proceso por empresa (una promesa compartida) para que dos turnos
  simultáneos no quemen el refresh dos veces. `invalid_grant` →
  `reconnect_required` (el snapshot sigue sirviendo).
- **D3 Una cuenta de ML = una empresa.** El grant nuevo de la misma app
  invalida el anterior: `ml_user_id` UNIQUE en la instancia → 409.
- **D4 Normalización pura** (`src/lib/meli/listing.ts`): operación, tipo,
  números desde `attributes` (`struct.number` o el número de `value_name`),
  barrio/ciudad de `location`, permalink forzado a https y validado contra el
  dominio de ML del sitio, título/descripción por `sanitizeForeignText` (texto
  ajeno = DATO). Características = atributos booleanos en «Sí» + expensas +
  mascotas/amoblado explícitos.
- **D5 Búsqueda pura** (`src/lib/meli/search.ts`): sinónimos de operación y
  tipo, zona sin acentos, dormitorios/ambientes mínimos, precio con moneda (si
  no viene, la moneda DOMINANTE de esa operación en el inventario — alquiler
  en pesos, venta en dólares), texto libre; sin coincidencias → resumen de lo
  que sí hay.
- **D6 Acciones**: `search_listings`, `show_listing` (herramientas, familia
  propia con presupuesto 2 dentro del total 3) y `request_visit` (terminal):
  nota en el contacto + etapa de visita/interesado si existe (por nombre, sin
  crear etapas) + respuesta + handoff `visita` con push. Con agenda reservable
  (005) el prompt manda por `check_availability/book_appointment`.
- **D7 Privacidad general** en `buildAgentSystemPrompt` (siempre) + guarda
  PURA `src/lib/privacy-guard.ts` sobre el texto saliente: teléfonos/emails
  que no aparecen en el corpus del turno (system + historial + herramientas +
  teléfono del contacto) se sacan con la oración; si no queda nada, frase
  segura. No toca precios con separador de miles, fechas, horas, ids `MLA…`
  ni URLs.
- **D8 Número personal**: `agent_profile.shared_personal_number` +
  `contact.known_from_phone_at` (lo marca la sync de agenda, el historial y los
  ecos del celular; backfill en la migración). Corte en `runAgentTurn` antes
  del proveedor; sección del prompt para mensajes personales de números
  nuevos → `none`.
- **D9 Entrenador**: regla dura de no guardar datos personales de terceros.
- **D10 Laboratorio**: `requires: "listings"` (persona que busca alquiler y
  pide visita) y persona general «datos ajenos»; el juez recibe
  `liveListings`.

## Datos (migración 0021)

- `meli_integration` (1 por org): `ml_user_id` UNIQUE, `nickname`, `site_id`,
  tokens cifrados, `access_token_expires_at`, `status`, `agent_enabled`,
  `sync_status`, `last_sync_at`, `last_sync_error`, `listings_count`,
  `connected_by`.
- `meli_listing`: `(organization_id, item_id)` UNIQUE, campos normalizados,
  `features` jsonb (string[]), `description`, `ml_updated_at`, `synced_at`.
- `agent_profile.shared_personal_number boolean default false`.
- `contact.known_from_phone_at timestamp` + backfill (contactos con mensajes
  `history`/`phone`, o sin consentimiento en empresas con historial, o creados
  antes de su primer entrante por la nube en esas empresas).

## Superficie

- Adaptador `src/lib/meli/{oauth,client,listing,search,render}.ts`.
- Servidor `src/server/meli/{integration,sync,agent-tools}.ts`.
- Rutas `/api/integrations/mercadolibre` (GET/PATCH/DELETE), `/connect`,
  `/callback`, `/sync` (POST 202).
- UI `/integrations/mercadolibre` + tarjeta del índice + tarjeta «Número
  personal» en Agente.
- Mock `/api/dev/meli-mock/*` (authorization con PKCE real, token con
  rotación, users/me, items/search, items/bulk, items, description, state).
- ai-mock: ramas de publicaciones, privacidad y número personal.
- Docs `docs/integraciones/mercadolibre.md`, `.env.example`, CLAUDE.md,
  constitución 1.8.1.

## Verificación

Unit (puros + pipeline con base mockeada) · gate completo · guion
`tests/e2e/025-mercadolibre-listings.md` conducido con mocks en el worktree
(puerto 3025): conectar/sincronizar/desconectar, búsqueda → opciones →
visita → handoff, sin coincidencias, token revocado, API caída, privacidad
(pregunta por otros + guarda de teléfono), número personal (conocido calla,
nuevo responde, personal calla), Laboratorio.
