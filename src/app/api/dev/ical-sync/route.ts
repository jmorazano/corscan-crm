import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { ageSnapshotsForTest, runSyncTick } from "@/server/ical/sync";

export const dynamic = "force-dynamic";

const Body = z.object({
  organizationId: z.string().optional(),
  /** Deja las lecturas de la empresa como hechas hace `ageMs`. */
  ageMs: z.number().int().min(0).optional(),
  /** Corre una vuelta del ticker (sin espaciado). */
  tick: z.boolean().optional(),
});

/**
 * 051: reloj de los calendarios para el E2E (envejecer lecturas, correr una
 * vuelta del ticker). 404 incondicional en producción.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bad body" }, { status: 400 });
  const { organizationId, ageMs, tick } = parsed.data;
  if (organizationId && ageMs !== undefined) await ageSnapshotsForTest(organizationId, ageMs);
  const synced = tick ? await runSyncTick(new Date(), 0) : 0;
  return Response.json({ ok: true, synced });
}
