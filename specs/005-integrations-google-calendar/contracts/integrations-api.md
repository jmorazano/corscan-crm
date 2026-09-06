# Contrato — API de Integraciones (005)

Todas las rutas van con `withAuth` (sesión + organización). Errores en el
formato estándar `{ error: { code, message } }`. Mutaciones solo `owner`
(403 `forbidden` para `member`). Los tokens de Google JAMÁS se devuelven.

## `GET /api/integrations`

```json
{
  "integrations": [
    {
      "key": "google_calendar",
      "name": "Google Calendar",
      "available": true,            // instancia con GOOGLE_CLIENT_ID/SECRET
      "connected": true,
      "status": "connected",        // | "reconnect_required" | null
      "accountEmail": "agenda@negocio.com"
    }
  ]
}
```

## `GET /api/integrations/google-calendar`

```json
{
  "available": true,
  "integration": {
    "accountEmail": "...", "calendarId": "primary", "calendarName": "...",
    "timezone": "America/Argentina/Buenos_Aires", "status": "connected",
    "agentBookingEnabled": true, "slotMinutes": 30, "bufferMinutes": 0,
    "minLeadHours": 2, "horizonDays": 14,
    "weeklyHours": { "1": [["09:00","18:00"]], "2": [] },
    "bookingInstructions": "...", "connectedAt": "ISO"
  } | null,
  "canManage": true                  // role === owner
}
```

## `GET /api/integrations/google-calendar/connect`

`owner` → 302 a la URL de autorización de Google con `state` firmado.
`member` → 403. Instancia sin credenciales → 409 `not_available`.

## `GET /api/integrations/google-calendar/callback?code&state[&error]`

Siempre redirige (302) a `/integrations/google-calendar`:

- OK → `?connected=1` (upsert de la integración; reconexión reemplaza
  tokens y vuelve a `connected`; conserva reglas previas).
- `error=access_denied` → `?error=cancelled`.
- state inválido/expirado/de otra sesión → `?error=state`.
- canje fallido → `?error=exchange`.

## `PUT /api/integrations/google-calendar`

Body (todos opcionales; Zod según data-model):

```json
{ "calendarId": "abc@group.calendar.google.com", "timezone": "...",
  "agentBookingEnabled": true, "slotMinutes": 30, "bufferMinutes": 10,
  "minLeadHours": 2, "horizonDays": 14,
  "weeklyHours": { "1": [["09:00","13:00"],["15:00","18:00"]] },
  "bookingInstructions": "Pedí nombre completo y motivo." }
```

200 `{ ok: true }` · 404 `not_connected` · 422 `invalid_body` (motivo).
`calendarId` se resuelve contra la lista real para guardar `calendarName`.

## `DELETE /api/integrations/google-calendar`

Revoca (best-effort) y borra la fila. 200 idempotente.

## `GET /api/integrations/google-calendar/calendars`

Lista real de la cuenta: `{ calendars: [{ id, summary, primary }] }`.
`reconnect_required`/fallo → 502 `provider_error` (mensaje sin secretos).

## `GET /api/integrations/google-calendar/availability?from=YYYY-MM-DD&days=7`

```json
{ "timezone": "...", "slots": [
  { "start": "2026-09-07T12:00:00.000Z", "end": "...", "label": "lun 7 sep 09:00" }
] , "source": "google" | "rules_only" }
```

`days` 1..horizon. Fallo de proveedor → 502 `provider_error` (y si es
`invalid_grant`, la fila pasa a `reconnect_required`).

## `GET /api/integrations/google-calendar/appointments`

`{ appointments: [{ id, contactId, contactName, contactPhone, startsAt,
endsAt, status, createdBy, note, conversationId }] }` — próximos 60 días +
cancelados recientes, orden por inicio.

## `POST /api/integrations/google-calendar/appointments/[id]/cancel`

`owner` o `member`. Borra el evento (best-effort) y marca `cancelled`
(guard WHERE confirmed). 200 `{ ok: true }` · 404.

## Acciones del agente (extensión del contrato ai.md)

- `{"action":"check_availability","date":"YYYY-MM-DD"}` — `date` opcional
  (sin fecha: próximos 3 días con huecos). Resultado de herramienta:
  mensaje `system` `[HERRAMIENTA] DISPONIBILIDAD …` con hasta 12 huecos
  `YYYY-MM-DDTHH:MM (etiqueta)`.
- `{"action":"book_appointment","start":"YYYY-MM-DDTHH:MM","note":"...","reply":"..."}`
  — `start` en hora local del negocio. Validación server-side; ocupado →
  `[HERRAMIENTA] OCUPADO … alternativas`; proveedor caído → handoff.
