# Tasks — 028 Conector MiniHotel

Estado durable del loop. `[x]` = hecho y verificado.

## Fase A — Fundaciones
- [x] A1 Constitución 1.9.0 (Principio II cat. 5, PROHIBIDO, adaptadores en II y en Restricciones, Sync Impact Report) + CLAUDE.md
- [x] A2 `postGuardedText` + núcleo `send<T>` en `src/lib/mcp/transport.ts` (187 tests de MCP verdes tras el cambio)
- [x] A3 Migración 0023 `mcp_integration.provider_config` + schema (perfil `minihotel` sin SQL)

## Fase B — Adaptador `src/lib/minihotel/`
- [x] B1 `xml.ts` parser acotado
- [x] B2 `dates.ts`, `requests.ts`, `endpoints.ts`, `booking-link.ts`
- [x] B3 `responses.ts` (ERR de texto plano, `<Errors>`, Immediate, Bulk, getRoomTypes, getRooms)
- [x] B4 `alternatives.ts`
- [x] B5 `credential.ts` + `client.ts` (herramientas virtuales, deadline único, motivos de config)
- [x] B6 Tests unitarios de B1–B5 (+ `postGuardedText`)

## Fase C — Conector
- [x] C1 `profiles/types.ts` (transport, roomTypes, campos nuevos de search_stays, providerConfig)
- [x] C2 `profiles/minihotel.ts` + registro + tests
- [x] C3 `providers.ts` + `calls.ts` (despacho, motivo de reconexión) + `integration.ts` (providerConfig, credencial, handshake) + tests
- [x] C4 `agent-tools.ts` (providerConfig, hidePrices), `actions.ts`, `prompts.ts`, `pipeline.ts`

## Fase D — Rutas y UI
- [x] D1 Admin PUT (perfil + providerConfig) y vista del super admin
- [x] D2 Empresa PUT (usuario/contraseña, precios), verify, vista previa por perfil
- [x] D3 UI super admin (tarjeta + diálogo del panel)
- [x] D4 UI empresa (credenciales, toggles, catálogo de habitaciones, vista previa)

## Fase E — Simuladores, docs y verificación
- [x] E1 `minihotel-mock` (ARI + contenido + perillas) y rama MiniHotel del ai-mock
- [x] E2 `docs/integraciones/minihotel.md` (sandbox y paso a producción)
- [x] E3 Gate (tsc + eslint + build + vitest)
- [x] E4 E2E `tests/e2e/028-minihotel-pms.md` verde con evidencia

## Estado (1-oct-2026)

- **Gate verde**: `tsc` + `eslint` + `next build` + `vitest` (148 archivos, 1381
  tests; 98 nuevos de 028 en `minihotel-*.test.ts` y `mcp-profile-minihotel.test.ts`).
- **E2E verde, 19/19** (`tests/e2e/028-minihotel-pms.md`) contra el simulador
  local, wa-mock y ai-mock, en la empresa `principal` (su conector de Altos se
  guardó antes y se restauró idéntico después; Altos verificado y buscando).
- **Hallazgos del E2E, corregidos**: (1) grupo que no entra en ninguna
  habitación → el texto decía «no pude buscar alternativas»; ahora dice que es
  capacidad y ofrece repartir o derivar; (2) cambiar de PERFIL conservaba la
  credencial del otro proveedor (formato incompatible): ahora se borra igual
  que al cambiar la dirección; (3) placeholder de contraseña y plurales.
- **Pendiente (fuera de esta rama)**: commit/merge/deploy con OK del dueño;
  prueba contra el sandbox REAL de MiniHotel con las credenciales públicas que
  carga el dueño (SC3, incluida la verificación de que `to` = salida);
  después, credenciales de producción + IPs autorizadas.
