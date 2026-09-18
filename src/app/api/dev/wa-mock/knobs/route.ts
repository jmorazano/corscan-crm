import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState } from "@/server/dev/wa-mock-state";

/**
 * Knobs del harness (008): perillas de fallo determinístico para los caminos
 * infelices del self-test. `failUploads` hace fallar el PRÓXIMO upload
 * resumable con 500 (se auto-apaga al dispararse).
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  failUploads: z.boolean().optional(),
  /** 014: el próximo envío a Graph falla con 500 (503 de cara a la API). */
  failNextSend: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const state = getWaMockState();
  if (body.data.failUploads !== undefined) {
    state.failUploads = body.data.failUploads;
  }
  if (body.data.failNextSend !== undefined) {
    state.failNextSend = body.data.failNextSend;
  }
  return Response.json({
    failUploads: state.failUploads,
    failNextSend: state.failNextSend,
  });
}
