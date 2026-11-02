# Quickstart — 048 Quién atiende (self-test de punta a punta)

Entorno de pruebas de siempre (`specs/001-vocero-core/quickstart.md`):
`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` apuntando al wa-mock,
`OPENROUTER_BASE_URL` al ai-mock y el push-mock de 013. Usuarios de la org
principal: `e2e@vocero.test` (propietario) y dos miembros que siembra
`tests/e2e/fixtures/seed-attention.mjs` (Lucía y Pedro, con Lucía suscripta
al push-mock y Pedro sin suscripciones).

El guion completo vive en `tests/e2e/us-048-team-attention.md`. Los tiempos
se conducen con `POST /api/dev/attention { now }`.

## 1. Aviso (US1)

1. Como propietario: Ajustes → Equipo → «Aviso cuando un cliente espera»:
   encender, 15 min. Sin suscripción propia, la tarjeta advierte que no le
   va a llegar. Suscribir el dispositivo y la advertencia desaparece.
2. wa-mock inbound «quiero hablar con un humano» → el ai-mock deriva. Hay
   una espera `open` con `start_reason = handoff`.
3. `POST /api/dev/attention { now: inicio + 14 min }` → `alerted: 0`.
4. `POST /api/dev/attention { now: inicio + 15 min }` → `alerted: 1`. El
   push-mock recibe UNA notificación «… espera hace 15 min», con
   `url=/inbox?c=…`, solo en la suscripción del propietario (la de Lucía, no).
5. Otro inbound del cliente y otro barrido a +20 min → sin aviso nuevo.
6. Camino feliz: repetir con otra conversación y que Lucía responda desde el
   CRM a +8 min. El barrido a +15 no avisa. La espera queda `answered`,
   `responder = Lucía`, `response_ms ≈ 8 min`.
7. IA apagada en una conversación + inbound → la espera se abre con
   `ai_off`.
8. Aviso apagado → la espera se registra y no hay push.
9. Camino infeliz: el push-mock con `?status=410` → la suscripción se poda,
   la espera queda con `alerted_at` y no se reintenta. El barrido sigue con
   las demás.

## 2. Métricas (US2, US4)

1. Sembrar esperas conocidas con `seed-attention.mjs --waits`:
   - Lucía: 3 respondidas (2, 5 y 30 min → 1 tarde);
   - Pedro: 1 respondida (10 min);
   - 1 retomada por el agente, 1 sin respuesta, 1 abierta.
2. `/metrics` → sección «Equipo»:
   - total 7, a tiempo 3, tarde 1, agente 1, sin respuesta 1, abiertas 1;
   - medianas: Lucía 5 min, equipo 7,5 min;
   - «Esperando ahora: 1»;
   - lista de problemas con 2 filas que abren su conversación;
   - Pedro con «Sin avisos en ningún dispositivo» resaltado.
3. Cambiar a Semana y a Año: las cifras siguen cuadrando.
4. Cruzar las cifras con SQL directo sobre `attention_wait` y `message`.

## 3. Firma (US3)

1. Lucía y Pedro responden en la misma conversación: cada burbuja muestra su
   nombre y la hora. También en vivo por SSE, sin recargar.
2. Quitar a Pedro del equipo (sin otras empresas → se elimina la cuenta):
   sus mensajes siguen con «Pedro», y en Métricas aparece como «ya no está en
   el equipo».

## 4. Mi atención (US5)

1. Como Lucía: Ajustes → Mi atención muestra solo su fila.
2. `GET /api/metrics/team` como Lucía → 403. `/metrics` redirige a
   `/inbox`.

## 5. Última vez en el CRM

Abrir la app como Pedro: `member.last_seen_at` se actualiza al conectar el
SSE y la fila de Pedro en Métricas muestra «hace instantes».

## Gate técnico

```bash
node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint . && node_modules/.bin/next build && node_modules/.bin/vitest run
```

(pnpm vía corepack está roto en esta máquina: memoria `pnpm-corepack-roto`.)
