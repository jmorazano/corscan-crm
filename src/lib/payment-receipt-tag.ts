/**
 * Etiqueta automática de comprobantes de pago (049). Módulo puro.
 *
 * `looksLikeReceipt` (034) es un filtro amplio a propósito: lo que deja pasar
 * lo confirma después una lectura completa antes de tocar la planilla. Acá no
 * hay segunda lectura, y medido contra descripciones reales ese filtro marcaba
 * cedulones, constancias de Catastro y capturas con «los datos para hacer una
 * transferencia», que son justo lo contrario de un pago hecho. Por eso este
 * detector pide que la descripción diga que el pago YA ocurrió.
 */

/** Se muestra como cualquier etiqueta y el equipo la quita a mano al registrar el pago. */
export const PAYMENT_RECEIPT_TAG = "registro-pago-pendiente";

/**
 * Las descripciones de imágenes son una oración y las de un PDF arrancan por
 * lo que es el documento. Lo que viene después puede nombrar un comprobante sin
 * serlo («…y enviar el comprobante a secretaría»).
 */
const NATURE_CHARS = 160;

/** Dice que todavía no se pagó: son los datos para pagar, no el pago. */
const BEFORE_PAYING =
  /datos (?:bancarios )?(?:para|de)\b|para (?:hacer|realizar|recibir|pagar)\b|\bno es un comprobante\b/i;

const PAID = [
  /\bcomprobantes?\b/i,
  /\brecibos? de (?:pago|cobranza|transferencia)\b/i,
  /\bticket de pago\b/i,
  /\b(?:detalle|confirmaci[oó]n|constancia) de (?:una |la |un |el )?(?:transferencia|pago)\b/i,
  /\btransferencia (?:bancaria )?(?:recibida|realizada|enviada|hecha)\b/i,
  /\bconfirm\w* (?:de )?(?:un |el |la )?pago\b/i,
  /\bpago (?:realizado|acreditado|aprobado|exitoso)\b/i,
];

/** ¿La descripción del adjunto dice que es la prueba de un pago hecho? */
export function isPaymentReceiptSummary(summary: string | null | undefined): boolean {
  const nature = (summary ?? "").slice(0, NATURE_CHARS);
  if (!nature.trim() || BEFORE_PAYING.test(nature)) return false;
  return PAID.some((pattern) => pattern.test(nature));
}
