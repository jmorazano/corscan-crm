/**
 * ¿La respuesta nueva REPITE la anterior? (PURO, sin imports).
 *
 * 011 solo frenaba el texto idéntico. En producción (17-nov-2026) el
 * modelo contestó un «gracias» con el mismo mensaje de antes más
 * «¡Hasta luego!» al final, y la guarda lo dejó pasar. Ahora también es
 * repetición lo que, comparado por pares de palabras (sin mayúsculas,
 * tildes, signos ni emojis), coincide en un 80 % o más — o el texto
 * anterior entero contenido en el nuevo con apenas un agregado.
 *
 * Los textos cortos (menos de 6 palabras) solo cuentan si son iguales:
 * «¡Perfecto!» o «Dale, te espero» se pueden repetir con naturalidad.
 */

const MIN_WORDS = 6;
const SIMILARITY = 0.8;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bigrams(list: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < list.length - 1; i++) {
    const key = `${list[i]} ${list[i + 1]}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Coeficiente de Dice sobre pares de palabras (0 a 1). */
export function replySimilarity(a: string, b: string): number {
  const ga = bigrams(words(a));
  const gb = bigrams(words(b));
  const total = [...ga.values()].reduce((s, n) => s + n, 0) + [...gb.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let shared = 0;
  for (const [key, n] of ga) shared += Math.min(n, gb.get(key) ?? 0);
  return (2 * shared) / total;
}

export function repeatsPreviousReply(previous: string | null, next: string): boolean {
  if (previous === null) return false;
  const a = words(previous);
  const b = words(next);
  if (a.length === 0 || b.length === 0) return previous.trim() === next.trim();
  if (a.join(" ") === b.join(" ")) return true;
  if (Math.min(a.length, b.length) < MIN_WORDS) return false;
  return replySimilarity(previous, next) >= SIMILARITY;
}
