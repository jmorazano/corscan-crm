/**
 * Traducción amable de los errores de entrega de Meta (010). Puro y
 * compartido: la burbuja de la bandeja y el detalle de campaña muestran LA
 * MISMA explicación. Meta manda el texto en inglés dentro del webhook de
 * estados (se persiste crudo en message.error); acá se mapean los casos que
 * el operador puede accionar. Un error no catalogado se muestra tal cual —
 * honesto antes que mudo.
 */

const KNOWN: { pattern: RegExp; friendly: string }[] = [
  {
    // 131042 — falta o falla el método de pago de la WABA.
    pattern: /payment issue|payment method|eligibility payment/i,
    friendly:
      "Problema de facturación en Meta: revisá el método de pago de la cuenta de WhatsApp (las plantillas de marketing se cobran).",
  },
  {
    // 131049 — límite de frecuencia de marketing POR destinatario.
    pattern: /healthy ecosystem engagement|marketing message limit/i,
    friendly:
      "Meta pausó el marketing hacia este contacto por límite de frecuencia. Es temporal (horas o un día): reintentá más tarde o pedile que te escriba.",
  },
  {
    // 131026 — el número no puede recibir (sin WhatsApp, bloqueó, app vieja).
    pattern: /undeliverable|not a whatsapp user|unable to deliver/i,
    friendly:
      "El número no puede recibir el mensaje: puede no tener WhatsApp, haber bloqueado al negocio o tener la app desactualizada.",
  },
  {
    // 131047 — ventana de 24h cerrada para mensaje libre.
    pattern: /re-engagement|24 hour|customer service window/i,
    friendly:
      "La ventana de 24 horas está cerrada: para retomar hay que enviar una plantilla aprobada.",
  },
  {
    // 131048/131056 — spam rate limit del número emisor.
    pattern: /spam rate|too many messages|rate limit/i,
    friendly:
      "Meta limitó temporalmente los envíos del número por volumen: bajá el ritmo y reintentá más tarde.",
  },
];

/** Devuelve la explicación amable, o el texto crudo si no está catalogado. */
export function friendlyDeliveryError(
  raw: string | null | undefined
): string | null {
  const text = raw?.trim();
  if (!text) return null;
  for (const k of KNOWN) {
    if (k.pattern.test(text)) return k.friendly;
  }
  return text;
}
