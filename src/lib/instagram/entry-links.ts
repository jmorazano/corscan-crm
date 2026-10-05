import { z } from "zod";

/**
 * Links con origen (030, US5) — PURO. Un link `ig.me/<cuenta>?ref=<slug>`
 * abre el chat de la cuenta y Meta nos avisa con qué `ref` llegó la persona
 * (`messaging_referral`). Con eso la conversación queda marcada con su origen
 * (un flyer, una campaña, la bio) y el agente arranca con contexto.
 */

/** Meta: hasta 2083 caracteres, solo letras, números, «-», «_» o «=». */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const ENTRY_LINK_INSTRUCTION_MAX = 500;

/** «Flyer Cabañas 2026» → «flyer-cabanas-2026». */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && SLUG_RE.test(slug);
}

/** El link que se comparte (formato de la doc de Meta). */
export function igMeLink(username: string, slug?: string | null): string {
  const base = `https://ig.me/m/${encodeURIComponent(username.replace(/^@/, ""))}`;
  return slug ? `${base}?ref=${encodeURIComponent(slug)}` : base;
}

/** La etiqueta de conversación que deja un link («ig-flyer-cabanas»). */
export function entryLinkTag(slug: string): string {
  return `ig-${slug}`.slice(0, 48);
}

export const AD_TAG = "ig-anuncio";
export const COMMENT_TAG = "ig-comentario";

export const entryLinkInput = z.object({
  label: z.string().trim().min(1, "Poné un nombre").max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((s) => s || undefined)
    .refine((s) => s === undefined || isValidSlug(s), "Solo letras, números y guiones (2 a 40)"),
  instruction: z
    .string()
    .trim()
    .max(ENTRY_LINK_INSTRUCTION_MAX)
    .nullable()
    .optional()
    .transform((s) => s || null),
});

export type EntryLinkInput = z.infer<typeof entryLinkInput>;

/** El `ref` que llegó en el webhook → el slug a buscar (o null). */
export function slugFromRef(ref: string | null | undefined): string | null {
  const r = ref?.trim().toLowerCase();
  return r && isValidSlug(r) ? r : null;
}
