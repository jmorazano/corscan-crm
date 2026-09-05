# Contrato: Config de IA por empresa

Bajo `withAuth` (sesión con organización activa). Gestiona la config de la
PROPIA empresa; no existe acceso a la de otras.

## GET /api/settings/ai

```json
{
  "config": {
    "configured": true,
    "tokenLast4": "abcd",
    "model": "anthropic/claude-sonnet-4.5",
    "judgeModel": null
  },
  "defaults": { "model": "<default de producto>", "judgeModel": "<default>" }
}
```

`config: null` cuando no hay token (la UI muestra el aviso "agente apagado" y
la guía). El token completo JAMÁS se devuelve.

## PUT /api/settings/ai

Request: `{ "token": "sk-or-...", "model"?: string, "judgeModel"?: string }`.
Guarda cifrado (AES-256-GCM) con upsert por organización; responde
`{ ok: true, tokenLast4 }`. Solo rol `owner` de la empresa (mismo criterio
que Equipo). Token vacío → 422.

Sin validación remota contra el proveedor en el PUT (el proveedor es opcional
y puede estar caído): el primer turno del agente valida en la práctica y
degrada sin colgarse ante token inválido (FR-010 / escenario infeliz US3).

## DELETE /api/settings/ai

Borra la config → agente y Laboratorio de la empresa quedan inactivos con
aviso. Solo `owner`. Responde `{ ok: true }` (idempotente: 200 aunque no
hubiera config).

## Resolución en runtime (contrato interno)

`getAiConfig(organizationId): Promise<AiConfig | null>` con
`AiConfig = { token, model, judgeModel }` (defaults de producto aplicados).
`chatJson` recibe la config resuelta — NINGÚN camino lee
`OPENROUTER_API_TOKEN`/`OPENROUTER_MODEL`/`OPENROUTER_JUDGE_MODEL` del env.
`OPENROUTER_BASE_URL` sigue siendo de instancia (adaptador; interceptado por
ai-mock en self-test). Empresa sin config → el trigger del agente y el
Laboratorio cortan ANTES de llamar al proveedor, con estado observable en
Ajustes (FR-010).
