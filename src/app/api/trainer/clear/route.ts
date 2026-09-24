import { apiError, withOwner } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { getConversation, serializeConversation } from "@/server/inbox/queries";
import { clearTrainerConversation } from "@/server/ai/trainer";
import { getTrainerConversation } from "@/server/trainer/conversation";

export const dynamic = "force-dynamic";

/** Vacía el hilo con el agente; la auditoría de cambios se conserva. */
export const POST = withOwner(async (session) => {
  const trainer = await getTrainerConversation(session.organizationId);
  if (!trainer) return apiError(404, "not_found", "No hay conversación con el agente");
  const deleted = await clearTrainerConversation(
    session.organizationId,
    trainer.conversation.id
  );
  const fresh = await getConversation(session.organizationId, trainer.conversation.id);
  if (fresh) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: serializeConversation(fresh.conversation, fresh.contact) },
    });
  }
  return Response.json({ ok: true, deleted });
});
