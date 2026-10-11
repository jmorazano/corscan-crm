/**
 * Origen de una conversación — tipos PUROS y SIN imports: los importa el
 * schema (`jsonb.$type`) y drizzle-kit carga este archivo.
 *
 * 030 lo creó para Instagram (link `ig.me` con ref, anuncio «Enviar
 * mensaje», comentario, historia). 035 lo extiende a WhatsApp: el primer
 * mensaje que llega tocando un anuncio Click-to-WhatsApp trae un `referral`
 * y la conversación queda marcada con ese anuncio.
 *
 * Vive en la columna `conversation.ig_origin` (propiedad `igOrigin`): el
 * nombre es historia de 030. Renombrarla pedía una migración —y tocar la
 * base— sin ningún beneficio; el tipo que manda es este. Los campos de
 * WhatsApp son TODOS opcionales: una fila de Instagram sigue siendo válida
 * tal cual.
 */

export type ConversationOriginKind = "link" | "ad" | "comment" | "story_reply" | "story_mention";

/** Canal del origen. Sin dato = Instagram (las filas de 030 no lo traen). */
export type ConversationOriginChannel = "instagram" | "whatsapp";

/** De dónde llegó una conversación (`conversation.ig_origin`). */
export type ConversationOrigin = {
  kind: ConversationOriginKind;
  /** Lo que ve el equipo: «Link: Flyer cabañas», «Anuncio: …». */
  label: string;
  /** link: el slug · ad: el ad_id (IG) o el `source_id` (WA) · comment: el comment_id. */
  ref?: string | null;
  linkId?: string | null;
  /** Instrucción que ESCRIBIÓ EL DUEÑO para ese link (es configuración). */
  instruction?: string | null;
  /**
   * Texto de un tercero (título del anuncio, comentario, epígrafe de la
   * publicación): llega al agente como DATO, nunca como instrucción.
   */
  detail?: string | null;
  /** Cuándo llegó (ISO): la fecha del mensaje que trajo el origen. */
  at: string;

  /* ---- 035: anuncio Click-to-WhatsApp (todo opcional) ---- */

  channel?: ConversationOriginChannel;
  /** Qué tocó la persona según Meta: un anuncio o una publicación promocionada. */
  sourceType?: "ad" | "post" | null;
  /** Enlace al anuncio o a la publicación (solo https). */
  sourceUrl?: string | null;
  /**
   * `ctwa_clid`: identificador del clic en el anuncio. Se guarda para la
   * Conversions API de mensajería (otra feature). Es del servidor: NO viaja
   * al navegador (`originForClient`) ni al modelo.
   */
  clickId?: string | null;
  /** Texto principal del anuncio (dato de un tercero, saneado y recortado). */
  body?: string | null;
  mediaType?: "image" | "video" | null;
  /** Mensaje de bienvenida que vio la persona al tocar el anuncio (dato). */
  welcome?: string | null;
};

/** Lo que viaja al navegador: todo menos el identificador del clic. */
export type ConversationOriginDto = Omit<ConversationOrigin, "clickId">;

export function originForClient(origin: ConversationOrigin): ConversationOriginDto {
  const { clickId: _clickId, ...visible } = origin;
  return visible;
}
