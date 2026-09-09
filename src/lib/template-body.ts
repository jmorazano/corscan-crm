/**
 * Cuerpo de plantillas de WhatsApp: variables `{{n}}` y formato inline.
 *
 * Módulo PURO (sin BD ni red) para que lo compartan el servicio de plantillas
 * del servidor y el editor/preview del cliente: la misma regla de validación
 * que rechaza un cuerpo en la API es la que el editor muestra mientras se
 * escribe.
 */

export const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

export const MAX_TEMPLATE_VARIABLES = 5;

/**
 * Catálogo de ORÍGENES de variables (009). Cada `{{n}}` del cuerpo queda
 * atada en la creación a uno de estos orígenes (template.variable_bindings);
 * los automáticos se resuelven solos al enviar y solo `free_text` pide valor.
 */
export const VARIABLE_ORIGINS = [
  {
    key: "contact_name",
    label: "Nombre del contacto",
    description: "Se completa solo con el nombre de cada destinatario.",
    sample: "María",
  },
  {
    key: "contact_phone",
    label: "Teléfono del contacto",
    description: "Se completa solo, en formato legible.",
    sample: "+54 9 351 123-4567",
  },
  {
    key: "org_name",
    label: "Nombre de tu empresa",
    description: "Se completa solo con la marca de Ajustes → Marca.",
    sample: "Tu Empresa",
  },
  {
    key: "free_text",
    label: "Texto libre al enviar",
    description:
      "Lo cargás al crear la campaña (un valor para todos) o al enviar 1:1.",
    sample: "una promo especial",
  },
] as const;

export type VariableOrigin = (typeof VARIABLE_ORIGINS)[number];
export type VariableOriginKey = VariableOrigin["key"];

export const VARIABLE_ORIGIN_KEYS = VARIABLE_ORIGINS.map((o) => o.key);

export function originByKey(key: string): VariableOrigin | undefined {
  return VARIABLE_ORIGINS.find((o) => o.key === key);
}

/** Índices DISTINTOS usados en el cuerpo, ordenados. */
export function usedVariableIndexes(body: string): number[] {
  const set = new Set<number>();
  for (const m of body.matchAll(VARIABLE_REGEX)) {
    set.add(Number(m[1]));
  }
  return [...set].sort((a, b) => a - b);
}

/** Cantidad de variables del cuerpo (índices distintos; repetir no suma). */
export function countVariables(body: string): number {
  return usedVariableIndexes(body).length;
}

/**
 * Valida el cuerpo (009): hasta 5 variables posicionales CONTIGUAS desde
 * {{1}} (sin huecos); repetir un índice está permitido.
 */
export function validateBodyVariables(body: string): string | null {
  const used = usedVariableIndexes(body);
  if (used.length === 0) return null;
  if (used.length > MAX_TEMPLATE_VARIABLES) {
    return `Máximo ${MAX_TEMPLATE_VARIABLES} variables por plantilla`;
  }
  const expected = Array.from({ length: used.length }, (_, i) => i + 1);
  if (used.some((n, i) => n !== expected[i])) {
    return `Las variables deben ser consecutivas desde {{1}} (sin huecos): usa {{1}}..{{${used.length}}}`;
  }
  return null;
}

/** Sustituye cada {{n}} por values[n-1] (vacío si falta el valor). */
export function renderBody(body: string, values?: readonly string[]): string {
  return body.replace(VARIABLE_REGEX, (_m, n: string) => {
    return values?.[Number(n) - 1] ?? "";
  });
}

/** Cantidad de bindings `free_text` (valores que hay que pedir al enviar). */
export function freeTextCount(bindings: readonly string[]): number {
  return bindings.filter((b) => b === "free_text").length;
}

export type VariableResolution =
  | { ok: true; values: string[] }
  | { ok: false; error: string };

/**
 * Resuelve el valor de cada variable según su binding (009). Pura y
 * compartida: el server la usa con datos reales del envío y el cliente con
 * muestras para el preview. `freeTexts` trae un valor por binding
 * `free_text`, en orden; vacíos o faltantes son error (jamás sale un mensaje
 * con huecos).
 */
export function resolveVariableValues(
  bindings: readonly string[],
  ctx: {
    contactName: string;
    contactPhone: string;
    orgName: string;
    freeTexts?: readonly string[];
  }
): VariableResolution {
  const values: string[] = [];
  let free = 0;
  for (const binding of bindings) {
    if (binding === "contact_name") values.push(ctx.contactName);
    else if (binding === "contact_phone") values.push(ctx.contactPhone);
    else if (binding === "org_name") values.push(ctx.orgName);
    else if (binding === "free_text") {
      const value = ctx.freeTexts?.[free]?.trim();
      free += 1;
      if (!value) {
        return {
          ok: false,
          error: `Falta el valor del texto libre para {{${values.length + 1}}}`,
        };
      }
      values.push(value);
    } else {
      return { ok: false, error: `Origen de variable desconocido: ${binding}` };
    }
  }
  const expected = freeTextCount(bindings);
  if ((ctx.freeTexts?.length ?? 0) > expected) {
    return { ok: false, error: "Sobran valores de texto libre" };
  }
  return { ok: true, values };
}

/** Muestras del catálogo para una lista de bindings (preview y examples). */
export function sampleValuesFor(bindings: readonly string[]): string[] {
  return bindings.map((b) => originByKey(b)?.sample ?? "ejemplo");
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "variable"; key: string; raw: string };

/** Parte el cuerpo en texto y variables, para resaltarlas en el preview. */
export function splitBodyVariables(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(VARIABLE_REGEX)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: body.slice(last, start) });
    out.push({ kind: "variable", key: m[1]!, raw: m[0] });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
};

const INLINE_FORMAT_REGEX =
  /```([^`]+?)```|\*([^*\n]+?)\*|_([^_\n]+?)_|~([^~\n]+?)~/g;

/**
 * Formato inline de WhatsApp (*negrita*, _cursiva_, ~tachado~, ```mono```)
 * → spans para el preview. Sin anidamiento: lo que WhatsApp resuelve raro
 * acá se muestra tal cual, que es lo honesto.
 */
export function parseInlineFormat(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_FORMAT_REGEX)) {
    const start = m.index ?? 0;
    if (start > last) spans.push({ text: text.slice(last, start) });
    if (m[1] !== undefined) spans.push({ text: m[1], mono: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) spans.push({ text: m[3], italic: true });
    else if (m[4] !== undefined) spans.push({ text: m[4], strike: true });
    last = start + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

/**
 * Detecta si el cursor está justo después de un `{{` abierto (sin cerrar)
 * y devuelve el rango a reemplazar por la variable elegida.
 */
export function findOpenVariableAtCursor(
  body: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const before = body.slice(0, cursor);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const inner = before.slice(open + 2);
  if (inner.includes("}}") || inner.includes("{{") || /\s/.test(inner)) {
    return null;
  }
  return { start: open, end: cursor, query: inner };
}
