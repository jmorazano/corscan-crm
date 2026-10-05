import { z } from "zod";
import type { IgMenuItem } from "./types";

/**
 * Primer contacto (030, US4) — PURO: preguntas frecuentes (ice breakers) y
 * menú fijo de Instagram. Validación del formulario y payloads de
 * `/<IG_ID>/messenger_profile`.
 */

/** Meta: «4 questions can be set via the Ice Breaker API». */
export const ICE_BREAKERS_MAX = 4;
export const ICE_BREAKER_MAX_CHARS = 80;
/** Meta recomienda hasta 5 opciones de menú. */
export const MENU_ITEMS_MAX = 5;
export const MENU_TITLE_MAX = 30;

/** Postback del menú «Hablar con una persona»: escala sin pasar por el modelo. */
export const HUMAN_PAYLOAD = "VOCERO_HUMAN";

export function isHumanPayload(payload: string | null | undefined): boolean {
  return payload === HUMAN_PAYLOAD;
}

const httpsUrl = z
  .string()
  .trim()
  .url("El enlace no es una URL válida")
  .refine((u) => u.startsWith("https://"), "El enlace tiene que empezar con https://");

export const messagingProfileInput = z.object({
  iceBreakers: z
    .array(z.string().trim().max(ICE_BREAKER_MAX_CHARS, `Cada pregunta admite hasta ${ICE_BREAKER_MAX_CHARS} caracteres`))
    .max(ICE_BREAKERS_MAX, `Instagram admite hasta ${ICE_BREAKERS_MAX} preguntas`)
    .default([]),
  menu: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("question"), title: z.string().trim().min(1).max(MENU_TITLE_MAX) }),
        z.object({ type: z.literal("link"), title: z.string().trim().min(1).max(MENU_TITLE_MAX), url: httpsUrl }),
        z.object({ type: z.literal("human"), title: z.string().trim().min(1).max(MENU_TITLE_MAX) }),
      ])
    )
    .max(MENU_ITEMS_MAX, `El menú admite hasta ${MENU_ITEMS_MAX} opciones`)
    .default([]),
});

export type MessagingProfileInput = z.infer<typeof messagingProfileInput>;

/** Limpia: sin vacías, sin repetidas. */
export function cleanIceBreakers(list: readonly string[]): string[] {
  const seen = new Set<string>();
  return list
    .map((q) => q.trim())
    .filter((q) => {
      const k = q.toLowerCase();
      if (!q || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, ICE_BREAKERS_MAX);
}

export function iceBreakersBody(questions: readonly string[]) {
  return {
    platform: "instagram",
    ice_breakers: [
      {
        locale: "default",
        call_to_actions: questions.map((question, i) => ({ question, payload: `VOCERO_IB_${i}` })),
      },
    ],
  };
}

export function persistentMenuBody(items: readonly IgMenuItem[]) {
  return {
    platform: "instagram",
    persistent_menu: [
      {
        locale: "default",
        call_to_actions: items.map((item, i) =>
          item.type === "link"
            ? { type: "web_url", title: item.title, url: item.url }
            : {
                type: "postback",
                title: item.title,
                payload: item.type === "human" ? HUMAN_PAYLOAD : `VOCERO_MENU_${i}`,
              }
        ),
      },
    ],
  };
}
