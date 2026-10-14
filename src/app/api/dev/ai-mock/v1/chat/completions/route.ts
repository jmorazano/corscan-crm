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
  // 031: `-nocredit` = cuenta de OpenRouter sin saldo (402), el caso que el
  // hilo tiene que explicar en criollo.
  if (bearer.endsWith("-nocredit")) {
    return Response.json(
      { error: { message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits", code: 402 } },
      { status: 402 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: Parameters<typeof aiMockCompletion>[0];
  };
  // `-prose` = el proveedor responde pero en prosa, sin JSON (el modelo
  // «charla» en vez de devolver la acción): los tres intentos del adaptador
  // fallan y el turno tiene que decirlo como lo que es, no como una caída.
  const content = bearer.endsWith("-prose")
    ? "Claro, lo tengo en cuenta: no insisto con la demo y paso la conversación a una persona."
    : aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
