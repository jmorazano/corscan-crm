import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { assistantResource } from "@/server/assistants/authorize";
import { listConnectionsForOrganization } from "@/server/assistants/grants";
import { getAssistantSettings, setAssistantsEnabled } from "@/server/assistants/settings";

export const dynamic = "force-dynamic";

async function view(organizationId: string) {
  const [settings, connections] = await Promise.all([
    getAssistantSettings(organizationId),
    listConnectionsForOrganization(organizationId),
  ]);
  return { ...settings, connectorUrl: assistantResource(), connections };
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
