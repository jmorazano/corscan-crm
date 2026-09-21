import { mockGuard } from "@/lib/dev-guard";
import {
  ejecutarHerramienta,
  errorForzado,
  inyectarTextoHostil,
  type McpMockError,
} from "../engine";
import {
  last4,
  registrarLlamada,
  getMcpMockState,
  type McpMockAuthScheme,
  type McpMockMalformed,
} from "../state";
import {
  MCP_MOCK_INSTRUCTIONS,
  MCP_MOCK_PROTOCOL_VERSION,
  MCP_MOCK_SERVER_INFO,
  MCP_MOCK_TOOLS,
} from "../tools";

/**
 * Servidor MCP simulado (016). La ruta se llama `assistant/` para que la URL
 * del mock —`http://localhost:3000/api/dev/mcp-mock/assistant`— sea análoga a la
 * real y solo cambie el host y el prefijo.
 *
 * FIDELIDAD OBLIGATORIA con el servidor real (hallazgos 1-5):
 *  - SIN ESTADO: `tools/list` y `tools/call` responden 200 sin `Mcp-Session-Id`
 *    y sin `notifications/initialized` previa. Un POST por llamada.
 *  - `initialize` y `tools/list` NO exigen credencial (así el guion prueba el
 *    handshake antes de cargar el token); `tools/call` sí.
 *  - DOBLE SOBRE literal: el payload viaja como STRING JSON dentro de
 *    `result.content[0].text`; un error de aplicación es HTTP **200** con
 *    `isError: true` y `{success:false,error:{code,message,…}}` dentro de ese
 *    mismo texto. Nunca alcanza con mirar el status HTTP. Si el mock no
 *    replicara esto, el parser del conector jamás se ejercitaría.
 *  - `content-type: application/json` puro (no SSE), salvo que se pida `?sse=1`.
 *
 * 404 incondicional en producción, como todos los mocks (`mockGuard`).
 */

export const dynamic = "force-dynamic";

const MAX_RELLENO_BYTES = 2_000_000;
const DEMORA_POR_DEFECTO_MS = 30_000;

// ------------------------------------------------------------- knobs --------

type FalloForzado =
  | "unauthorized"
  | "internal_error"
  | "timeout"
  | "redirect"
  | "huge"
  | "malformed";

type KnobsEfectivos = {
  fallo: FalloForzado | null;
  malformed: McpMockMalformed | null;
  forceError: string | null;
  delayMs: number;
  emptyResults: boolean;
  evilText: boolean;
  huge: boolean;
  sse: boolean;
  contentType: string | null;
  /** Nombre del knob que alteró esta respuesta, para la bitácora. */
  origen: string | null;
};

function comoFallo(valor: string | null): FalloForzado | null {
  switch (valor) {
    case "unauthorized":
    case "internal_error":
    case "timeout":
    case "redirect":
    case "huge":
    case "malformed":
      return valor;
    default:
      return null;
  }
}

function comoMalformed(valor: string | null): McpMockMalformed | null {
  switch (valor) {
    case "not-json":
    case "no-content":
    case "rpc-error":
    case "truncated":
    case "bad-json-body":
      return valor;
    default:
      return null;
  }
}

/**
 * Los knobs se piden de DOS maneras, como pide el harness: por query param o
 * header (valen solo para ESA request, sin ensuciar el estado del proceso) y
 * por `POST /api/dev/mcp-mock/state` (patrón `failNextSend` del wa-mock, con
 * los de un disparo que se auto-apagan). El pedido por request gana.
 *
 * Los de UN DISPARO se consumen SOLO en `tools/call`: si los gastara el
 * `initialize` o el `tools/list` del handshake, `nextUnauthorized` nunca
 * llegaría a la llamada que el guion quiere romper.
 */
function resolverKnobs(
  url: URL,
  req: Request,
  method: string
): KnobsEfectivos {
  const esLlamada = method === "tools/call";
  const q = url.searchParams;
  const h = req.headers;
  const pedido = (nombre: string, cabecera: string): string | null =>
    q.get(nombre) ?? h.get(cabecera);

  const estado = getMcpMockState();
  const k = estado.knobs;

  const falloPedido = comoFallo(pedido("fail", "x-mcp-mock-fail"));
  const malformedPedido = comoMalformed(
    pedido("malformed", "x-mcp-mock-malformed")
  );
  const errorPedido = pedido("error", "x-mcp-mock-error");
  const delayPedido = Number(pedido("delayMs", "x-mcp-mock-delay") ?? "");

  let fallo = falloPedido;
  let malformed = malformedPedido ?? (falloPedido === "malformed" ? "not-json" : null);
  let forceError = errorPedido;
  let origen: string | null =
    falloPedido ?? (malformedPedido !== null ? "malformed" : null) ??
    (errorPedido !== null ? `error:${errorPedido}` : null);

  // Knobs persistentes de un disparo: se consumen al usarse.
  if (esLlamada && fallo === null && k.redirectNext) {
    k.redirectNext = false;
    fallo = "redirect";
    origen = "redirectNext";
  }
  if (esLlamada && fallo === null && k.failNextCall) {
    k.failNextCall = false;
    fallo = "internal_error";
    origen = "failNextCall";
  }
  if (esLlamada && fallo === null && k.nextUnauthorized) {
    k.nextUnauthorized = false;
    fallo = "unauthorized";
    origen = "nextUnauthorized";
  }
  if (esLlamada && malformed === null && k.malformedNext !== null) {
    malformed = k.malformedNext;
    k.malformedNext = null;
    if (origen === null) origen = "malformedNext";
  }
  if (esLlamada && forceError === null && k.forceError !== null) {
    forceError = k.forceError;
    k.forceError = null;
    if (origen === null) origen = "forceError";
  }

  const huge = fallo === "huge" || q.get("huge") === "1" || k.hugeResponse;
  if (huge && origen === null) origen = "hugeResponse";
  const evilText = q.get("evil") === "1" || k.evilText;
  if (evilText && origen === null) origen = "evilText";
  const emptyResults = q.get("empty") === "1" || k.emptyResults;
  if (emptyResults && origen === null) origen = "emptyResults";

  const delayMs = Number.isFinite(delayPedido) && delayPedido > 0
    ? delayPedido
    : fallo === "timeout"
      ? DEMORA_POR_DEFECTO_MS
      : k.delayMs;

  return {
    fallo,
    malformed,
    forceError,
    delayMs,
    emptyResults,
    evilText,
    huge,
    sse: q.get("sse") === "1",
    contentType: q.get("contentType"),
    origen,
  };
}

/** Knobs apagados: para responder antes de saber qué método pidieron. */
function knobsNeutros(url: URL): KnobsEfectivos {
  return {
    fallo: null,
    malformed: null,
    forceError: null,
    delayMs: 0,
    emptyResults: false,
    evilText: false,
    huge: false,
    sse: url.searchParams.get("sse") === "1",
    contentType: url.searchParams.get("contentType"),
    origen: null,
  };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------- credencial --------

type Credencial = { scheme: McpMockAuthScheme; value: string };

/**
 * El real acepta `Authorization: Bearer`; el mock acepta además `X-Api-Key` y
 * `params._meta.api_key` para poder ejercitar los tres `authScheme` del
 * conector. Cualquier valor no vacío sirve: el mock no conoce el token real.
 */
function leerCredencial(
  req: Request,
  params: Record<string, unknown>
): Credencial | null {
  const auth = req.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return { scheme: "bearer", value: bearer };

  const apiKey = req.headers.get("x-api-key")?.trim();
  if (apiKey) return { scheme: "api_key", value: apiKey };

  const meta = leerMetaApiKey(params._meta) ?? leerMetaApiKey(params.arguments);
  if (meta) return { scheme: "meta", value: meta };

  return null;
}

function leerMetaApiKey(valor: unknown): string | null {
  if (typeof valor !== "object" || valor === null) return null;
  const obj = valor as Record<string, unknown>;
  const directo = obj.api_key;
  if (typeof directo === "string" && directo.trim() !== "") return directo.trim();
  const anidado = obj._meta;
  if (typeof anidado === "object" && anidado !== null) {
    const clave = (anidado as Record<string, unknown>).api_key;
    if (typeof clave === "string" && clave.trim() !== "") return clave.trim();
  }
  return null;
}

// ------------------------------------------------------------ sobres --------

type IdRpc = string | number | null;

function sobreExito(id: IdRpc, texto: string): Record<string, unknown> {
  // Sin `isError` en el camino feliz: el real lo omite y el spec lo define
  // como false por defecto. Así el conector ejercita ese default.
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: texto }] },
  };
}

function sobreIsError(id: IdRpc, error: McpMockError): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        { type: "text", text: JSON.stringify({ success: false, error }) },
      ],
      isError: true,
    },
  };
}

function sobreRpcError(
  id: IdRpc,
  code: number,
  message: string
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

type Emitido = { body: string; status: number; contentType: string };

function emitir(
  sobre: unknown,
  knobs: KnobsEfectivos,
  status = 200
): Emitido {
  const json = JSON.stringify(sobre);
  if (knobs.sse) {
    // El real responde application/json aunque se mande `Accept: text/
    // event-stream`, pero el transporte debe tolerar framing SSE por si cambia.
    return {
      body: `event: message\ndata: ${json}\n\n`,
      status,
      contentType: knobs.contentType ?? "text/event-stream",
    };
  }
  return {
    body: json,
    status,
    contentType: knobs.contentType ?? "application/json",
  };
}

function responder(e: Emitido, extra?: Record<string, string>): Response {
  return new Response(e.body, {
    status: e.status,
    headers: {
      "content-type": e.contentType,
      "cache-control": "no-store",
      ...(extra ?? {}),
    },
  });
}

// ------------------------------------------------------------- handler ------

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const iniciado = Date.now();
  const url = new URL(req.url);

  const crudo = await req.text();
  let sobre: Record<string, unknown>;
  try {
    const parseado: unknown = JSON.parse(crudo);
    if (typeof parseado !== "object" || parseado === null || Array.isArray(parseado)) {
      throw new Error("no es un objeto");
    }
    sobre = parseado as Record<string, unknown>;
  } catch {
    const e = emitir(sobreRpcError(null, -32700, "Parse error"), knobsNeutros(url));
    return responder(e);
  }

  const id: IdRpc =
    typeof sobre.id === "string" || typeof sobre.id === "number" ? sobre.id : null;
  const method = typeof sobre.method === "string" ? sobre.method : "";
  const params =
    typeof sobre.params === "object" && sobre.params !== null && !Array.isArray(sobre.params)
      ? (sobre.params as Record<string, unknown>)
      : {};

  const knobs = resolverKnobs(url, req, method);
  if (knobs.delayMs > 0) await dormir(knobs.delayMs);

  // Fallos de TRANSPORTE: valen para cualquier método, porque un servidor que
  // se cae o que redirige no distingue handshake de llamada.
  if (knobs.fallo === "redirect") {
    // El transporte NO debe seguir un 3xx: arrastraría el bearer (corrección #56).
    registrar({ method, tool: null, args: null, cred: null, knobs, iniciado, status: 307, ok: false, errorCode: "redirect", bytes: 0 });
    return new Response(null, {
      status: 307,
      headers: {
        location: "https://altosdecalamuchita.example/mcp/assistant",
        "cache-control": "no-store",
      },
    });
  }
  if (knobs.fallo === "internal_error") {
    // HTTP 500: caída de transporte, distinta del `isError` de aplicación.
    const cuerpo = JSON.stringify({
      error: { code: "internal_error", message: "Error interno del servidor." },
    });
    registrar({ method, tool: null, args: null, cred: null, knobs, iniciado, status: 500, ok: false, errorCode: "internal_error", bytes: cuerpo.length });
    return new Response(cuerpo, {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  // Las notificaciones no llevan id y no se contestan (spec: 202 sin cuerpo).
  if (method.startsWith("notifications/")) {
    registrar({ method, tool: null, args: null, cred: null, knobs, iniciado, status: 202, ok: true, errorCode: null, bytes: 0 });
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return manejarInitialize(req, id, knobs, iniciado);
    case "tools/list":
      return manejarToolsList(req, id, knobs, iniciado);
    case "tools/call":
      return manejarToolsCall(req, id, params, knobs, iniciado);
    case "ping": {
      const e = emitir({ jsonrpc: "2.0", id, result: {} }, knobs);
      registrar({ method, tool: null, args: null, cred: null, knobs, iniciado, status: e.status, ok: true, errorCode: null, bytes: e.body.length });
      return responder(e);
    }
    default: {
      const e = emitir(
        sobreRpcError(id, -32601, `Method not found: ${method}`),
        knobs
      );
      registrar({ method, tool: null, args: null, cred: null, knobs, iniciado, status: e.status, ok: false, errorCode: "method_not_found", bytes: e.body.length });
      return responder(e);
    }
  }
}

/** El endpoint real solo habla POST; un GET acá ayuda a detectar una URL mal puesta. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json(
    {
      error: {
        code: "method_not_allowed",
        message: "Este endpoint MCP solo acepta POST con un sobre JSON-RPC 2.0.",
      },
    },
    { status: 405 }
  );
}

function manejarInitialize(
  req: Request,
  id: IdRpc,
  knobs: KnobsEfectivos,
  iniciado: number
): Response {
  const e = emitir(
    {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_MOCK_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_MOCK_SERVER_INFO,
        instructions: MCP_MOCK_INSTRUCTIONS,
      },
    },
    knobs
  );
  registrar({ method: "initialize", tool: null, args: null, cred: null, knobs, iniciado, status: e.status, ok: true, errorCode: null, bytes: e.body.length });
  // El real devuelve `mcp-session-id`, pero NO lo exige después (hallazgo 1):
  // el mock lo emite igual para que el conector pueda ignorarlo a conciencia.
  return responder(e, { "mcp-session-id": crypto.randomUUID() });
}

function manejarToolsList(
  req: Request,
  id: IdRpc,
  knobs: KnobsEfectivos,
  iniciado: number
): Response {
  const e = emitir({ jsonrpc: "2.0", id, result: { tools: MCP_MOCK_TOOLS } }, knobs);
  registrar({ method: "tools/list", tool: null, args: null, cred: null, knobs, iniciado, status: e.status, ok: true, errorCode: null, bytes: e.body.length });
  return responder(e);
}

function manejarToolsCall(
  req: Request,
  id: IdRpc,
  params: Record<string, unknown>,
  knobs: KnobsEfectivos,
  iniciado: number
): Response {
  const tool = typeof params.name === "string" ? params.name : "";
  const args =
    typeof params.arguments === "object" &&
    params.arguments !== null &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};
  const cred = leerCredencial(req, params);
  const conversationId =
    typeof args.conversation_id === "string" ? args.conversation_id : null;

  const bitacora = (
    status: number,
    ok: boolean,
    errorCode: string | null,
    bytes: number
  ) =>
    registrar({ method: "tools/call", tool, args, cred, knobs, iniciado, status, ok, errorCode, bytes, conversationId });

  // Los fallos de transporte (307 / 500) ya se resolvieron en `POST`.

  // 1. Credencial: ausente o forzada a fallar → HTTP 200 + isError (hallazgo 3).
  if (cred === null || knobs.fallo === "unauthorized") {
    const e = emitir(sobreIsError(id, errorForzado("unauthorized")), knobs);
    bitacora(e.status, false, "unauthorized", e.body.length);
    return responder(e);
  }

  // 2. Herramienta desconocida: también error de aplicación, no JSON-RPC.
  const resultado = knobs.forceError !== null
    ? ({ ok: false, error: errorForzado(knobs.forceError) } as const)
    : ejecutarHerramienta(tool, args, { sinResultados: knobs.emptyResults });

  if (!resultado.ok) {
    const e = emitir(sobreIsError(id, resultado.error), knobs);
    bitacora(e.status, false, String(resultado.error.code), e.body.length);
    return responder(e);
  }

  // 3. Camino feliz, con los knobs que deforman el payload.
  let data = resultado.data;
  if (knobs.evilText) data = inyectarTextoHostil(data);
  if (knobs.huge) data = { ...data, filler: "x".repeat(MAX_RELLENO_BYTES) };

  const texto = JSON.stringify(data);

  if (knobs.malformed !== null) {
    const e = respuestaRota(id, texto, knobs);
    bitacora(e.status, false, `malformed:${knobs.malformed}`, e.body.length);
    return responder(e);
  }

  const e = emitir(sobreExito(id, texto), knobs);
  bitacora(e.status, true, null, e.body.length);
  return responder(e);
}

/** Las cinco formas de romper la respuesta a propósito. */
function respuestaRota(
  id: IdRpc,
  texto: string,
  knobs: KnobsEfectivos
): Emitido {
  switch (knobs.malformed) {
    case "no-content":
      return emitir({ jsonrpc: "2.0", id, result: { content: [] } }, knobs);
    case "rpc-error":
      return emitir(sobreRpcError(id, -32603, "Internal error"), knobs);
    case "truncated":
      return emitir(
        sobreExito(id, texto.slice(0, Math.max(1, Math.floor(texto.length / 2)))),
        knobs
      );
    case "bad-json-body":
      // El CUERPO HTTP entero no parsea: ni siquiera se llega al doble sobre.
      return {
        body: '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text"',
        status: 200,
        contentType: knobs.contentType ?? "application/json",
      };
    case "not-json":
    default:
      return emitir(
        sobreExito(
          id,
          "Disculpá, no puedo responder eso ahora mismo. Escribinos por teléfono."
        ),
        knobs
      );
  }
}

// ------------------------------------------------------------ bitácora ------

type EntradaBitacora = {
  method: string;
  tool: string | null;
  args: unknown;
  cred: Credencial | null;
  knobs: KnobsEfectivos;
  iniciado: number;
  status: number;
  ok: boolean;
  errorCode: string | null;
  bytes: number;
  conversationId?: string | null;
};

function registrar(e: EntradaBitacora): void {
  registrarLlamada({
    at: new Date().toISOString(),
    method: e.method,
    tool: e.tool,
    arguments: e.args,
    auth: e.cred?.scheme ?? null,
    credentialLast4: last4(e.cred?.value ?? null),
    conversationId: e.conversationId ?? null,
    httpStatus: e.status,
    ok: e.ok,
    errorCode: e.errorCode,
    knob: e.knobs.origen,
    bytes: e.bytes,
    durationMs: Date.now() - e.iniciado,
  });
}
