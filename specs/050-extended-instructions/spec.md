# 050 — Instrucciones extendidas del agente (15.000 → 30.000)

**Pedido del dueño (9-nov-2026)**: que cada empresa pueda subir el tope de las
instrucciones de su agente de 15.000 a 30.000 caracteres, de forma opcional.

## Decisiones

- **Qué sube**: solo el campo «Instrucciones» del perfil. Reglas de escalado
  (6.000), tono, saludo y el Conocimiento quedan igual.
- **Quién lo decide**: el propietario de cada empresa, con un switch debajo del
  campo en `/agent`. Apagado por defecto: ninguna empresa cambia sola.
- **Por qué es opcional y no un tope más alto para todos**: las instrucciones
  viajan completas en CADA respuesta del agente. El doble de texto es más gasto
  de tokens por mensaje y reglas que el modelo sigue peor; lo elige quien lo paga.
- **Apagar no recorta**: con más de 15.000 caracteres guardados la opción no se
  puede desactivar; primero hay que acortar el texto.

## Requisitos

- **FR-001** `agent_profile.extended_instructions` (boolean, default `false`,
  migración 0037). El tope vigente sale siempre de `instructionsLimit()`.
- **FR-002** Un único punto del servidor aplica el tope: `updateProfile`. Por ahí
  pasan la página Agente, el Entrenador, Claude por MCP y el «Deshacer».
- **FR-003** Con la opción apagada, guardar más de 15.000 se rechaza y el motivo
  dice cómo subir el tope. Con la opción prendida el tope es 30.000.
- **FR-004** Prender la opción y guardar el texto largo en el mismo pedido entra.
- **FR-005** Apagar con más de 15.000 guardados se rechaza con el largo actual.
  Acortar y apagar en el mismo pedido entra.
- **FR-006** Un cambio que no toca las instrucciones ni la opción (prender el
  agente, la espera, etc.) nunca falla por el largo de lo ya guardado.
- **FR-007** Solo el propietario cambia la opción (`PUT /api/agent/profile` ya es
  `withOwner`).
- **FR-008** Claude por MCP ve el tope de ESA empresa en `get_agent_knowledge`
  (`limits.instructions`). No puede cambiar la opción: cuando un cambio no entra,
  el rechazo le dice que la activa el propietario en la página Agente.
- **FR-009** Deshacer un cambio que restauraría un texto más largo que el tope
  vigente se rechaza con el motivo (409 `over_limit`), no con un error interno.
- **FR-010** En `/agent`, prender la opción no borra lo que la persona escribió y
  todavía no guardó (el caso típico: pegó el texto largo y recién después la
  prende).
- **FR-011** Se cuentan caracteres visibles, como desde 92e750a (un emoji = 1).

## Fuera de alcance

- Subir otros topes (reglas de escalado, entradas del Conocimiento).
- Que el super admin habilite o bloquee la opción por empresa.
- `scripts/seed/agent-config.ts`: sigue con sus topes propios (8.000).
