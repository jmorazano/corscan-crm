# Contrato — API interna de Ajustes → Asistentes

Todas con sesión del CRM y `withOwner` (403 `forbidden` para miembros),
sobre la empresa activa.

## `GET /api/settings/assistants`

```json
{
  "enabled": false,
  "updatedAt": "2026-10-23T15:00:00.000Z",
  "updatedBy": "Juan Manuel",
  "connectorUrl": "https://crm.example.com/api/mcp",
  "connections": [
    {
      "id": "agr_…",
      "clientLabel": "Claude (claude.ai)",
      "clientName": "Claude",
      "user": { "id": "usr_…", "name": "Martín", "email": "m…@…" },
      "otherWorkspaces": 1,
      "status": "active",
      "createdAt": "…",
      "lastUsedAt": "…",
      "revokedAt": null,
      "revokedReason": null
    }
  ]
}
```

`connections` = conexiones con fila en `assistant_grant_org` para esta
empresa (las revocadas/vencidas de los últimos 30 días también, para que
se vea qué pasó). `otherWorkspaces` es solo un número: no se revelan
nombres de otras empresas.

## `PATCH /api/settings/assistants`

`{ "enabled": true }` → `200` con el GET actualizado.

## `DELETE /api/settings/assistants/connections/[grantId]`

Revoca la conexión entera (todas sus empresas; `revoked_reason = 'owner'`
si quien revoca no es su titular, `'user'` si lo es). Solo si la conexión
incluye esta empresa; si no → `404`. Idempotente: revocada → `200`.

## `GET /api/settings/assistants/log?cursor=&limit=`

```json
{
  "entries": [
    {
      "at": "…",
      "clientLabel": "Claude (claude.ai)",
      "user": "Martín",
      "tool": "get_campaign",
      "summary": "Detalle de la campaña «Reactivación octubre»",
      "outcome": "ok",
      "reason": null
    }
  ],
  "nextCursor": null
}
```

Default 50 por página, más nuevos primero, 90 días.
