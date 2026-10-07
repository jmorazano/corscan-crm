/**
 * ARGUMENTOS DE UNA HERRAMIENTA GENÉRICA CONTRA SU `inputSchema` (032).
 *
 * El perfil de 016 validaba a mano los argumentos de SUS herramientas. Para
 * una herramienta que nadie programó, la única descripción de sus
 * parámetros es el JSON Schema que publica el servidor. Esto implementa el
 * subconjunto que publican los servidores MCP reales (`type` —incluidas las
 * uniones con `null`—, `properties`, `required`, `enum`, `items`), con dos
 * objetivos:
 *
 * 1. Que un argumento mal formado NO gaste una llamada al sistema del
 *    cliente: el modelo recibe qué corregir y lo corrige en la vuelta
 *    siguiente (la misma idea que la corrección #43 de 016).
 * 2. Tolerar lo que los modelos hacen siempre: un entero como texto («4»),
 *    un booleano como «true». Se convierte en vez de rechazar.
 *
 * NO es un validador completo y no pretende serlo: el servidor valida igual
 * (y devuelve errores estables que el modelo también sabe leer). Lo que no
 * se entiende del esquema, se deja pasar.
 *
 * Módulo puro: sin imports, sin I/O.
 */

export type ArgsValidation =
  | { ok: true; args: Record<string, unknown>; notes: string[] }
  | { ok: false; errors: string[] };

type JsonType = "string" | "integer" | "number" | "boolean" | "array" | "object" | "null";

type PropSchema = {
  type?: JsonType | JsonType[];
  description?: string;
  enum?: unknown[];
  items?: PropSchema;
};

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
  "null",
]);

/** Nombres de parámetro razonables: el resto se descarta al guardar. */
export const PARAM_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typesOf(schema: PropSchema | undefined): JsonType[] {
  const raw = schema?.type;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((t): t is JsonType => KNOWN_TYPES.has(t));
}

function propertiesOf(schema: unknown): Record<string, PropSchema> | null {
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;
  const out: Record<string, PropSchema> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (PARAM_NAME_RE.test(name) && isRecord(prop)) out[name] = prop as PropSchema;
  }
  return out;
}

function requiredOf(schema: unknown): string[] {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((r): r is string => typeof r === "string");
}

/** Intenta llevar `value` a alguno de los tipos permitidos. */
function coerce(
  value: unknown,
  schema: PropSchema | undefined
): { ok: true; value: unknown } | { ok: false } {
  const types = typesOf(schema);
  if (types.length === 0) return { ok: true, value };
  if (value === null) return types.includes("null") ? { ok: true, value } : { ok: false };

  for (const type of types) {
    switch (type) {
      case "string":
        if (typeof value === "string") return { ok: true, value };
        if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value: String(value) };
        break;
      case "integer": {
        const n = typeof value === "string" && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
        if (typeof n === "number" && Number.isInteger(n)) return { ok: true, value: n };
        break;
      }
      case "number": {
        const n = typeof value === "string" && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(value)
          ? Number(value.replace(",", "."))
          : value;
        if (typeof n === "number" && Number.isFinite(n)) return { ok: true, value: n };
        break;
      }
      case "boolean":
        if (typeof value === "boolean") return { ok: true, value };
        if (value === "true") return { ok: true, value: true };
        if (value === "false") return { ok: true, value: false };
        break;
      case "array": {
        if (!Array.isArray(value)) break;
        const items: unknown[] = [];
        let fine = true;
        for (const item of value) {
          const c = coerce(item, schema?.items);
          if (!c.ok) {
            fine = false;
            break;
          }
          items.push(c.value);
        }
        if (fine) return { ok: true, value: items };
        break;
      }
      case "object":
        if (isRecord(value)) return { ok: true, value };
        break;
      case "null":
        break;
    }
  }
  return { ok: false };
}

const TYPE_LABEL: Record<JsonType, string> = {
  string: "texto",
  integer: "número entero",
  number: "número",
  boolean: "true/false",
  array: "lista",
  object: "objeto",
  null: "vacío",
};

function typeLabel(schema: PropSchema | undefined): string {
  const types = typesOf(schema).filter((t) => t !== "null");
  if (types.length === 0) return "valor";
  const base = types.map((t) => TYPE_LABEL[t]).join(" o ");
  if (types.includes("array")) {
    const inner = typesOf(schema?.items).filter((t) => t !== "null");
    if (inner.length > 0) return `lista de ${inner.map((t) => TYPE_LABEL[t]).join(" o ")}`;
  }
  return base;
}

/**
 * Valida y normaliza los argumentos. Sin esquema de propiedades, pasan tal
 * cual (el servidor decide). Las claves que el esquema no declara se
 * descartan con una nota: un servidor estricto las rechaza
 * (`unknown_guest_field`) y no vale la pena gastar una llamada en eso.
 */
export function validateToolArgs(schema: unknown, raw: unknown): ArgsValidation {
  const args = isRecord(raw) ? raw : {};
  const props = propertiesOf(schema);
  if (!props) return { ok: true, args: { ...args }, notes: [] };

  const errors: string[] = [];
  const notes: string[] = [];
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [name, value] of Object.entries(args)) {
    const prop = props[name];
    if (!prop) {
      unknown.push(name);
      continue;
    }
    if (value === undefined) continue;
    const c = coerce(value, prop);
    if (!c.ok) {
      errors.push(`«${name}» tiene que ser ${typeLabel(prop)}.`);
      continue;
    }
    if (Array.isArray(prop.enum) && prop.enum.length > 0 && c.value !== null) {
      if (!prop.enum.some((option) => option === c.value)) {
        const options = prop.enum.filter((o) => typeof o === "string" || typeof o === "number").slice(0, 12);
        errors.push(`«${name}» tiene que ser uno de: ${options.join(", ")}.`);
        continue;
      }
    }
    out[name] = c.value;
  }

  for (const name of requiredOf(schema)) {
    if (out[name] === undefined || out[name] === null || out[name] === "") {
      if (!errors.some((e) => e.startsWith(`«${name}»`))) {
        const prop = props[name];
        const hint = prop?.description ? ` (${prop.description.slice(0, 120)})` : "";
        errors.push(`Falta «${name}»${hint}.`);
      }
    }
  }

  if (unknown.length > 0) {
    notes.push(`Ignoré parámetros que la herramienta no acepta: ${unknown.slice(0, 8).join(", ")}.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, args: out, notes };
}

/** ¿El esquema declara este parámetro? (p. ej. `conversation_id`). */
export function declaresParam(schema: unknown, name: string): boolean {
  const props = propertiesOf(schema);
  return Boolean(props && props[name]);
}

/**
 * Líneas cortas para el prompt: `- fullname (texto, opcional): Nombre y
 * apellido…`. El esquema ya llega SANEADO desde el handshake; acá solo se
 * da formato y se acota.
 */
export function describeParams(schema: unknown, maxDescriptionChars = 160): string[] {
  const props = propertiesOf(schema);
  if (!props) return [];
  const required = new Set(requiredOf(schema));
  return Object.entries(props).map(([name, prop]) => {
    const flag = required.has(name) ? "obligatorio" : "opcional";
    const options =
      Array.isArray(prop.enum) && prop.enum.length > 0
        ? `; uno de: ${prop.enum.filter((o) => typeof o === "string" || typeof o === "number").slice(0, 12).join(", ")}`
        : "";
    const description = typeof prop.description === "string" ? prop.description.trim() : "";
    const clipped =
      description.length > maxDescriptionChars
        ? `${description.slice(0, maxDescriptionChars - 1).trimEnd()}…`
        : description;
    return `  - ${name} (${typeLabel(prop)}, ${flag}${options})${clipped ? `: ${clipped}` : ""}`;
  });
}

/**
 * Copia saneada de un esquema ajeno para GUARDAR: solo las claves que este
 * módulo entiende, nombres de parámetro razonables, descripciones pasadas
 * por `clean` (el saneo de texto ajeno vive en el servidor) y un tope de
 * profundidad. Lo que no se reconoce se pierde: es dato de un tercero.
 */
export function sanitizeInputSchema(
  raw: unknown,
  clean: (text: string, max: number) => string,
  depth = 0
): Record<string, unknown> | null {
  if (!isRecord(raw) || depth > 3) return null;
  const out: Record<string, unknown> = {};
  const types = Array.isArray(raw.type)
    ? raw.type.filter((t): t is string => typeof t === "string" && KNOWN_TYPES.has(t))
    : typeof raw.type === "string" && KNOWN_TYPES.has(raw.type)
      ? raw.type
      : null;
  if (types && (!Array.isArray(types) || types.length > 0)) out.type = types;
  if (typeof raw.description === "string") {
    const d = clean(raw.description, 600);
    if (d) out.description = d;
  }
  if (Array.isArray(raw.enum)) {
    const options = raw.enum
      .filter((o) => typeof o === "string" || typeof o === "number" || typeof o === "boolean")
      .slice(0, 50)
      .map((o) => (typeof o === "string" ? clean(o, 80) : o));
    if (options.length > 0) out.enum = options;
  }
  if (isRecord(raw.items)) {
    const items = sanitizeInputSchema(raw.items, clean, depth + 1);
    if (items) out.items = items;
  }
  if (isRecord(raw.properties)) {
    const props: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(raw.properties).slice(0, 40)) {
      if (!PARAM_NAME_RE.test(name)) continue;
      const p = sanitizeInputSchema(prop, clean, depth + 1);
      if (p) props[name] = p;
    }
    out.properties = props;
  }
  if (Array.isArray(raw.required)) {
    const required = raw.required.filter(
      (r): r is string => typeof r === "string" && PARAM_NAME_RE.test(r)
    );
    if (required.length > 0) out.required = required;
  }
  return out;
}
