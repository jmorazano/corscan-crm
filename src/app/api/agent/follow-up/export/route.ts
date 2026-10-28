import { withOwner } from "@/lib/api";
import { exportFollowUpCsv } from "@/server/follow-up/settings";

export const dynamic = "force-dynamic";

/** 042: el registro de seguimientos (90 días) en CSV. Solo el propietario. */
export const GET = withOwner(async (session) => {
  const csv = await exportFollowUpCsv(session.organizationId);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="seguimientos-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
