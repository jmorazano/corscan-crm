# 044 — El pipeline se ordena solo (etapas del lead + ventana a la vista)

**Pedido**: el dueño, 28-oct-2026, mirando Altos de Calamuchita: 854 leads en
«Nuevo», 186 en «Interesado», 0 en «En conversación», 1 en «Cliente» y 2 en
«Perdido».

## Diagnóstico (producción, 28-oct-2026)

- 846 de los 854 leads de «Nuevo» ya habían conversado con el agente; 537
  consultaron disponibilidad y ~20 hablan de seña, transferencia o
  comprobante.
- Las 3 tarjetas de «Cliente»/«Perdido» las movió el agente (mismo segundo
  que su respuesta, sin mensajes del equipo): sabe distinguir, pero casi
  nunca lo hace.
- Causas: (1) UNA acción por turno — `move_stage` compite con responder o
  consultar y casi siempre pierde; (2) el agente no sabe en qué etapa está el
  lead ni qué significa cada una; (3) la única regla es «intención clara de
  compra → interesados»; (4) nada mueve el lead fuera de la primera etapa
  salvo la baja.

## Decisión del dueño

Las etapas son el EMBUDO de venta y solo avanzan (salvo Perdido). La
ventana de 24 h NO es una etapa (una tarjeta saltaría de columna cada hora y
un interesado retrocedería al escribir): es una MARCA en cada tarjeta más un
filtro «Ventana abierta» en el tablero.

| Etapa (siembra) | Significado |
|---|---|
| Nuevo | escribió y todavía no hubo charla |
| En conversación | respondió y está consultando, sin intención clara |
| Interesado | pidió fechas, precios o disponibilidad concreta |
| Cliente (won) | compró, reservó o pagó — confirmado |
| Perdido (lost) | dijo que no, que no le interesa o se dio de baja |

## Requisitos

- **FR-001** La etapa viaja CON la acción: `stage` opcional en `reply`,
  `update_lead`, `move_stage` y todas las consultas (como `lead_note`).
- **FR-002** El prompt dice la etapa ACTUAL del lead y qué significa cada
  etapa (por rol; las etapas propias de la empresa van por nombre).
- **FR-003** Reglas de movimiento automático (agente o sistema), PURAS:
  solo hacia adelante entre etapas abiertas; Perdido solo desde una
  abierta; Cliente desde abierta o perdida; de Cliente nunca se sale solo;
  de Perdido se vuelve a una abierta solo si el contacto no está dado de
  baja. Las personas del equipo siguen moviendo libremente.
- **FR-004** Movimientos fijos, sin modelo:
  - el cliente escribe después de un mensaje del negocio → de la primera
    etapa a «en conversación» (también al crear el lead si ya hubo un
    saliente, p. ej. respondió una campaña);
  - el agente consulta disponibilidad con fechas (conector o agenda) →
    «interesados»;
  - el agente registra una escritura en el sistema del cliente (032) o se
    anota un comprobante en la planilla (034) → Cliente.
- **FR-005** Las etapas se reconocen por rol: primera abierta, abierta cuyo
  nombre habla de conversación, abierta de interesados, `won`, `lost`. Sin
  la etapa del rol, la regla no hace nada.
- **FR-006** Escritura compare-and-set (`WHERE stage_id = actual`): un
  arrastre del equipo en el mismo instante gana.
- **FR-007** Tablero: cada tarjeta con ventana abierta muestra un punto
  verde y cuánto le queda; filtro «Ventana abierta» con conteo, en la URL.
- **FR-008** El Laboratorio (`is_test`) nunca mueve leads.
- **FR-009** Reclasificación de los leads existentes: script con informe
  primero (dry-run por defecto) y aplicación solo con el OK del dueño.

Sin migración.
