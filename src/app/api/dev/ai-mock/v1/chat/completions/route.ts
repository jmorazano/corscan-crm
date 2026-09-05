import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  // Convención compartida con el wa-mock: un token con sufijo mágico
  // `-invalid` simula el rechazo del proveedor (test del camino infeliz:
  // el turno del agente debe degradar sin colgarse).
  const bearer = req.headers.get("authorization") ?? "";
  if (bearer.endsWith("-invalid")) {
    return Response.json(
      { error: { message: "Invalid API key provided", code: 401 } },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
  };
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
