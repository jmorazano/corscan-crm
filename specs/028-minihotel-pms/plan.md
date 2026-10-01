# Plan — 028 Conector MiniHotel (PMS hotelero)

**Rama**: `028-minihotel-pms` · **Fecha**: 1-oct-2026 · **Spec**: [spec.md](spec.md)

## Resumen

MiniHotel entra como un **segundo proveedor del conector de 016**: mismo
alta por el super admin, misma credencial cifrada de la empresa, misma puerta
única a la red (`callGuarded`), mismas guardas (promesas, precios,
privacidad), mismo Laboratorio aislado y misma bitácora. Lo nuevo es un
**segundo transporte** —XML por POST en vez de JSON-RPC— y un **perfil**
propio. El agente sigue hablando el mismo idioma (`search_stays`), con campos
nuevos para adultos/niños/bebés y para comparar rangos.

## Constitución — enmienda 1.8.1 → 1.9.0 (aprobada 1-oct-2026)

La categoría 5 del Principio II pasa a «sistemas de terceros POR EMPRESA vía
MCP **o vía la API del proveedor**». Cómo se cumple cada condición:

| | Condición | Cómo |
|---|---|---|
| a | Sin el conector todo funciona | Sin fila `mcp_integration`, nada cambia (igual que 016). |
| b | Lo habilita el super admin y fija la URL | El super admin fija la dirección ARI, el código de hotel, la tarifa y el **enlace del motor**. La URL de contenido se DERIVA por regla de código (`endpoints.ts`). La empresa solo pone usuario y contraseña. |
| c | Credencial cifrada, nunca en logs/errores | `{username,password}` cifrado como un solo secreto; viaja SOLO en el cuerpo del POST al origen validado. **Decisión explícita (antes c#15 descartó la credencial en el cuerpo porque «el cuerpo se audita»)**: el cuerpo XML no se loguea, no se persiste y no vuelve en errores; la bitácora guarda solo NUESTROS argumentos. Es la única forma que acepta la API. |
| d | Anti-SSRF en cada conexión, sin 3xx, timeout, tope, cupo | `postGuardedText` comparte socket, semáforo, `guardedLookup`, tope y deadline con `postJsonRpc`. |
| e | Transporte genérico + perfil | `lib/mcp/transport.ts` (POST protegido) + `lib/minihotel/` (adaptador único) + `profiles/minihotel.ts`. |
| f | Solo lectura, allowlist propia, nunca promete | Herramientas virtuales `availability` y `room_catalog` → solo Immediate ARI, Bulk ARI, `getRoomTypes`, `getRooms`. No existe builder de escritura. `promise-guard` sigue activo. |
| g | El instalador no lo necesita | Nada de env nuevo. |
| h | Laboratorio jamás lo toca | El corte de sandbox de `callGuarded` + `profile.sandbox()` con datos de ejemplo. |
| i | Lo que devuelve es DATO | Errores → códigos propios; nombres y atributos por `sanitizeForeignText`/`safeName`; enlaces armados por código y validados contra `hotelpms.io`/`minihotel.cloud`. |
| j | Un fallo degrada sin tumbar | Todo `catch` → texto propio; alternativas que fallan no tumban la respuesta principal. |

## Arquitectura

```
modelo ──search_stays──▶ agent-tools ─validate/render─▶ profiles/minihotel.ts (PURO)
                              │
                              ▼
                        callGuarded (calls.ts) ── allowlist · sandbox · credencial · cupo · caché · bitácora
                              │
                    providers.ts (despacho por transporte)
                     ├─ mcp       → lib/mcp (JSON-RPC)
                     └─ minihotel → lib/minihotel/client.ts ──▶ postGuardedText (lib/mcp/transport.ts)
                                         │ requests.ts · responses.ts · xml.ts · alternatives.ts
```

- **`src/lib/minihotel/`** — adaptador ÚNICO de MiniHotel. Puros: `xml.ts`
  (parser acotado, sin DTD), `dates.ts`, `requests.ts`, `endpoints.ts`,
  `booking-link.ts`, `responses.ts` (lee `ERR …` de texto plano y `<Errors>`),
  `alternatives.ts`, `credential.ts`. Con I/O: `client.ts` (orquesta las
  herramientas virtuales con un único deadline).
- **`src/lib/mcp/transport.ts`** — `postGuardedText` + núcleo `send<T>` con
  lector intercambiable; decodificación UTF-8 incremental.
- **`src/server/mcp/`**
  - `profiles/types.ts`: `transport?: "mcp" | "minihotel"`; `StayCatalog`
    gana `roomTypes` y `hotelName` opcionales; `SearchStaysAction` gana
    `adults`, `children`, `babies`, `room_type`, `ranges`; las funciones del
    perfil reciben `providerConfig`.
  - `profiles/minihotel.ts` + registro en `profiles/index.ts`.
  - `providers.ts` (nuevo): `callProviderTool` y `providerHandshake`
    despachan por transporte y arman la config de MiniHotel (credencial,
    `providerConfig`, hoy en la zona de la empresa).
  - `calls.ts`: usa `callProviderTool`; ante `unauthorized` guarda el MOTIVO
    (`auth`, `hotel`, `ip_not_authorized`) en `last_error_code`.
  - `integration.ts`: `providerConfig` en fila y vistas; credencial de
    MiniHotel; el handshake de MiniHotel es pedir el catálogo de habitaciones.
  - `agent-tools.ts`: pasa `providerConfig`; el contexto expone `hidePrices`.
- **`src/server/ai/`**: `actions.ts` (campos nuevos de `search_stays`),
  `pipeline.ts` (`mcp.hidePrices`), `prompts.ts` (menú de acciones que da el
  perfil).
- **Rutas**: admin (`profile: "minihotel"` + `providerConfig` validado),
  empresa (`minihotel: {username,password}`, `showPrices`,
  `showNonRefundable`), vista previa por perfil.
- **UI**: tarjeta del super admin (ajustes de MiniHotel con atajos
  sandbox/producción), diálogo del panel, tarjeta de la empresa (usuario +
  contraseña, precios, vista previa de habitaciones y alternativas).
- **Dev**: `src/app/api/dev/minihotel-mock/` (ARI + contenido, perillas) y
  rama MiniHotel del ai-mock.

## Datos

- Migración **0023**: `mcp_integration.provider_config jsonb` (nullable).
  Los «enums» son de TypeScript (`text({enum})`): sumar `"minihotel"` al
  perfil no lleva SQL.
- `providerConfig` de MiniHotel (Zod): `hotelId`, `rateCode`,
  `bookingEngineUrl` (super admin) · `showPrices` (default `true`),
  `showNonRefundable` (default `false`) (empresa).
- Credencial: JSON `{"username","password"}` cifrado; `credential_last4` =
  últimos 4 de la contraseña.

## Decisiones

- **D1** Parser XML propio y acotado (sin dependencia nueva: `pnpm` está roto
  en la máquina y `node_modules` es compartido entre worktrees; además una
  librería genérica trae DTD/entidades).
- **D2** Herramientas VIRTUALES: `availability` (1–3 rangos; con 1 rango sin
  lugar → Bulk ARI ±7 días → hasta 3 ventanas → Immediate para confirmar) y
  `room_catalog` (`getRoomTypes` + `getRooms`). Una fila de bitácora y un
  lugar del cupo por herramienta virtual; las subconsultas comparten un
  deadline.
- **D3** `to` del Immediate ARI = fecha de SALIDA (`ERR 108` lo confirma).
  Se verifica en el sandbox con una consulta de 1 noche.
- **D4** La capacidad se filtra en el perfil con el catálogo (`getRooms`):
  el cliente HTTP no decide qué se ofrece.
- **D5** Los atributos se prometen solo si los tienen TODAS las habitaciones
  del tipo (el huésped reserva un tipo, no una habitación); se priorizan las
  habitaciones `is_mapped`.
- **D6** Precios por empresa: `hidePrices = profile.hidePricesInReply ||
  providerConfig.showPrices === false`; la guarda `stripPrices` no cambia.
- **D7** Un enlace por mensaje: el `toolText` trae el enlace de cada opción,
  la regla del prompt obliga a mandar UNO (el de la opción elegida o
  recomendada).
- **D8** Motivos de reconexión propios (`auth`, `hotel`, `ip_not_authorized`)
  con texto de primera parte; nunca el texto del proveedor.

## Verificación

- Unit: xml, requests, responses (incluido `ERR …` y `<Errors>` reales),
  alternatives, booking-link, endpoints, client (servidor loopback), transport
  (`postGuardedText`), perfil (validate/render/section/sandbox), calls
  (despacho + motivos), rutas.
- E2E (`tests/e2e/028-minihotel-pms.md`) contra `minihotel-mock` + wa-mock +
  ai-mock: habilitar, credenciales, verificar, disponibilidad con/sin
  precios, alternativas, comparación, sin alternativas, credencial inválida,
  IP no autorizada, caída, Laboratorio sin red, vista previa.
