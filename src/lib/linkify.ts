/**
 * Enlaces clicables en el hilo (031): parte un texto en tramos de texto y de
 * enlace. PURO y conservador:
 * - Solo `http(s)://` y `www.` (este último se abre como https). Nada de
 *   `javascript:`, `data:` ni esquemas raros: el texto lo escribió un tercero.
 * - La puntuación pegada al final («…acá: https://x.com/a.») no es parte del
 *   enlace; un paréntesis de cierre sí, si abre otro dentro del enlace.
 */

export type LinkPart = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi;
const TRAILING = /[.,;:!?¡¿…"'»)\]}]+$/;

function trimTrailing(raw: string): string {
  let url = raw;
  for (;;) {
    const m = TRAILING.exec(url);
    if (!m) return url;
    // «(ver https://x.com/a_(b))»: el «)» que cierra un «(» del enlace se queda.
    const tail = m[0];
    let keep = 0;
    if (tail.startsWith(")")) {
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.slice(0, url.length - tail.length).match(/\)/g) ?? []).length;
      if (opens > closes) keep = 1;
    }
    const cut = url.length - tail.length + keep;
    if (cut === url.length) return url;
    url = url.slice(0, cut);
    if (keep) return url;
  }
}

export function linkifyParts(text: string | null | undefined): LinkPart[] {
  if (!text) return [];
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimTrailing(match[0]);
    // «www.» solo no es un enlace.
    if (url.length <= 4 || /^www\.?$/i.test(url)) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parts.push({ type: "link", value: url, href });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
