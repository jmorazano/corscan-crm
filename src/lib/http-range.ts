/**
 * Parseo puro del header `Range` (015): iOS Safari exige 206 para reproducir
 * `<audio>`. Solo un rango `bytes=start-end` (el único que piden los
 * navegadores); múltiples rangos se tratan como "sin Range".
 */
export type ByteRange = { start: number; end: number };

export function parseByteRange(
  header: string | null | undefined,
  total: number
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (total <= 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (a === "") {
    // sufijo: últimos N bytes
    const n = Number(b);
    if (n <= 0) return "unsatisfiable";
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(a);
    end = b === "" ? total - 1 : Math.min(Number(b), total - 1);
  }
  if (start > end || start >= total) return "unsatisfiable";
  return { start, end };
}
