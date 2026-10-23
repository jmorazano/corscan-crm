# Quickstart — 040 Conversar con el CRM desde Claude

## 1. Local con mocks (self-test)

Mismo entorno de pruebas que el resto (`specs/001-vocero-core/quickstart.md`,
`WA_MOCK_ENABLED=true`). No hay variables nuevas: el emisor es
`APP_BASE_URL`.

```bash
node_modules/.bin/drizzle-kit migrate
```

```bash
node tests/e2e/fixtures/seed-metrics.mjs
```

1. Entrar como `e2e@vocero.test` (propietario de la empresa principal) →
   Ajustes → Asistentes → encender «Permitir asistentes externos».
2. Correr el cliente de prueba, que imprime la URL de autorización y
   espera el código en un puerto loopback:

```bash
node tests/e2e/fixtures/mcp-client.mjs --base http://localhost:3000 --tools all
```

3. Abrir esa URL en el Browser pane → (login si hace falta) →
   consentimiento → tildar la empresa → «Permitir».
4. El cliente canjea el código, hace `initialize`, `tools/list` y llama
   cada herramienta; compara contra los números del seed y sale con código
   0 si todo coincide. `--scenario unhappy` corre los caminos infelices
   (switch apagado, empresa no autorizada, miembro, retorno no permitido,
   código y refresh reusados, límite de 60/min).

Guion completo: `tests/e2e/040-crm-mcp-server.md`.

## 2. Claude Code contra local

Claude Code acepta servidores HTTP locales:

```bash
claude mcp add --transport http vocero-local http://localhost:3000/api/mcp
```

En una sesión de Claude Code: `/mcp` → `vocero-local` → Authenticate →
navegador → consentimiento. Preguntas de prueba: «¿a qué empresas tenés
acceso?», «¿cuántos mensajes llegaron en los últimos 30 días?».

## 3. Pasos para el cliente (lo que muestra Ajustes → Asistentes)

**Claude Desktop o claude.ai**: Configuración → Conectores → «Agregar
conector personalizado» → Nombre «Vocero CRM», URL
`https://<tu-crm>/api/mcp` → Agregar → «Conectar» → iniciar sesión en el
CRM → elegir las empresas → «Permitir». Después, en un chat nuevo, activar
el conector desde el menú de herramientas.

**Claude Code**:

```bash
claude mcp add --transport http vocero https://<tu-crm>/api/mcp
```

Guía para el cliente: `docs/integraciones/claude-mcp.md`.

## 4. Prueba real antes de entregarlo (producción)

1. Deploy (migración 0029 se aplica al arrancar).
2. En la empresa principal del operador (NO en Altos): encender el switch.
3. Conectar Claude Desktop con la cuenta del operador; hacer las diez
   preguntas de SC-006 y contrastar con Métricas y Campañas.
4. Verificar la renovación: dejar pasar > 1 h y volver a preguntar (no
   debe pedir reconectar). Si pide reconectar por reuso del refresh,
   aplicar la gracia de research D5.
5. Revocar desde Ajustes y comprobar que Claude pide reconectar.
6. Recién ahí: el cliente enciende el switch en Altos de Calamuchita y Altos
   de la Ciudad y conecta.
