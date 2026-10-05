import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  InstagramApiError,
  deleteMessengerProfile,
  listInstagramMediaPage,
  setMessengerProfile,
  type IgMedia,
} from "@/lib/instagram/client";
import { ruleColumns, type CommentRuleInput } from "@/lib/instagram/comments";
import { entryLinkTag, igMeLink, slugify, type EntryLinkInput } from "@/lib/instagram/entry-links";
import { cleanIceBreakers, iceBreakersBody, persistentMenuBody, type MessagingProfileInput } from "@/lib/instagram/profile";
import type { IgMenuItem } from "@/lib/instagram/types";
import {
  ensureInstagramToken,
  getInstagramIntegration,
  markInstagramReconnectRequired,
} from "@/server/instagram/integration";
import { friendlyCommentError } from "@/server/instagram/comments";

/**
 * Configuración de crecimiento de Instagram por empresa (030): primer
 * contacto (ice breakers + menú), reglas de comentarios, moderación y links
 * con origen. Todo pasa por `scoped()`; las escrituras las hace solo el
 * propietario (las rutas usan `withOwner`).
 */

export class InstagramConfigError extends Error {
  constructor(
    public readonly code: "not_connected" | "reconnect_required" | "meta_error" | "not_found" | "slug_taken",
    message: string
  ) {
    super(message);
    this.name = "InstagramConfigError";
  }
}

async function readyIntegration(organizationId: string) {
  const integration = await getInstagramIntegration(organizationId);
  if (!integration) throw new InstagramConfigError("not_connected", "No hay una cuenta de Instagram conectada");
  const ready = await ensureInstagramToken(integration);
  if (ready.status === "reconnect_required") {
    throw new InstagramConfigError("reconnect_required", "La conexión con Instagram venció: reconectá la cuenta");
  }
  return ready;
}

/* ============================================================
 * Primer contacto (US4)
 * ============================================================ */

/**
 * Aplica en Instagram lo guardado (o lo nuevo). Una lista vacía BORRA lo que
 * hubiera en Instagram. Guarda primero, aplica después: si Meta falla, el
 * error queda visible y «Guardar» lo reintenta.
 */
export async function saveMessagingProfile(
  organizationId: string,
  input: MessagingProfileInput
): Promise<{ synced: boolean; error: string | null }> {
  const iceBreakers = cleanIceBreakers(input.iceBreakers);
  const menu = input.menu as IgMenuItem[];
  await getDb()
    .update(schema.instagramIntegration)
    .set({ iceBreakers, persistentMenu: menu, updatedAt: new Date() })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));
  return applyMessagingProfile(organizationId);
}

export async function applyMessagingProfile(
  organizationId: string
): Promise<{ synced: boolean; error: string | null }> {
  const integration = await readyIntegration(organizationId);
  const db = getDb();
  let error: string | null = null;
  try {
    if (integration.iceBreakers.length > 0) {
      await setMessengerProfile(integration.token, integration.igUserId, iceBreakersBody(integration.iceBreakers));
    } else {
      await deleteMessengerProfile(integration.token, integration.igUserId, ["ice_breakers"]).catch(() => {});
    }
    if (integration.persistentMenu.length > 0) {
      await setMessengerProfile(integration.token, integration.igUserId, persistentMenuBody(integration.persistentMenu));
    } else {
      await deleteMessengerProfile(integration.token, integration.igUserId, ["persistent_menu"]).catch(() => {});
    }
  } catch (err) {
    if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
    error = friendlyCommentError(err);
  }
  await db
    .update(schema.instagramIntegration)
    .set(error ? { profileError: error } : { profileError: null, profileSyncedAt: new Date() })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));
  return { synced: !error, error };
}

/* ============================================================
 * Publicaciones (para elegir en una regla)
 * ============================================================ */

export async function listRecentMedia(
  organizationId: string,
  after: string | null = null
): Promise<{ media: IgMedia[]; next: string | null }> {
  const integration = await readyIntegration(organizationId);
  try {
    return await listInstagramMediaPage(integration.token, { limit: 24, after });
  } catch (err) {
    if (err instanceof InstagramApiError && err.isAuthError) await markInstagramReconnectRequired(organizationId);
    throw new InstagramConfigError("meta_error", friendlyCommentError(err));
  }
}

/* ============================================================
 * Reglas de comentarios (US1) y moderación (US2)
 * ============================================================ */

export type CommentRuleView = {
  id: string;
  name: string;
  target: "media" | "all" | "live";
  media: (typeof schema.instagramCommentRule.$inferSelect)["mediaPreview"];
  keywords: string[];
  dmText: string;
  buttonLabel: string | null;
  followUpText: string | null;
  publicReplies: string[];
  active: boolean;
  createdAt: string;
  stats: { replied: number; followUps: number };
};

export async function listCommentRules(organizationId: string): Promise<CommentRuleView[]> {
  const db = getDb();
  const rules = await db
    .select()
    .from(schema.instagramCommentRule)
    .where(scoped(schema.instagramCommentRule.organizationId, organizationId))
    .orderBy(asc(schema.instagramCommentRule.createdAt));
  const events = await db
    .select({
      ruleId: schema.instagramCommentEvent.ruleId,
      status: schema.instagramCommentEvent.status,
      followUpDoneAt: schema.instagramCommentEvent.followUpDoneAt,
    })
    .from(schema.instagramCommentEvent)
    .where(
      scoped(
        schema.instagramCommentEvent.organizationId,
        organizationId,
        eq(schema.instagramCommentEvent.status, "replied")
      )
    );
  return rules.map((r) => {
    const mine = events.filter((e) => e.ruleId === r.id);
    return {
      id: r.id,
      name: r.name,
      target: r.target,
      media: r.mediaPreview,
      keywords: r.keywords,
      dmText: r.dmText,
      buttonLabel: r.buttonLabel,
      followUpText: r.followUpText,
      publicReplies: r.publicReplies,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      stats: {
        replied: mine.length,
        followUps: r.followUpText ? mine.filter((e) => e.followUpDoneAt).length : 0,
      },
    };
  });
}

export async function createCommentRule(organizationId: string, input: CommentRuleInput): Promise<string> {
  const id = newId("instagramCommentRule");
  await getDb()
    .insert(schema.instagramCommentRule)
    .values({ id, organizationId, ...ruleColumns(input) });
  return id;
}

export async function updateCommentRule(organizationId: string, id: string, input: CommentRuleInput): Promise<void> {
  const updated = await getDb()
    .update(schema.instagramCommentRule)
    .set({ ...ruleColumns(input), updatedAt: new Date() })
    .where(scoped(schema.instagramCommentRule.organizationId, organizationId, eq(schema.instagramCommentRule.id, id)))
    .returning({ id: schema.instagramCommentRule.id });
  if (!updated[0]) throw new InstagramConfigError("not_found", "La regla no existe");
}

export async function setCommentRuleActive(organizationId: string, id: string, active: boolean): Promise<void> {
  const updated = await getDb()
    .update(schema.instagramCommentRule)
    .set({ active, updatedAt: new Date() })
    .where(scoped(schema.instagramCommentRule.organizationId, organizationId, eq(schema.instagramCommentRule.id, id)))
    .returning({ id: schema.instagramCommentRule.id });
  if (!updated[0]) throw new InstagramConfigError("not_found", "La regla no existe");
}

export async function deleteCommentRule(organizationId: string, id: string): Promise<void> {
  await getDb()
    .delete(schema.instagramCommentRule)
    .where(scoped(schema.instagramCommentRule.organizationId, organizationId, eq(schema.instagramCommentRule.id, id)));
}

export async function saveModerationWords(organizationId: string, words: string[]): Promise<void> {
  await getDb()
    .update(schema.instagramIntegration)
    .set({ moderationWords: words, updatedAt: new Date() })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));
}

export type CommentActivityItem = {
  commentId: string;
  username: string | null;
  text: string | null;
  status: (typeof schema.instagramCommentEvent.$inferSelect)["status"];
  detail: string | null;
  hidden: boolean;
  live: boolean;
  source: "webhook" | "poll";
  ruleName: string | null;
  conversationId: string | null;
  publicReply: boolean;
  at: string;
};

export async function listCommentActivity(organizationId: string, limit = 30): Promise<CommentActivityItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      event: schema.instagramCommentEvent,
      ruleName: schema.instagramCommentRule.name,
    })
    .from(schema.instagramCommentEvent)
    .leftJoin(schema.instagramCommentRule, eq(schema.instagramCommentRule.id, schema.instagramCommentEvent.ruleId))
    .where(scoped(schema.instagramCommentEvent.organizationId, organizationId))
    .orderBy(desc(schema.instagramCommentEvent.createdAt))
    .limit(200);
  return rows
    // Lo ignorado de la propia cuenta no le dice nada al dueño.
    .filter((r) => !(r.event.status === "ignored" && r.event.detail === "Comentario de la propia cuenta"))
    .slice(0, limit)
    .map((r) => ({
      commentId: r.event.commentId,
      username: r.event.username,
      text: r.event.text,
      status: r.event.status,
      detail: r.event.detail,
      hidden: r.event.hidden,
      live: r.event.live,
      source: r.event.source,
      ruleName: r.ruleName ?? null,
      conversationId: r.event.conversationId,
      publicReply: !!r.event.publicReplyId,
      at: (r.event.commentedAt ?? r.event.createdAt).toISOString(),
    }));
}

/* ============================================================
 * Links con origen (US5)
 * ============================================================ */

export type EntryLinkView = {
  id: string;
  slug: string;
  label: string;
  instruction: string | null;
  url: string | null;
  tag: string;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
};

export async function listEntryLinks(organizationId: string): Promise<EntryLinkView[]> {
  const db = getDb();
  const integration = await db
    .select({ username: schema.instagramIntegration.username })
    .from(schema.instagramIntegration)
    .where(scoped(schema.instagramIntegration.organizationId, organizationId))
    .limit(1);
  const username = integration[0]?.username ?? null;
  const rows = await db
    .select()
    .from(schema.instagramEntryLink)
    .where(scoped(schema.instagramEntryLink.organizationId, organizationId))
    .orderBy(asc(schema.instagramEntryLink.createdAt));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    instruction: r.instruction,
    url: username ? igMeLink(username, r.slug) : null,
    tag: entryLinkTag(r.slug),
    uses: r.uses,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createEntryLink(organizationId: string, input: EntryLinkInput): Promise<string> {
  const slug = input.slug ?? slugify(input.label);
  if (slug.length < 2) {
    throw new InstagramConfigError("meta_error", "Elegí un identificador de al menos 2 letras o números");
  }
  const id = newId("instagramEntryLink");
  const inserted = await getDb()
    .insert(schema.instagramEntryLink)
    .values({ id, organizationId, slug, label: input.label, instruction: input.instruction })
    .onConflictDoNothing({ target: [schema.instagramEntryLink.organizationId, schema.instagramEntryLink.slug] })
    .returning({ id: schema.instagramEntryLink.id });
  if (!inserted[0]) throw new InstagramConfigError("slug_taken", `Ya hay un link con el identificador «${slug}»`);
  return id;
}

export async function updateEntryLink(
  organizationId: string,
  id: string,
  input: { label: string; instruction: string | null }
): Promise<void> {
  const updated = await getDb()
    .update(schema.instagramEntryLink)
    .set({ label: input.label, instruction: input.instruction })
    .where(scoped(schema.instagramEntryLink.organizationId, organizationId, eq(schema.instagramEntryLink.id, id)))
    .returning({ id: schema.instagramEntryLink.id });
  if (!updated[0]) throw new InstagramConfigError("not_found", "El link no existe");
}

export async function deleteEntryLink(organizationId: string, id: string): Promise<void> {
  await getDb()
    .delete(schema.instagramEntryLink)
    .where(scoped(schema.instagramEntryLink.organizationId, organizationId, eq(schema.instagramEntryLink.id, id)));
}

export async function getEntryLink(organizationId: string, id: string) {
  const links = await listEntryLinks(organizationId);
  return links.find((l) => l.id === id) ?? null;
}
