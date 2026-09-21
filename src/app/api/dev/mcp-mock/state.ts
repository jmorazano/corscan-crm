/**
 * Estado en memoria del mcp-mock (016): knobs de fallo + BITÁCORA de llamadas.
 * Vive en `globalThis` porque Next recarga módulos en caliente (mismo patrón que
 * `src/server/dev/wa-mock-state.ts`), con migración suave campo por campo.
 *
 * La bitácora no es un lujo de depuración: es lo que hace VERIFICABLE el
 * guardrail del sandbox (SC-003 / corrección #25). Sin un log consultable,
 * «el agente no tocó el MCP durante el Laboratorio» no se puede afirmar, solo
 * suponer. El guion E2E limpia el log, corre el Laboratorio completo y exige
 * `calls: []`.
 *
 * Nota: este módulo vive junto a las rutas del mock (y no en `src/server/dev/`)
 * porque el reparto de archivos de 016 asignó a este agente exactamente
 * `src/app/api/dev/mcp-mock/**`. Se importa como
 * `@/app/api/dev/mcp-mock/state`.
 */

/** Formas de romper la respuesta a propósito. */
export type McpMockMalformed =
  | "not-json" // content[0].text no es JSON
  | "no-content" // result.content vacío
  | "rpc-error" // sobre JSON-RPC con `error` en vez de `result`
  | "truncated" // el JSON del texto viene cortado a la mitad
  | "bad-json-body"; // el CUERPO HTTP entero no parsea

export const MCP_MOCK_MALFORMED: readonly McpMockMalformed[] = [
  "not-json",
  "no-content",
  "rpc-error",
  "truncated",
  "bad-json-body",
];

export type McpMockKnobs = {
  /** Un disparo: el próximo `tools/call` → isError + `unauthorized`. */
  nextUnauthorized: boolean;
  /** Un disparo: HTTP 500 (caída de transporte, ≠ isError de aplicación). */
  failNextCall: boolean;
  /** Un disparo: HTTP 307 con Location (corrección #56: el transporte no sigue 3xx). */
  redirectNext: boolean;
  /** Un disparo: devuelve ESE código estable de error de aplicación. */
  forceError: string | null;
  /** Un disparo: rompe la respuesta de la forma indicada. */
  malformedNext: McpMockMalformed | null;
  /** Persistente: espera antes de responder (ejercita timeout/abort). */
  delayMs: number;
  /** Persistente: `check-availability` devuelve `properties: []`. */
  emptyResults: boolean;
  /** Persistente: relleno de ~2 MB (ejercita el tope de bytes → `too_large`). */
  hugeResponse: boolean;
  /** Persistente: marcadores de prompt y enlaces fuera de dominio en el texto. */
  evilText: boolean;
};

export type McpMockAuthScheme = "bearer" | "api_key" | "meta";

/** Una entrada de la bitácora. `arguments` va tal cual llegó. */
export type McpMockCall = {
  at: string;
  method: string;
  tool: string | null;
  arguments: unknown;
  /** Cómo viajó la credencial; null = no vino ninguna. */
  auth: McpMockAuthScheme | null;
  /** Últimos 4 de la credencial — NUNCA la credencial entera, ni en un mock. */
  credentialLast4: string | null;
  conversationId: string | null;
  httpStatus: number;
  /** false cuando la respuesta viajó con `isError: true`. */
  ok: boolean;
  errorCode: string | null;
  /** Knob que alteró esta respuesta, si hubo alguno. */
  knob: string | null;
  bytes: number;
  durationMs: number;
};

type McpMockState = {
  knobs: McpMockKnobs;
  calls: McpMockCall[];
};

/** Tope de la bitácora: un guion largo no debe comerse la memoria del proceso. */
export const MCP_MOCK_MAX_CALLS = 200;

function knobsIniciales(): McpMockKnobs {
  return {
    nextUnauthorized: false,
    failNextCall: false,
    redirectNext: false,
    forceError: null,
    malformedNext: null,
    delayMs: 0,
    emptyResults: false,
    hugeResponse: false,
    evilText: false,
  };
}

const globalForMock = globalThis as unknown as {
  __voceroMcpMock?: McpMockState;
};

export function getMcpMockState(): McpMockState {
  if (!globalForMock.__voceroMcpMock) {
    globalForMock.__voceroMcpMock = { knobs: knobsIniciales(), calls: [] };
  }
  const estado = globalForMock.__voceroMcpMock;
  // Migración suave: dev recarga módulos y el objeto viejo sobrevive.
  if (!Array.isArray(estado.calls)) estado.calls = [];
  const base = knobsIniciales();
  estado.knobs = { ...base, ...(estado.knobs ?? {}) };
  return estado;
}

export function resetMcpMockState(): void {
  globalForMock.__voceroMcpMock = { knobs: knobsIniciales(), calls: [] };
}

export function registrarLlamada(call: McpMockCall): void {
  const estado = getMcpMockState();
  estado.calls.push(call);
  if (estado.calls.length > MCP_MOCK_MAX_CALLS) {
    estado.calls.splice(0, estado.calls.length - MCP_MOCK_MAX_CALLS);
  }
}

/** Últimos 4 de la credencial, para que el guion verifique CUÁL viajó. */
export function last4(credencial: string | null): string | null {
  if (credencial === null || credencial.length === 0) return null;
  return credencial.slice(-4);
}
