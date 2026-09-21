# Quickstart — 015 Entrenador del agente

Entorno local con mocks (`.env`: `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock,
`AGENT_COALESCE_MS=2000`). Usuario E2E: `e2e@vocero.test`.

1. Migrar: `pnpm db:migrate` (o arrancar la app).
2. Ajustes → Inteligencia artificial: guardar un token (cualquiera con el
   ai-mock; `mock-invalid` simula proveedor caído). Opcional: modelo de
   transcripción.
3. Bandeja: arriba aparece «Entrená a {agente}». Abrirla.
4. Escribir «cuando pregunten por precio de mensura decí que arranca en
   150 mil» → el agente confirma; Agente → Knowledge base tiene la P/R con
   el chip «desde el chat».
5. Panel derecho (icono de detalles / `?d=1` en móvil): «Cambios recientes»
   → «Deshacer» → la entrada desaparece y el hilo muestra «Deshice: …».
6. Cliente: `POST /api/dev/wa-mock/inbound` con «¿precio de mensura?» → la
   respuesta del agente de clientes usa el conocimiento nuevo.
7. Nota de voz: en el composer del entrenador, micrófono (o adjuntar
   `tests/e2e/fixtures/nota-de-voz.wav`) → burbuja con reproductor,
   «Transcribiendo…», transcripción y respuesta.

Comprobaciones rápidas:

```bash
curl -s -b "$COOKIE" http://localhost:3000/api/trainer/changes | jq .
curl -s -b "$COOKIE" -X POST http://localhost:3000/api/trainer/changes/chg_…/revert
```
