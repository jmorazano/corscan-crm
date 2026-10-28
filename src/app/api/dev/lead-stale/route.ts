import { mockGuard } from "@/lib/dev-guard";
import { runStaleSweep } from "@/server/inbox/lead-stale";

export const dynamic = "force-dynamic";

/**
 * 044: corre UN barrido de «días sin respuesta» con el reloj que se le pase
 * (`{ "now": "<ISO>" }`), para el E2E. 404 incondicional en producción.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  let now = new Date();
  try {
    const body = (await req.json()) as { now?: unknown };
    if (typeof body.now === "string") {
      const parsed = new Date(body.now);
      if (!Number.isNaN(parsed.getTime())) now = parsed;
    }
  } catch {
    // sin cuerpo: ahora
  }
  const result = await runStaleSweep(now);
  return Response.json({ now: now.toISOString(), ...result });
}
