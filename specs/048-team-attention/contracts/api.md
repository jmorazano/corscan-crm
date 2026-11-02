# Contratos — 048 Quién atiende

Todas las rutas son de la empresa activa de la sesión. Errores con el formato
de siempre (`apiError`).

## `GET /api/metrics/team?range=day|week|year&tz=<IANA>` — `withOwner`

Mismos parámetros y validación que `/api/metrics` (`parseMetricsQuery`). Un
miembro recibe 403 `forbidden`.

```ts
type TeamAttention = {
  range: "day" | "week" | "year";
  timeZone: string;
  from: string; to: string;              // ISO, ventana de metricsWindow
  lateMinutes: number;                   // minutos del aviso (15 si está apagado)
  summary: {
    total: number;
    onTime: number; late: number;
    agent: number;                       // retomadas por el agente
    unanswered: number;                  // expired
    open: number;                        // del período, todavía abiertas
    medianResponseMs: number | null;     // solo answered
    phone: { answered: number; medianResponseMs: number | null }; // «Desde el celular»
    platform: { answered: number };      // «Soporte de la plataforma»
  };
  waitingNow: WaitItem[];                // abiertas ahora (cualquier período), más viejas primero, máx. 50
  problems: WaitItem[];                  // tarde o sin respuesta del período, más recientes primero, máx. 100
  people: MemberAttentionRow[];          // miembros + quien tuvo actividad en el período
  truncated: boolean;
};

type WaitItem = {
  waitId: string;
  conversationId: string;
  contactName: string;
  channel: "whatsapp" | "instagram";
  startedAt: string;
  reason: "handoff" | "ai_off";
  status: "open" | "answered" | "agent" | "expired";
  responseMs: number | null;
  responderName: string | null;
};

type MemberAttentionRow = {
  userId: string | null;                 // null si la cuenta ya no existe
  name: string;
  role: "owner" | "member" | null;       // null = ya no está en el equipo
  waitsAnswered: number;
  waitsLate: number;
  medianResponseMs: number | null;
  conversations: number;                 // con ≥1 mensaje suyo en el período
  messages: number;                      // enviados, sin fallidos
  lastMessageAt: string | null;          // de siempre, no solo del período
  lastSeenAt: string | null;
  push: { devices: number; modes: ("all" | "handoff")[] };
};
```

Orden de `people`: más esperas respondidas primero, después por nombre. Los
que no están en el equipo van al final.

## `GET /api/me/attention?range=&tz=` — `withAuth`

Devuelve SOLO la fila de la sesión. No acepta un `userId`.

```ts
type MyAttention = {
  range: "day" | "week" | "year";
  timeZone: string; from: string; to: string;
  lateMinutes: number;
  me: MemberAttentionRow;
};
```

## `GET /api/settings/attention` — `withOwner`

```ts
{ alertEnabled: boolean; alertMinutes: number; ownerHasPush: boolean }
```

## `PUT /api/settings/attention` — `withOwner`

Body (Zod): `{ alertEnabled: boolean; alertMinutes: number /* int 5–120 */ }`.
Responde lo mismo que el GET. Fuera de rango → 422 `invalid_body` (`parseBody`, convención del repo).

## `MessageDto` (cambio)

Suma `sentByName: string | null`. Va en la lista de mensajes y en los eventos
SSE `message.created` y `message.updated`.

## Notificación push «cliente esperando»

```ts
{
  title: "<contactName> espera hace <N> min",
  body: "<últimos 80 caracteres del último mensaje del cliente, o «Derivado por el agente»>",
  url: "/inbox?c=<conversationId>",
  tag: "wait-<waitId>",
}
```

Solo a las suscripciones de los propietarios de la empresa.

## Dev (404 en producción)

`POST /api/dev/attention` con body `{ now?: string }`: corre un barrido con
ese reloj y devuelve `{ reconciled, alerted }`.
