/**
 * 048 — Quién atiende: reglas PURAS de las esperas (un cliente que necesita
 * a una persona), del aviso al propietario y del resumen de Métricas.
 * Sin I/O: lo usan `src/server/attention/*`, `src/server/metrics/team.ts` y
 * los tests.
 */
import { z } from "zod";
import { isCustomerTurnMessage } from "./inbound-media";

export type WaitReason = "handoff" | "ai_off";
export type WaitStatus = "open" | "answered" | "agent" | "expired";
export type ResponderVia = "crm" | "phone";

export const ATTENTION_DEFAULT_MINUTES = 15;
export const ATTENTION_MIN_MINUTES = 5;
export const ATTENTION_MAX_MINUTES = 120;
/** Ventana de atención de WhatsApp e Instagram: pasada, nadie puede responder texto libre. */
export const ATTENTION_WINDOW_MS = 24 * 60 * 60_000;
/**
 * Un mensaje del agente pegado a la derivación es su despedida, no una
 * vuelta: el reloj de la app (`handoff_at`) y el de la BD (`created_at`)
 * pueden diferir un poco.
 */
export const AGENT_GRACE_MS = 5_000;

export const attentionSettingsInput = z.object({
  alertEnabled: z.boolean(),
  alertMinutes: z.number().int().min(ATTENTION_MIN_MINUTES).max(ATTENTION_MAX_MINUTES),
});
export type AttentionSettings = z.infer<typeof attentionSettingsInput>;

export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
  alertEnabled: false,
  alertMinutes: ATTENTION_DEFAULT_MINUTES,
};

/**
 * ¿La conversación está en manos de una persona? Derivada (salvo por
 * `ventana`: ahí nadie puede responder texto libre) o con la IA apagada en
 * la conversación o en la empresa.
 */
export function needsPerson(input: {
  handoffAt: Date | null;
  handoffReason: string | null;
  aiEnabled: boolean;
  agentEnabled: boolean;
}): WaitReason | null {
  if (input.handoffAt) return input.handoffReason === "ventana" ? null : "handoff";
  if (!input.aiEnabled || !input.agentEnabled) return "ai_off";
  return null;
}

/** ¿Este mensaje entrante abre una espera? Devuelve el motivo o null. */
export function opensWaitOnInbound(input: {
  conversation: {
    isTest: boolean;
    kind: string;
    handoffAt: Date | null;
    handoffReason: string | null;
    aiEnabled: boolean;
  };
  message: { direction: string; type: string };
  /** `opted_out_source` del contacto si está dado de baja (NULL viejo = palabra clave). */
  optedOut: { source: string | null } | null;
  agentEnabled: boolean;
}): WaitReason | null {
  const { conversation } = input;
  if (conversation.isTest) return null;
  if (conversation.kind !== "whatsapp" && conversation.kind !== "instagram") return null;
  if (!isCustomerTurnMessage(input.message)) return null;
  // 011: la baja por palabra clave deja mudo al agente y no espera a nadie.
  // La baja que anotó el agente (042) sí espera: si vuelve, se le responde.
  if (input.optedOut && input.optedOut.source !== "agent") return null;
  return needsPerson({ ...conversation, agentEnabled: input.agentEnabled });
}

/** Un saliente posterior al inicio de la espera, con lo que hace falta para cerrarla. */
export type OutgoingForWait = {
  createdAt: Date;
  aiGenerated: boolean;
  sentByUserId: string | null;
  sentByName: string | null;
  source: string | null;
  status: string;
  /** 036: el mismo texto a muchos chats no es atención. */
  broadcast: boolean;
};

export type WaitClosure =
  | { status: "open" }
  | {
      status: "answered";
      closedAt: Date;
      responderUserId: string | null;
      responderName: string | null;
      responderVia: ResponderVia;
      responseMs: number;
    }
  | { status: "agent"; closedAt: Date }
  | { status: "expired"; closedAt: Date };

/** ¿Lo escribió una persona del equipo (desde el CRM o desde el celular)? */
export function isPersonReply(m: OutgoingForWait): boolean {
  if (m.aiGenerated || m.broadcast || m.status === "failed") return false;
  return m.sentByUserId !== null || m.source === "phone";
}

/**
 * Cómo termina (o no) una espera. Gana lo primero que pasó: una persona, el
 * agente o el cierre de la ventana de 24 h. En el mismo instante, la persona.
 */
export function closeWait(
  wait: { startedAt: Date; startReason: WaitReason },
  outgoing: ReadonlyArray<OutgoingForWait>,
  lastInboundAt: Date | null,
  now: Date
): WaitClosure {
  const start = wait.startedAt.getTime();
  const sorted = [...outgoing]
    .filter((m) => m.createdAt.getTime() >= start)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const person = sorted.find(isPersonReply);
  const agentFrom = wait.startReason === "handoff" ? start + AGENT_GRACE_MS : start;
  const agent = sorted.find(
    (m) => m.aiGenerated && m.status !== "failed" && m.createdAt.getTime() >= agentFrom
  );
  const windowEnd =
    lastInboundAt !== null ? lastInboundAt.getTime() + ATTENTION_WINDOW_MS : start + ATTENTION_WINDOW_MS;

  const personAt = person ? person.createdAt.getTime() : Infinity;
  const agentAt = agent ? agent.createdAt.getTime() : Infinity;

  if (person && personAt <= agentAt && personAt <= windowEnd) {
    return {
      status: "answered",
      closedAt: person.createdAt,
      responderUserId: person.sentByUserId,
      responderName: person.sentByUserId ? person.sentByName : null,
      responderVia: person.sentByUserId ? "crm" : "phone",
      responseMs: Math.max(0, personAt - start),
    };
  }
  if (agent && agentAt <= windowEnd) return { status: "agent", closedAt: agent.createdAt };
  if (now.getTime() >= windowEnd) return { status: "expired", closedAt: new Date(windowEnd) };
  return { status: "open" };
}

/** ¿Corresponde avisar ahora por esta espera? */
export function alertDue(
  wait: { status: WaitStatus; alertedAt: Date | null; startedAt: Date },
  settings: AttentionSettings,
  now: Date
): boolean {
  if (!settings.alertEnabled || wait.status !== "open" || wait.alertedAt) return false;
  return now.getTime() >= wait.startedAt.getTime() + settings.alertMinutes * 60_000;
}

/** «Tarde» = más que los minutos del aviso (justo los minutos = a tiempo). */
export function isLate(responseMs: number, lateMinutes: number): boolean {
  return responseMs > lateMinutes * 60_000;
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export type WaitForSummary = {
  status: WaitStatus;
  responseMs: number | null;
  responderUserId: string | null;
  responderName: string | null;
  responderVia: ResponderVia | null;
};

export type ResponderStats = {
  name: string | null;
  answered: number;
  late: number;
  medianResponseMs: number | null;
};

export type TeamAttentionSummary = {
  total: number;
  onTime: number;
  late: number;
  agent: number;
  unanswered: number;
  open: number;
  medianResponseMs: number | null;
  phone: { answered: number; medianResponseMs: number | null };
  platform: { answered: number };
};

/**
 * Totales del equipo y esperas por persona (clave: `responderKey`). Las
 * respondidas desde el celular van aparte (sin persona) y las de cuentas de
 * plataforma también (no son del equipo de la empresa).
 */
export function summarizeTeamAttention(
  waits: ReadonlyArray<WaitForSummary>,
  lateMinutes: number,
  platformUserIds: ReadonlySet<string> = new Set()
): { summary: TeamAttentionSummary; byUser: Map<string, ResponderStats> } {
  const summary: TeamAttentionSummary = {
    total: waits.length,
    onTime: 0,
    late: 0,
    agent: 0,
    unanswered: 0,
    open: 0,
    medianResponseMs: null,
    phone: { answered: 0, medianResponseMs: null },
    platform: { answered: 0 },
  };
  const all: number[] = [];
  const phone: number[] = [];
  const perUser = new Map<string, { name: string | null; times: number[]; late: number }>();

  for (const w of waits) {
    if (w.status === "agent") summary.agent += 1;
    else if (w.status === "expired") summary.unanswered += 1;
    else if (w.status === "open") summary.open += 1;
    if (w.status !== "answered" || w.responseMs === null) continue;

    const late = isLate(w.responseMs, lateMinutes);
    if (late) summary.late += 1;
    else summary.onTime += 1;
    all.push(w.responseMs);

    if (w.responderVia === "phone") {
      summary.phone.answered += 1;
      phone.push(w.responseMs);
      continue;
    }
    if (w.responderUserId && platformUserIds.has(w.responderUserId)) {
      summary.platform.answered += 1;
      continue;
    }
    const key = responderKey(w.responderUserId, w.responderName);
    if (!key) continue;
    const entry = perUser.get(key) ?? { name: w.responderName, times: [], late: 0 };
    entry.times.push(w.responseMs);
    if (late) entry.late += 1;
    entry.name = entry.name ?? w.responderName;
    perUser.set(key, entry);
  }

  summary.medianResponseMs = median(all);
  summary.phone.medianResponseMs = median(phone);
  const byUser = new Map<string, ResponderStats>();
  for (const [userId, e] of perUser) {
    byUser.set(userId, {
      name: e.name,
      answered: e.times.length,
      late: e.late,
      medianResponseMs: median(e.times),
    });
  }
  return { summary, byUser };
}

/**
 * Clave de una persona en el resumen: su id, o su nombre copiado si la
 * cuenta ya se eliminó (019 deja el id en NULL; el nombre sobrevive).
 */
export function responderKey(userId: string | null, name: string | null): string | null {
  if (userId) return userId;
  return name ? `name:${name}` : null;
}

/** «Tarde o sin respuesta»: lo que el propietario tiene que revisar. */
export function needsReview(
  w: { status: WaitStatus; responseMs: number | null },
  lateMinutes: number
): boolean {
  if (w.status === "expired") return true;
  return w.status === "answered" && w.responseMs !== null && isLate(w.responseMs, lateMinutes);
}

// ── Contratos de la API (los comparten el servidor y la UI) ────────────

export type WaitItem = {
  waitId: string;
  conversationId: string;
  contactName: string;
  channel: "whatsapp" | "instagram";
  startedAt: string;
  reason: WaitReason;
  status: WaitStatus;
  responseMs: number | null;
  responderName: string | null;
};

export type MemberAttentionRow = {
  /** null si la cuenta ya no existe (queda el nombre copiado). */
  userId: string | null;
  name: string;
  /** null = ya no está en el equipo. */
  role: "owner" | "member" | null;
  waitsAnswered: number;
  waitsLate: number;
  medianResponseMs: number | null;
  conversations: number;
  messages: number;
  lastMessageAt: string | null;
  lastSeenAt: string | null;
  push: { devices: number; modes: ("all" | "handoff")[] };
};

export type AttentionPeriod = {
  range: "day" | "week" | "year";
  timeZone: string;
  from: string;
  to: string;
  lateMinutes: number;
};

export type TeamAttention = AttentionPeriod & {
  summary: TeamAttentionSummary;
  waitingNow: WaitItem[];
  problems: WaitItem[];
  people: MemberAttentionRow[];
  truncated: boolean;
};

export type MyAttention = AttentionPeriod & { me: MemberAttentionRow };

/** Orden de la tabla: más esperas respondidas, después por nombre; los que se fueron al final. */
export function comparePeople(a: MemberAttentionRow, b: MemberAttentionRow): number {
  const gone = Number(a.role === null) - Number(b.role === null);
  if (gone !== 0) return gone;
  if (b.waitsAnswered !== a.waitsAnswered) return b.waitsAnswered - a.waitsAnswered;
  return a.name.localeCompare(b.name, "es");
}

/** «hace 5 min» / «hace 3 h» / «hace 2 días»; null → «nunca». */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "nunca";
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

/** Estado de los avisos de una persona, en criollo. */
export function pushStatusText(push: { devices: number; modes: ReadonlyArray<"all" | "handoff"> }): string {
  if (push.devices === 0) return "Sin avisos en ningún dispositivo";
  const devices = push.devices === 1 ? "1 dispositivo" : `${push.devices} dispositivos`;
  const what = push.modes.includes("all") ? "todos los mensajes" : "solo derivaciones";
  return `${devices} · ${what}`;
}
