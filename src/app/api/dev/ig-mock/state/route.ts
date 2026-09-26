import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getIgMockState } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

const knobs = z.object({
  nextAuthError: z.string().nullable().optional(),
  failNextSend: z.enum(["auth", "error", "down"]).nullable().optional(),
  profileFails: z.boolean().optional(),
  refreshFails: z.boolean().optional(),
  subscribeFails: z.boolean().optional(),
  echoSends: z.boolean().optional(),
  historyFails: z.boolean().optional(),
});

/** Perillas del camino infeliz del ig-mock (one-shot salvo `echoSends`). */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = knobs.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  Object.assign(getIgMockState(), parsed.data);
  return Response.json({ ok: true });
}
