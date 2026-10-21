/**
 * Tipos compartidos de la feature 030 (Instagram que vende). Viven fuera del
 * schema porque los usan la base (`jsonb.$type`), el servidor y la UI.
 * Sin imports de runtime: el schema los importa como tipos y drizzle-kit los
 * carga (el `import type` de abajo se borra al compilar).
 */
import type { ConversationOrigin, ConversationOriginKind } from "../conversation-origin";

/**
 * De dónde llegó una conversación (`conversation.ig_origin`). 035 generalizó
 * el tipo a `ConversationOrigin` (también lo usa el anuncio Click-to-WhatsApp);
 * estos nombres quedan como alias para el código de Instagram.
 */
export type IgOriginKind = ConversationOriginKind;
export type IgOrigin = ConversationOrigin;

export type IgButton = { title: string; url: string };

export type IgCard = {
  title: string;
  subtitle?: string | null;
  url: string;
  imageUrl?: string | null;
  buttonTitle?: string | null;
};

export type IgQuickReply =
  | { kind: "text"; title: string }
  | { kind: "email" }
  | { kind: "phone" };

/** `message.details`: lo estructurado de un mensaje de Instagram. */
export type MessageDetails = {
  buttons?: IgButton[];
  cards?: IgCard[];
  quickReplies?: IgQuickReply[];
  /** Nota de un comentario (tipo `comment`) o DM que lo respondió. */
  comment?: {
    id: string;
    mediaId: string | null;
    permalink?: string | null;
    caption?: string | null;
    ruleId?: string | null;
    ruleName?: string | null;
    live?: boolean;
  };
  /** Respuesta o mención de una historia. */
  story?: { kind: "reply" | "mention" };
  /** Eco de una tarjeta o botones que mandó OTRA app (p. ej. ManyChat). */
  template?: { title: string | null; buttons: string[] };
  /** Llegó como `standby`: otra app maneja el hilo. */
  standby?: boolean;
  /**
   * 036: mensaje del equipo detectado como DIFUSIÓN (mismo texto a varios
   * chats): no cuenta como «alguien atendiendo».
   */
  broadcast?: boolean;
  /**
   * 038: reacción del cliente (`reaction`): el comienzo del mensaje al que
   * reaccionó, para el hilo y para el agente. Copiado al recibirla.
   */
  reactionTo?: string;
};

/** Opción del menú persistente de Instagram (030, US4). */
export type IgMenuItem =
  | { type: "question"; title: string }
  | { type: "link"; title: string; url: string }
  | { type: "human"; title: string };

/** Publicación elegida en una regla (copia para mostrarla sin pedirla). */
export type IgMediaPreview = {
  id: string;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  mediaType: string | null;
  timestamp: string | null;
};
