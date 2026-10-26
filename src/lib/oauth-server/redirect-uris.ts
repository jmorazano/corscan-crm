/**
 * Direcciones de retorno permitidas para los asistentes (040, research D4).
 * Módulo PURO.
 *
 * Solo dos familias:
 * - las de Claude (claude.ai y claude.com), EXACTAS;
 * - loopback de clientes de escritorio/terminal (RFC 8252 §7.3: cualquier
 *   puerto), como Claude Code.
 *
 * El `client_name` registrado es dato no confiable (cualquiera se registra
 * como «Claude»): lo que se le muestra a la persona en el consentimiento sale
 * del destino de retorno (`clientLabelFor`).
 */

export const CLAUDE_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const MAX_URI_CHARS = 2048;

function parse(raw: string): URL | null {
  if (raw.length > MAX_URI_CHARS || /\s/.test(raw) || raw.includes("#")) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLoopback(u: URL): boolean {
  return (
    u.protocol === "http:" &&
    LOOPBACK_HOSTS.has(u.hostname) &&
    u.username === "" &&
    u.password === ""
  );
}

function isClaudeCallback(raw: string): boolean {
  return (CLAUDE_CALLBACKS as readonly string[]).includes(raw);
}

/** ¿Se puede registrar esta dirección de retorno? */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (isClaudeCallback(raw)) return true;
  const u = parse(raw);
  return u !== null && isLoopback(u);
}

/**
 * ¿La dirección pedida en la autorización es una de las registradas por el
 * cliente? Exacta, salvo loopback: ahí el puerto puede cambiar (el cliente
 * abre uno libre en cada intento).
 */
export function redirectMatchesRegistered(
  requested: string,
  registered: readonly string[]
): boolean {
  if (!isAllowedRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;
  const r = parse(requested);
  if (!r || !isLoopback(r)) return false;
  return registered.some((raw) => {
    const u = parse(raw);
    return (
      u !== null &&
      isLoopback(u) &&
      u.hostname === r.hostname &&
      u.pathname === r.pathname &&
      u.search === r.search
    );
  });
}

/** Lo que el consentimiento y Ajustes muestran como «quién pide acceso». */
export function clientLabelFor(redirectUri: string): string {
  if (redirectUri === CLAUDE_CALLBACKS[0]) return "Claude (claude.ai)";
  if (redirectUri === CLAUDE_CALLBACKS[1]) return "Claude (claude.com)";
  return "Una aplicación en esta computadora (por ejemplo, Claude Code)";
}
