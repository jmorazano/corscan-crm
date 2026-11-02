import { z } from "zod";

/**
 * Respuestas rápidas propias de la empresa (047) — PURO, compartido por la
 * API, Ajustes y el compositor.
 *
 * Las de la app WhatsApp Business viven en el teléfono (la Cloud API no las
 * expone): estas son del CRM. Atajo + texto, sin pasar por Meta; al elegirla
 * el texto queda en la caja y viaja como mensaje común.
 */

export const QUICK_REPLY_SHORTCUT_MAX = 30;
export const QUICK_REPLY_BODY_MAX = 2000;
export const MAX_QUICK_REPLIES = 200;

/** Se reemplaza por el primer nombre del contacto al insertar. */
export const NAME_PLACEHOLDER = "{nombre}";

/**
 * Atajo tal como se tipea después de `/`: minúsculas, sin tildes ni la `/`
 * inicial, espacios → `-`, solo letras, dígitos, `-` y `_`. La `ñ` queda
 * (es la forma natural de escribir `/seña`).
 */
export function sanitizeShortcut(raw: string, max = QUICK_REPLY_SHORTCUT_MAX): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "ñ")
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9ñ_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

export const quickReplyInput = z.object({
  shortcut: z
    .string()
    .transform((s) => sanitizeShortcut(s))
    .refine((s) => s.length > 0, "El atajo necesita al menos una letra o número"),
  body: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "El texto no puede estar vacío")
    .refine(
      (s) => s.length <= QUICK_REPLY_BODY_MAX,
      `Hasta ${QUICK_REPLY_BODY_MAX} caracteres`
    ),
});

export type QuickReplyInput = z.infer<typeof quickReplyInput>;

export type QuickReplyDto = {
  id: string;
  shortcut: string;
  body: string;
  updatedAt: string;
};

/**
 * Primer nombre para `{nombre}`. Un contacto sin nombre guarda su teléfono
 * (o `ig:<id>`) como nombre: algo con dígitos no se usa para saludar.
 */
export function greetingName(contactName: string | null | undefined): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || !/\p{L}/u.test(first) || /\d/.test(first)) return "";
  return first;
}

/**
 * Texto listo para la caja: `{nombre}` (también `{{nombre}}`, sin importar
 * mayúsculas) → primer nombre. Sin nombre, desaparece sin dejar «Hola ,» ni
 * dobles espacios.
 */
export function renderQuickReply(body: string, contactName: string | null | undefined): string {
  const name = greetingName(contactName);
  const placeholder = /\{\{?\s*nombre\s*\}?\}/giu;
  if (name) return body.replace(placeholder, name);
  return body
    .replace(placeholder, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

/**
 * Lo que lista el selector: primero las respuestas propias (por atajo),
 * después las plantillas aprobadas. `key` sirve para el filtro y se muestra
 * tras la `/`.
 */
export type QuickPick =
  | { kind: "reply"; id: string; key: string; body: string }
  | { kind: "template"; id: string; key: string; body: string };

export function quickPicks(
  replies: readonly Pick<QuickReplyDto, "id" | "shortcut" | "body">[],
  templates: readonly { id: string; name: string; body: string }[]
): QuickPick[] {
  const own = [...replies]
    .sort((a, b) => a.shortcut.localeCompare(b.shortcut, "es"))
    .map((r) => ({ kind: "reply" as const, id: r.id, key: r.shortcut, body: r.body }));
  const tpl = templates.map((t) => ({
    kind: "template" as const,
    id: t.id,
    key: t.name,
    body: t.body,
  }));
  return [...own, ...tpl];
}

/**
 * Filtro de la `/`: por atajo o texto, sin tildes ni mayúsculas. Las que
 * EMPIEZAN con lo tipeado van primero (`/se` → `/seña` antes que
 * `/reserva` que dice «seña» en el texto); el resto mantiene su orden.
 */
export function filterQuickPicks<T extends { key: string; body: string }>(
  items: readonly T[],
  query: string
): T[] {
  const q = fold(query.trim().replace(/^\/+/, ""));
  if (!q) return [...items];
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const key = fold(item.key);
    if (key.startsWith(q)) starts.push(item);
    else if (key.includes(q) || fold(item.body).includes(q)) contains.push(item);
  }
  return [...starts, ...contains];
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
