import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { AD_TAG, entryLinkTag, slugFromRef } from "@/lib/instagram/entry-links";
import type { IgOrigin } from "@/lib/instagram/types";
import type { InstagramReferral } from "@/lib/instagram/webhook";
import { publish } from "@/server/events/bus";

/**
 * Origen de una conversación de Instagram (030, US5): link `ig.me` con ref,
 * anuncio «Enviar mensaje», o historia. Queda en `conversation.ig_origin`
 * (contexto del agente + lo que ve el equipo) y como etiqueta de la
 * conversación (filtrable en la Bandeja).
 */

function addTag(tag: string) {
  return sql`(select array(select distinct unnest(${schema.conversation.tags} || array[${tag}]::text[])))`;
}

/** La referencia de un link o anuncio → origen + etiqueta + conteo del link. */
export async function applyInstagramReferral(input: {
  organizationId: string;
  conversationId: string;
  currentOrigin: IgOrigin | null;
  referral: InstagramReferral;
  at: Date;
}): Promise<IgOrigin | null> {
  const db = getDb();
  const { organizationId, referral } = input;
  let origin: IgOrigin | null = null;
  let tag: string | null = null;

  if (referral.source === "ADS" || referral.adId) {
    origin = {
      kind: "ad",
      label: referral.adTitle ? `Anuncio: ${referral.adTitle.slice(0, 80)}` : "Anuncio de Instagram",
      ref: referral.adId,
      detail: referral.adTitle,
      at: input.at.toISOString(),
    };
    tag = AD_TAG;
  } else {
    const slug = slugFromRef(referral.ref);
    if (!slug) return null;
    const links = await db
      .select()
      .from(schema.instagramEntryLink)
      .where(
        scoped(
          schema.instagramEntryLink.organizationId,
          organizationId,
          eq(schema.instagramEntryLink.slug, slug)
        )
      )
      .limit(1);
    const link = links[0] ?? null;
    origin = {
      kind: "link",
      label: `Link: ${link?.label ?? slug}`,
      ref: slug,
      linkId: link?.id ?? null,
      instruction: link?.instruction ?? null,
      at: input.at.toISOString(),
    };
    tag = entryLinkTag(slug);
    // Se cuenta UNA vez por conversación y link (abrir el chat dos veces
    // desde el mismo flyer no es otra conversación traída).
    const sameLink = input.currentOrigin?.kind === "link" && input.currentOrigin.ref === slug;
    if (link && !sameLink) {
      await db
        .update(schema.instagramEntryLink)
        .set({ uses: sql`${schema.instagramEntryLink.uses} + 1`, lastUsedAt: input.at })
        .where(eq(schema.instagramEntryLink.id, link.id));
    }
  }

  await db
    .update(schema.conversation)
    .set({ igOrigin: origin, tags: addTag(tag), updatedAt: new Date() })
    .where(
      scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, input.conversationId))
    );
  publish(organizationId, { type: "conversations.updated", data: { conversationIds: [input.conversationId] } });
  return origin;
}

/** Historia: solo marca origen si la conversación no tenía uno mejor. */
export async function applyStoryOrigin(input: {
  organizationId: string;
  conversationId: string;
  currentOrigin: IgOrigin | null;
  kind: "story_reply" | "story_mention";
  at: Date;
}): Promise<void> {
  if (input.currentOrigin) return;
  const origin: IgOrigin = {
    kind: input.kind,
    label: input.kind === "story_reply" ? "Respondió una historia" : "Te mencionó en una historia",
    at: input.at.toISOString(),
  };
  await getDb()
    .update(schema.conversation)
    .set({ igOrigin: origin, updatedAt: new Date() })
    .where(
      scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
    );
}
