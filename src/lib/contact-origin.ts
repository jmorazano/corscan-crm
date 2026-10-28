import { z } from "zod";
import { normalizeForMatch } from "@/lib/follow-up";
import { MAX_TAG_LENGTH } from "@/lib/tags";
import { toLocalParts } from "@/lib/time";

/**
 * Etiquetas de origen en el CONTACTO (043) — PURO.
 *
 * Las campañas (004) eligen destinatarios por etiquetas del contacto; el
 * origen de un anuncio (035) vive en la conversación. Para poder retomar «a
 * los que llegaron por el anuncio de octubre», el origen deja además una
 * etiqueta canal + mes en el contacto:
 * - anuncio Click-to-WhatsApp de Meta → `meta-ads-AAAA-MM` (mes del clic);
 * - regla por frase de la empresa («vi el anuncio en Google» → `google-ads`),
 *   con el mes por defecto: Google no manda `referral`, solo llega el texto
 *   precargado del enlace `wa.me`.
 *
 * El mes se corta en hora de Argentina: un clic del 31 a las 23 h es de ese
 * mes, no del siguiente (UTC).
 */

export const ORIGIN_TIMEZONE = "America/Argentina/Cordoba";

/** Base de la etiqueta que deja un anuncio de Meta en el contacto. */
export const META_ADS_TAG = "meta-ads";

/** `-AAAA-MM` ocupa 8: la base deja lugar para que entre en los 40 de 004. */
export const ORIGIN_TAG_BASE_MAX = MAX_TAG_LENGTH - 8;
export const ORIGIN_PHRASE_MIN = 3;
export const ORIGIN_PHRASE_MAX = 80;
export const MAX_ORIGIN_RULES = 20;

/** Una charla se «abre» si el cliente no escribía hace 24 h (o nunca). */
export const OPENING_GAP_MS = 24 * 60 * 60_000;

/** `AAAA-MM` del instante en la zona dada. */
export function originMonth(at: Date, timeZone: string = ORIGIN_TIMEZONE): string {
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const p = toLocalParts(timeZone, when);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** La etiqueta que queda en el contacto: base sola o base + mes. */
export function originTag(
  base: string,
  at: Date,
  appendMonth = true,
  timeZone: string = ORIGIN_TIMEZONE
): string {
  return appendMonth ? `${base}-${originMonth(at, timeZone)}` : base;
}

/**
 * Etiqueta base de una regla: minúsculas, sin tildes, espacios → guiones,
 * solo `[a-z0-9-_]`, sin guiones sueltos en los bordes. `null` si no queda
 * nada.
 */
export function sanitizeRuleTag(raw: string): string | null {
  const tag = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^#+/, "")
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ORIGIN_TAG_BASE_MAX)
    .replace(/[-_]+$/g, "");
  return tag || null;
}

/** Frase tal como se compara: sin mayúsculas, tildes ni puntuación. */
export function normalizeOriginText(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, " ");
}

export const originRuleInput = z
  .object({
    phrase: z.string().trim().min(ORIGIN_PHRASE_MIN).max(ORIGIN_PHRASE_MAX),
    tag: z.string().trim().min(1).max(80),
    appendMonth: z.boolean().default(true),
  })
  .transform((v, ctx) => {
    const tag = sanitizeRuleTag(v.tag);
    if (!tag) {
      ctx.addIssue({ code: "custom", path: ["tag"], message: "La etiqueta necesita letras o números." });
      return z.NEVER;
    }
    if (normalizeOriginText(v.phrase).length < ORIGIN_PHRASE_MIN) {
      ctx.addIssue({ code: "custom", path: ["phrase"], message: "La frase necesita letras o números." });
      return z.NEVER;
    }
    return { phrase: v.phrase.replace(/\s+/g, " "), tag, appendMonth: v.appendMonth };
  });

export type OriginRuleInput = z.output<typeof originRuleInput>;

export type OriginRule = { phrase: string; tag: string; appendMonth: boolean };

/**
 * Las etiquetas que dejan las reglas que coinciden con el texto (todas, sin
 * repetir). Coincidencia por palabras completas: «google» no coincide con
 * «googleado».
 */
export function matchOriginRules(
  text: string | null | undefined,
  rules: readonly OriginRule[],
  at: Date,
  timeZone: string = ORIGIN_TIMEZONE
): string[] {
  if (!text) return [];
  const haystack = ` ${normalizeOriginText(text)} `;
  if (!haystack.trim()) return [];
  const tags = new Set<string>();
  for (const rule of rules) {
    const needle = normalizeOriginText(rule.phrase);
    const base = sanitizeRuleTag(rule.tag);
    if (!needle || !base) continue;
    if (haystack.includes(` ${needle} `)) {
      tags.add(originTag(base, at, rule.appendMonth, timeZone));
    }
  }
  return [...tags];
}

/**
 * ¿Este mensaje abre la charla? El primero de la conversación o el primero
 * tras 24 h sin mensajes del cliente: el texto precargado de un `wa.me`
 * siempre es ese, y así una frase dicha en medio de una charla no etiqueta.
 */
export function opensConversation(previousInboundAt: Date | null, at: Date): boolean {
  if (!previousInboundAt) return true;
  return at.getTime() - previousInboundAt.getTime() >= OPENING_GAP_MS;
}

/** Ejemplo de la etiqueta que deja una regla (para la pantalla). */
export function originTagExample(rule: OriginRule, now: Date = new Date()): string {
  const base = sanitizeRuleTag(rule.tag) ?? "";
  return base ? originTag(base, now, rule.appendMonth) : "";
}
