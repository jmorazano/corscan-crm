/**
 * IP del cliente para los limitadores por IP (FR-062): ÚNICA fuente. La usan
 * el rate limit propio de `src/lib/auth` y, vía `withClientIp`, el limitador
 * interno de Better Auth (que además la guarda en `session.ip_address`).
 *
 * Regla: la PRIMERA entrada de `X-Forwarded-For`; si no hay una IP válida,
 * `X-Real-IP`; si tampoco, `null` (el llamador decide el balde compartido).
 *
 * Verificado en producción el 4-oct-2026 (Railway, edge `railway-hikari`):
 * - 11 pedidos con un `X-Forwarded-For` falso DISTINTO cada uno cayeron en el
 *   MISMO balde (el 11.º dio 429): el edge descarta el valor del cliente y la
 *   primera entrada es la IP real. No es falsificable.
 * - El header llega con DOS entradas (`<cliente>, <edge del CDN>`): toda
 *   sesión de producción tenía `ip_address` vacío porque Better Auth solo
 *   acepta un valor único. Por eso NO sirve la entrada de la DERECHA: es el
 *   edge del CDN, compartido por miles de clientes (un 429 para todos).
 * - `X-Real-IP` queda de respaldo y no primero: detrás del Caddyfile de la
 *   Ruta B pasa tal cual lo manda el cliente (Caddy reescribe
 *   `X-Forwarded-For` de clientes no confiables, pero no toca `X-Real-IP`).
 *
 * Supuesto: la app SIEMPRE está detrás de un proxy que reescribe
 * `X-Forwarded-For` (edge de Railway, Caddy, Traefik de Coolify). Expuesta
 * directo a internet, ningún header es confiable.
 *
 * IPv6 se agrupa por /64 (un cliente suele tener el prefijo entero y rotaría
 * de dirección para esquivar el límite) y la IPv4 mapeada (`::ffff:a.b.c.d`)
 * vuelve a IPv4: la misma máquina no puede caer en dos baldes.
 */

/** Header que `withClientIp` fija para Better Auth (`advanced.ipAddress`). */
export const CLIENT_IP_HEADER = "x-vocero-client-ip";

type HeaderSource = { get(name: string): string | null } | null | undefined;

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_V6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** Los 8 grupos de 16 bits de una IPv6, o `null` si no es válida. */
function parseIPv6(raw: string): number[] | null {
  let text = raw.toLowerCase();
  if (!text.includes(":") || text.includes("%")) return null;

  // IPv4 embebida al final (`::ffff:1.2.3.4`): ocupa los dos últimos grupos.
  let v4Tail: [number, number] | null = null;
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (!IPV4.test(maybeV4)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = maybeV4.split(".").map(Number);
    v4Tail = [(a << 8) | b, (c << 8) | d];
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (!groups.every((g) => HEXTET.test(g))) return null;
    return groups.map((g) => Number.parseInt(g, 16));
  };
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!left || !right) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    groups = left;
  }
  if (groups.length !== 8) return null;
  if (v4Tail) [groups[6], groups[7]] = v4Tail;
  return groups;
}

/**
 * Normaliza UNA dirección (sin coma). IPv4 tal cual; IPv4 mapeada → IPv4;
 * IPv6 → su /64 en forma expandida (la misma que usa Better Auth, así el
 * valor re-normalizado allí no cambia). Acepta `a.b.c.d:puerto` y
 * `[v6]:puerto`, que algunos proxies escriben. `null` si no es una IP.
 */
export function normalizeIp(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  const bracketed = BRACKETED_V6.exec(text);
  if (bracketed) text = bracketed[1] ?? "";
  else {
    const withPort = IPV4_WITH_PORT.exec(text);
    if (withPort) text = withPort[1] ?? "";
  }

  if (IPV4.test(text)) return text;

  const groups = parseIPv6(text);
  if (!groups) return null;
  const isMappedV4 =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return [...groups.slice(0, 4), 0, 0, 0, 0]
    .map((g) => g.toString(16).padStart(4, "0"))
    .join(":");
}

function firstEntry(value: string | null): string | null {
  if (!value) return null;
  return normalizeIp(value.split(",")[0] ?? "");
}

/** IP del cliente según la regla de arriba, o `null` si no se puede saber. */
export function clientIp(headers: HeaderSource): string | null {
  if (!headers) return null;
  return (
    firstEntry(headers.get("x-forwarded-for")) ??
    firstEntry(headers.get("x-real-ip"))
  );
}

/**
 * Copia del pedido con `CLIENT_IP_HEADER` = `clientIp(...)`, para que el
 * limitador interno de Better Auth (que corre ANTES de cualquier hook o
 * plugin) use la misma IP. Pisa (o borra) el valor que mande el cliente.
 */
export function withClientIp(req: Request): Request {
  const headers = new Headers(req.headers);
  const ip = clientIp(headers);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  else headers.delete(CLIENT_IP_HEADER);
  return new Request(req, { headers });
}
