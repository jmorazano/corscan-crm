# E2E 011 — Agente paciente y baja visible

Entorno: dev server + mocks; `AGENT_COALESCE_MS` corto en local (2s) para
conducir la espera. Evidencia = mensajes en BD, UI de la bandeja y pipeline.

## Guion (ejecutado en verde el 9-sep-2026)

1. **Ráfaga**: dos inbounds del mismo contacto con 1s de diferencia
   («Buenas tardes» + «Tengo un campo de 40 hectáreas…»).
   ✅ UNA sola respuesta IA, posterior al último mensaje y elaborada sobre
   ese último (no un saludo genérico repetido).
2. **Baja**: el contacto responde «Baja».
   ✅ `opted_out_at` marcado · CERO respuestas IA nuevas · lead movido solo
   a la etapa **Perdido** (kind lost) de su organización.
3. **Badge**: la conversación en la bandeja muestra el chip rojo «Dado de
   baja» con tooltip explicativo (`optout-badge`).
4. **Silencio persistente**: un mensaje posterior del dado de baja no
   produce respuesta del agente.
5. **Regresión**: un contacto normal con un solo mensaje recibe su respuesta
   única de siempre.

Guardas unit-testeadas (tests/unit/agent-patience.test.ts): respuesta con
contexto viejo → se descarta y regenera; texto idéntico al último saliente →
no se envía; confirmaciones de turno reservado exentas (FR-004).
