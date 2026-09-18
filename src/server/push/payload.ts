/**
 * Payloads de Web Push (013): funciones puras, testeables sin BD ni red.
 * El service worker (`public/sw.js`) muestra exactamente estos campos.
 */

export type PushPayload = {
  kind: "inbound" | "handoff" | "test";
  title: string;
  body: string;
  /** Agrupa: varios mensajes del mismo chat reemplazan la notificación. */
  tag: string;
  /** Ruta a abrir al tocar (relativa al origen de la app). */
  url: string;
  /** Ícono de la marca (relativo). */
  icon?: string;
};

export type PushMode = "all" | "handoff";

export const MAX_BODY_CHARS = 120;

const MEDIA_LABELS: Record<string, string> = {
  image: "📎 Imagen",
  audio: "🎤 Audio",
  video: "📎 Video",
  document: "📎 Documento",
  sticker: "Sticker",
  location: "📍 Ubicación",
  contacts: "👤 Contacto compartido",
  template: "Plantilla",
};

const HANDOFF_LABELS: Record<string, string> = {
  cliente: "El cliente pidió hablar con una persona",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24 h cerrada",
};

export function truncateBody(text: string, max = MAX_BODY_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function messagePreview(type: string, text: string | null): string {
  if (type === "text" && text) return truncateBody(text);
  const label = MEDIA_LABELS[type] ?? "Nuevo mensaje";
  return text ? truncateBody(`${label} — ${text}`) : label;
}

export function conversationUrl(conversationId: string): string {
  return `/inbox?c=${encodeURIComponent(conversationId)}`;
}

export function buildInboundPayload(input: {
  contactName: string;
  conversationId: string;
  type: string;
  text: string | null;
  icon?: string;
}): PushPayload {
  return {
    kind: "inbound",
    title: input.contactName,
    body: messagePreview(input.type, input.text),
    tag: `conv:${input.conversationId}`,
    url: conversationUrl(input.conversationId),
    icon: input.icon,
  };
}

export function buildHandoffPayload(input: {
  contactName: string;
  conversationId: string;
  reason: string;
  icon?: string;
}): PushPayload {
  return {
    kind: "handoff",
    title: `Atención humana: ${input.contactName}`,
    body: HANDOFF_LABELS[input.reason] ?? "La IA está en pausa en esta conversación.",
    tag: `conv:${input.conversationId}`,
    url: conversationUrl(input.conversationId),
    icon: input.icon,
  };
}

export function buildTestPayload(input: { appName: string; icon?: string }): PushPayload {
  return {
    kind: "test",
    title: `${input.appName}: notificaciones activas`,
    body: "Así vas a enterarte de los mensajes nuevos en este dispositivo.",
    tag: "test",
    url: "/settings/notifications",
    icon: input.icon,
  };
}

/**
 * Filtro por modo (FR-005): `all` avisa todo entrante; `handoff` solo
 * cuando la conversación ya está en manos humanas (IA en pausa o escalada).
 */
export function shouldNotifyInbound(
  mode: PushMode,
  conversation: { aiEnabled: boolean; handoffAt: Date | string | null }
): boolean {
  if (mode === "all") return true;
  return !conversation.aiEnabled || conversation.handoffAt !== null;
}

/** El push service dice que la suscripción ya no existe (FR-008). */
export function isGoneStatus(status: number | null): boolean {
  return status === 404 || status === 410;
}
