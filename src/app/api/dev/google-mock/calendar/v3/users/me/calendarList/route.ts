import { googleApiGuard } from "@/server/dev/google-mock-api";
import { MOCK_CALENDARS } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  return Response.json({
    kind: "calendar#calendarList",
    items: MOCK_CALENDARS.map((c) => ({ ...c, accessRole: "owner" })),
  });
}
