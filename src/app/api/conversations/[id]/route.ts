import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import { recordConversationEvent } from "@/server/ai/events";
import {
  serializeConversation,
  getConversation,
  updateConversation,
  deleteConversation,
} from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
  /** 012: «marcar como no leída» desde la fila (gesto o atajo). */
  markUnread: z.boolean().optional(),
  /** 006: reemplaza las etiquetas de la conversación (saneadas). */
  tags: z.array(z.string().max(80)).max(30).optional(),
});

type Params = { params: Promise<{ id: string }> };

type ConversationState = { aiEnabled: boolean; handoffAt: Date | null };

/** 031: qué cambió en la IA del chat (o null si nada). */
function toggleReason(
  before: ConversationState,
  after: ConversationState,
  reactivate: boolean
): "paused" | "enabled" | "reactivated" | null {
  if (reactivate && before.handoffAt && !after.handoffAt) return "reactivated";
  if (before.aiEnabled && !after.aiEnabled) return "paused";
  if (!before.aiEnabled && after.aiEnabled) return "enabled";
  return null;
}

async function userName(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return rows[0]?.name ?? null;
}

/** Una conversación por id (006): el hilo abierto no depende de la página. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json({
    conversation: serializeConversation(row.conversation, row.contact),
  });
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // 031: el estado ANTES, para dejar en el hilo quién prendió o apagó la IA
  // (solo si cambió de verdad).
  const before = await getConversation(session.organizationId, id);
  const updated = await updateConversation(session.organizationId, id, body.data);
  if (!updated) return apiError(404, "not_found", "Conversación no encontrada");
  if (before && updated.kind !== "trainer") {
    const toggle = toggleReason(before.conversation, updated, body.data.reactivate === true);
    if (toggle) {
      await recordConversationEvent({
        organizationId: session.organizationId,
        conversationId: id,
        kind: "ai_toggled",
        reason: toggle,
        actor: { userId: session.userId, name: await userName(session.userId) },
      });
    }
  }

  const row = await getConversation(session.organizationId, id);
  if (row) {
    const dto = serializeConversation(row.conversation, row.contact);
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: dto },
    });
    return Response.json({ conversation: dto });
  }
  return Response.json({ conversation: null });
});

/**
 * Borra la conversación y sus mensajes. Solo afecta al CRM: la Cloud API no
 * tiene noción de borrar chats, así que del lado de WhatsApp no cambia nada.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // 015: la conversación del entrenador es fija (se puede vaciar, no borrar).
  const current = await getConversation(session.organizationId, id);
  if (current?.conversation.kind === "trainer") {
    return apiError(
      409,
      "trainer_conversation",
      "La conversación con tu agente no se puede borrar; podés vaciarla desde su panel"
    );
  }
  const deleted = await deleteConversation(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Conversación no encontrada");
  publish(session.organizationId, {
    type: "conversation.deleted",
    data: { conversationId: id },
  });
  return Response.json({ ok: true });
});
