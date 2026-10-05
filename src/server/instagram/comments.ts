import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  InstagramApiError,
  getInstagramMedia,
  listInstagramMedia,
  listMediaComments,
  replyToComment,
  sendPrivateReply,
  setCommentHidden,
  type IgMedia,
} from "@/lib/instagram/client";
import {
  PRIVATE_REPLIES_PER_HOUR,
  PRIVATE_REPLY_WINDOW_MS,
  ignoreReason,
  matchesModeration,
  pickPublicReply,
  pickRule,
  renderCommentText,
  shortCaption,
} from "@/lib/instagram/comments";
import { COMMENT_TAG } from "@/lib/instagram/entry-links";
import { quickRepliesPayload } from "@/lib/instagram/interactive";
import type { IgOrigin, MessageDetails } from "@/lib/instagram/types";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation, serializeMessage } from "@/server/inbox/ingest";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import { sendText } from "@/server/inbox/send";
import { getOrCreateInstagramContact } from "@/server/instagram/ingest";
import {
  COMMENTS_WEBHOOK_FRESH_MS,
  ensureInstagramToken,
  getInstagramIntegration,
  markInstagramReconnectRequired,
  type InstagramIntegration,
} from "@/server/instagram/integration";

/**
 * Respuestas a comentarios (030, US1/US2): el reemplazo de ManyChat.
 *
 * Cada comentario pasa UNA vez por acá (reserva en `instagram_comment_event`
 * con UNIQUE por tenant y `comment_id`): llegue por webhook (acceso avanzado)
 * o por la consulta periódica (respaldo con acceso estándar), y aunque Meta lo
 * reintente, el DM sale a lo sumo una vez (Constitución IV).
 *
 * Orden: reservar → moderación (un comentario ofensivo se oculta y NO recibe
 * DM) → regla → DM privado → respuesta pública → conversación en la Bandeja.
 * Nunca lanza hacia el webhook: el resultado queda en el evento.
 */

export type CommentInput = {
  commentId: string;
  mediaId: string | null;
  fromId: string;
  username: string | null;
  text: string | null;
  parentId: string | null;
  live: boolean;
  at: Date;
};

type RuleRow = typeof schema.instagramCommentRule.$inferSelect;
type EventStatus = (typeof schema.instagramCommentEvent.$inferSelect)["status"];

/** Motivos en castellano (se ven en la actividad). */
export const COMMENT_DETAIL = {
  own: "Comentario de la propia cuenta",
  reply: "Es una respuesta a otro comentario",
  no_rule: "Ninguna regla aplica",
  before_rule: "Es anterior a la regla",
  old: "Tiene más de 7 días: Instagram ya no deja responderlo por privado",
  already: "Esta persona ya recibió el mensaje de esta regla en esta publicación",
  rate: "Se alcanzó el tope de respuestas privadas por hora",
  no_scope: "La conexión no tiene el permiso de comentarios: reconectá la cuenta",
  reconnect: "La conexión con Instagram venció: reconectá la cuenta",
} as const;

const CAPTION_CACHE_MS = 10 * 60 * 1000;
declare global {
  var __voceroIgCaptionCache: Map<string, { at: number; media: IgMedia | null }> | undefined;
}
function captionCache() {
  if (!globalThis.__voceroIgCaptionCache) globalThis.__voceroIgCaptionCache = new Map();
  return globalThis.__voceroIgCaptionCache;
}

async function mediaInfo(
  integration: InstagramIntegration,
  mediaId: string | null,
  rule: RuleRow | null
): Promise<{ caption: string | null; permalink: string | null }> {
  if (!mediaId) return { caption: null, permalink: null };
  const fromRule = rule?.mediaPreview.find((m) => m.id === mediaId);
  if (fromRule) return { caption: fromRule.caption, permalink: fromRule.permalink };
  const cache = captionCache();
  const hit = cache.get(mediaId);
  if (hit && Date.now() - hit.at < CAPTION_CACHE_MS) {
    return { caption: hit.media?.caption ?? null, permalink: hit.media?.permalink ?? null };
  }
  const media = await getInstagramMedia(integration.token, mediaId).catch(() => null);
  cache.set(mediaId, { at: Date.now(), media });
  return { caption: media?.caption ?? null, permalink: media?.permalink ?? null };
}

/** Motivo en castellano de un rechazo de Instagram a un comentario. */
export function friendlyCommentError(err: unknown): string {
  if (!(err instanceof InstagramApiError)) {
    return err instanceof Error ? err.message : String(err);
  }
  if (err.isUnavailable) return "Instagram no respondió en ese momento (servicio caído): este comentario quedó sin respuesta privada";
  if (err.code === 2018300 || err.subcode === 2018300 || err.subcode === 2534037 || /thread owner|controlling this thread/i.test(err.message)) {
    return "Otra app (por ejemplo ManyChat) maneja las conversaciones de esta cuenta: dejá al CRM como app principal en Meta Business Suite → Configuración → Integraciones → Conversation Routing";
  }
  if (err.subcode === 2534025 || /invalid for a private reply/i.test(err.message)) {
    return "Instagram no deja responder este comentario por privado (es muy viejo, ya tiene respuesta o se borró)";
  }
  if (err.code === 10 || err.code === 200 || err.code === 3) {
    return `Instagram rechazó la acción por permisos (falta el permiso de comentarios o la aprobación de Meta): ${err.message}`;
  }
  return `Instagram rechazó la acción: ${err.message}`;
}

async function finishEvent(
  organizationId: string,
  commentId: string,
  patch: Partial<typeof schema.instagramCommentEvent.$inferInsert> & { status: EventStatus }
) {
  await getDb()
    .update(schema.instagramCommentEvent)
    .set(patch)
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.commentId, commentId)
      )
    );
}

/**
 * Procesa UN comentario. `source` = por dónde llegó. Devuelve el estado
 * final (o null si ya se había procesado).
 */
export async function handleInstagramComment(
  integrationIn: InstagramIntegration,
  c: CommentInput,
  source: "webhook" | "poll",
  now: Date = new Date()
): Promise<EventStatus | null> {
  const db = getDb();
  const { organizationId } = integrationIn;

  if (source === "webhook") {
    const last = integrationIn.commentsWebhookAt?.getTime() ?? 0;
    if (now.getTime() - last > 5 * 60 * 1000) {
      await db
        .update(schema.instagramIntegration)
        .set({ commentsWebhookAt: now })
        .where(scoped(schema.instagramIntegration.organizationId, organizationId));
    }
  }

  // 1. Reserva: el mismo comentario no se procesa dos veces.
  const reserved = await db
    .insert(schema.instagramCommentEvent)
    .values({
      id: newId("instagramCommentEvent"),
      organizationId,
      commentId: c.commentId,
      mediaId: c.mediaId,
      fromId: c.fromId,
      username: c.username,
      text: c.text?.slice(0, 2000) ?? null,
      live: c.live,
      source,
      status: "processing",
      commentedAt: c.at,
    })
    .onConflictDoNothing({
      target: [schema.instagramCommentEvent.organizationId, schema.instagramCommentEvent.commentId],
    })
    .returning({ id: schema.instagramCommentEvent.id });
  if (!reserved[0]) return null;

  const done = async (status: EventStatus, detail: string | null, extra: Partial<typeof schema.instagramCommentEvent.$inferInsert> = {}) => {
    await finishEvent(organizationId, c.commentId, { status, detail, ...extra });
    publish(organizationId, { type: "instagram.comments", data: { commentId: c.commentId } });
    return status;
  };

  try {
    const ignored = ignoreReason(c, integrationIn.igUserId);
    if (ignored === "own") return done("ignored", COMMENT_DETAIL.own);

    if (!integrationIn.commentsEnabled) return done("failed", COMMENT_DETAIL.no_scope);
    const integration = await ensureInstagramToken(integrationIn, now);
    if (integration.status === "reconnect_required") return done("failed", COMMENT_DETAIL.reconnect);

    // 2. Moderación: el comentario ofensivo se oculta y no recibe DM.
    if (matchesModeration(c.text, integration.moderationWords)) {
      try {
        await setCommentHidden(integration.token, c.commentId, true);
        return done("hidden", "Ocultado: contiene una palabra de la lista de moderación", { hidden: true });
      } catch (err) {
        if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
        return done("failed", friendlyCommentError(err));
      }
    }

    if (ignored === "reply") return done("ignored", COMMENT_DETAIL.reply);

    // 3. Regla.
    const rules = await db
      .select()
      .from(schema.instagramCommentRule)
      .where(
        scoped(
          schema.instagramCommentRule.organizationId,
          organizationId,
          eq(schema.instagramCommentRule.active, true)
        )
      )
      .orderBy(asc(schema.instagramCommentRule.createdAt));
    const rule = pickRule(rules, c);
    if (!rule) return done("ignored", COMMENT_DETAIL.no_rule);

    // Lo que se comentó ANTES de crear la regla no dispara (la consulta trae
    // los últimos comentarios: sin esto, una regla nueva le escribiría a
    // todos los que comentaron la semana pasada).
    if (c.at.getTime() < rule.createdAt.getTime() - 60_000) {
      return done("ignored", COMMENT_DETAIL.before_rule, { ruleId: rule.id });
    }
    if (now.getTime() - c.at.getTime() > PRIVATE_REPLY_WINDOW_MS) {
      return done("skipped", COMMENT_DETAIL.old, { ruleId: rule.id });
    }

    // 4. Una vez por persona, publicación y regla (como ManyChat).
    const repeated = await db
      .select({ id: schema.instagramCommentEvent.id })
      .from(schema.instagramCommentEvent)
      .where(
        scoped(
          schema.instagramCommentEvent.organizationId,
          organizationId,
          eq(schema.instagramCommentEvent.ruleId, rule.id),
          eq(schema.instagramCommentEvent.fromId, c.fromId),
          c.mediaId
            ? eq(schema.instagramCommentEvent.mediaId, c.mediaId)
            : isNull(schema.instagramCommentEvent.mediaId),
          eq(schema.instagramCommentEvent.status, "replied")
        )
      )
      .limit(1);
    if (repeated[0]) return done("skipped", COMMENT_DETAIL.already, { ruleId: rule.id });

    // 5. Tope por hora (Meta: 750 respuestas privadas por hora y cuenta).
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const sent = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.instagramCommentEvent)
      .where(
        scoped(
          schema.instagramCommentEvent.organizationId,
          organizationId,
          eq(schema.instagramCommentEvent.status, "replied"),
          gte(schema.instagramCommentEvent.createdAt, hourAgo)
        )
      );
    if ((sent[0]?.n ?? 0) >= PRIVATE_REPLIES_PER_HOUR) {
      return done("skipped", COMMENT_DETAIL.rate, { ruleId: rule.id });
    }

    // 6. DM privado (con el botón como respuesta rápida; si Instagram no la
    //    acepta en una respuesta privada, sale solo el texto).
    const dmText = renderCommentText(rule.dmText, { username: c.username });
    const quickReplies = rule.buttonLabel ? [{ kind: "text" as const, title: rule.buttonLabel }] : [];
    let reply: { messageId: string; recipientId: string | null };
    let sentQuickReplies = quickReplies;
    try {
      reply = await sendPrivateReply({
        igUserId: integration.igUserId,
        token: integration.token,
        commentId: c.commentId,
        message: quickReplies.length > 0 ? { text: dmText, quick_replies: quickRepliesPayload(quickReplies) } : { text: dmText },
      });
    } catch (err) {
      const retryable =
        quickReplies.length > 0 && err instanceof InstagramApiError && !err.isAuthError && !err.isUnavailable && err.code === 100 && err.subcode !== 2534025;
      if (!retryable) {
        if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
        return done("failed", friendlyCommentError(err), { ruleId: rule.id });
      }
      try {
        reply = await sendPrivateReply({
          igUserId: integration.igUserId,
          token: integration.token,
          commentId: c.commentId,
          message: { text: dmText },
        });
        sentQuickReplies = [];
      } catch (err2) {
        return done("failed", friendlyCommentError(err2), { ruleId: rule.id });
      }
    }

    // 7. Respuesta pública (no en vivos: Instagram no lo permite).
    let publicReplyId: string | null = null;
    let publicNote: string | null = null;
    const publicText = c.live ? null : pickPublicReply(rule.publicReplies);
    if (publicText) {
      try {
        publicReplyId = (await replyToComment(integration.token, c.commentId, renderCommentText(publicText, { username: c.username }))).id;
      } catch (err) {
        publicNote = `El DM salió, pero la respuesta pública falló: ${friendlyCommentError(err)}`;
      }
    }

    // 8. La conversación en la Bandeja: nota del comentario + el DM.
    const media = await mediaInfo(integration, c.mediaId, rule);
    const igsid = reply.recipientId ?? c.fromId;
    const conversationId = await recordCommentConversation(integration, {
      comment: c,
      rule,
      igsid,
      dmText,
      dmMessageId: reply.messageId,
      quickReplies: sentQuickReplies,
      caption: media.caption,
      permalink: media.permalink,
      now,
    }).catch((err) => {
      console.error("[instagram] no se pudo registrar la conversación del comentario:", err instanceof Error ? err.message : err);
      return null;
    });

    return done("replied", publicNote, {
      ruleId: rule.id,
      recipientId: igsid,
      publicReplyId,
      conversationId,
      // Sin seguimiento configurado no hay nada pendiente.
      followUpDoneAt: rule.followUpText ? null : now,
    });
  } catch (err) {
    console.error("[instagram] fallo procesando un comentario:", err instanceof Error ? err.message : err);
    return done("failed", friendlyCommentError(err));
  }
}

async function recordCommentConversation(
  integration: InstagramIntegration,
  input: {
    comment: CommentInput;
    rule: RuleRow;
    igsid: string;
    dmText: string;
    dmMessageId: string;
    quickReplies: { kind: "text"; title: string }[];
    caption: string | null;
    permalink: string | null;
    now: Date;
  }
): Promise<string> {
  const db = getDb();
  const { organizationId } = integration;
  const contact = await getOrCreateInstagramContact(
    integration,
    input.igsid,
    { username: input.comment.username },
    // Quien solo comentó no dio consentimiento para leer su perfil: Meta
    // respondería «User consent is required». Se completa cuando escriba.
    { skipProfile: true }
  );
  const conversation = await getOrCreateConversation(organizationId, contact.id, "instagram");

  const commentDetails: MessageDetails["comment"] = {
    id: input.comment.commentId,
    mediaId: input.comment.mediaId,
    permalink: input.permalink,
    caption: shortCaption(input.caption, 200),
    ruleId: input.rule.id,
    ruleName: input.rule.name,
    live: input.comment.live,
  };

  // La nota del comentario: entrante, pero NO abre la ventana de 24 h, no
  // suma no leídos y no despierta al agente (FR-006).
  const noteAt = new Date(Math.min(input.comment.at.getTime(), input.now.getTime() - 1));
  const note = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: `comment:${input.comment.commentId}`,
      direction: "in",
      type: "comment",
      text: input.comment.text,
      mediaSummary: shortCaption(input.caption, 200),
      status: "delivered",
      details: { comment: commentDetails },
      waTimestamp: noteAt,
      createdAt: noteAt,
    })
    .onConflictDoNothing({ target: [schema.message.organizationId, schema.message.waMessageId] })
    .returning();

  const dm = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.dmMessageId,
      direction: "out",
      type: "text",
      text: input.dmText,
      status: "sent",
      details: {
        comment: commentDetails,
        ...(input.quickReplies.length > 0 ? { quickReplies: input.quickReplies } : {}),
      },
      waTimestamp: input.now,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: [schema.message.organizationId, schema.message.waMessageId] })
    .returning();

  const origin: IgOrigin = {
    kind: "comment",
    label: input.caption ? `Comentario en «${shortCaption(input.caption, 60)}»` : "Comentario en una publicación",
    ref: input.comment.commentId,
    detail: input.comment.text?.slice(0, 300) ?? null,
    at: input.now.toISOString(),
  };
  await db
    .update(schema.conversation)
    .set({
      igOrigin: origin,
      lastMessageAt: sql`greatest(coalesce(${schema.conversation.lastMessageAt}, to_timestamp(0)), ${input.now.toISOString()}::timestamp)`,
      tags: sql`(select array(select distinct unnest(${schema.conversation.tags} || array[${COMMENT_TAG}]::text[])))`,
      updatedAt: input.now,
    })
    .where(eq(schema.conversation.id, conversation.id));
  await onLeadActivity(organizationId, contact.id, input.now);

  for (const row of [note[0], dm[0]]) {
    if (!row) continue;
    publish(organizationId, {
      type: "message.new",
      data: { conversationId: conversation.id, message: serializeMessage(row) },
    });
  }
  publish(organizationId, { type: "conversations.updated", data: { conversationIds: [conversation.id] } });
  return conversation.id;
}

/* ============================================================
 * Seguimiento: «tocá el botón y te paso el link»
 * ============================================================ */

/**
 * ¿Esta conversación tiene un seguimiento pendiente de una regla de
 * comentarios? Lo consulta la ingesta ANTES de despertar al agente: si hay
 * seguimiento, sale ese mensaje y el agente no habla encima (FR-007).
 */
export async function pendingCommentFollowUp(
  organizationId: string,
  conversationId: string,
  now: Date = new Date()
): Promise<{ eventId: string; text: string } | null> {
  const rows = await getDb()
    .select({
      eventId: schema.instagramCommentEvent.id,
      text: schema.instagramCommentRule.followUpText,
      createdAt: schema.instagramCommentEvent.createdAt,
    })
    .from(schema.instagramCommentEvent)
    .innerJoin(
      schema.instagramCommentRule,
      eq(schema.instagramCommentRule.id, schema.instagramCommentEvent.ruleId)
    )
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.conversationId, conversationId),
        eq(schema.instagramCommentEvent.status, "replied"),
        isNull(schema.instagramCommentEvent.followUpDoneAt),
        gte(schema.instagramCommentEvent.createdAt, new Date(now.getTime() - PRIVATE_REPLY_WINDOW_MS))
      )
    )
    .orderBy(desc(schema.instagramCommentEvent.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row?.text) return null;
  return { eventId: row.eventId, text: row.text };
}

/**
 * Manda el seguimiento (una sola vez: se marca ANTES de enviar). Lo que
 * falle queda en el log; la conversación sigue y el agente atiende el
 * próximo mensaje.
 */
export async function sendCommentFollowUp(
  organizationId: string,
  conversationId: string,
  followUp: { eventId: string; text: string },
  now: Date = new Date()
): Promise<boolean> {
  const claimed = await getDb()
    .update(schema.instagramCommentEvent)
    .set({ followUpDoneAt: now })
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.id, followUp.eventId),
        isNull(schema.instagramCommentEvent.followUpDoneAt)
      )
    )
    .returning({ id: schema.instagramCommentEvent.id });
  if (!claimed[0]) return false;
  try {
    await sendText({ conversationId, organizationId, text: followUp.text, aiGenerated: false });
    return true;
  } catch (err) {
    console.warn("[instagram] no salió el seguimiento del comentario:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Marca el seguimiento como resuelto sin mandarlo (p. ej. la persona escribió otra cosa por otro lado). */
export async function closeCommentFollowUps(organizationId: string, conversationId: string, now: Date = new Date()) {
  await getDb()
    .update(schema.instagramCommentEvent)
    .set({ followUpDoneAt: now })
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.conversationId, conversationId),
        isNull(schema.instagramCommentEvent.followUpDoneAt)
      )
    );
}

/* ============================================================
 * Ocultar / mostrar a mano (actividad)
 * ============================================================ */

export async function setInstagramCommentHidden(
  organizationId: string,
  commentId: string,
  hidden: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const integration = await getInstagramIntegration(organizationId);
  if (!integration) return { ok: false, message: "No hay una cuenta de Instagram conectada" };
  if (!integration.commentsEnabled) return { ok: false, message: COMMENT_DETAIL.no_scope };
  const ready = await ensureInstagramToken(integration);
  if (ready.status === "reconnect_required") return { ok: false, message: COMMENT_DETAIL.reconnect };
  try {
    await setCommentHidden(ready.token, commentId, hidden);
  } catch (err) {
    if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
    return { ok: false, message: friendlyCommentError(err) };
  }
  await getDb()
    .update(schema.instagramCommentEvent)
    .set({ hidden })
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.commentId, commentId)
      )
    );
  return { ok: true };
}

/* ============================================================
 * Consulta periódica (respaldo del webhook)
 * ============================================================ */

/** Sin webhook de comentarios: cada minuto. Con webhook vivo: cada 15. */
export const POLL_EVERY_MS = 60 * 1000;
export const POLL_EVERY_WITH_WEBHOOK_MS = 15 * 60 * 1000;
const RECENT_MEDIA_FOR_ALL = 10;

/** ¿Toca consultar? (puro) */
export function shouldPollComments(
  row: { commentsPolledAt: Date | null; commentsWebhookAt: Date | null },
  now: Date = new Date()
): boolean {
  const webhookAlive =
    !!row.commentsWebhookAt && now.getTime() - row.commentsWebhookAt.getTime() < COMMENTS_WEBHOOK_FRESH_MS;
  const every = webhookAlive ? POLL_EVERY_WITH_WEBHOOK_MS : POLL_EVERY_MS;
  return !row.commentsPolledAt || now.getTime() - row.commentsPolledAt.getTime() >= every - 5_000;
}

/** Consulta los comentarios de UNA empresa. Devuelve cuántos procesó. */
export async function pollInstagramComments(
  integration: InstagramIntegration,
  now: Date = new Date()
): Promise<number> {
  const db = getDb();
  const { organizationId } = integration;
  const rules = await db
    .select()
    .from(schema.instagramCommentRule)
    .where(
      scoped(
        schema.instagramCommentRule.organizationId,
        organizationId,
        eq(schema.instagramCommentRule.active, true)
      )
    );
  const postRules = rules.filter((r) => r.target !== "live");
  const moderation = integration.moderationWords.length > 0;
  if (postRules.length === 0 && !moderation) return 0;

  await db
    .update(schema.instagramIntegration)
    .set({ commentsPolledAt: now })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));

  const ready = await ensureInstagramToken(integration, now);
  if (ready.status === "reconnect_required") return 0;

  const mediaIds = new Set<string>(postRules.flatMap((r) => (r.target === "media" ? r.mediaIds : [])));
  try {
    if (moderation || postRules.some((r) => r.target === "all")) {
      for (const m of await listInstagramMedia(ready.token, RECENT_MEDIA_FOR_ALL)) mediaIds.add(m.id);
    }
    let processed = 0;
    const since = now.getTime() - PRIVATE_REPLY_WINDOW_MS;
    for (const mediaId of mediaIds) {
      const comments = (await listMediaComments(ready.token, mediaId)).filter((c) => {
        const at = c.timestamp ? Date.parse(c.timestamp) : NaN;
        return c.fromId && Number.isFinite(at) && at >= since;
      });
      if (comments.length === 0) continue;
      const known = await db
        .select({ commentId: schema.instagramCommentEvent.commentId })
        .from(schema.instagramCommentEvent)
        .where(
          scoped(
            schema.instagramCommentEvent.organizationId,
            organizationId,
            inArray(
              schema.instagramCommentEvent.commentId,
              comments.map((c) => c.id)
            )
          )
        );
      const seen = new Set(known.map((k) => k.commentId));
      // Más viejos primero: el orden de la Bandeja queda natural.
      for (const c of comments
        .filter((x) => !seen.has(x.id))
        .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!))) {
        const status = await handleInstagramComment(
          ready,
          {
            commentId: c.id,
            mediaId,
            fromId: c.fromId!,
            username: c.username,
            text: c.text,
            parentId: c.parentId,
            live: false,
            at: new Date(Date.parse(c.timestamp!)),
          },
          "poll",
          now
        );
        if (status) processed++;
      }
    }
    await db
      .update(schema.instagramIntegration)
      .set({ commentsError: null })
      .where(scoped(schema.instagramIntegration.organizationId, organizationId));
    return processed;
  } catch (err) {
    if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
    const message = err instanceof InstagramApiError && err.isUnavailable
      ? "Instagram no respondió la última consulta de comentarios; se reintenta sola"
      : `No se pudieron leer los comentarios: ${friendlyCommentError(err)}`;
    await db
      .update(schema.instagramIntegration)
      .set({ commentsError: message })
      .where(scoped(schema.instagramIntegration.organizationId, organizationId));
    return 0;
  }
}

/** Barrido de todas las empresas con el permiso de comentarios. */
export async function pollDueInstagramComments(now: Date = new Date()): Promise<void> {
  const rows = await getDb()
    .select({
      organizationId: schema.instagramIntegration.organizationId,
      commentsPolledAt: schema.instagramIntegration.commentsPolledAt,
      commentsWebhookAt: schema.instagramIntegration.commentsWebhookAt,
    })
    .from(schema.instagramIntegration)
    .where(
      and(
        eq(schema.instagramIntegration.status, "connected"),
        sql`${schema.instagramIntegration.grantedScopes} @> array['instagram_business_manage_comments']::text[]`
      )
    );
  for (const row of rows) {
    if (!shouldPollComments(row, now)) continue;
    const integration = await getInstagramIntegration(row.organizationId).catch(() => null);
    if (!integration) continue;
    await pollInstagramComments(integration, now).catch((err) =>
      console.warn("[instagram] consulta de comentarios falló:", err instanceof Error ? err.message : err)
    );
  }
}

declare global {
  var __voceroIgCommentsTicker: ReturnType<typeof setInterval> | undefined;
  var __voceroIgCommentsRunning: boolean | undefined;
}

/** Ticker en proceso (sin colas externas), como el de los tokens. */
export function startInstagramCommentsTicker(): void {
  if (globalThis.__voceroIgCommentsTicker) return;
  const run = () => {
    if (globalThis.__voceroIgCommentsRunning) return;
    globalThis.__voceroIgCommentsRunning = true;
    void pollDueInstagramComments()
      .catch((err) => console.warn("[instagram] barrido de comentarios falló:", err instanceof Error ? err.message : err))
      .finally(() => {
        globalThis.__voceroIgCommentsRunning = false;
      });
  };
  globalThis.__voceroIgCommentsTicker = setInterval(run, 20_000);
  globalThis.__voceroIgCommentsTicker.unref?.();
}
