/**
 * Errores tipados del adaptador MCP (016, design §C.1).
 *
 * MCP_ERROR_TEXT es la ÚNICA fuente de los mensajes que el adaptador entrega
 * hacia afuera (corrección #13): a la respuesta HTTP, a la UI y a
 * `mcp_tool_call.errorMessage`. Ni un byte del cuerpo remoto se propaga como
 * texto, porque eso sería a la vez (a) un oráculo semi-ciego de SSRF —el
 * super admin leería fragmentos de lo que devolvió un servicio interno—,
 * (b) un canal para que un tercero escriba castellano elegido por él en la
 * pantalla del dueño y en la base, y (c) alimento de superficies como el
 * `ERROR_TEXT` de la UI. De lo remoto solo sobreviven datos estructurados:
 * `httpStatus` y el código estable del proveedor (`unknown_city`, …), este
 * último saneado a un identificador.
 */

export type McpErrorCode =
  /** La URL no pasa la validación sintáctica (esquema, puerto, fragmento…). */
  | "invalid_url"
  /** La IP resuelta cae en un rango prohibido (anti-SSRF). */
  | "blocked_host"
  /** 3xx: un endpoint JSON-RPC no redirige; seguirlo arrastraría el bearer. */
  | "unexpected_redirect"
  /** `content-type` o `content-encoding` que no sabemos (ni queremos) leer. */
  | "bad_content_type"
  | "timeout"
  | "too_large"
  /** Respuesta HTTP fuera de 2xx que no es 401/403. */
  | "http_error"
  /** El sobre JSON-RPC trae `error` (o un `id` que no es el nuestro). */
  | "rpc_error"
  /** El cuerpo no es el sobre que esperábamos, o el doble sobre no parsea. */
  | "bad_payload"
  /** 401/403, o el proveedor respondió `unauthorized` en el doble sobre. */
  | "unauthorized"
  /** La herramienta respondió `isError` con un código estable del proveedor. */
  | "tool_error"
  /** La herramienta no está en la allowlist del perfil. Nunca toca la red. */
  | "not_allowed"
  /** Cupo propio por empresa. Nunca toca la red. */
  | "rate_limited"
  /** Semáforo de salida lleno: demasiadas llamadas en vuelo en el proceso. */
  | "busy"
  /** D4: una conversación `is_test` intentó salir a la red. Es un guardrail. */
  | "sandbox_violation";

/**
 * Mensajes de primera parte, en castellano, pensados para que los lea el
 * dueño de la empresa. Son los únicos que salen del adaptador.
 */
export const MCP_ERROR_TEXT: Record<McpErrorCode, string> = {
  invalid_url:
    "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  blocked_host:
    "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  unexpected_redirect:
    "El servidor respondió con una redirección; por seguridad no la seguimos.",
  bad_content_type: "El servidor respondió en un formato que no podemos leer.",
  timeout: "El servidor no respondió a tiempo. Probá de nuevo en un minuto.",
  too_large: "La respuesta del servidor es demasiado grande.",
  http_error: "No se pudo conectar con el servidor.",
  rpc_error: "El servidor respondió algo que no pudimos interpretar.",
  bad_payload: "El servidor respondió algo que no pudimos interpretar.",
  unauthorized:
    "El servidor rechazó la credencial. Pedile una nueva al proveedor y volvé a cargarla.",
  tool_error: "El servidor rechazó la consulta.",
  not_allowed: "Esa consulta no está habilitada para este servidor.",
  rate_limited: "Muchas consultas seguidas. Esperá un minuto.",
  busy: "El sistema está atendiendo muchas consultas. Probá de nuevo en un momento.",
  sandbox_violation:
    "Las conversaciones de prueba no consultan el servidor real.",
};

const FALLBACK_TEXT = "No se pudo conectar con el servidor.";

/** Texto de primera parte para un código, tolerando códigos desconocidos. */
export function mcpErrorText(code: string): string {
  return isMcpErrorCode(code) ? MCP_ERROR_TEXT[code] : FALLBACK_TEXT;
}

export function isMcpErrorCode(code: string): code is McpErrorCode {
  return Object.prototype.hasOwnProperty.call(MCP_ERROR_TEXT, code);
}

/**
 * Código estable del proveedor, saneado a `[a-z0-9_]{1,40}`: llega dentro del
 * doble sobre, así que es texto ajeno aunque parezca un enum. Lo que no
 * matchea se colapsa a `provider_error` (nunca se propaga crudo).
 */
export function sanitizeProviderCode(raw: unknown): string {
  if (typeof raw !== "string") return "provider_error";
  const clean = raw.trim().toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(clean) ? clean : "provider_error";
}

export type McpErrorOptions = {
  /** Código estable del proveedor cuando `code === "tool_error"`. */
  providerCode?: string;
  httpStatus?: number;
  /** Causa original, SOLO para el stack. Nunca se serializa hacia afuera. */
  cause?: unknown;
};

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly providerCode: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(code: McpErrorCode, options: McpErrorOptions = {}) {
    // El mensaje NO se recibe por parámetro: sale del mapa. Así no hay forma
    // de que un caller distraído meta bytes del remoto en un Error que
    // después alguien loguea o devuelve por HTTP.
    super(MCP_ERROR_TEXT[code]);
    this.name = "McpError";
    this.code = code;
    this.providerCode = options.providerCode;
    this.httpStatus = options.httpStatus;
    if (options.cause !== undefined) {
      // `cause` puede traer el error de red de Node (ECONNREFUSED…). Es útil
      // en el stack local; jamás se devuelve ni se persiste.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isMcpError(err: unknown): err is McpError {
  return err instanceof McpError;
}

/**
 * Convierte cualquier `unknown` de un `catch` en un `McpError`. Los errores de
 * red de Node se mapean por su `code` sin mirar su mensaje (que puede traer el
 * hostname o parte de la respuesta).
 */
export function toMcpError(err: unknown, fallback: McpErrorCode = "http_error"): McpError {
  if (isMcpError(err)) return err;
  const nodeCode =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  if (nodeCode === "ETIMEDOUT" || nodeCode === "ESOCKETTIMEDOUT") {
    return new McpError("timeout", { cause: err });
  }
  return new McpError(fallback, { cause: err });
}
