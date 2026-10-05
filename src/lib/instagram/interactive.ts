import type { IgButton, IgCard, IgQuickReply } from "./types";

/**
 * Botones, tarjetas y respuestas rápidas de Instagram (030, US3) — PURO.
 *
 * El agente los propone junto a su respuesta; acá se decide qué sale. La
 * regla de oro es la de la guarda de privacidad (025): un enlace que no
 * aparece TAL CUAL en lo que el modelo tuvo delante en el turno (conocimiento,
 * herramientas, conversación) no sale. Un modelo que inventa una URL
 * («altosdecalamuchita.com/reservar-ya») manda a la persona a un 404 —o peor,
 * a otro sitio.
 */

export const IG_QUICK_REPLIES_MAX = 4;
export const IG_QUICK_REPLY_TITLE_MAX = 20;
export const IG_BUTTONS_MAX = 3;
export const IG_BUTTON_TITLE_MAX = 20;
export const IG_CARDS_MAX = 10;
export const IG_CARD_TITLE_MAX = 80;
export const IG_CARD_SUBTITLE_MAX = 80;
/** El texto de una plantilla de botones admite hasta 640 caracteres. */
export const IG_BUTTON_TEXT_MAX = 640;

export type Interactive = {
  buttons: IgButton[];
  cards: IgCard[];
  quickReplies: IgQuickReply[];
};

export const EMPTY_INTERACTIVE: Interactive = { buttons: [], cards: [], quickReplies: [] };

export function hasInteractive(i: Interactive | null | undefined): i is Interactive {
  return !!i && (i.buttons.length > 0 || i.cards.length > 0 || i.quickReplies.length > 0);
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ¿La URL es https y aparece COMPLETA en el corpus? «Completa» = después de
 * la coincidencia no sigue un carácter de URL: un recorte de un enlace más
 * largo no vale. Una barra final de diferencia sí se tolera.
 */
export function urlInCorpus(url: string, corpus: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // Un dominio de verdad (con punto y TLD): descarta «https://..» y otros
  // restos de un ejemplo que el modelo pudo copiar del propio prompt.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i.test(parsed.hostname)) return false;
  const base = url.trim().replace(/\/+$/, "");
  if (!base) return false;
  // Después de la URL no puede seguir nada que la CONTINÚE (otra letra del
  // camino, «?», «#», «=»…); un signo de cierre («.», «»», «)», un emoji) sí.
  const re = new RegExp(
    `${escapeRegExp(base)}/?(?![\\p{L}\\p{N}\\-_~/%#?=&+@]|[.,:;!'][\\p{L}\\p{N}])`,
    "u"
  );
  return re.test(corpus);
}

const EMAIL_TOKEN = /^(e-?mail|correo|mail|mi e-?mail|mi correo)$/i;
const PHONE_TOKEN = /^(phone|tel[eé]fono|celular|whats?app|mi tel[eé]fono|mi celular)$/i;

/**
 * Lo que propuso el modelo → lo que sale. Nunca lanza: lo inválido se
 * descarta y se cuenta en `dropped` (para el log).
 */
export function sanitizeInteractive(
  raw: { quick_replies?: unknown; buttons?: unknown; cards?: unknown } | null | undefined,
  opts: { corpus: string }
): { interactive: Interactive; dropped: number } {
  let dropped = 0;
  const quickReplies: IgQuickReply[] = [];
  const seenQr = new Set<string>();
  for (const q of Array.isArray(raw?.quick_replies) ? raw.quick_replies : []) {
    if (typeof q !== "string" || !q.trim()) {
      dropped++;
      continue;
    }
    const value = q.trim();
    const item: IgQuickReply = EMAIL_TOKEN.test(value)
      ? { kind: "email" }
      : PHONE_TOKEN.test(value)
        ? { kind: "phone" }
        : { kind: "text", title: clip(value, IG_QUICK_REPLY_TITLE_MAX) };
    const key = item.kind === "text" ? `t:${item.title.toLowerCase()}` : item.kind;
    if (seenQr.has(key)) continue;
    seenQr.add(key);
    if (quickReplies.length < IG_QUICK_REPLIES_MAX) quickReplies.push(item);
    else dropped++;
  }

  const buttons: IgButton[] = [];
  for (const b of Array.isArray(raw?.buttons) ? raw.buttons : []) {
    const title = typeof b?.title === "string" ? clip(b.title, IG_BUTTON_TITLE_MAX) : "";
    const url = typeof b?.url === "string" ? b.url.trim() : "";
    if (!title || !urlInCorpus(url, opts.corpus) || buttons.length >= IG_BUTTONS_MAX) {
      dropped++;
      continue;
    }
    if (buttons.some((x) => x.url === url)) continue;
    buttons.push({ title, url });
  }

  const cards: IgCard[] = [];
  for (const c of Array.isArray(raw?.cards) ? raw.cards : []) {
    const title = typeof c?.title === "string" ? clip(c.title, IG_CARD_TITLE_MAX) : "";
    const url = typeof c?.url === "string" ? c.url.trim() : "";
    if (!title || !urlInCorpus(url, opts.corpus) || cards.length >= IG_CARDS_MAX) {
      dropped++;
      continue;
    }
    const image = typeof c?.image_url === "string" ? c.image_url.trim() : "";
    const subtitle = typeof c?.subtitle === "string" ? clip(c.subtitle, IG_CARD_SUBTITLE_MAX) : "";
    const button = typeof c?.button === "string" ? clip(c.button, IG_BUTTON_TITLE_MAX) : "";
    if (image && !urlInCorpus(image, opts.corpus)) dropped++;
    cards.push({
      title,
      subtitle: subtitle || null,
      url,
      imageUrl: image && urlInCorpus(image, opts.corpus) ? image : null,
      buttonTitle: button || null,
    });
  }

  return { interactive: { buttons, cards, quickReplies }, dropped };
}

/* ============================================================
 * Payloads de la Send API de Instagram
 * ============================================================ */

export function quickRepliesPayload(items: readonly IgQuickReply[]): Record<string, string>[] {
  return items.map((q, i): Record<string, string> => {
    if (q.kind === "email") return { content_type: "user_email", payload: "VOCERO_QR_EMAIL" };
    if (q.kind === "phone") return { content_type: "user_phone_number", payload: "VOCERO_QR_PHONE" };
    return { content_type: "text", title: q.title, payload: `VOCERO_QR_${i}` };
  });
}

export function buttonTemplateMessage(text: string, buttons: readonly IgButton[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: buttons.map((b) => ({ type: "web_url", url: b.url, title: b.title })),
      },
    },
  };
}

export function genericTemplateMessage(cards: readonly IgCard[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: cards.map((c) => ({
          title: c.title,
          ...(c.subtitle ? { subtitle: c.subtitle } : {}),
          ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
          default_action: { type: "web_url", url: c.url },
          buttons: [{ type: "web_url", url: c.url, title: c.buttonTitle || "Ver" }],
        })),
      },
    },
  };
}

export type PlannedIgMessage = {
  /** El objeto `message` de la Send API. */
  message: Record<string, unknown>;
  /** Lo que se guarda como texto del mensaje en el CRM. */
  text: string;
  /** Lo estructurado que se guarda en `message.details`. */
  details: { buttons?: IgButton[]; cards?: IgCard[]; quickReplies?: IgQuickReply[] } | null;
};

/**
 * Cómo sale una respuesta con extras, en orden:
 * - tarjetas: el texto (partido) y después el carrusel;
 * - botones: el texto, con el último pedazo como texto de la plantilla de
 *   botones (si entra en 640; si no, va aparte y la plantilla dice «👇»);
 * - respuestas rápidas: en el último pedazo de texto.
 * Las respuestas rápidas solo acompañan al texto solo (sin tarjetas ni
 * botones): mezclar formatos se ve mal en la app y Meta no lo documenta.
 */
export function planIgMessages(chunks: readonly string[], i: Interactive): PlannedIgMessage[] {
  const out: PlannedIgMessage[] = [];
  if (i.cards.length > 0) {
    for (const c of chunks) out.push({ message: { text: c }, text: c, details: null });
    out.push({
      message: genericTemplateMessage(i.cards),
      text: i.cards.map((c) => c.title).join(" · "),
      details: { cards: i.cards },
    });
    return out;
  }
  if (i.buttons.length > 0) {
    const last = chunks[chunks.length - 1] ?? "";
    const fits = last.length > 0 && last.length <= IG_BUTTON_TEXT_MAX;
    const head = fits ? chunks.slice(0, -1) : chunks;
    for (const c of head) out.push({ message: { text: c }, text: c, details: null });
    const templateText = fits ? last : "👇";
    out.push({
      message: buttonTemplateMessage(templateText, i.buttons),
      text: templateText,
      details: { buttons: i.buttons },
    });
    return out;
  }
  chunks.forEach((c, idx) => {
    const isLast = idx === chunks.length - 1;
    if (isLast && i.quickReplies.length > 0) {
      out.push({
        message: { text: c, quick_replies: quickRepliesPayload(i.quickReplies) },
        text: c,
        details: { quickReplies: i.quickReplies },
      });
    } else {
      out.push({ message: { text: c }, text: c, details: null });
    }
  });
  return out;
}

/** Si Instagram rechaza el formato: el texto con los enlaces escritos. */
export function fallbackText(text: string, i: Interactive): string {
  const lines = [
    ...i.buttons.map((b) => `${b.title}: ${b.url}`),
    ...i.cards.map((c) => `${c.title}${c.subtitle ? ` (${c.subtitle})` : ""}: ${c.url}`),
  ];
  return lines.length > 0 ? `${text.trim()}\n\n${lines.join("\n")}` : text;
}

/**
 * Cómo ve el agente, en el historial, lo que mandó con extras: si no sabe
 * que ya mostró botones, los repite o le dice al cliente que «toque el
 * enlace» que nunca vio.
 */
export function interactiveAgentNote(d: {
  buttons?: IgButton[];
  cards?: IgCard[];
  quickReplies?: IgQuickReply[];
} | null | undefined): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (d.buttons?.length) parts.push(`botones: ${d.buttons.map((b) => b.title).join(", ")}`);
  if (d.cards?.length) parts.push(`tarjetas: ${d.cards.map((c) => c.title).join(", ")}`);
  if (d.quickReplies?.length) {
    parts.push(
      `respuestas rápidas: ${d.quickReplies
        .map((q) => (q.kind === "text" ? q.title : q.kind === "email" ? "[su email]" : "[su teléfono]"))
        .join(", ")}`
    );
  }
  return parts.length > 0 ? `(mostraste ${parts.join("; ")})` : null;
}
