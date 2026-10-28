# 044 — Plan

- `src/lib/lead-stages.ts` (PURO): roles por etapa (`stageRoles`), reglas
  `canAutoMove` y la sección `ETAPA DEL LEAD` del prompt.
- `src/server/inbox/lead-stage.ts`: `loadLeadStageState` + `advanceLeadStage`
  (compare-and-set sobre la etapa leída; nunca lanza).
- Agente: `stage` opcional en todas las acciones (`actions.ts`), aplicado en
  el loop de herramientas y en la acción final (`pipeline.ts`, `applyStage`);
  `move_stage` y el pedido de visita pasan por las mismas reglas; el prompt
  recibe la etapa actual. `isConcreteAvailabilityQuery` → interesados;
  escritura del conector (032) → cliente.
- Ingesta: `onLeadActivity(..., { conversationId })` → si ya hubo un saliente,
  primera etapa → conversación (también al crear el lead).
- Planilla (034): comprobante `recorded` (ingesta y reintento) → cliente.
- Tablero: `windowClosesAt` en `/api/pipeline/board`; marca por tarjeta y
  filtro `?ventana=1` en `pipeline-client.tsx`.
- `scripts/reclassify-leads.ts`: informe por defecto, `--apply` con el OK.
- Días sin respuesta: `src/server/inbox/lead-stale.ts` (ajuste, vista
  previa, barrido CAS + línea `lead_stale`, ticker 15 min en
  `instrumentation.ts`), `GET/PUT /api/pipeline/settings`, sección en
  «Gestionar etapas», `stageAfterReply` (vuelta solo desde la primera etapa
  o desde perdido por silencio), ruta dev `/api/dev/lead-stale`.
- Migración 0033 (la 0032 es de la 043).

## Tareas

- [x] Reglas puras + tests (`tests/unit/lead-stages-044.test.ts`)
- [x] Etapa con la acción + prompt + reglas fijas en el turno
- [x] Ingesta: respondió → en conversación
- [x] Cliente por escritura del conector y por comprobante anotado
- [x] Tablero: marca + filtro de ventana
- [x] Script de reclasificación (dry-run sobre Altos)
- [x] Gate + E2E (A 18/18, B 11/11, UI)
- [x] Días sin respuesta → Perdido (regla general, apagada) + vuelta si escribe
- [x] E2E C 21/21 + UI del diálogo
- [ ] Merge + deploy (con OK del dueño)
- [ ] Aplicar la reclasificación en Altos (con OK del dueño)
