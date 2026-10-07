import { MAX_LINK_CHARS, safeLink, sanitizeForeignText } from "@/server/mcp/sanitize";

/**
 * RESULTADO DE UNA HERRAMIENTA GENÉRICA → TEXTO PARA EL MODELO (032).
 *
 * El perfil de 016 sabía condensar SUS herramientas. Una herramienta que
 * nadie programó devuelve un JSON de forma desconocida; esto lo convierte en
 * un DATO seguro para el prompt:
 *
 * - todo string pasa por `sanitizeForeignText` (invisibles, marcadores del
 *   sistema, cercos de código, prefijos de rol) y se acota;
 * - todo enlace que no sea https a un host permitido (los del perfil más el
 *   del endpoint, que fija solo el super admin) se reemplaza por
 *   «[enlace omitido]»: es el corte de la exfiltración, igual que `safeLink`;
 * - claves raras se descartan, la profundidad y las listas se acotan;
 * - el total se corta a `maxChars` con aviso.
 *
 * Puro (salvo por usar el saneo compartido): sin base ni red.
 */

export const OMITTED_LINK = "[enlace omitido]";
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_DEPTH = 6;
const MAX_ITEMS = 30;
const MAX_STRING_CHARS = 2000;
const URL_RE = /https?:\/\/[^\s"'<>()]+/gi;

export type GenericRenderOptions = {
  /** Hosts a los que se puede enlazar. */
  linkHosts: readonly string[];
  /** Tope del JSON resultante. */
  maxChars: number;
};

function cleanString(raw: string, hosts: readonly string[]): string {
  const text = sanitizeForeignText(raw, MAX_STRING_CHARS);
  return text.replace(URL_RE, (url) => {
    // Puntuación final pegada al enlace («…/pago.») no es parte de él.
    const trimmed = url.replace(/[.,;:!?]+$/, "");
    const tail = url.slice(trimmed.length);
    if (trimmed.length > MAX_LINK_CHARS) return OMITTED_LINK + tail;
    return (safeLink(trimmed, hosts) ? trimmed : OMITTED_LINK) + tail;
  });
}

/** Copia saneada y acotada de un payload ajeno. */
export function sanitizeForeignValue(
  value: unknown,
  hosts: readonly string[],
  depth = 0
): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return cleanString(value, hosts);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => sanitizeForeignValue(v, hosts, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`… (${value.length - MAX_ITEMS} más)`);
    return items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (!KEY_RE.test(key)) continue;
      out[key] = sanitizeForeignValue(v, hosts, depth + 1);
    }
    return out;
  }
  return null;
}

/** JSON compacto del payload saneado, acotado a `maxChars`. */
export function renderGenericResult(data: unknown, options: GenericRenderOptions): string {
  const clean = sanitizeForeignValue(data, options.linkHosts);
  const json = JSON.stringify(clean) ?? "null";
  if (json.length <= options.maxChars) return json;
  return `${json.slice(0, Math.max(0, options.maxChars - 40))}… (respuesta recortada)`;
}

const AMOUNT_KEY_RE =
  /total|amount|importe|price|precio|deposit|sena|seña|monto|balance|saldo|cost|costo|subtotal|fee/i;
const MONEY_IN_TEXT_RE = /(?:AR|US)?\$\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:ARS|USD|pesos?)\b/gi;

function moneyValue(fragment: string): number | null {
  const digits = fragment.match(/\d[\d.,]*/)?.[0];
  if (!digits) return null;
  const n = Number(digits.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Importes de un resultado: números bajo claves de dinero (`total`,
 * `deposit`…) e importes escritos dentro de los textos (`summary.lines`).
 * Son los únicos que la guarda de precios deja salir en este turno (032,
 * decisión del dueño: el total y la seña del resumen de la reserva).
 */
export function amountsIn(data: unknown, depth = 0): number[] {
  const out = new Set<number>();
  const visit = (value: unknown, key: string | null, d: number): void => {
    if (d > MAX_DEPTH || value === null || value === undefined) return;
    if (typeof value === "number") {
      if (key && AMOUNT_KEY_RE.test(key) && Number.isFinite(value) && value > 0) {
        out.add(Math.round(value));
        out.add(Math.trunc(value));
      }
      return;
    }
    if (typeof value === "string") {
      for (const m of value.matchAll(MONEY_IN_TEXT_RE)) {
        const v = moneyValue(m[0]);
        if (v !== null && v > 0) out.add(v);
      }
      if (key && AMOUNT_KEY_RE.test(key) && /^\s*\d[\d.,]*\s*$/.test(value)) {
        const v = moneyValue(value);
        if (v !== null && v > 0) out.add(v);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_ITEMS)) visit(item, key, d + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k, d + 1);
    }
  };
  visit(data, null, depth);
  return [...out];
}
