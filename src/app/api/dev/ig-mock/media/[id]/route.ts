import { mockGuard } from "@/lib/dev-guard";
import { mockMediaFor } from "@/server/dev/wa-mock-media";

/** CDN de adjuntos de Instagram simulada (023): mismos binarios que el wa-mock. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await ctx.params;
  if (id.includes("gone")) return new Response(null, { status: 404 });
  const media = mockMediaFor(id);
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.bytes.byteLength),
    },
  });
}
