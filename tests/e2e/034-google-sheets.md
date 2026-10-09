# E2E — 034 Google Sheets (comprobantes + planillas de consulta)

Entorno: `WA_MOCK_ENABLED=true`, wa-mock + ai-mock + google-mock
(`GOOGLE_AUTH_URL/TOKEN_URL/API_BASE_URL` y `GOOGLE_SHEETS_API_BASE_URL` →
`/api/dev/google-mock`, `GOOGLE_CLIENT_ID/SECRET` cualquiera). Empresa
«Inmobiliaria Demo» (`phoneNumberId` 222222222), propietario
`socio@vocero.test`, miembro `e2e@vocero.test`.

Marcas del wa-mock en `mediaId` de imagen: `opNNNN` (n° de operación),
`photo` (no parece comprobante), `notreceipt` (parece, el extractor dice que
no), `inject` (titular con fórmula). PDF con `filename` que contenga
«comprobante». Knobs del google-mock (`POST /api/dev/google-mock/state`):
`grantSheet`, `revokeSheet`, `setRows`, `failNextApi`, `failNextAppend`,
`revokeAll`.

## Verificado el 8-oct-2026 (todo verde)

| # | Paso | Resultado esperado | ✓ |
|---|------|--------------------|---|
| 1 | Integraciones | Tarjeta «Google Sheets» | ✓ |
| 2 | Conectar con Google | vuelve con `?connected=1`, cuenta visible | ✓ |
| 3 | POST picker con una planilla NO elegida | 409 `no_access` con explicación | ✓ |
| 4 | Elegir «Conciliación de pagos» › Pagos con el selector | destino + chips de columnas | ✓ |
| 5 | Comprobante `op5551` | fila 2 (Fecha, Cliente=contacto, Importe…); aviso «anotado»; el agente confirma sin importes | ✓ |
| 6 | Mismo `op5551` desde otro número | `duplicate`, sin fila, aviso «repetido» | ✓ |
| 7 | `photo` / `notreceipt` | sin fila ni registro | ✓ |
| 8 | `failNextApi` + comprobante | `failed provider_error`, aviso «no se pudo anotar», el agente igual responde | ✓ |
| 9 | «Reintentar» en la página | fila 4, estado Anotado | ✓ |
| 10 | Crear planilla nueva + KB «Concepto: SEÑA-WEB» | 13 columnas; Concepto = SEÑA-WEB (manda la KB) | ✓ |
| 11 | `inject` | titular escrito como `'=IMPORTXML(…)` (texto) | ✓ |
| 12 | PDF «comprobante-transferencia.pdf» | fila anotada | ✓ |
| 13 | `failNextAppend` + reintento | reintento escribe la fila cifrada guardada; 2º reintento → 409 | ✓ |
| 14 | Agregar «Precios 2026» › Temporadas | vista previa + filas | ✓ |
| 15 | «¿cuánto sale el Bosque en temporada baja?» | responde $ 110.000 desde la planilla | ✓ |
| 16 | `setRows` (99.000) + copia vencida | responde $ 99.000 (refresco automático) | ✓ |
| 17 | `revokeSheet` + copia vencida | responde con la última copia; `last_error=no_access` | ✓ |
| 18 | Planilla de 602 filas | `search_sheet` encuentra la fila 602 | ✓ |
| 19 | `revokeAll` + «Actualizar ahora» | `reconnect_required`; comprobante → fallido; agente usa la copia | ✓ |
| 20 | Reconectar | `connected`, conserva destino y planillas | ✓ |
| 21 | Miembro | API 403 en GET/POST; la página redirige a /inbox | ✓ |
| 22 | Desconectar | planillas borradas, 0 valores cifrados, refresh revocado; nuevos comprobantes sin nota | ✓ |
| 23 | Logs | ningún dato bancario ni token | ✓ |

Hallazgo corregido durante la corrida: con `USER_ENTERED`, «000123456789»
perdía los ceros, un CBU de 22 dígitos iba a notación científica y el
teléfono «+549…» perdía el «+» → ahora esos valores se escriben como texto.
