import { eq } from "drizzle-orm";
import { apiError, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { getConversation, serializeConversation } from "@/server/inbox/queries";
import { ChangeError, revertChange } from "@/server/trainer/changes";
import { getTrainerConversation } from "@/server/trainer/conversation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const STATUS: Record<ChangeError["code"], number> = {
  not_found: 404,
  already_reverted: 409,
  target_conflict: 409,
};

/**
 * Deshace un cambio del entrenador (015, FR-008): restaura el estado
 * anterior y deja constancia en el hilo («Deshice: …»).
 */
export const POST = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  let change;
  try {
    change = await revertChange(session.organizationId, id, session.userId);
  } catch (err) {
    if (err instanceof ChangeError) {
      return apiError(STATUS[err.code], err.code, err.message);
    }
    throw err;
  }

  const trainer = await getTrainerConversation(session.organizationId);
  if (trainer) {
    const db = getDb();
    const now = new Date();
    const inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId: session.organizationId,
        conversationId: trainer.conversation.id,
        direction: "in",
        type: "text",
        text: `Deshice: ${change.summary}`,
        status: "delivered",
        aiGenerated: false,
        waTimestamp: now,
      })
      .returning();
    await db
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, trainer.conversation.id));
    if (inserted[0]) {
      publish(session.organizationId, {
        type: "message.new",
        data: {
          conversationId: trainer.conversation.id,
          message: serializeMessage(inserted[0]),
        },
      });
    }
    const fresh = await getConversation(session.organizationId, trainer.conversation.id);
    if (fresh) {
      publish(session.organizationId, {
        type: "conversation.updated",
        data: { conversation: serializeConversation(fresh.conversation, fresh.contact) },
      });
    }
  }
  return Response.json({ change });
});
