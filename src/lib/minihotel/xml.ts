/**
 * Parser XML mínimo y DEFENSIVO para las respuestas de MiniHotel (028).
 *
 * Por qué uno propio y no una dependencia: lo único que necesitamos es leer
 * elementos, atributos y texto de respuestas chicas (la más grande medida en
 * la documentación son unos pocos KB), y el repo ya resuelve así formatos
 * acotados (SSE en `src/lib/mcp/transport.ts`, Ogg/Opus en
 * `src/lib/ogg-opus.ts`). Una librería genérica trae además superficie que
 * acá es riesgo puro: DTD, entidades externas, expansión de entidades.
 *
 * Lo que hace:
 * - elementos, atributos (comillas dobles o simples), texto, CDATA;
 * - entidades predefinidas y numéricas (`&amp;`, `&#233;`, `&#xE9;`);
 * - ignora la declaración `<?xml …?>`, otras instrucciones y comentarios;
 * - tolera VARIAS raíces (la documentación de MiniHotel trae respuestas así):
 *   devuelve siempre un nodo `#document` cuyos hijos son los elementos de
 *   primer nivel.
 *
 * Lo que NO hace, a propósito:
 * - `<!DOCTYPE` / `<!ENTITY` → error (cierra la expansión de entidades);
 * - etiquetas mal cerradas → error (la respuesta es ilegible, no se adivina);
 * - más de `maxNodes` elementos o `maxDepth` niveles → error.
 *
 * Todo es PURO: sin I/O. El texto que devuelve es del proveedor y sigue
 * siendo DATO: quien lo muestre lo sanea (`sanitizeForeignText`).
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Texto propio (los nodos de texto directos concatenados), sin recortar. */
  text: string;
};

export class XmlParseError extends Error {
  constructor(reason: string) {
    super(`XML inválido: ${reason}`);
    this.name = "XmlParseError";
  }
}

export type XmlLimits = {
  maxNodes: number;
  maxDepth: number;
  maxInputChars: number;
};

/** Holgados para MiniHotel (un hotel grande con un año de Bulk ARI entra). */
export const XML_LIMITS: XmlLimits = {
  maxNodes: 50_000,
  maxDepth: 64,
  maxInputChars: 4_000_000,
};

const NAME_RE = /^[A-Za-z_][\w.:-]*$/;
const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY_RE = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decodifica las entidades predefinidas y numéricas; deja el resto igual. */
export function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(ENTITY_RE, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid =
        Number.isInteger(cp) &&
        cp > 0 &&
        cp <= 0x10ffff &&
        !(cp >= 0xd800 && cp <= 0xdfff);
      return valid ? String.fromCodePoint(cp) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Índice del `>` que cierra la etiqueta, respetando comillas. */
function findTagEnd(input: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

function parseTag(inner: string): { name: string; attrs: Record<string, string> } {
  const trimmed = inner.trim();
  const space = trimmed.search(/\s/);
  const name = space === -1 ? trimmed : trimmed.slice(0, space);
  if (!NAME_RE.test(name)) throw new XmlParseError("nombre de etiqueta inválido");
  const attrs: Record<string, string> = {};
  if (space !== -1) {
    const rest = trimmed.slice(space);
    ATTR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTR_RE.exec(rest)) !== null) {
      const key = match[1] ?? "";
      if (!NAME_RE.test(key)) throw new XmlParseError("nombre de atributo inválido");
      attrs[key] = decodeEntities(match[2] ?? match[3] ?? "");
    }
  }
  return { name, attrs };
}

/**
 * Parsea `input` y devuelve el nodo `#document`. Lanza `XmlParseError` ante
 * cualquier cosa que no sea XML bien formado dentro de los límites.
 */
export function parseXml(input: string, limits: XmlLimits = XML_LIMITS): XmlNode {
  if (input.length > limits.maxInputChars) throw new XmlParseError("respuesta demasiado grande");
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const doc: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [doc];
  let nodes = 0;
  let i = 0;

  const top = (): XmlNode => stack[stack.length - 1] ?? doc;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      top().text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(source.slice(i, lt));

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end === -1) throw new XmlParseError("comentario sin cerrar");
      i = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end === -1) throw new XmlParseError("CDATA sin cerrar");
      top().text += source.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (source.startsWith("<!", lt)) {
      // DOCTYPE / ENTITY: la puerta de la expansión de entidades. Cerrada.
      throw new XmlParseError("declaraciones DTD no permitidas");
    }
    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end === -1) throw new XmlParseError("instrucción sin cerrar");
      i = end + 2;
      continue;
    }
    if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt + 2);
      if (end === -1) throw new XmlParseError("etiqueta de cierre sin terminar");
      const name = source.slice(lt + 2, end).trim();
      const open = stack.length > 1 ? stack.pop() : undefined;
      if (!open || open.name !== name) throw new XmlParseError("etiquetas mal anidadas");
      i = end + 1;
      continue;
    }

    const end = findTagEnd(source, lt + 1);
    if (end === -1) throw new XmlParseError("etiqueta sin terminar");
    let inner = source.slice(lt + 1, end);
    const selfClosing = inner.trimEnd().endsWith("/");
    if (selfClosing) inner = inner.trimEnd().slice(0, -1);
    const { name, attrs } = parseTag(inner);

    nodes += 1;
    if (nodes > limits.maxNodes) throw new XmlParseError("demasiados elementos");
    const node: XmlNode = { name, attrs, children: [], text: "" };
    top().children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length - 1 > limits.maxDepth) throw new XmlParseError("demasiados niveles");
    }
    i = end + 1;
  }

  if (stack.length !== 1) throw new XmlParseError("etiquetas sin cerrar");
  return doc;
}

/* ============================================================
 * Lectura: búsquedas insensibles a mayúsculas
 * ============================================================
 * La documentación de MiniHotel mezcla `RoomType`/`Rmtype`, `price`/`Price`:
 * comparar en minúsculas evita que un cambio de mayúscula del proveedor
 * vacíe una respuesta válida.
 */

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Hijos DIRECTOS con ese nombre (todos si no se pasa nombre). */
export function childElements(node: XmlNode | null, name?: string): XmlNode[] {
  if (!node) return [];
  return name ? node.children.filter((c) => same(c.name, name)) : [...node.children];
}

export function firstChild(node: XmlNode | null, name: string): XmlNode | null {
  if (!node) return null;
  return node.children.find((c) => same(c.name, name)) ?? null;
}

/** Descendientes con ese nombre, en orden de documento. */
export function findAll(node: XmlNode | null, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  if (!node) return out;
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (same(c.name, name)) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function findFirst(node: XmlNode | null, name: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) {
    if (same(c.name, name)) return c;
    const deep = findFirst(c, name);
    if (deep) return deep;
  }
  return null;
}

/** Atributo (insensible a mayúsculas), recortado; vacío → `null`. */
export function attr(node: XmlNode | null, name: string): string | null {
  if (!node) return null;
  for (const [key, value] of Object.entries(node.attrs)) {
    if (same(key, name)) {
      const v = value.trim();
      return v === "" ? null : v;
    }
  }
  return null;
}

/** Texto propio recortado; vacío → `null`. */
export function textOf(node: XmlNode | null): string | null {
  if (!node) return null;
  const v = node.text.trim();
  return v === "" ? null : v;
}

/** Texto del primer hijo directo con ese nombre. */
export function childText(node: XmlNode | null, name: string): string | null {
  return textOf(firstChild(node, name));
}
