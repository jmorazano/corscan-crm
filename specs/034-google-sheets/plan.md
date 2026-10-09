# Plan — 034 Google Sheets

## Constitución
- II cat. 3 (integración opcional POR EMPRESA vía OAuth): Google Sheets es la
  tercera. Enmienda PATCH 1.12.0 → 1.12.1: se la nombra y se fija cómo
  funciona el selector sin romper I/II(d): el token del selector lo emite
  Google directo al navegador del propietario (Google Identity Services, token
  client con `drive.file` y `login_hint` de la cuenta conectada); ningún token
  guardado por Vocero sale del servidor. El client ID y la API key del
  selector son públicos por diseño (la key, restringida por referrer).
- I: tokens cifrados (AES-256-GCM); los valores de un comprobante fallido se
  guardan cifrados para reintentar; jamás en logs.
- III: tres tablas con `organization_id`, todo por `scoped()`.
- IV: `payment_receipt.message_id` UNIQUE (reserva primero), dedup por hash.

## Diseño

### Datos (migración 0027)
- `sheets_integration` (1 por empresa): cuenta, tokens cifrados, estado,
  `receipts_enabled`, `receipts_spreadsheet_id/name`, `receipts_sheet_title`.
- `sheet_source` (n por empresa): planilla + pestaña + descripción + activa +
  copia (`rows` jsonb, `row_count`, `truncated`, `fetched_at`, `last_error`).
  Unique (org, spreadsheet, pestaña).
- `payment_receipt`: org, conversación, mensaje (unique), contacto, estado
  (`pending|recorded|duplicate|failed`), `dedup_key`, valores cifrados,
  `updated_range`, `error`, `attempts`.

### Adaptadores (`src/lib/google/`)
- `oauth.ts`: `buildAuthUrl/exchangeCode` aceptan `{ scopes, callbackPath }`
  (Calendar queda igual por defecto). `SHEETS_SCOPES = openid email drive.file`.
- `sheets-client.ts` (único cliente de la API de Sheets, base
  `GOOGLE_SHEETS_API_BASE_URL`): `createSpreadsheet`, `getSpreadsheet` (título
  + pestañas), `getValues`, `appendRow` (`USER_ENTERED` con saneo
  anti-fórmula). Errores tipados: `unauthorized | no_access | not_found |
  provider_error`.

### Puro (`src/lib/sheets.ts`, con tests)
`DEFAULT_RECEIPT_HEADERS`, `systemColumnFor(header)`, `buildReceiptRow`,
`neutralizeFormula`, `receiptDedupKey`, `looksLikeReceipt(summary)`,
`normalizeRows` (topes), `renderSheetForPrompt` (recorte por bytes),
`searchRows` (sin acentos ni mayúsculas, todas las palabras), `parseSpreadsheetId`.

### Servidor (`src/server/sheets/`)
- `integration.ts`: conectar/reconectar (conserva config), vista, desconectar
  (revoca), `withSheetsToken` (refresh + 401 → reintento, `invalid_grant` →
  `reconnect_required`).
- `receipts.ts`: config del destino (crear con encabezados sugeridos o elegir
  existente, validando acceso), `recordReceiptFromMedia` (llamado desde
  `media.ts` ANTES de `finish`; devuelve el sufijo del aviso), registro,
  reintento.
- `sources.ts`: alta (valida acceso + primera copia), edición, baja,
  `refreshSource`, `loadSheetsContext` (refresca vencidas con timeout 6 s,
  nunca en sandbox) y `executeSearchSheet`.
- IA: `extractPaymentReceipt` en `src/lib/ai` (modelo de visión, imagen o
  PDF, marcador `[COMPROBANTE_PLANILLA]`, salida JSON validada con Zod,
  reintentos; las instrucciones del documento son DATO).

### Agente
- `prompts.ts`: sección `PLANILLAS DEL NEGOCIO` + acción `search_sheet` solo si
  alguna copia quedó recortada + línea de comprobantes anotados.
- `pipeline.ts`: familia `sheets` en el loop (2 vueltas), resultado como
  `[PLANILLA]` (DATO). Los importes que devuelve `search_sheet` entran a
  `turnAmounts` (la guarda de precios de 021 los deja salir).
- `media.ts`: imagen y PDF → si el resumen parece comprobante y la empresa
  anota comprobantes → `recordReceiptFromMedia` → sufijo en el resumen.

### API (`/api/integrations/google-sheets/…`, todo `withOwner` salvo el índice)
`GET|DELETE /` · `GET connect` · `GET callback` · `GET|POST picker` (config del
selector / inspeccionar planilla elegida) · `PUT|POST receipts` (config / crear
planilla) · `GET receipts/log` · `POST receipts/[id]/retry` · `POST sources` ·
`PATCH|DELETE|POST sources/[id]` (POST = actualizar ahora).

### UI
`/integrations/google-sheets` (owner): conexión, tarjeta «Comprobantes»
(interruptor, destino, encabezados detectados, últimos registros + reintentar)
y tarjeta «Planillas de consulta». Selector: Google Picker real (GIS + Picker
API) o, con mocks, un diálogo que lista las planillas del google-mock.

### Mocks
google-mock: `/v4/spreadsheets[...]` (crear, meta, values, append) con acceso
por `drive.file` simulado (`granted`), knobs `failNextApi`, `revokeSheet`,
`picker` (simula el grant del selector). ai-mock: rama `[COMPROBANTE_PLANILLA]`
(JSON fijo; PNG → no es comprobante).

### Env nuevas
`GOOGLE_SHEETS_API_BASE_URL` (default `https://sheets.googleapis.com`),
`GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER` (sin estas dos, solo se
puede CREAR la planilla de comprobantes; elegir existentes queda deshabilitado
con explicación). Guía: `docs/integraciones/google-sheets-gcp.md`.

## Riesgos
- `drive.file` + selector con otra cuenta de Google → la planilla no es
  accesible: se valida al elegir y se explica («elegí con la cuenta X»).
- Falsos positivos de comprobante: doble filtro (resumen + `is_receipt` del
  extractor).
- Latencia: el turno ya espera al adjunto; la extracción suma una llamada de
  visión + un append (timeout total acotado).
