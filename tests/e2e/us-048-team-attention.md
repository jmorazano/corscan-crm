# E2E 048 — Quién atiende

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock,
ai-mock y push-mock), BD local `vocero` con la migración 0035,
`AGENT_COALESCE_MS=2000`. Conducido por dos scripts Node (`fetch` +
`postgres`), desde la raíz del repo con el dev server arriba:

```bash
node tests/e2e/fixtures/attention-live.mjs
```

```bash
node tests/e2e/fixtures/seed-attention.mjs && node tests/e2e/fixtures/attention-metrics.mjs && node tests/e2e/fixtures/seed-attention.mjs --cleanup
```

Los `timestamp` de la BD son UTC sin zona: los scripts los leen como texto y
les agregan la `Z` (postgres-js los tomaría como hora local). El push-mock
registra la query del endpoint (`?who=owner|socio`) para saber a qué
dispositivo llegó cada entrega. El reloj del barrido se adelanta con
`POST /api/dev/attention {"now": "<ISO>"}`.

## En vivo — `attention-live.mjs` (org «Negocio de Super Admin Local»)

Propietario `e2e@vocero.test` y `socio@vocero.test` sumado como miembro
durante la prueba (se quita al terminar, igual que las suscripciones y la
configuración del aviso).

1. **Configuración**: el GET por defecto dice apagado, 15 min y
   `ownerHasPush=false`. Con 4 minutos → 422. El miembro → 403. Con una
   suscripción del dueño (`handoff`) y otra del miembro (`all`), encendido en
   15 → `ownerHasPush=true`.
2. **Derivación sin respuesta**: «quiero hablar con un humano» → espera
   `open`, `handoff`.
   - El barrido a +14 min no avisa; a +15 min reserva `alerted_at` y llega
     UNA entrega al dueño y ninguna al miembro.
   - Otro mensaje del cliente no abre otra espera.
   - Dos barridos en paralelo a +20 min dan `alerted: 0` y no cambian
     `alerted_at`.
3. **Respondida**: el miembro responde desde el CRM → la espera queda
   `answered`, por «Socio Demo», `crm`, con su demora. Sin aviso a +15 min.
   El DTO del mensaje trae `sentByName = "Socio Demo"`.
4. **IA apagada**: tras apagar la IA, un mensaje del cliente abre una espera
   `ai_off` con `start_message_id`.
5. **Aviso apagado**: a +30 min la espera sigue abierta, sin `alerted_at` y
   sin entregas.
6. **Push 410**: después de la derivación (el push de 013 sale primero), el
   dispositivo del dueño pasa a un endpoint `?status=410`. El barrido a
   +6 min (aviso en 5) reserva y entrega, la suscripción queda podada y el
   barrido siguiente no reintenta.
7. **El agente retoma**: con la IA prendida otra vez y un mensaje nuevo
   (`[e2e_etapa:…]`, para que la respuesta no sea igual a la anterior), la
   espera `ai_off` se cierra como `agent`.
8. **Última vez en el CRM**: abrir `/api/events` como el miembro llena
   `member.last_seen_at`.
9. **Métricas en vivo**: «Socio Demo» aparece con ≥1 espera respondida,
   «última vez», 1 dispositivo «todos los mensajes», y la espera del caso 2
   figura en «Esperando ahora».

## Cifras conocidas — `seed-attention.mjs` + `attention-metrics.mjs`

Empresa aislada «Atención E2E» con estas esperas:

- Lucía: 2, 5 y 30 min;
- Pedro: 10 min;
- una retomada por el agente, una vencida y una abierta;
- un mensaje fallido de Pedro;
- un mensaje de Bruno, cuya cuenta se eliminó después.

En **Día, Semana y Año**:

- **Resumen**: 7 / a tiempo 3 / tarde 1 / agente 1 / sin respuesta 1 /
  abiertas 1, mediana 7,5 min.
- **Esperando ahora** = Cliente G. **Para revisar** = C (tarde) y F (sin
  respuesta).
- **Lucía**: 3 esperas (1 tarde), mediana 5 min, 4 mensajes en 4
  conversaciones, 1 dispositivo «solo derivaciones».
- **Pedro**: 1 espera de 10 min, 1 mensaje (el fallido no cuenta), sin
  avisos.
- **Bruno**: «ya no está», 1 mensaje, `userId = null`, al final de la lista.

Acceso del miembro (`socio@vocero.test`):

- `/api/metrics/team` → 403; `/api/settings/attention` → 403; `/metrics` →
  redirige a `/inbox`.
- `/api/me/attention` devuelve solo su fila e ignora un `userId` ajeno en la
  query.

## UI (browser pane)

- Métricas → Equipo: tarjetas del resumen, «Esperando ahora», «Para
  revisar» con enlaces y una tarjeta por persona. Pedro aparece con «Sin
  avisos en ningún dispositivo» en ámbar.
- El hilo muestra «Socio Demo · 17:37» en el mensaje del miembro.
- Ajustes → Equipo: tarjeta «Aviso cuando un cliente espera» con
  interruptor, minutos, «Guardado» y la advertencia sin notificaciones.
- Ajustes → Mi atención (miembro, 375 px): solo su tarjeta y «Última vez en
  el CRM: hace instantes».

## Resultado (2-nov-2026)

- `attention-live.mjs`: TODO VERDE.
- `attention-metrics.mjs`: TODO VERDE (39 chequeos).
- Gate: `tsc`, `eslint`, `next build` y `vitest` (190 archivos, 2159 tests)
  en verde.
