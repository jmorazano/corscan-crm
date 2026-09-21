import dns from "node:dns";
import net, { type LookupFunction } from "node:net";
import { isMockEnabled } from "@/lib/env";
import { McpError } from "./errors";

/**
 * Anti-SSRF del conector MCP (016, design §G.1 + correcciones #2, #3, #17,
 * #34).
 *
 * Única dependencia de `@/lib/*` admitida en `src/lib/mcp/`: `isMockEnabled()`,
 * que este módulo lee POR SU CUENTA (corrección #34) para que el transporte no
 * tenga que recibir ningún flag `allowInsecureHttp` que alguien pueda pasar en
 * `true` desde otra rama. Importar `getEnv`/`isMockEnabled` desde `src/lib/` es
 * la casa, no una excepción: `src/lib/google/oauth.ts:2` y
 * `calendar-client.ts:32` ya lo hacen.
 *
 * Dos controles, en dos momentos distintos:
 *  1. `checkEndpointSyntax`: barato, corre al guardar la URL Y antes de cada
 *     llamada (la fila puede cambiar entre la validación y el uso).
 *  2. `guardedLookup`: el control real, sobre la IP RESUELTA, DENTRO de la
 *     resolución que consume el socket. Validar aparte y conectar 5 ms después
 *     no sirve: con TTL 0 el atacante cambia el registro en el medio
 *     (DNS rebinding / TOCTOU).
 */

export type EndpointCheckReason =
  | "invalid_url"
  | "not_https"
  | "userinfo"
  | "bad_port"
  | "bad_host"
  | "too_long";

export type EndpointCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: EndpointCheckReason };

const MAX_URL_CHARS = 2048;

/**
 * Validación sintáctica. `http://` y loopback SOLO bajo el gate de mocks
 * (`WA_MOCK_ENABLED=true` y fuera de producción): el self-test que exige el
 * Principio IX corre contra `http://localhost:3000/api/dev/mcp-mock`.
 */
export function checkEndpointSyntax(raw: string): EndpointCheck {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_URL_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const mocks = isMockEnabled();

  if (url.protocol !== "https:" && !(mocks && url.protocol === "http:")) {
    return { ok: false, reason: "not_https" };
  }
  // `https://user:pass@evil/` confunde a media humanidad y a varios parsers.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "userinfo" };
  }
  // Un fragmento no viaja en la request: si está, la URL no es la que alguien
  // cree que guardó.
  if (url.hash !== "") return { ok: false, reason: "invalid_url" };

  // Un puerto raro en un PMS público es señal de estar apuntando a un
  // servicio interno. Bajo el gate de mocks el puerto es libre: el mcp-mock
  // vive en el dev server (3000, o el que haya quedado libre).
  if (!mocks && !["", "443"].includes(url.port)) {
    return { ok: false, reason: "bad_port" };
  }

  const host = stripBrackets(url.hostname).toLowerCase();
  if (host.length === 0) return { ok: false, reason: "bad_host" };

  const family = net.isIP(host);
  if (family !== 0) {
    // S-1: Node NO llama al `lookup` cuando el host YA es una IP, así que una
    // IP literal esquivaría todo el control de rangos. Y el parser WHATWG
    // normaliza `2130706433`, `0x7f.1` y `0` a IPv4 punteado, de modo que
    // "tiene al menos un punto" tampoco las frena. Un PMS público tiene
    // dominio y certificado: una IP literal no es un caso de uso.
    const loopbackOk = mocks && isLoopback(host, family === 4 ? 4 : 6);
    if (!loopbackOk) return { ok: false, reason: "bad_host" };
    return { ok: true, url };
  }

  // Sin punto no hay dominio público: corta `http://postgres`,
  // `http://vocero-crm.railway.internal` cae en el control de IP resuelta.
  if (!host.includes(".") && !(mocks && host === "localhost")) {
    return { ok: false, reason: "bad_host" };
  }
  if (host.endsWith(".")) {
    // El FQDN con punto final matchea distinto en toda comparación por texto.
    return { ok: false, reason: "bad_host" };
  }
  return { ok: true, url };
}

/* ------------------------------------------------------------------ */
/* Rangos bloqueados                                                   */
/* ------------------------------------------------------------------ */

/** Prefijos IPv4 prohibidos, como [base, bits]. */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: incluye TODA la metadata de nube
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // relay anycast 6to4 (corrección #3)
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada (incluye 255.255.255.255)
  ["100.100.100.200", 32], // metadata de Alibaba Cloud
];

/**
 * ¿La IP resuelta cae en un rango prohibido? Sin librerías: `net.isIP` +
 * aritmética. Ante cualquier duda (formato que no podemos parsear) devuelve
 * `true`: este control falla CERRADO a propósito.
 */
export function isBlockedAddress(address: string, family: 4 | 6): boolean {
  const host = stripBrackets(address);
  if (family === 4) {
    const n = toUint32(host);
    if (n === null) return true;
    return BLOCKED_V4.some(([base, bits]) => inV4Range(n, base, bits));
  }
  const bytes = parseIPv6(host);
  if (bytes === null) return true;

  // ::ffff:0:0/96 — IPv4-mapeada: se desmapea y se le aplican las reglas v4.
  // `::ffff:169.254.169.254` tiene que morir.
  if (isZeroPrefix(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedAddress(v4FromTail(bytes), 4);
  }
  // ::/96 — IPv4-compatible (obsoleta pero viva en los parsers): cubre `::`,
  // `::1` y `[::a9fe:a9fe]`, que ES 169.254.169.254 (corrección #3).
  if (isZeroPrefix(bytes, 12)) return true;
  // 64:ff9b::/96 — NAT64.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    isZeroSlice(bytes, 4, 12)
  ) {
    return true;
  }
  // 2002::/16 — 6to4: embebe una IPv4 arbitraria (corrección #3).
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;
  // fc00::/7 — únicas locales.
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local.
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true;
  // fec0::/10 — site-local (deprecada, todavía ruteable en redes viejas).
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0xc0) return true;
  // ff00::/8 — multicast.
  if (bytes[0] === 0xff) return true;
  return false;
}

/** Loopback puro (127/8, ::1, ::ffff:127.x): lo único que los mocks admiten. */
export function isLoopback(address: string, family: 4 | 6): boolean {
  const host = stripBrackets(address);
  if (family === 4) {
    const n = toUint32(host);
    return n !== null && inV4Range(n, "127.0.0.0", 8);
  }
  const bytes = parseIPv6(host);
  if (bytes === null) return false;
  if (isZeroPrefix(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isLoopback(v4FromTail(bytes), 4);
  }
  return isZeroPrefix(bytes, 15) && bytes[15] === 1;
}

/* ------------------------------------------------------------------ */
/* lookup guardado                                                     */
/* ------------------------------------------------------------------ */

/**
 * `lookup` que se pasa a `https.request({ lookup })`: el control ocurre DENTRO
 * de la resolución que consume el socket, lo que cierra la ventana de DNS
 * rebinding, y `servername` sigue siendo el hostname (TLS y SNI intactos).
 *
 * Corrección #2, verificada empíricamente: desde Node 20 `autoSelectFamily`
 * es `true` por defecto y Node invoca el lookup con `{ hints, all: true }`.
 * Con `all: true` el callback recibe un ARRAY de `{address, family}`, no un
 * string — una implementación escrita para la firma de un solo address recibe
 * el array, `net.isIP(array)` da 0, ningún rango matchea y la función falla
 * ABIERTO en silencio. Acá se pide `all: true` siempre y se exigen TODAS las
 * direcciones: con Happy Eyeballs, Node puede elegir cualquiera.
 */
export function guardedLookup(allowLoopback = isMockEnabled()): LookupFunction {
  return ((
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, ...rest: unknown[]) => void
  ) => {
    const opts: dns.LookupOptions =
      typeof options === "object" && options !== null
        ? (options as dns.LookupOptions)
        : { family: typeof options === "number" ? options : undefined };

    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) {
        callback(err);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        callback(new McpError("blocked_host") as NodeJS.ErrnoException);
        return;
      }
      for (const entry of list) {
        const family = entry.family === 6 ? 6 : 4;
        if (allowLoopback && isLoopback(entry.address, family)) continue;
        if (isBlockedAddress(entry.address, family)) {
          callback(new McpError("blocked_host") as NodeJS.ErrnoException);
          return;
        }
      }
      if (opts.all === true) {
        callback(null, list as never);
        return;
      }
      const first = list[0];
      if (!first) {
        callback(new McpError("blocked_host") as NodeJS.ErrnoException);
        return;
      }
      callback(null, first.address, first.family);
    });
  }) as unknown as LookupFunction;
}

/**
 * Resolución previa, para que el alta del super admin pueda responder 422
 * `invalid_endpoint` en vez de fallar recién en la primera llamada. NO
 * reemplaza a `guardedLookup` (entre esta resolución y la conexión hay una
 * ventana): es comodidad de UI, no un control.
 */
export async function assertResolvable(
  url: URL,
  allowLoopback = isMockEnabled()
): Promise<void> {
  const host = stripBrackets(url.hostname);
  const family = net.isIP(host);
  if (family !== 0) {
    const fam = family === 4 ? 4 : 6;
    if (allowLoopback && isLoopback(host, fam)) return;
    if (isBlockedAddress(host, fam)) throw new McpError("blocked_host");
    return;
  }
  const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, result) => {
      if (err) reject(new McpError("blocked_host", { cause: err }));
      else resolve(result);
    });
  });
  if (addresses.length === 0) throw new McpError("blocked_host");
  for (const entry of addresses) {
    const fam = entry.family === 6 ? 6 : 4;
    if (allowLoopback && isLoopback(entry.address, fam)) continue;
    if (isBlockedAddress(entry.address, fam)) throw new McpError("blocked_host");
  }
}

/* ------------------------------------------------------------------ */
/* Allowlist de enlaces salientes                                      */
/* ------------------------------------------------------------------ */

const MAX_LINK_CHARS = 512;

/**
 * Enlace que el CRM puede repetirle a un cliente de WhatsApp (FR-010,
 * corrección #17). Devuelve la URL normalizada o `null`; lo que no matchea se
 * OMITE, nunca se muestra.
 *
 * `h.endsWith(dominio)` a secas —la implementación ingenua— acepta
 * `evil-altosdecalamuchita.com`: por eso la comparación es `h === d` o
 * `h.endsWith("." + d)`. `new URL()` conserva el punto final del FQDN
 * (`altosdecalamuchita.com.`), así que se le quita antes de comparar. Y el
 * largo se acota porque un open redirect en el sitio del proveedor
 * convertiría la allowlist en un pasamanos.
 */
export function safeLink(raw: unknown, hosts: readonly string[]): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LINK_CHARS) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null; // corta http:, javascript:, data:
  if (url.username !== "" || url.password !== "") return null;
  const host = stripBrackets(url.hostname).toLowerCase().replace(/\.$/, "");
  const ok = hosts.some((entry) => {
    const d = entry.trim().toLowerCase().replace(/^\.|\.$/g, "");
    return d.length > 0 && (host === d || host.endsWith(`.${d}`));
  });
  if (!ok) return null;
  // Se devuelve el host normalizado (sin el punto final del FQDN): es el
  // enlace que ve un cliente en WhatsApp.
  url.hostname = host;
  if (url.href.length > MAX_LINK_CHARS) return null;
  return url.href;
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function toUint32(address: string): number | null {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = Number(part);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    n = n * 256 + byte;
  }
  return n;
}

function inV4Range(address: number, base: string, bits: number): boolean {
  const baseN = toUint32(base);
  if (baseN === null) return false;
  if (bits === 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((address & mask) >>> 0) === ((baseN & mask) >>> 0);
}

/** IPv6 → 16 bytes. `null` si no parsea (el caller falla cerrado). */
function parseIPv6(address: string): number[] | null {
  if (net.isIP(address) !== 6) return null;
  let head = address;
  let tailV4: number[] = [];
  const lastColon = head.lastIndexOf(":");
  const afterColon = head.slice(lastColon + 1);
  if (afterColon.includes(".")) {
    const v4 = toUint32(afterColon);
    if (v4 === null) return null;
    tailV4 = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff];
    head = head.slice(0, lastColon + 1) + "0:0";
  }
  const [left = "", right = "", extra] = head.split("::");
  if (extra !== undefined) return null;
  const leftGroups = left.length > 0 ? left.split(":") : [];
  const rightGroups = head.includes("::")
    ? right.length > 0
      ? right.split(":")
      : []
    : [];
  const groups = head.includes("::")
    ? [
        ...leftGroups,
        ...new Array(8 - leftGroups.length - rightGroups.length).fill("0"),
        ...rightGroups,
      ]
    : leftGroups;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push((value >>> 8) & 0xff, value & 0xff);
  }
  if (tailV4.length === 4) {
    bytes.splice(12, 4, ...tailV4);
  }
  return bytes.length === 16 ? bytes : null;
}

function isZeroPrefix(bytes: number[], count: number): boolean {
  return isZeroSlice(bytes, 0, count);
}

function isZeroSlice(bytes: number[], from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function v4FromTail(bytes: number[]): string {
  return [bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0].join(".");
}
