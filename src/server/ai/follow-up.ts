import { z } from "zod";
import { chatJson, type AiConfig, type ChatMessage } from "@/lib/ai";
import { agentTextFor } from "@/lib/inbound-media";
import { outboundAgentText } from "@/lib/outbound-media";
import { stripUnknownContactData } from "@/lib/privacy-guard";
import { stripPrices } from "@/lib/price-guard";
import { stripBookingPromise } from "@/lib/promise-guard";
import { FOLLOW_UP_MAX_CHARS, type FollowUpStep } from "@/lib/follow-up";
import type { schema } from "@/lib/db";

/**
 * 042: el turno que REDACTA un seguimiento. Es propio (como el del
 * Entrenador): no es una respuesta a un mensaje del cliente, así que no pasa
 * por `runAgentTurn` — que además calla cuando lo último es del negocio.
 *
 * El texto pasa por las mismas guardas que una respuesta. Si alguna tuvo que
 * tocarlo, o el proveedor falló, o el modelo devolvió algo raro, se usa el
 * texto de respaldo: un recordatorio fijo bien escrito es mejor que uno
 * recortado. `none` = el agente decidió que no correspondía.
 */

/** Marcador del prompt: lo usa el ai-mock para reconocer este turno. */
export const FOLLOW_UP_MARKER = "[SEGUIMIENTO]";

const FollowUpAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({ action: z.literal("none"), reason: z.string().optional() }),
]);

type Profile = typeof schema.agentProfile.$inferSelect;
type Message = typeof schema.message.$inferSelect;

export type FollowUpDraft =
  | { kind: "text"; text: string; source: "agent" | "fallback"; note?: string }
  | { kind: "none"; reason: string | null };

export function buildFollowUpPrompt(input: {
  profile: Pick<Profile, "name" | "tone" | "instructions">;
  step: FollowUpStep;
  greetingName: string | null;
  fallback: string;
}): string {
  const { profile, step } = input;
  return [
    `${FOLLOW_UP_MARKER} Eres "${profile.name}" y atendés el WhatsApp de este negocio. El cliente dejó de contestar después de tu último mensaje y vas a escribirle un RECORDATORIO breve (seguimiento ${step} de 2).`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio (para el tono y el contexto):\n${profile.instructions}` : null,
    step === 1
      ? "Objetivo: retomar la charla desde donde quedó. Si le pediste datos (fechas, cantidad de personas…), recordáselo; si ya le pasaste opciones o precio, preguntale si pudo verlo o si le queda alguna duda."
      : "Objetivo: el último recordatorio. Dejale el contacto a disposición para más adelante, sin presionar, y despedite con calidez.",
    input.greetingName
      ? `Saludalo por su nombre: ${input.greetingName}.`
      : "Saludá sin nombre («¡Hola!»).",
    "Reglas duras:",
    `- Una o dos oraciones, como máximo ${FOLLOW_UP_MAX_CHARS} caracteres. En español, cercano, sin presionar.`,
    "- NO repitas lo que ya dijiste ni inventes datos: nada de precios, importes, disponibilidad, fechas, descuentos ni promociones nuevas.",
    "- NO digas que reservaste, confirmaste o anotaste nada.",
    "- NO pongas enlaces, teléfonos ni emails salvo que aparezcan en el ejemplo de abajo.",
    "- Si por la conversación un recordatorio no tiene sentido (ya resolvió, se despidió, pidió que no le escriban), no lo mandes.",
    `Ejemplo del negocio para este recordatorio (podés usarlo tal cual o adaptarlo a la charla): «${input.fallback}»`,
    "Respondé ÚNICAMENTE un objeto JSON:",
    '- {"action":"reply","text":"..."} — el recordatorio.',
    '- {"action":"none","reason":"..."} — no mandar nada (reason breve: lo ve solo el equipo).',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Historial del turno: el mismo texto que ve el agente (adjuntos incluidos). */
export function followUpHistory(messages: readonly Message[]): ChatMessage[] {
  return messages
    .map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content:
        m.direction === "in"
          ? agentTextFor({
              type: m.type,
              mediaState: m.mediaState,
              text: m.text,
              mediaSummary: m.mediaSummary,
              details: m.details,
            })
          : outboundAgentText({ type: m.type, text: m.text, status: m.status }),
    }))
    .filter((m): m is { role: "user" | "assistant"; content: string } => !!m.content);
}

const URL_RE = /\bhttps?:\/\/[^\s<>«»"]+|\bwww\.[^\s<>«»"]+/gi;

/**
 * Las guardas sobre el texto del modelo. Devuelve el texto si pasó intacto,
 * o null si alguna lo tuvo que tocar (→ respaldo).
 */
export function guardFollowUpText(
  text: string,
  ctx: { corpus: string; contactPhone: string | null; lastOutboundText: string | null }
): { text: string | null; why: string | null } {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return { text: null, why: "vacío" };
  if (trimmed.length > FOLLOW_UP_MAX_CHARS) return { text: null, why: "demasiado largo" };
  if (ctx.lastOutboundText && ctx.lastOutboundText.trim() === trimmed) return { text: null, why: "repetía el último mensaje" };
  const urls = trimmed.match(URL_RE) ?? [];
  if (urls.some((u) => !ctx.corpus.includes(u.replace(/[.,;:!?)]+$/, "")))) {
    return { text: null, why: "un enlace que no estaba en la charla" };
  }
  const privacy = stripUnknownContactData(trimmed, {
    corpus: ctx.corpus,
    extraPhones: ctx.contactPhone ? [ctx.contactPhone] : [],
  });
  if (privacy.replaced) return { text: null, why: "un dato de contacto ajeno" };
  if (stripPrices(trimmed).replaced) return { text: null, why: "un importe" };
  if (stripBookingPromise(trimmed).replaced) return { text: null, why: "una promesa de reserva" };
  return { text: trimmed, why: null };
}

/**
 * Redacta el seguimiento. Nunca lanza: cualquier problema del proveedor o del
 * texto termina en el respaldo.
 */
export async function draftFollowUp(input: {
  aiConfig: AiConfig | null;
  profile: Pick<Profile, "name" | "tone" | "instructions">;
  step: FollowUpStep;
  greetingName: string | null;
  fallback: string;
  history: readonly Message[];
  contactPhone: string | null;
}): Promise<FollowUpDraft> {
  const fallback = (note: string): FollowUpDraft => ({ kind: "text", text: input.fallback, source: "fallback", note });
  if (!input.aiConfig) return fallback("sin IA configurada");
  const system = buildFollowUpPrompt(input);
  const history = followUpHistory(input.history);
  try {
    const result = await chatJson(input.aiConfig, FollowUpAction, [{ role: "system", content: system }, ...history], {
      maxTokens: 400,
    });
    if (!result.ok) return fallback(`el proveedor no respondió (${result.error})`);
    if (result.data.action === "none") {
      return { kind: "none", reason: result.data.reason?.trim().slice(0, 200) || null };
    }
    const corpus = [system, ...history.map((m) => (typeof m.content === "string" ? m.content : ""))].join("\n");
    const lastOutbound = [...input.history].reverse().find((m) => m.direction === "out")?.text ?? null;
    const guarded = guardFollowUpText(result.data.text, {
      corpus,
      contactPhone: input.contactPhone,
      lastOutboundText: lastOutbound,
    });
    if (!guarded.text) return fallback(`el texto del modelo tenía ${guarded.why}`);
    return { kind: "text", text: guarded.text, source: "agent" };
  } catch (err) {
    console.error("[seguimiento] falló la redacción:", err instanceof Error ? err.message : err);
    return fallback("falló la redacción");
  }
}
