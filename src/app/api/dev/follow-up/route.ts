import { mockGuard } from "@/lib/dev-guard";
import { runFollowUpSweep } from "@/server/follow-up/sweep";

export const dynamic = "force-dynamic";

/**
 * 042: corre UN barrido de seguimientos con el reloj que se le pase
 * (`{ "now": "<ISO>" }`), para conducir las 2 h y las 20 h en el E2E sin
 * esperarlas. El envío real sigue validando la ventana con la hora del
 * servidor. 404 incondicional en producción.
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
  const result = await runFollowUpSweep(now);
  return Response.json({ now: now.toISOString(), ...result });
}
