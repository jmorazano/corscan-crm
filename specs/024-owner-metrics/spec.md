# Feature Specification: Métricas para el propietario

**Feature Branch**: `024-owner-metrics`

**Created**: 2026-09-26

**Status**: Draft

**Input**: Pedido del dueño (26-sep-2026): «una sección de métricas visible
solo para propietarios en donde mostremos por ahora:

1. Card Cantidad de mensajes recibidos (ig + waba)
2. Card Cantidad de mensajes enviados por el agente
3. Card de Tiempo de respuesta promedio del agente
4. Histograma full width diario/semanal/anual de cantidad de mensajes
   recibidos stacked indicando de donde vino, ig/waba»

Se apoya en 022 (propietario vs. miembro, tres capas) y 023 (Instagram como
segundo canal: `conversation.kind`). Sin migración, sin dependencias nuevas
(el histograma es SVG propio) y sin cambios de constitución.

## Decisiones tomadas (defaults sensatos, revisables)

- **Un solo selector de período arriba de todo** (Diario · Semanal ·
  Anual). Recorta las tres tarjetas y el histograma, así los números
  siempre coinciden:
  - **Diario** = últimos 30 días, una barra por día.
  - **Semanal** = últimas 12 semanas (lunes a domingo), una barra por semana.
  - **Anual** = últimos 12 meses, una barra por mes.
  La barra más reciente es el período EN CURSO (hoy, esta semana, este
  mes) y se marca así en el tooltip.
- **Cada tarjeta compara contra el período anterior del mismo largo**
  (p. ej. los 30 días previos). Sin datos previos, no hay comparación.
- **Zona horaria**: la del navegador del propietario (validada; si no es
  válida, `America/Argentina/Buenos_Aires`). Los días y semanas se cortan
  en hora local, no en UTC.
- **Qué es un mensaje recibido**: entrante (`direction='in'`) de una
  conversación REAL de WhatsApp o Instagram. No cuentan: el Laboratorio ni
  el Entrenador (`is_test`), el historial importado del celular o de
  Instagram (`source='history'`, es una copia parcial del pasado) ni las
  reacciones con emoji de Instagram (`type='reaction'`, no son mensajes).
- **Qué es un mensaje enviado por el agente**: saliente con
  `ai_generated=true` en una conversación real, que no falló
  (`status <> 'failed'`: si Meta lo rechazó, el cliente no lo recibió).
  La tarjeta suma qué parte representa de todo lo que envió la empresa
  (agente + equipo + campañas + celular, sin historial ni fallidos).
- **Tiempo de respuesta del agente** = desde el PRIMER mensaje del cliente
  que quedó esperando respuesta hasta la respuesta del agente (cómo lo vive
  el cliente). Si a ese grupo de mensajes lo respondió una persona o una
  campaña, no entra en el cálculo. Incluye a propósito la espera
  configurada antes de responder (022) y el procesamiento de audios e
  imágenes (020): es lo que tarda de verdad. **El número principal es la
  MEDIANA** (decisión del dueño, 26-sep-2026, tras ver datos reales:
  promedio 2 min 21 s contra mediana 3 s — un mensaje que quedó esperando
  con el agente apagado dispara el promedio). Debajo va el promedio y la
  cantidad de respuestas; la comparación con el período anterior es
  mediana contra mediana.
- **Solo propietario, tres capas** (como 022): el enlace «Métricas» no
  aparece para un miembro, `requireOwnerPage()` en la página y
  `withOwner` (403 `forbidden`) en `GET /api/metrics`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El propietario ve cómo viene el negocio (Priority: P1)

Como propietario abro «Métricas» y veo cuántos mensajes entraron (y por qué
canal), cuántos respondió el agente y cuánto tarda en responder, con la
comparación contra el período anterior.

**Acceptance Scenarios**:

1. **Given** una empresa con mensajes de WhatsApp e Instagram, **When** el
   propietario abre `/metrics`, **Then** ve tres tarjetas (recibidos con el
   desglose por canal, enviados por el agente con su porcentaje, tiempo de
   respuesta —mediana— con el promedio debajo) y el histograma apilado del
   período.
2. **Given** la vista Diario, **When** elige Semanal o Anual, **Then** las
   tarjetas y el histograma se recalculan para ese período sin saltos de
   diseño (el gráfico anterior queda atenuado mientras carga).
3. **Given** el histograma, **When** pasa el puntero (o el foco de teclado)
   sobre una barra, **Then** un tooltip muestra la fecha, WhatsApp,
   Instagram y el total.
4. **Given** mensajes del Laboratorio, del Entrenador, del historial
   importado o reacciones de Instagram, **Then** no suman en ninguna
   tarjeta ni barra.
5. **Given** una empresa sin mensajes, **Then** las tarjetas muestran 0 / «—»
   y el histograma un estado vacío explicado, sin errores.

### User Story 2 - Un miembro no ve las métricas (Priority: P1)

1. **Given** sesión de un `member`, **Then** no ve «Métricas» en el menú
   (escritorio ni hoja «Más» del móvil).
2. **When** pega `/metrics`, **Then** lo redirige a la Bandeja.
3. **When** llama `GET /api/metrics`, **Then** recibe 403 `forbidden`.

### Edge Cases

- Zona horaria inválida o ausente en el pedido → la de Buenos Aires.
- Período anterior en 0 → la tarjeta no muestra porcentaje de cambio.
- Ninguna respuesta del agente en el período → «—» y sin mediana.
- Una respuesta de una persona entre medio corta el grupo: la siguiente
  respuesta del agente mide desde el siguiente mensaje del cliente.
- Un saliente fallido no cuenta como respuesta.

## Requirements *(mandatory)*

- **FR-001**: Sección «Métricas» (`/metrics`) solo para el propietario, en
  el sidebar de escritorio y en la hoja «Más» del móvil.
- **FR-002**: `GET /api/metrics?range=day|week|year&tz=<IANA>` devuelve
  tarjetas + serie en una sola respuesta; 400 `invalid_range` si el rango
  no existe; 403 para miembros; toda consulta con `scoped()` por empresa.
- **FR-003**: Tarjeta de recibidos con total, desglose WhatsApp/Instagram y
  cambio vs. período anterior.
- **FR-004**: Tarjeta de enviados por el agente con total, porcentaje sobre
  todo lo enviado y cambio vs. período anterior.
- **FR-005**: Tarjeta de tiempo de respuesta con la mediana como número
  principal, promedio y cantidad de respuestas debajo, y cambio de la
  mediana (bajar es bueno).
- **FR-006**: Histograma a todo el ancho, barras apiladas WhatsApp (base) e
  Instagram, con leyenda, tooltip por barra (puntero y teclado), eje Y con
  valores redondos y una vista de tabla con los mismos datos.
- **FR-007**: Funciona en móvil (1 columna de tarjetas, histograma legible
  a 375 px sin scroll horizontal de la página).

## Success Criteria

- **SC-001**: Con datos sembrados conocidos, las tarjetas y las barras dan
  exactamente los números esperados (test de integración + E2E).
- **SC-002**: Un miembro no puede ver ni pedir las métricas por ninguna de
  las tres capas.
