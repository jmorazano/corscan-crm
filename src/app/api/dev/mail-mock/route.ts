import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getMailMockState, resetMailMockState } from "@/lib/mail/mock-outbox";

export const dynamic = "force-dynamic";

/**
 * Bandeja del mail-mock (029): con el entorno de pruebas activo los correos
 * no salen a ningún SMTP y quedan acá. 404 incondicional en producción.
 *
 * GET → { messages, failNext, disabled } · DELETE → vacía y apaga knobs ·
 * POST { failNext?, disabled? } → camino infeliz (SMTP caído / sin SMTP).
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json(getMailMockState());
}

const knobsSchema = z.object({
  failNext: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = knobsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "knobs inválidos" }, { status: 400 });
  }
  const state = getMailMockState();
  if (parsed.data.failNext !== undefined) state.failNext = parsed.data.failNext;
  if (parsed.data.disabled !== undefined) state.disabled = parsed.data.disabled;
  return Response.json({ failNext: state.failNext, disabled: state.disabled });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetMailMockState();
  return Response.json({ cleared: true });
}
