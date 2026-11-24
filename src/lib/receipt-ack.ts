/**
 * CRM-6 (053) — Acuse automático de comprobante en «Atención humana» o con la
 * IA del chat apagada. Reglas PURAS, sin I/O: las usa `runAgentTurn`.
 */
import { isPaymentReceiptSummary } from "./payment-receipt-tag";
import { RECEIPT_NOTES } from "./sheets";

export const RECEIPT_ACK_TEXT = "Recibí el comprobante, gracias. Ahora corroboramos el ingreso del pago.";

/** Tolera un comprobante que entró justo antes de la derivación mientras se leía. */
export const HANDOFF_RACE_MS = 2 * 60_000;
/** Un comprobante más viejo que esto no se acusa. */
export const RECEIPT_ACK_MAX_AGE_MS = 15 * 60_000;

export type AckMessage = {
  direction: string;
  type: string;
  createdAt: Date;
  aiGenerated: boolean;
  status: string;
  mediaState: string | null;
  mediaSummary: string | null;
  details: { standby?: boolean; storeOnly?: boolean } | null;
};

/** ¿Es un comprobante de pago leído (imagen o PDF)? `failed` solo no confirma nada. */
export function isReceiptMessage(m: Pick<AckMessage, "direction" | "type" | "mediaState" | "mediaSummary">): boolean {
  if (m.direction !== "in") return false;
  if (m.type !== "image" && m.type !== "document") return false;
  if (m.mediaState !== "ready") return false;
  const summary = m.mediaSummary ?? "";
  return (
    isPaymentReceiptSummary(summary) ||
    summary.includes(RECEIPT_NOTES.recorded) ||
    summary.includes(RECEIPT_NOTES.duplicate)
  );
}

/**
 * ¿Hay una imagen o PDF del cliente todavía en lectura (posterior a lo último
 * que mandó el negocio)? Mientras tanto no se puede decidir el acuse ni la
 * retoma: al terminar la lectura, `media.ts` suelta otro turno. Una lectura
 * trabada más de `RECEIPT_ACK_MAX_AGE_MS` ya no frena nada.
 */
export function hasPendingAttachment(
  history: ReadonlyArray<Pick<AckMessage, "direction" | "type" | "createdAt" | "mediaState" | "details">>,
  now: Date
): boolean {
  // No se corta en el último saliente: una plantilla de API, una campaña o una
  // difusión no responden al comprobante y la lectura sigue en curso. Los
  // documentos que solo se guardan (`storeOnly`) no reprograman el turno al
  // terminar, así que esperarlos dejaría al cliente sin respuesta.
  return history.some(
    (m) =>
      m.direction === "in" &&
      (m.type === "image" || m.type === "document") &&
      m.mediaState === "pending" &&
      !m.details?.storeOnly &&
      now.getTime() - m.createdAt.getTime() <= RECEIPT_ACK_MAX_AGE_MS
  );
}

/** ¿Hay que mandar el acuse fijo? `history` va en orden ascendente. */
export function needsReceiptAck(input: {
  enabled: boolean;
  history: ReadonlyArray<AckMessage>;
  aiEnabled: boolean;
  handoffAt: Date | null;
  lastTeamAt: Date | null;
  now: Date;
}): boolean {
  if (!input.enabled) return false;
  if (input.aiEnabled && !input.handoffAt) return false;

  let receipt: AckMessage | null = null;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const m = input.history[i]!;
    if (isReceiptMessage(m)) {
      receipt = m;
      break;
    }
  }
  if (!receipt) return false;

  const at = receipt.createdAt.getTime();
  if (input.now.getTime() - at > RECEIPT_ACK_MAX_AGE_MS) return false;
  if (input.aiEnabled && input.handoffAt && at < input.handoffAt.getTime() - HANDOFF_RACE_MS) return false;
  if (input.lastTeamAt && input.lastTeamAt.getTime() >= at) return false;
  const acked = input.history.some(
    (m) => m.direction === "out" && m.aiGenerated && m.status !== "failed" && m.createdAt.getTime() >= at
  );
  if (acked) return false;
  return !receipt.details?.standby;
}
