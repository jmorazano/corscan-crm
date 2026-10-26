import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { assistantResource } from "@/server/assistants/authorize";
import { listConnectionsForOrganization } from "@/server/assistants/grants";
import { getAssistantSettings, setAssistantsEnabled, TEACHING_SINCE } from "@/server/assistants/settings";
import { getTrainerConversation } from "@/server/trainer/conversation";

export const dynamic = "force-dynamic";

async function view(organizationId: string) {
  const [settings, connections, trainer] = await Promise.all([
    getAssistantSettings(organizationId),
    listConnectionsForOrganization(organizationId),
    getTrainerConversation(organizationId),
  ]);
  return {
    ...settings,
    connectorUrl: assistantResource(),
    connections,
    // 041: dónde se ven y se deshacen los cambios que hizo Claude.
    trainerConversationId: trainer?.conversation.id ?? null,
    // 041: hay conexiones de antes de que el switch también dejara enseñar.
    teachingNotice: connections.some(
      (c) => c.status === "active" && new Date(c.createdAt).getTime() < TEACHING_SINCE.getTime()
    ),
  };
}

/**
 * Ajustes → Asistentes (040, contracts/settings-api.md): switch de la
 * empresa, dirección del conector y conexiones con acceso. Solo propietario.
 */
export const GET = withOwner(async (session) => Response.json(await view(session.organizationId)));

const patchSchema = z.object({ enabled: z.boolean() });

export const PATCH = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  await setAssistantsEnabled(session.organizationId, body.data.enabled, session.userId);
  return Response.json(await view(session.organizationId));
});
