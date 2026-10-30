import { z } from "zod";

/**
 * Largo de un texto como lo cuenta una persona: un emoji, una bandera o una
 * letra con tilde valen 1. `String.length` cuenta unidades UTF-16 (un emoji
 * vale 2, una familia 👨‍👩‍👧 vale 8) y un texto de 7.996 caracteres «visibles»
 * terminaba rechazado por un tope de 8.000. Puro.
 */
const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });

export function visibleLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** Tope en caracteres visibles sobre un `z.string()` (mismo mensaje en toda la app). */
export function visibleMax(schema: z.ZodString, max: number) {
  return schema.refine((s) => visibleLength(s) <= max, {
    message: `Supera el tope de ${max} caracteres.`,
  });
}
