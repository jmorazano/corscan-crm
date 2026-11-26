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
    // #10 subcode 2593184 — Meta niega TODO envío de la cuenta aunque el token
    // y los permisos estén bien. Caso real (Bosque Douglas, nov-2026, confirmado
    // por Meta Support): la cuenta de mensajes seguía pagando con la línea de
    // crédito del proveedor anterior (ManyChat). Reconectar o cargar una
    // tarjeta NO la saca: el proveedor anterior tiene que revocarla.
    pattern: /necessary permission to send messages on behalf of|2593184/i,
    friendly:
      "Meta no deja enviar desde esta cuenta de WhatsApp. La causa más común es que la cuenta todavía paga con la línea de crédito de un proveedor anterior (por ejemplo ManyChat): se ve en Meta Business → Facturación y pagos → Líneas de crédito. El proveedor anterior tiene que revocarla y después el dueño carga su propio método de pago; reconectar el número no lo arregla.",
  },
  {
    // 131042 — falta o falla el método de pago de la WABA. Meta frena TODO
    // envío de la cuenta (también el texto libre, que es gratis): el aviso no
    // debe sugerir que es culpa de un tipo de mensaje.
    pattern: /payment issue|payment method|eligibility payment/i,
    friendly:
      "Meta frenó todos los envíos de esta cuenta de WhatsApp por un problema de facturación (tarjeta rechazada, cobro pendiente o sin método de pago). No depende del mensaje: el dueño de la cuenta lo resuelve en WhatsApp Manager → Configuración → Métodos de pago, y después hay que reenviar.",
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
    // 131053 — Meta no pudo procesar el adjunto (formato, códec o tamaño).
    pattern: /media upload error|unsupported (media|file)|media (download|processing) (error|failed)/i,
    friendly:
      "WhatsApp no pudo procesar el archivo (formato, códec o tamaño no admitidos). Probá con otro formato: JPG o PNG para imágenes, MP4 (H.264) para videos, PDF para documentos.",
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

/**
 * Resumen de una falla «Meta no disponible» (5xx, corte de red o timeout)
 * para los logs, PURO. Antes el envío solo decía `meta_unavailable` y no se
 * podía saber si Meta contestó con un error, si se cortó la conexión o si
 * venció el plazo (caso Distrito, 26-nov-2026). Lleva SOLO metadatos: estado,
 * códigos, el mensaje de error de Meta recortado, el `fbtrace_id` (lo pide el
 * soporte de Meta) y la causa de red; jamás el cuerpo del envío ni el token.
 */
export function metaFailureSummary(
  err: {
    status: number;
    code: number | null;
    type: string | null;
    message: string;
    details: unknown;
  },
  elapsedMs?: number
): string {
  const parts: string[] = [`status=${err.status}`];
  if (err.status === 0) {
    parts.push(`causa=${networkCause(err.details) ?? oneLine(err.message)}`);
  } else {
    const body = graphErrorBody(err.details);
    if (err.code !== null) parts.push(`code=${err.code}`);
    if (body?.subcode !== undefined) parts.push(`subcode=${body.subcode}`);
    if (err.type) parts.push(`type=${err.type}`);
    parts.push(`msg=${JSON.stringify(oneLine(err.message))}`);
    if (body?.fbtraceId) parts.push(`fbtrace_id=${body.fbtraceId}`);
  }
  if (elapsedMs !== undefined) parts.push(`tras ${Math.round(elapsedMs)} ms`);
  return parts.join(" ");
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

/** `TimeoutError`, `TypeError: fetch failed (ECONNRESET)`… del `fetch`. */
function networkCause(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { name?: unknown; message?: unknown; cause?: unknown };
  const name = typeof d.name === "string" ? d.name : null;
  if (!name) return null;
  const cause = d.cause as { code?: unknown; message?: unknown } | undefined;
  const inner =
    cause && typeof cause === "object"
      ? typeof cause.code === "string"
        ? cause.code
        : typeof cause.message === "string"
          ? oneLine(cause.message)
          : null
      : null;
  const message = typeof d.message === "string" ? oneLine(d.message) : "";
  return inner ? `${name}: ${message} (${inner})` : message ? `${name}: ${message}` : name;
}

function graphErrorBody(
  details: unknown
): { subcode?: number; fbtraceId?: string } | null {
  if (!details || typeof details !== "object") return null;
  const error = (details as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const e = error as { error_subcode?: unknown; fbtrace_id?: unknown };
  return {
    ...(typeof e.error_subcode === "number" ? { subcode: e.error_subcode } : {}),
    ...(typeof e.fbtrace_id === "string" && /^[\w-]{1,64}$/.test(e.fbtrace_id)
      ? { fbtraceId: e.fbtrace_id }
      : {}),
  };
}
