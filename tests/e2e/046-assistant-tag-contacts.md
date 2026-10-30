# E2E 046 — Claude etiqueta contactos por el MCP

Herramienta `tag_contacts` del servidor MCP de los asistentes (040/041).
Constitución 1.15.0: segunda escritura acotada (solo etiquetas de contactos).

## Cómo correrlo

Con el dev server levantado (mocks como en `specs/001-vocero-core/quickstart.md`):

```bash
node tests/e2e/fixtures/tag-contacts-e2e.mjs --base http://localhost:3000
```

Siembra contactos propios en «Negocio de Super Admin Local» (uno con el tope
de 20 etiquetas y uno del Laboratorio), crea una conexión de asistente con
token de acceso (el flujo OAuth lo cubre `mcp-client.mjs connect`, sin
cambios en 046), conduce `tag_contacts` por `/api/mcp` real y al final borra
todo y restaura el switch y el rol. Re-ejecutable.

## Qué verifica

- A: `search_contacts` y `tag_contacts` con el MISMO filtro y `expected_count`;
  minúsculas; por etiqueta quién la ganó o perdió; el contacto lleno se
  informa; el del Laboratorio jamás se toca.
- B: repetir no cambia nada; deshacer con lo informado deja todo como estaba.
- C: `selection_changed` si la búsqueda cambió; filter sin `expected_count`;
  ids y filter a la vez; etiquetas con pinta de teléfono/correo/documento
  rechazadas (las fechas de 043 pasan); ids del Laboratorio o ajenos → 0.
- D: switch apagado o usuario que deja de ser propietario → denegado.
- E: la llamada 21 de la hora → `rate_limited`; todo queda en el registro.

Última corrida: 29-oct-2026, verde dos veces seguidas (24 chequeos).
