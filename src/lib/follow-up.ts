/**
 * Seguimiento automático del agente (042): reglas PURAS, sin BD ni red.
 *
 * Un CICLO lo abre cada mensaje nuevo del cliente. Si el agente respondió,
 * dejó su respuesta marcada «espera respuesta» y el cliente se calló, salen
 * hasta dos recordatorios dentro de la ventana de 24 h de WhatsApp y en el
 * horario permitido de la empresa. Sin marca, no sale nada: el error seguro
 * es no escribirle a alguien.
 *
 * El estado no se duplica: la etapa del pipeline (`won`/`lost` = cerrada) y
 * la baja del contacto ya dicen lo que el documento del cliente llamaba
 * «Cerrada» y «No contactar»; lo único que falta es la marca del mensaje.
 */
import { normalizeContactName } from "@/lib/contact-name";
import { toLocalParts, zonedToUtc } from "@/lib/time";

export type FollowUpStep = 1 | 2;

export const FOLLOW_UP_WINDOW_MS = 24 * 60 * 60_000;
/** Margen antes del cierre de la ventana: Meta rechaza lo que llega tarde. */
export const FOLLOW_UP_WINDOW_MARGIN_MS = 10 * 60_000;
/** Seguimiento 1: horas desde el último mensaje del agente. */
export const FOLLOW_UP_1_AFTER_MS = 2 * 60 * 60_000;
/** Seguimiento 2: horas desde el último mensaje del CLIENTE… */
export const FOLLOW_UP_2_AFTER_CUSTOMER_MS = 20 * 60 * 60_000;
/** …y al menos esto después del seguimiento 1. */
export const FOLLOW_UP_2_AFTER_FIRST_MS = 3 * 60 * 60_000;
/** Antigüedad mínima del último saliente antes de decidir nada. */
export const FOLLOW_UP_SETTLE_MS = 2 * 60_000;
/** Tope del texto de un seguimiento (un recordatorio, no otra respuesta). */
export const FOLLOW_UP_MAX_CHARS = 400;

/**
 * Motivos de omisión. Los definitivos cierran el ciclo (no se vuelve a
 * evaluar); `customer_replied` se registra cuando el cliente escribió
 * mientras el modelo redactaba.
 */
export type FollowUpSkipReason =
  | "unmarked" // el agente no marcó su respuesta
  | "not_awaiting" // el agente marcó que no espera respuesta
  | "stage_closed" // el lead está en una etapa ganada o perdida
  | "opted_out" // el contacto está dado de baja
  | "team" // alguien del equipo escribió en el ciclo
  | "ai_off" // la IA está pausada o en atención humana en este chat
  | "refusal" // el filtro de seguridad vio un rechazo
  | "no_slot" // no hay horario permitido antes de que cierre la ventana
  | "not_agent" // lo último no lo mandó el agente (campaña, API…)
  | "agent_none" // el agente decidió que no correspondía
  | "customer_replied"; // el cliente escribió mientras se redactaba

export type FollowUpMessage = {
  id: string;
  direction: "in" | "out";
  type: string;
  createdAt: Date;
  text: string | null;
  aiGenerated: boolean;
  sentByUserId: string | null;
  source: string | null;
  details: { awaitingReply?: boolean; followUp?: { step: number } } | null;
};

export type FollowUpRecord = {
  step: number;
  status: "reserved" | "sent" | "skipped" | "failed";
  sentAt: Date | null;
};

export type FollowUpConfig = {
  timezone: string;
  startHour: number;
  endHour: number;
};

export type FollowUpSnapshot = {
  now: Date;
  config: FollowUpConfig;
  /** Mensajes de la conversación en orden cronológico (al menos los del ciclo). */
  messages: readonly FollowUpMessage[];
  /** Registros del ciclo actual (mismo `cycle_message_id`). */
  records: readonly FollowUpRecord[];
  stageKind: "open" | "won" | "lost" | null;
  optedOut: boolean;
  /** Switch de la IA en el chat encendido y sin atención humana vigente. */
  aiActive: boolean;
};

export type FollowUpDecision =
  | { kind: "send"; step: FollowUpStep; cycleMessageId: string }
  | { kind: "wait"; step: FollowUpStep; cycleMessageId: string; until: Date }
  | { kind: "skip"; step: FollowUpStep; cycleMessageId: string; reason: FollowUpSkipReason }
  | { kind: "done" };

/** Un mensaje del cliente que abre ciclo (una reacción no es un turno). */
export function isCustomerTurn(m: Pick<FollowUpMessage, "direction" | "type">): boolean {
  return m.direction === "in" && m.type !== "reaction";
}

/**
 * Saliente escrito por una persona del equipo: desde el CRM con su usuario,
 * o desde el celular (coexistencia / historial). Mismo criterio que 031.
 */
export function isTeamOutbound(m: Pick<FollowUpMessage, "direction" | "aiGenerated" | "sentByUserId" | "source">): boolean {
  if (m.direction !== "out" || m.aiGenerated) return false;
  return m.sentByUserId !== null || m.source === "phone" || m.source === "history";
}

export function isFollowUpMessage(m: Pick<FollowUpMessage, "details">): boolean {
  return typeof m.details?.followUp?.step === "number";
}

/**
 * Qué hacer AHORA con una conversación. Todas las condiciones de la spec en
 * orden; ante la duda, no se manda.
 */
export function followUpDecision(s: FollowUpSnapshot): FollowUpDecision {
  const lastCustomerIndex = findLastIndex(s.messages, isCustomerTurn);
  if (lastCustomerIndex < 0) return { kind: "done" };
  const lastCustomer = s.messages[lastCustomerIndex]!;
  const cycleMessageId = lastCustomer.id;
  const after = s.messages.slice(lastCustomerIndex + 1).filter((m) => m.direction === "out");
  const last = after[after.length - 1];
  // El agente todavía no respondió (o lo último es del cliente): su turno decide.
  if (!last) return { kind: "done" };

  const record1 = s.records.find((r) => r.step === 1) ?? null;
  const record2 = s.records.find((r) => r.step === 2) ?? null;
  // Un turno del agente puede mandar más de un mensaje (respuesta y después
  // la confirmación de una reserva): se decide con el turno ya asentado.
  if (s.now.getTime() - last.createdAt.getTime() < FOLLOW_UP_SETTLE_MS) return { kind: "done" };

  // Cualquier cosa distinta de «enviado» en el 1 cierra el ciclo (el 2
  // depende del 1); un 2 ya registrado también.
  if (record1 && record1.status !== "sent") return { kind: "done" };
  if (record2) return { kind: "done" };
  const step: FollowUpStep = record1 ? 2 : 1;
  const skip = (reason: FollowUpSkipReason): FollowUpDecision => ({ kind: "skip", step, cycleMessageId, reason });

  if (after.some(isTeamOutbound)) return skip("team");
  if (!last.aiGenerated) return skip("not_agent");
  if (s.optedOut) return skip("opted_out");
  if (s.stageKind === "won" || s.stageKind === "lost") return skip("stage_closed");
  if (!s.aiActive) return skip("ai_off");
  if (matchesRefusal(lastCustomer.text)) return skip("refusal");

  // La respuesta del agente que abrió la espera (no un seguimiento).
  const agentReplies = after.filter((m) => m.aiGenerated && !isFollowUpMessage(m));
  const agentReply = agentReplies[agentReplies.length - 1];
  if (!agentReply) return skip("not_agent");
  const mark = agentReply.details?.awaitingReply;
  if (mark === undefined) return skip("unmarked");
  if (mark !== true) return skip("not_awaiting");

  const windowLimit = lastCustomer.createdAt.getTime() + FOLLOW_UP_WINDOW_MS - FOLLOW_UP_WINDOW_MARGIN_MS;
  let due: number;
  if (step === 1) {
    due = agentReply.createdAt.getTime() + FOLLOW_UP_1_AFTER_MS;
  } else {
    // Un 1 reservado en otra réplica todavía no tiene `sentAt`: esperar.
    if (!record1?.sentAt) return { kind: "done" };
    due = Math.max(
      lastCustomer.createdAt.getTime() + FOLLOW_UP_2_AFTER_CUSTOMER_MS,
      record1.sentAt.getTime() + FOLLOW_UP_2_AFTER_FIRST_MS
    );
  }

  const { timezone, startHour, endHour } = s.config;
  const from = new Date(Math.max(due, s.now.getTime()));
  const slot = allowedSlot(from, timezone, startHour, endHour);
  if (slot.getTime() >= windowLimit) return skip("no_slot");
  if (slot.getTime() > s.now.getTime()) return { kind: "wait", step, cycleMessageId, until: slot };
  return { kind: "send", step, cycleMessageId };
}

/**
 * El primer instante ≥ `at` dentro del horario permitido (hora local de la
 * empresa; `endHour` excluido). Un horario inválido (inicio ≥ fin) no deja
 * ningún hueco: devuelve un instante lejano y el seguimiento se omite.
 */
export function allowedSlot(at: Date, timeZone: string, startHour: number, endHour: number): Date {
  if (!(startHour >= 0 && endHour <= 24 && startHour < endHour)) {
    return new Date(at.getTime() + 365 * FOLLOW_UP_WINDOW_MS);
  }
  const p = toLocalParts(timeZone, at);
  if (p.hour >= startHour && p.hour < endHour) return at;
  if (p.hour < startHour) return zonedToUtc(timeZone, p.year, p.month, p.day, startHour, 0);
  // Después del cierre: la apertura del día local siguiente. El mediodía
  // local + 24 h cae siempre en el día siguiente, aun con cambio de hora.
  const noon = zonedToUtc(timeZone, p.year, p.month, p.day, 12, 0);
  const next = toLocalParts(timeZone, new Date(noon.getTime() + FOLLOW_UP_WINDOW_MS));
  return zonedToUtc(timeZone, next.year, next.month, next.day, startHour, 0);
}

/** ¿`at` cae dentro del horario permitido? */
export function isAllowedHour(at: Date, timeZone: string, startHour: number, endHour: number): boolean {
  return allowedSlot(at, timeZone, startHour, endHour).getTime() === at.getTime();
}

// ── Filtro de seguridad ──────────────────────────────────────────────────

/** Frases del documento del cliente: cuentan en cualquier parte del mensaje. */
const REFUSAL_PHRASES = [
  "no me interesa",
  "no me escribas",
  "no me escriban",
  "dejen de escribir",
  "deja de escribir",
  "deja de escribirme",
  "dejen de escribirme",
  "no quiero recibir",
  "no me molesten",
  "no me molestes",
  "de baja",
  "sacame de",
];

/**
 * Palabras sueltas: SOLO en un mensaje corto (≤ 3 palabras) que no sea una
 * pregunta. Así «basta», «stop!!» o «baja por favor» frenan, y «¿baja el
 * precio?» o «me gusta bastante» no.
 */
const REFUSAL_WORDS = new Set(["basta", "stop", "baja", "sacame", "spam"]);
const SHORT_MESSAGE_WORDS = 3;

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** ¿El mensaje del cliente rechaza que le sigan escribiendo? */
export function matchesRefusal(text: string | null | undefined): boolean {
  if (!text) return false;
  const norm = normalizeForMatch(text);
  if (!norm) return false;
  const padded = ` ${norm} `;
  if (REFUSAL_PHRASES.some((p) => padded.includes(` ${p} `))) return true;
  const words = norm.split(" ");
  if (words.length > SHORT_MESSAGE_WORDS || text.includes("?")) return false;
  return words.some((w) => REFUSAL_WORDS.has(w));
}

// ── Textos ───────────────────────────────────────────────────────────────

/** Primeras palabras que delatan que el perfil no es el nombre de una persona. */
const NOT_A_FIRST_NAME = new Set([
  "familia",
  "flia",
  "fam",
  "sr",
  "sra",
  "srta",
  "dr",
  "dra",
  "ing",
  "arq",
  "lic",
  "hotel",
  "cabanas",
  "cabana",
  "inmobiliaria",
  "estudio",
  "grupo",
  "empresa",
  "servicio",
  "servicios",
  "tienda",
  "local",
  "mama",
  "papa",
  "abuela",
  "abuelo",
  "amor",
]);

/**
 * El primer nombre del perfil, bien escrito («JUAN perez» → «Juan»), o null
 * si el perfil no parece el nombre de una persona (emoji, número, «Familia
 * Gómez», una razón social…). Con null el saludo queda «¡Hola!».
 */
export function greetingName(name: string | null | undefined): string | null {
  const valid = normalizeContactName(name ?? "");
  if (!valid) return null;
  const first = valid.split(" ")[0] ?? "";
  if (!/^\p{L}[\p{L}'-]*$/u.test(first) || first.length < 2) return null;
  if (NOT_A_FIRST_NAME.has(normalizeForMatch(first))) return null;
  return first
    .split("-")
    .map((part) => (part ? part[0]!.toLocaleUpperCase("es") + part.slice(1).toLocaleLowerCase("es") : part))
    .join("-");
}

/** Textos de respaldo del CRM (la empresa los cambia en /agent). */
export const DEFAULT_FOLLOW_UP_TEXTS: Record<FollowUpStep, string> = {
  1: "¡Hola, {nombre}! 😊 ¿Pudiste ver lo que te pasé? Si te queda alguna duda, escribime y lo vemos.",
  2: "¡Hola, {nombre}! Te dejo por acá el contacto por si más adelante querés consultar. Cuando quieras, escribime 😊",
};

export const NAME_PLACEHOLDER = "{nombre}";

/** El texto de respaldo con el nombre, o sin él («¡Hola, {nombre}!» → «¡Hola!»). */
export function fallbackText(step: FollowUpStep, name: string | null, custom: string | null | undefined): string {
  const template = custom?.trim() || DEFAULT_FOLLOW_UP_TEXTS[step];
  const rendered = name
    ? template.split(NAME_PLACEHOLDER).join(name)
    : template.replace(/,?[ \t]*\{nombre\}/g, "");
  return rendered.replace(/[ \t]{2,}/g, " ").trim();
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}

// ── Registro ─────────────────────────────────────────────────────────────

/** Motivos en castellano (registro, CSV y resumen de /agent). */
export const FOLLOW_UP_REASON_LABELS: Record<FollowUpSkipReason, string> = {
  unmarked: "el agente no marcó si esperaba respuesta",
  not_awaiting: "el agente no esperaba respuesta",
  stage_closed: "el lead está ganado o perdido",
  opted_out: "el contacto está dado de baja",
  team: "intervino alguien del equipo",
  ai_off: "la IA estaba pausada o en atención humana",
  refusal: "el cliente pidió que no le escriban (filtro)",
  no_slot: "no quedaba horario antes de que cierre la ventana",
  not_agent: "lo último no lo mandó el agente",
  agent_none: "la IA decidió no mandarlo",
  customer_replied: "el cliente escribió mientras se redactaba",
};

export function followUpReasonLabel(reason: string | null): string {
  if (!reason) return "";
  return (FOLLOW_UP_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

/** Una celda de CSV: comillas dobles y, si empieza como fórmula, como texto. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let v = String(value).replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(v) && !/^[+-]?\d[\d.,]*$/.test(v)) v = `'${v}`;
  return /[",;]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}
