import { z } from "zod";

/**
 * Reglas PURAS de las respuestas a comentarios (030, US1/US2). Sin red ni
 * base: qué comentario dispara qué regla, cómo se comparan las palabras y qué
 * acepta el formulario. El motor (`src/server/instagram/comments.ts`) solo
 * ejecuta lo que esto decide.
 */

/** Meta: «The message must be sent within 7 days of the comment». */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Meta permite 750 por hora y cuenta; dejamos margen. */
export const PRIVATE_REPLIES_PER_HOUR = 700;
export const COMMENT_DM_MAX_BYTES = 1000;
export const COMMENT_BUTTON_MAX = 20;
export const COMMENT_PUBLIC_REPLY_MAX = 300;
export const MAX_KEYWORDS = 20;
export const MAX_PUBLIC_REPLIES = 5;
export const MAX_RULE_MEDIA = 20;
export const MAX_MODERATION_WORDS = 50;

/** Minúsculas, sin tildes y con los espacios colapsados. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** «ALGO, info\nprecio» → ["ALGO", "info", "precio"] (sin repetidos). */
export function parseWordList(input: string | readonly string[], max: number): string[] {
  const raw = typeof input === "string" ? input.split(/[,\n]/) : [...input];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const word = item.trim().slice(0, 40);
    const key = normalizeForMatch(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ¿El texto contiene alguna de las palabras? Palabra o frase COMPLETA, sin
 * mayúsculas ni tildes: «info» dispara con «Info!» pero no con «informal».
 * Una lista vacía coincide con todo (regla «cualquier comentario»).
 */
export function matchesWords(text: string | null, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const hay = normalizeForMatch(text ?? "");
  if (!hay) return false;
  return words.some((w) => {
    const needle = normalizeForMatch(w);
    if (!needle) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "u");
    return re.test(hay);
  });
}

/** Moderación: igual que las palabras clave, pero una lista vacía no oculta nada. */
export function matchesModeration(text: string | null, words: readonly string[]): boolean {
  return words.length > 0 && matchesWords(text, words);
}

export type CommentRuleLike = {
  id: string;
  target: "media" | "all" | "live";
  mediaIds: readonly string[];
  keywords: readonly string[];
  active: boolean;
  createdAt: Date;
};

export type CommentLike = {
  mediaId: string | null;
  text: string | null;
  live: boolean;
};

/**
 * La regla que aplica a un comentario, o null. Prioridad: la que nombra esa
 * publicación > «todas las publicaciones» (los vivos solo con «vivos»); a
 * igual alcance, una con palabras clave le gana a la de «cualquier
 * comentario»; después, la más vieja.
 */
export function pickRule<R extends CommentRuleLike>(
  rules: readonly R[],
  comment: CommentLike
): R | null {
  const scope = (r: R): number => {
    if (comment.live) return r.target === "live" ? 1 : 0;
    if (r.target === "media") return comment.mediaId && r.mediaIds.includes(comment.mediaId) ? 2 : 0;
    if (r.target === "all") return 1;
    return 0;
  };
  const candidates = rules
    .filter((r) => r.active && scope(r) > 0 && matchesWords(comment.text, r.keywords))
    .sort(
      (a, b) =>
        scope(b) - scope(a) ||
        Number(b.keywords.length > 0) - Number(a.keywords.length > 0) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
  return candidates[0] ?? null;
}

/** Por qué un comentario no se considera para ninguna regla (o null). */
export function ignoreReason(
  comment: { fromId: string; parentId: string | null },
  accountId: string
): "own" | "reply" | null {
  if (comment.fromId === accountId) return "own";
  if (comment.parentId) return "reply";
  return null;
}

/** `{usuario}` → «@usuario» (vacío si no se sabe). */
export function renderCommentText(text: string, ctx: { username: string | null }): string {
  const handle = ctx.username ? `@${ctx.username.replace(/^@/, "")}` : "";
  return text.replace(/\{usuario\}/gi, handle).replace(/[ \t]{2,}/g, " ").trim();
}

export function pickPublicReply(replies: readonly string[], rand: () => number = Math.random): string | null {
  const clean = replies.map((r) => r.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return clean[Math.min(clean.length - 1, Math.floor(rand() * clean.length))] ?? null;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Lo que acepta el formulario de una regla (lo valida también la API). */
export const commentRuleInput = z
  .object({
    name: z.string().trim().min(1, "Poné un nombre").max(80),
    target: z.enum(["media", "all", "live"]),
    media: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(64),
          caption: z.string().nullable().optional(),
          thumbnailUrl: z.string().nullable().optional(),
          permalink: z.string().nullable().optional(),
          mediaType: z.string().nullable().optional(),
          timestamp: z.string().nullable().optional(),
        })
      )
      .max(MAX_RULE_MEDIA)
      .default([]),
    keywords: z.union([z.string(), z.array(z.string())]).default([]),
    dmText: z
      .string()
      .trim()
      .min(1, "Escribí el mensaje que le llega por privado")
      .refine((s) => byteLength(s) <= COMMENT_DM_MAX_BYTES, "El mensaje supera lo que acepta Instagram (1000 bytes)"),
    buttonLabel: z.string().trim().max(COMMENT_BUTTON_MAX, `El botón admite hasta ${COMMENT_BUTTON_MAX} caracteres`).nullable().optional(),
    followUpText: z
      .string()
      .trim()
      .refine((s) => byteLength(s) <= COMMENT_DM_MAX_BYTES, "El seguimiento supera los 1000 bytes")
      .nullable()
      .optional(),
    publicReplies: z.array(z.string().trim().max(COMMENT_PUBLIC_REPLY_MAX)).max(MAX_PUBLIC_REPLIES).default([]),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.target === "media" && v.media.length === 0) {
      ctx.addIssue({ code: "custom", path: ["media"], message: "Elegí al menos una publicación" });
    }
  });

export type CommentRuleInput = z.infer<typeof commentRuleInput>;

/** Normaliza lo validado a columnas. */
export function ruleColumns(input: CommentRuleInput) {
  return {
    name: input.name,
    target: input.target,
    mediaIds: input.target === "media" ? input.media.map((m) => m.id) : [],
    mediaPreview:
      input.target === "media"
        ? input.media.map((m) => ({
            id: m.id,
            caption: m.caption ?? null,
            thumbnailUrl: m.thumbnailUrl ?? null,
            permalink: m.permalink ?? null,
            mediaType: m.mediaType ?? null,
            timestamp: m.timestamp ?? null,
          }))
        : [],
    keywords: parseWordList(input.keywords, MAX_KEYWORDS),
    dmText: input.dmText,
    buttonLabel: input.buttonLabel?.trim() || null,
    followUpText: input.followUpText?.trim() || null,
    publicReplies: input.publicReplies.map((r) => r.trim()).filter(Boolean),
    active: input.active,
  };
}

/** Recorte del epígrafe para mostrar o dar como contexto. */
export function shortCaption(caption: string | null | undefined, max = 80): string | null {
  const c = caption?.replace(/\s+/g, " ").trim();
  if (!c) return null;
  return c.length > max ? `${c.slice(0, max - 1)}…` : c;
}
