import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState } from "@/server/dev/wa-mock-state";
import { mockMediaFor } from "@/server/dev/wa-mock-media";

/**
 * El binario del adjunto (020). En Meta esto vive en `lookaside.fbcdn.net`,
 * fuera de la Graph API: por eso es una ruta aparte y no un `path` más del
 * mock de Graph. El descargador real valida el host, y el guard anti-SSRF
 * acepta el host del mock SOLO con el gate de mocks activo.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;

  const { id } = await ctx.params;
  const state = getWaMockState();

  // Knob del camino infeliz: la CDN de Meta se cae o el medio ya venció.
  if (state.mediaDownloadFails) {
    state.mediaDownloadFails = false;
    return new Response(null, { status: 404 });
  }

  // Meta exige User-Agent en este pedido; sin él responde 403. El mock lo
  // exige también para que el self-test detecte si se dejara de mandar.
  if (!req.headers.get("user-agent")) {
    return new Response(null, { status: 403 });
  }

  const media = mockMediaFor(id);
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.bytes.byteLength),
    },
  });
}
