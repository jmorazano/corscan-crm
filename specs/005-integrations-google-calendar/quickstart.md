# Quickstart E2E — 005 Integraciones + Google Calendar

Mismo entorno local de 003/004 (Docker Postgres, `.env` dev con mocks,
`SUPER_ADMIN_EMAILS=superadmin@vocero.test`, org A = 111111111 con agente
"Ari" encendido y token de IA cargado). Gotcha vigente: JAMÁS `pnpm build`
con el dev server vivo.

## Extra de esta feature

- Migración `drizzle/0006_*` (tablas `calendar_integration`, `appointment`):
  `pnpm db:migrate`.
- `.env` dev (bloque "Integraciones (005)"):

  ```bash
  GOOGLE_CLIENT_ID=mock-google-client
  GOOGLE_CLIENT_SECRET=mock-google-secret
  GOOGLE_AUTH_URL=http://localhost:3000/api/dev/google-mock/auth
  GOOGLE_TOKEN_URL=http://localhost:3000/api/dev/google-mock/token
  GOOGLE_API_BASE_URL=http://localhost:3000/api/dev/google-mock
  ```

- Sin deps nuevas.

## Recetas google-mock (tras dev-guard)

- Estado: `GET /api/dev/google-mock/state` → eventos creados, ocupados
  externos, tokens revocados, banderas. `DELETE` = reset total (⚠️ borra
  también los tokens emitidos: la integración conectada pasa a fallar →
  reconectar).
- Ocupado externo: `POST /api/dev/google-mock/state`
  `{ "busy": { "start": "2026-09-07T13:00:00.000Z", "end": "…" } }`
  (UTC; Buenos Aires = UTC-3).
- Cancelar en Google (camino infeliz de OAuth):
  `{ "nextAuthError": "access_denied" }` → el próximo Conectar vuelve con
  `?error=cancelled`.
- Proveedor caído: `{ "failNextApi": true }` → la próxima llamada a la API
  de Calendar responde 500 (una sola vez).
- Credencial revocada (→ "Requiere reconexión"): `{ "revokeAll": true }`.
- La cuenta simulada es `agenda@negocio.test`; calendarios: "Agenda del
  negocio" (principal) y "Turnos".

## Recetas ai-mock (agenda)

Con la sección "AGENDA DE TURNOS" en el prompt:

- "quiero un turno para el 2026-09-08" → `check_availability` con esa fecha
  (sin fecha en el mensaje, usa la última fecha dicha en la conversación;
  sin ninguna, próximos días) → reply con 3 huecos.
- "Dale, el de las 11" → `check_availability` + `book_appointment` del
  hueco de las 11:00 (si no está en la lista, lo reserva igual para
  ejercitar el rechazo server-side → reply con alternativas).
- Agenda no disponible / sin huecos → handoff con despedida.
- Ojo: "disponibles" (producto) NO dispara la agenda; "turno", "cita",
  "horario(s)", "disponibilidad", "agendar", "reservar" sí.

## Guiones (tests/e2e/)

- `us-gc-1-conectar.md`: sidenav → Integraciones → tarjeta → Conectar →
  Conectada (cuenta, calendario) → fila cifrada → cancelar en Google →
  desconectar → reconectar tras revocación.
- `us-gc-2-reglas.md`: reglas inválidas (422 con motivo), válidas, vista
  previa con ocupado externo descontado, calendario inexistente 422.
- `us-gc-3-agente-turnos.md`: pedido → huecos reales → elección → evento +
  confirmación + turno + nota; hueco ocupado entre oferta y elección →
  alternativas sin duplicar; proveedor caído → deriva sin colgarse;
  revocado → deriva + "Requiere reconexión"; cancelar turno; Laboratorio
  verde sin eventos.
