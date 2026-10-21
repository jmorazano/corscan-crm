/**
 * Reglas PURAS del alto de la pantalla en móvil (fix iOS, oct-2026).
 *
 * Dos síntomas en la app instalada en iPhone:
 * - Al cambiar de conversación la pantalla quedaba «comprimida» como si el
 *   teclado siguiera abierto. El shell fijaba el alto del visual viewport al
 *   abrir el teclado y, si el campo desaparecía con el teclado arriba (otro
 *   chat, «atrás»), iOS no avisaba el cierre y el alto quedaba pegado.
 * - En modo instalado, iOS además deja `innerHeight` más bajo que la pantalla
 *   después de cerrar el teclado, hasta que algo fuerza un re-medido.
 */

/** El teclado solo puede estar abierto si hay un campo editable con foco. */
export function isEditableTarget(el: {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
} | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
  if (tag !== "INPUT") return false;
  if (el.readOnly || el.disabled) return false;
  return !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Lo que el visual viewport tiene que perder para que sea el teclado. */
export const KEYBOARD_MIN_PX = 100;

export function keyboardOpen(input: {
  innerHeight: number;
  viewportHeight: number;
  editableFocused: boolean;
}): boolean {
  return input.editableFocused && input.innerHeight - input.viewportHeight > KEYBOARD_MIN_PX;
}

/** Tolerancia de redondeo de iOS entre mediciones del mismo alto. */
export const STUCK_TOLERANCE_PX = 4;

/**
 * Alto «sano» por orientación: el mayor `innerHeight` visto con ese ancho.
 * Rotar cambia el ancho y arranca otra referencia.
 */
export function nextBaseline(
  baseline: { width: number; height: number } | null,
  current: { width: number; height: number }
): { width: number; height: number } {
  if (!baseline || baseline.width !== current.width) return current;
  return current.height > baseline.height ? current : baseline;
}

/** ¿iOS dejó el viewport más chico que la pantalla sin teclado abierto? */
export function viewportStuck(input: {
  baseline: { width: number; height: number } | null;
  width: number;
  innerHeight: number;
  keyboardOpen: boolean;
}): boolean {
  const b = input.baseline;
  if (input.keyboardOpen || !b || b.width !== input.width) return false;
  return b.height - input.innerHeight > STUCK_TOLERANCE_PX;
}
