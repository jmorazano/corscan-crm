/**
 * Eventos de la conversación (031): tipos y textos PUROS de las líneas grises
 * del hilo. Compartidos por el servidor (que traduce los errores al
 * registrarlos) y la bandeja (que los muestra).
 *
 * Regla: lo que se guarda en `details.detail` ya es texto nuestro, en
 * castellano llano. Nunca el cuerpo crudo de un proveedor.
 */

export type ConversationEventKind =
  | "ai_toggled"
  | "ai_silent"
  | "ai_resumed"
  | "ai_handoff"
  | "ai_error"
  /** 032: el agente ejecutó una herramienta que ESCRIBE en el sistema del tercero. */
  | "ai_tool_write";

export type HandoffReason = "cliente" | "modelo" | "error" | "ventana" | "visita";

export type SilentReason =
  | "team_active"
  | "paused"
  | "handoff"
  | "no_reply_needed"
  | "acknowledgment"
  | "known_contact"
  | "opted_out"
  | "standby"
  | "duplicate";

export type ToggleReason = "paused" | "enabled" | "reactivated";

export type ErrorReason = "tool" | "send" | "unexpected";

export type ConversationEventDetails = {
  /** ISO: desde cuándo vuelve a responder si el cliente escribe. */
  until?: string;
  /** Minutos de la ventana del equipo. */
  minutes?: number;
  /** Texto claro (ya traducido) del error o del motivo. */
  detail?: string;
  /** Atención humana vigente (silencio por handoff). */
  handoffReason?: HandoffReason;
  /** Lo que la IA iba a decir y no salió. */
  text?: string;
};

export type ConversationEventDto = {
  id: string;
  kind: ConversationEventKind;
  reason: string | null;
  actorName: string | null;
  details: ConversationEventDetails | null;
  createdAt: string;
};

export type EventTone = "neutral" | "brand" | "warning" | "error";

const HANDOFF_SHORT: Record<HandoffReason, string> = {
  cliente: "el cliente pidió una persona",
  modelo: "el agente decidió derivar",
  error: "falló el proveedor de IA",
  ventana: "ventana de 24 h cerrada",
  visita: "pidió coordinar una visita",
};

/** Motivos que frenan a la IA hasta que vence la ventana del equipo. */
export const BLOCKING_SILENCES: readonly SilentReason[] = ["team_active", "paused", "handoff"];

/**
 * Texto y tono de una línea. `formatTime` lo pone quien muestra (la bandeja
 * usa la hora local del navegador).
 */
export function eventText(
  ev: Pick<ConversationEventDto, "kind" | "reason" | "actorName" | "details">,
  formatTime: (iso: string) => string
): { text: string; tone: EventTone } {
  const d = ev.details ?? {};
  const who = ev.actorName?.trim() || "Alguien del equipo";
  const back = d.until
    ? ` Vuelve a responder si el cliente escribe desde las ${formatTime(d.until)}.`
    : "";
  switch (ev.kind) {
    case "ai_toggled":
      if (ev.reason === "paused") return { text: `${who} pausó la IA en este chat`, tone: "neutral" };
      if (ev.reason === "reactivated") {
        return { text: `${who} reactivó la IA (salió de atención humana)`, tone: "brand" };
      }
      return { text: `${who} activó la IA en este chat`, tone: "brand" };
    case "ai_resumed":
      return {
        text: `La IA retomó la conversación: pasaron ${d.minutes ?? 10} min sin que el equipo escriba.`,
        tone: "brand",
      };
    case "ai_silent":
      return { text: silentText(ev.reason as SilentReason, d, back), tone: "neutral" };
    case "ai_handoff":
      return handoffText(ev.reason as HandoffReason, d.detail);
    case "ai_error":
      if (ev.reason === "tool") {
        return { text: `El sistema de reservas no respondió: ${d.detail ?? "falló la consulta"}.`, tone: "warning" };
      }
      if (ev.reason === "send") {
        return { text: `La respuesta de la IA no salió: ${d.detail ?? "falló el envío"}.`, tone: "error" };
      }
      return { text: "La IA tuvo un error inesperado y no respondió.", tone: "error" };
    case "ai_tool_write":
      // `detail` lo arma el servidor con el rótulo del conector y el título
      // de la herramienta, ya saneados (nunca texto libre del tercero).
      return { text: `El agente registró en ${d.detail ?? "el sistema del cliente"}.`, tone: "brand" };
  }
}

function silentText(reason: SilentReason, d: ConversationEventDetails, back: string): string {
  switch (reason) {
    case "team_active":
      return `La IA no respondió: alguien del equipo está atendiendo.${back}`;
    case "paused":
      // 031: el switch apagado no vence — lo prende una persona.
      return "La IA no respondió: está pausada en este chat. Vuelve cuando alguien la prenda.";
    case "handoff":
      // 031: espera a que alguien del equipo responda; desde ahí corre la ventana.
      return `La IA no respondió: la conversación está en atención humana${
        d.handoffReason ? ` (${HANDOFF_SHORT[d.handoffReason]})` : ""
      }.${back || ` Vuelve sola ${d.minutes ?? 10} min después de que alguien del equipo responda.`}`;
    case "no_reply_needed":
      return d.detail
        ? `La IA leyó el mensaje y decidió no responder: ${d.detail}`
        : "La IA leyó el mensaje y decidió no responder.";
    case "acknowledgment":
      return "La IA no respondió: es un acuse de recibo de una notificación automática.";
    case "known_contact":
      return "La IA no responde a conocidos del celular (este WhatsApp es también tu número personal).";
    case "opted_out":
      return "La IA no responde: el contacto se dio de baja.";
    case "standby":
      return "La IA no puede responder: otra app maneja este chat de Instagram.";
    case "duplicate":
      return "La IA iba a repetir su último mensaje y no lo mandó.";
    default:
      return "La IA no respondió.";
  }
}

function handoffText(reason: HandoffReason, detail?: string): { text: string; tone: EventTone } {
  switch (reason) {
    case "cliente":
      return { text: "El cliente pidió hablar con una persona: la IA pasó la conversación a atención humana.", tone: "warning" };
    case "modelo":
      return {
        text: detail
          ? `La IA pasó la conversación a atención humana: ${detail}`
          : "La IA pasó la conversación a atención humana.",
        tone: "warning",
      };
    case "error":
      return {
        text: `La IA no pudo responder: ${detail ?? "falló el proveedor de IA"}. Pasó a atención humana.`,
        tone: "error",
      };
    case "ventana":
      return { text: "La ventana de 24 h está cerrada: la IA no puede escribir y pasó la conversación a atención humana.", tone: "warning" };
    case "visita":
      return { text: "El cliente pidió coordinar una visita: la IA pasó la conversación a atención humana.", tone: "warning" };
    default:
      return { text: "La IA pasó la conversación a atención humana.", tone: "warning" };
  }
}

/**
 * Error del proveedor de IA en criollo. `status` es el último HTTP que
 * devolvió (402 = sin crédito es el caso que más importa).
 */
export function friendlyProviderError(input: {
  error: string;
  status?: number;
}): string {
  if (input.error === "invalid_output") return "el modelo devolvió una respuesta que no se pudo leer";
  switch (input.status) {
    case 402:
      return "OpenRouter no tiene crédito suficiente (cargá saldo en openrouter.ai)";
    case 401:
    case 403:
      return "OpenRouter rechazó el token (revisalo en Ajustes → Inteligencia artificial)";
    case 404:
      return "el modelo configurado no existe en OpenRouter (revisalo en Ajustes → Inteligencia artificial)";
    case 429:
      return "OpenRouter limitó los pedidos (demasiadas consultas seguidas)";
    case 400:
      return "OpenRouter rechazó el pedido";
  }
  if (input.status === undefined || input.status === 408 || input.status >= 500) {
    return "OpenRouter no respondió (caído o demoró demasiado)";
  }
  return `falló el proveedor de IA (${input.status})`;
}

/** Falla de transporte del conector MCP (016) en criollo. */
export function friendlyToolFailure(code: string): string {
  switch (code) {
    case "timeout":
      return "tardó demasiado en contestar";
    case "unauthorized":
      return "rechazó la credencial (hay que cargar una nueva en Administración)";
    case "rate_limited":
      return "pidió esperar: demasiadas consultas seguidas";
    case "too_large":
      return "devolvió una respuesta demasiado grande";
    case "bad_payload":
      return "devolvió algo que no se pudo interpretar";
    case "not_allowed":
      return "esa consulta no está habilitada";
    case "internal_error":
      return "falló la consulta";
    default:
      return "no se pudo conectar";
  }
}

/** Fallo del envío de la respuesta de la IA en criollo. */
export function friendlySendError(code: string, message: string): string {
  switch (code) {
    case "meta_unavailable":
      return "Meta no está disponible ahora";
    case "reconnect_required":
      return "el token de WhatsApp expiró (reconectá el número en Ajustes)";
    case "not_connected":
      return "no hay número de WhatsApp conectado";
    case "opted_out":
      return "el contacto se dio de baja";
    case "meta_error":
      return `Meta rechazó el envío (${message.slice(0, 160)})`;
    default:
      return message.slice(0, 160) || "falló el envío";
  }
}

/**
 * Silencios repetidos no se apilan: si lo último registrado es el mismo
 * silencio y la IA no habló desde entonces, no hace falta otra línea.
 */
export function shouldSkipSilence(
  last: { kind: string; reason: string | null; createdAt: Date } | null,
  reason: SilentReason,
  lastAiReplyAt: Date | null
): boolean {
  if (!last || last.kind !== "ai_silent" || last.reason !== reason) return false;
  return !lastAiReplyAt || last.createdAt.getTime() > lastAiReplyAt.getTime();
}

/** Motivos que no dicen nada («modelo», «handoff»…): mejor la línea sin porqué. */
const EMPTY_REASON = /^(cliente|modelo|error|ventana|visita|humano|handoff|none|ninguno|n\/a)$/i;

/** Recorta texto libre (el motivo que da el modelo) para una línea del hilo. */
export function clipReason(text: string | null | undefined, max = 140): string | undefined {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t || EMPTY_REASON.test(t)) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
