/**
 * Cuerpo de plantillas de WhatsApp: variables `{{n}}` y formato inline.
 *
 * Módulo PURO (sin BD ni red) para que lo compartan el servicio de plantillas
 * del servidor y el editor/preview del cliente: la misma regla de validación
 * que rechaza un cuerpo en la API es la que el editor muestra mientras se
 * escribe.
 */

export const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Variables que la plantilla puede usar (acotamiento v1: exactamente UNA).
 * El valor de `{{1}}` lo decide quien envía: en campañas es el nombre del
 * contacto o un texto fijo; desde la bandeja se escribe al enviar.
 */
export const TEMPLATE_VARIABLES = [
  {
    key: "1",
    token: "{{1}}",
    label: "Nombre del contacto",
    description:
      "En campañas se completa con el nombre del contacto (o un texto fijo); desde la bandeja lo escribís al enviar.",
    sample: "María",
  },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Cuenta variables {{n}} en el cuerpo. */
export function countVariables(body: string): number {
  return [...body.matchAll(VARIABLE_REGEX)].length;
}

/** Valida el acotamiento v1: máximo UNA variable y debe ser {{1}}. */
export function validateBodyVariables(body: string): string | null {
  const matches = [...body.matchAll(VARIABLE_REGEX)];
  if (matches.length > 1) {
    return "v1 admite una sola variable {{1}} en el cuerpo";
  }
  if (matches.length === 1 && matches[0]![1] !== "1") {
    return "La variable debe ser {{1}}";
  }
  return null;
}

/** Sustituye toda variable por el valor (vacío si no hay valor). */
export function renderBody(body: string, variable?: string): string {
  return body.replace(VARIABLE_REGEX, variable ?? "");
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
