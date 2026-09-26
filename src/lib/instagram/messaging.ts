/**
 * Reglas PURAS del canal Instagram (023), compartidas por el servidor y la
 * UI (composer, ficha, filtros). Sin imports de servidor.
 */

/** Tope por mensaje de la Send API de Instagram (bytes UTF-8). */
export const INSTAGRAM_TEXT_MAX_BYTES = 1000;

/** Ventana estándar: igual que WhatsApp, 24 h desde el último entrante. */
export const INSTAGRAM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Etiqueta HUMAN_AGENT: una PERSONA puede responder hasta 7 días después. */
export const INSTAGRAM_HUMAN_AGENT_MS = 7 * 24 * 60 * 60 * 1000;

/** Prefijo del "teléfono" sintético de un contacto de Instagram. */
const PHONE_PREFIX = "ig:";

/**
 * Valor de `contact.phone` para un contacto de Instagram. Mismo patrón que el
 * contacto sintético del Entrenador (`phone='trainer'`): mantiene el unique
 * `(organization_id, phone)` y a todos los consumidores del teléfono sin un
 * NULL que propagar. `contact.channel` es la fuente de verdad del canal.
 */
export function instagramContactPhone(igsid: string): string {
  return `${PHONE_PREFIX}${igsid}`;
}

export function isInstagramPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.startsWith(PHONE_PREFIX);
}

/** IGSID de un contacto de Instagram (`null` si el teléfono no es sintético). */
export function igsidFromPhone(phone: string | null | undefined): string | null {
  return isInstagramPhone(phone) ? phone!.slice(PHONE_PREFIX.length) || null : null;
}

/**
 * Cómo se muestra el contacto donde WhatsApp muestra el teléfono: `+549…`
 * para WhatsApp, `@usuario` (o «Instagram») para Instagram.
 */
export function contactHandle(contact: {
  phone: string;
  channel?: "whatsapp" | "instagram" | null;
  igUsername?: string | null;
}): string {
  if (contact.channel === "instagram" || isInstagramPhone(contact.phone)) {
    const u = contact.igUsername?.trim().replace(/^@/, "");
    return u ? `@${u}` : "Instagram";
  }
  return `+${contact.phone}`;
}

/** Nombre visible de un contacto de Instagram. */
export function instagramDisplayName(input: {
  name?: string | null;
  username?: string | null;
  igsid: string;
}): string {
  const name = input.name?.trim();
  if (name) return name;
  const username = input.username?.trim();
  if (username) return `@${username.replace(/^@/, "")}`;
  return `Instagram · …${input.igsid.slice(-4)}`;
}

/** true si el nombre guardado es el provisorio (sin perfil leído todavía). */
export function isProvisionalInstagramName(name: string, igsid: string): boolean {
  return name === `Instagram · …${igsid.slice(-4)}`;
}

export type InstagramSendMode =
  | { mode: "standard" }
  | { mode: "human_agent" }
  | { mode: "closed"; reason: "no_inbound" | "window" | "human_agent_expired" };

/**
 * Cómo (y si) se puede enviar por Instagram ahora. La etiqueta HUMAN_AGENT
 * es SOLO para personas del equipo (política de Meta): el agente de IA jamás
 * la usa, así que para él la ventana es de 24 h a secas.
 */
export function instagramSendMode(
  lastInboundAt: Date | null,
  opts: { aiGenerated: boolean; now?: Date }
): InstagramSendMode {
  if (!lastInboundAt) return { mode: "closed", reason: "no_inbound" };
  const elapsed = (opts.now ?? new Date()).getTime() - lastInboundAt.getTime();
  if (elapsed < INSTAGRAM_WINDOW_MS) return { mode: "standard" };
  if (opts.aiGenerated) return { mode: "closed", reason: "window" };
  if (elapsed < INSTAGRAM_HUMAN_AGENT_MS) return { mode: "human_agent" };
  return { mode: "closed", reason: "human_agent_expired" };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Corta `s` en el mayor prefijo que entra en `max` bytes sin partir un code point. */
function hardCut(s: string, max: number): [string, string] {
  let bytes = 0;
  let i = 0;
  for (const ch of s) {
    const b = byteLength(ch);
    if (bytes + b > max) break;
    bytes += b;
    i += ch.length;
  }
  return [s.slice(0, i), s.slice(i)];
}

/**
 * Parte un texto en mensajes de ≤ `maxBytes` bytes. Prefiere cortar entre
 * párrafos, después al final de una oración y después entre palabras; solo
 * corta una palabra si ella sola no entra. Nunca devuelve trozos vacíos.
 */
export function splitInstagramText(
  text: string,
  maxBytes: number = INSTAGRAM_TEXT_MAX_BYTES
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const parts: string[] = [];
  let rest = clean;
  while (rest) {
    if (byteLength(rest) <= maxBytes) {
      parts.push(rest);
      break;
    }
    const [head] = hardCut(rest, maxBytes);
    const cut =
      lastBreak(head, /\n\s*\n/g) ??
      lastBreak(head, /[.!?…](?=\s)/g, 1) ??
      lastBreak(head, /\n/g) ??
      lastBreak(head, /\s/g);
    const idx = cut && cut > 0 ? cut : head.length;
    const piece = rest.slice(0, idx).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(idx).trim();
  }
  return parts;
}

/** Índice donde cortar tras el último match (con `offset` para incluir el signo). */
function lastBreak(s: string, re: RegExp, offset = 0): number | null {
  let last: number | null = null;
  for (const m of s.matchAll(re)) {
    if (m.index === undefined) continue;
    const at = m.index + offset;
    // Un corte en el primer 30 % deja trozos ridículos: se ignora.
    if (at >= s.length * 0.3) last = at;
  }
  return last;
}
