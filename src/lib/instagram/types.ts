/**
 * Tipos compartidos de la feature 030 (Instagram que vende). Viven fuera del
 * schema porque los usan la base (`jsonb.$type`), el servidor y la UI.
 * Sin imports: el schema los importa como tipos y drizzle-kit los carga.
 */

export type IgOriginKind = "link" | "ad" | "comment" | "story_reply" | "story_mention";

/** De dónde llegó una conversación de Instagram (`conversation.ig_origin`). */
export type IgOrigin = {
  kind: IgOriginKind;
  /** Lo que ve el equipo: «Link: Flyer cabañas», «Anuncio: …». */
  label: string;
  /** link: el slug · ad: el ad_id · comment: el comment_id. */
  ref?: string | null;
  linkId?: string | null;
  /** Instrucción que ESCRIBIÓ EL DUEÑO para ese link (es configuración). */
  instruction?: string | null;
  /**
   * Texto de un tercero (título del anuncio, comentario, epígrafe de la
   * publicación): llega al agente como DATO, nunca como instrucción.
   */
  detail?: string | null;
  at: string;
};

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
