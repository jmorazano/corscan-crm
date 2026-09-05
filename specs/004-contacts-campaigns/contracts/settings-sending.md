# Contrato — Ajustes de envío (cupo por empresa)

## GET /api/settings/sending

`withAuth`. Respuesta:
```json
{ "dailyInitiatedLimit": 250, "usedLast24h": 37, "available": 213 }
```
`usedLast24h` = contactos únicos con `initiated_send` en las últimas 24h
móviles. Sin fila en `send_settings` → default 250 (sin crearla).

## PUT /api/settings/sending

Body: `{ "dailyInitiatedLimit": 1..100000 }` (Zod int). Upsert
onConflictDoUpdate sobre el unique de org. 200 con el estado nuevo.

UI: Ajustes → nueva tarjeta "Envíos y campañas" con el límite, el uso de la
ventana actual y la explicación del tier de Meta (250 sin verificar; subir
el límite real requiere verificación del negocio ante Meta — link a la doc).
Cambiarlo NO cambia el límite real del canal: es el freno del CRM.
