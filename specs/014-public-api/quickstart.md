# Quickstart — 014 API pública

Entorno local con mocks (`.env`: `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock,
`AGENT_COALESCE_MS=2000`). Usuario E2E: `e2e@vocero.test`.

1. Migrar: `pnpm db:migrate` (o arrancar la app).
2. Ajustes → API → «Nueva clave» → copiar `vk_…`.
3. Tener una plantilla aprobada con orígenes (Ajustes → Plantillas; en local
   aprobar con `POST /api/dev/wa-mock/template-status`).
4. Listar:

```bash
curl -s http://localhost:3000/api/v1/templates -H "Authorization: Bearer vk_…"
```

5. Enviar:

```bash
curl -s -X POST http://localhost:3000/api/v1/messages \
  -H "Authorization: Bearer vk_…" -H "Content-Type: application/json" \
  -H "Idempotency-Key: reserva_1:recordatorio" \
  -d '{"to":"+54 9 351 555 0101","name":"Ana","template":"recordatorio_checkin","params":{"2":"Cabaña Los Pinos","3":"viernes 25/10 14:00"}}'
```

6. Ver el outbox del mock: `GET /api/dev/wa-mock/outbox`; la bandeja muestra
   la conversación con «Enviado por API · <clave>».
7. Estado: `GET /api/v1/messages/<id>`; simular entrega con
   `POST /api/dev/wa-mock/status`.
8. Respuesta del huésped: `POST /api/dev/wa-mock/inbound` con «Gracias!» →
   el agente calla; con «¿A qué hora es el check-in?» → responde.

Guion completo: `tests/e2e/014-public-api.md`.
