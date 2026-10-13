/**
 * Equipo presente (031): reglas PURAS de cuándo el agente se calla porque
 * alguien del equipo está atendiendo, y cuándo vuelve solo.
 *
 * Decisión del dueño (6-oct-2026), tres situaciones distintas:
 * - **El equipo interviene** (escribe desde el CRM o el celular sin marcar
 *   nada): el agente se calla N minutos desde el último mensaje del equipo;
 *   pasado eso, si el cliente escribe, vuelve a responder.
 * - **Switch apagado** (pausa manual): decisión explícita — dura hasta que
 *   alguien lo prenda. Con la regla anterior ya no hace falta apagarlo para
 *   escribir; alcanza con escribir.
 * - **Atención humana** (la marca la IA: pidió una persona, derivó, falló el
 *   proveedor…): espera a que una PERSONA del equipo escriba. Desde ahí corre
 *   la regla del equipo y, al vencer, la IA retoma sola y la marca se limpia.
 *   Si nadie escribe, sigue esperando (el aviso push ya salió).
 *
 * Compartido por el turno del agente (servidor) y el panel de la bandeja.
 *
 * 036: al vencer la ventana del equipo el agente RETOMA solo si el cliente
 * quedó esperando una respuesta (`pendingAfterTeam`), y una difusión del
 * equipo (mismo texto a varios chats) no lo calla (`isBroadcast`).
 */

export const TEAM_SILENCE_DEFAULT_MS = 10 * 60_000;
export const TEAM_SILENCE_MIN_MS = 60_000;
/** Tope: un día. Más que eso ya es «la IA no atiende este chat»: para eso está el switch. */
export const TEAM_SILENCE_MAX_MS = 24 * 60 * 60_000;

/** Ventana efectiva de la empresa; un valor corrupto o NULL cae al default. */
export function resolveTeamSilenceMs(profileMs: number | null | undefined): number {
  if (profileMs === null || profileMs === undefined || !Number.isFinite(profileMs)) {
    return TEAM_SILENCE_DEFAULT_MS;
  }
  return Math.min(TEAM_SILENCE_MAX_MS, Math.max(TEAM_SILENCE_MIN_MS, Math.round(profileMs)));
}

/** Minutos (lo que edita la UI) → ms guardados; vacío = null (default). */
export function teamSilenceMinutesToMs(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const ms = Number(trimmed) * 60_000;
  if (ms < TEAM_SILENCE_MIN_MS || ms > TEAM_SILENCE_MAX_MS) return "invalid";
  return ms;
}

export function teamSilenceMsToMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * ¿Lo escribió una persona del equipo? Saliente, no generado por la IA, y con
 * autor humano: desde el CRM (`sentByUserId`) o desde el celular / la app
 * (`source` phone = ecos de WhatsApp e Instagram, history = historial
 * importado). Campañas, API pública, seguimientos automáticos y el
 * Entrenador no tienen autor: no callan al agente.
 */
export function isTeamMessage(m: {
  direction: string;
  aiGenerated: boolean;
  source?: string | null;
  sentByUserId?: string | null;
}): boolean {
  if (m.direction !== "out" || m.aiGenerated) return false;
  return m.source === "phone" || m.source === "history" || Boolean(m.sentByUserId);
}

export type SilenceReason = "paused" | "handoff" | "team_active";

export type Presence =
  /** `until` = desde cuándo vuelve si el cliente escribe; null = depende de una persona. */
  | { silent: true; reason: SilenceReason; until: Date | null }
  | { silent: false; resumed: "handoff" | null };

export type PresenceInput = {
  aiEnabled: boolean;
  handoffAt: Date | null;
  lastTeamAt: Date | null;
  now: Date;
  windowMs: number;
};

export function agentPresence(input: PresenceInput): Presence {
  // Switch apagado: no vence. Lo prende una persona.
  if (!input.aiEnabled) return { silent: true, reason: "paused", until: null };

  const teamUntil = input.lastTeamAt ? new Date(input.lastTeamAt.getTime() + input.windowMs) : null;
  const teamActive = teamUntil !== null && input.now.getTime() < teamUntil.getTime();

  if (input.handoffAt) {
    // Atención humana sin que nadie del equipo haya escrito DESPUÉS: espera.
    const attended =
      input.lastTeamAt !== null && input.lastTeamAt.getTime() >= input.handoffAt.getTime();
    if (!attended) return { silent: true, reason: "handoff", until: null };
    if (teamActive) return { silent: true, reason: "team_active", until: teamUntil };
    return { silent: false, resumed: "handoff" };
  }

  if (teamActive) return { silent: true, reason: "team_active", until: teamUntil };
  return { silent: false, resumed: null };
}

/**
 * 036: ¿el último mensaje del cliente llegó MIENTRAS el equipo atendía (y
 * nadie se lo contestó)? Es lo que convierte un turno normal en una RETOMA:
 * al vencer la ventana el agente responde solo si el cliente quedó esperando.
 * Un mensaje posterior a la ventana es una charla nueva, no una retoma.
 */
export function pendingAfterTeam(input: {
  lastTeamAt: Date | null;
  windowMs: number;
  lastInboundAt: Date;
}): boolean {
  if (!input.lastTeamAt) return false;
  const inbound = input.lastInboundAt.getTime();
  const team = input.lastTeamAt.getTime();
  return inbound > team && inbound < team + input.windowMs;
}

/**
 * 036 (decisión del dueño, 13-oct-2026): una DIFUSIÓN del equipo — el mismo
 * texto a varios chats a la vez, a gente que no venía escribiendo — no es
 * «alguien atendiendo»: el agente atiende las respuestas. El caso que la
 * motivó: «Se me libero este 👇» + enlace a ~8 contactos desde el celular
 * calló al agente en los 8 justo cuando le preguntaban el precio.
 *
 * Un texto repetido que RESPONDE a alguien que estaba escribiendo («Ya se
 * reservó, disculpas» a dos interesados) sigue siendo atender.
 */
export const BROADCAST_MIN_CONVERSATIONS = 3;
/** Ventana (a cada lado del mensaje) para contar los chats con el mismo texto. */
export const BROADCAST_SPAN_MS = 30 * 60_000;
/** Si el cliente escribió en esta ventana previa, el mensaje del equipo le responde. */
export const PROACTIVE_GAP_MS = 60 * 60_000;

/** Texto comparable de una difusión; null = sin texto (no se evalúa). */
export function broadcastKey(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t ? t : null;
}

export function isBroadcast(input: {
  text: string | null | undefined;
  /** ¿El cliente escribió en `PROACTIVE_GAP_MS` antes de este mensaje? */
  customerWroteBefore: boolean;
  /** Conversaciones DISTINTAS (incluida esta) con el mismo texto del equipo en ±`BROADCAST_SPAN_MS`. */
  sameTextConversations: number;
}): boolean {
  if (!broadcastKey(input.text)) return false;
  if (input.customerWroteBefore) return false;
  return input.sameTextConversations >= BROADCAST_MIN_CONVERSATIONS;
}

/**
 * Para el panel: qué tiene que pasar para que la IA vuelva a responder.
 * `null` = está respondiendo normalmente (o pausada: eso ya lo dice el switch).
 */
export function presenceHint(
  input: Omit<PresenceInput, "now">,
  now: Date = new Date()
): { kind: "until"; at: Date } | { kind: "needs_person"; minutes: number } | { kind: "next_message" } | null {
  const p = agentPresence({ ...input, now });
  if (p.silent) {
    if (p.until) return { kind: "until", at: p.until };
    if (p.reason === "handoff") return { kind: "needs_person", minutes: teamSilenceMsToMinutes(input.windowMs) };
    return null;
  }
  return p.resumed === "handoff" ? { kind: "next_message" } : null;
}
