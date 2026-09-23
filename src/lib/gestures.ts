/**
 * Matemática pura de gestos táctiles y atajos de la bandeja (012).
 * Sin DOM: se testea en Vitest; los hooks de `components/gestures.tsx`
 * solo conectan eventos a estas funciones.
 */

export type GesturePoint = { x: number; y: number };

/** Eje del movimiento: indefinido hasta superar el umbral (histéresis). */
export type SwipeAxis = "pending" | "horizontal" | "vertical";

export function classifySwipe(
  start: GesturePoint,
  current: GesturePoint,
  threshold = 10
): SwipeAxis {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx < threshold && dy < threshold) return "pending";
  return dx > dy ? "horizontal" : "vertical";
}

/** Gesto «volver» estilo iOS: arranca en el borde izquierdo y avanza a la derecha. */
export const EDGE_SWIPE = { edge: 32, min: 80 } as const;

export function isEdgeSwipeBack(
  startX: number,
  dx: number,
  dy: number,
  opts: { edge: number; min: number } = EDGE_SWIPE
): boolean {
  return startX <= opts.edge && dx >= opts.min && Math.abs(dy) < dx;
}

/**
 * Desplazamiento de una fila deslizable: solo hacia la izquierda; pasado el
 * ancho de las acciones frena elásticamente (un cuarto del exceso).
 */
export function clampReveal(dx: number, revealWidth: number): number {
  if (dx >= 0) return 0;
  if (-dx <= revealWidth) return dx;
  const extra = -dx - revealWidth;
  return -(revealWidth + extra * 0.25);
}

/**
 * Al soltar: abre si pasó la mitad; si ya estaba abierta, se cierra solo
 * cuando la devolvieron más de tres cuartos (evita cierres accidentales).
 */
export function settleReveal(
  dx: number,
  revealWidth: number,
  wasOpen: boolean
): boolean {
  const ratio = -dx / revealWidth;
  return wasOpen ? ratio > 0.25 : ratio > 0.5;
}

/** Long-press: se cancela si el dedo se mueve más de `tolerance` píxeles. */
export function longPressCancelled(
  start: GesturePoint,
  current: GesturePoint,
  tolerance = 10
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerance;
}

/** Atajos de teclado de la bandeja (escritorio, FR-011). */
export type InboxShortcut =
  | "search"
  | "next"
  | "prev"
  | "escape"
  | "markUnread"
  | null;

export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function inboxShortcut(e: KeyLike): InboxShortcut {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "Escape") return "escape";
  if (mod && !e.altKey && !e.shiftKey && key === "k") return "search";
  if (mod && e.shiftKey && !e.altKey && key === "u") return "markUnread";
  if (e.altKey && !mod && key === "ArrowDown") return "next";
  if (e.altKey && !mod && key === "ArrowUp") return "prev";
  return null;
}

/**
 * 018: ⌘/Ctrl + 1…9 → índice (0-based) del espacio de trabajo, en el orden
 * del rail; null si la combinación no aplica. `mod` es ⌘ en Mac y Ctrl en
 * Windows/Linux (como los atajos de la bandeja); Alt/Shift lo anulan para
 * no pisar atajos del sistema. Se mira `code` además de `key` porque en
 * algunos teclados el dígito con modificador llega como símbolo.
 */
export function workspaceShortcut(e: KeyLike & { code?: string }): number | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey || e.shiftKey) return null;
  const fromKey = /^[1-9]$/.test(e.key) ? Number(e.key) : null;
  const fromCode =
    e.code && /^(Digit|Numpad)[1-9]$/.test(e.code)
      ? Number(e.code.slice(-1))
      : null;
  const n = fromKey ?? fromCode;
  return n === null ? null : n - 1;
}

/** Etiqueta del modificador para mostrar el atajo: ⌘ en Apple, Ctrl en el resto. */
export function modifierLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl+";
}

/** Índice vecino en una lista (acotado; -1 si la lista está vacía). */
export function neighborIndex(
  ids: readonly string[],
  currentId: string | null,
  dir: 1 | -1
): number {
  if (ids.length === 0) return -1;
  const idx = currentId ? ids.indexOf(currentId) : -1;
  if (idx === -1) return dir === 1 ? 0 : ids.length - 1;
  return Math.max(0, Math.min(ids.length - 1, idx + dir));
}

/**
 * Respuestas rápidas con `/` (FR-008): activo cuando el texto es SOLO el
 * comando (opcionalmente precedido de espacios). Devuelve el filtro tipeado.
 */
export function quickReplyQuery(text: string): string | null {
  const m = /^\s*\/([^\s/]*)$/.exec(text);
  return m ? (m[1] ?? "") : null;
}

export function filterQuickReplies<T extends { name: string; body: string }>(
  items: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (t) =>
      t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
  );
}
