import { parseBody, withAuth } from "@/lib/api";
import { createEntry, kbCreateSchema, listEntries } from "@/server/kb/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const entries = await listEntries(session.organizationId);
  return Response.json({ entries });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, kbCreateSchema);
  if (!body.ok) return body.response;
  const entry = await createEntry(session.organizationId, body.data, "manual");
  return Response.json({ entry }, { status: 201 });
});
