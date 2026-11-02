import { mockGuard } from "@/lib/dev-guard";
import { runAttentionSweep } from "@/server/attention/sweep";

export const dynamic = "force-dynamic";

/**
 * 048: corre UN barrido de esperas con el reloj que se le pase
 * (`{ "now": "<ISO>" }`), para conducir los minutos del aviso y las 24 h en
 * el E2E sin esperarlos. 404 incondicional en producción.
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
  const result = await runAttentionSweep(now);
  return Response.json({ now: now.toISOString(), ...result });
}
