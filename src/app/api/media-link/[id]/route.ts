import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mediaLinkSecret, verifyMediaLink } from "@/lib/media-link";
import { contentDisposition, servingPolicy } from "@/lib/outbound-media";

/**
 * Binario de un adjunto SALIENTE por enlace firmado (026). Público a
 * propósito: lo baja Instagram al enviar el adjunto (su Send API solo acepta
 * una URL). Sin firma válida y vigente → 404 (no se confirma ni que exista).
 * Solo sirve adjuntos de mensajes salientes, con la misma política de tipos
 * seguros que la ruta privada.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function notFound(): Response {
  return new Response("No encontrado", { status: 404 });
}

export async function GET(req: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  if (!verifyMediaLink(id, url.searchParams.get("e"), url.searchParams.get("s"), mediaLinkSecret())) {
    return notFound();
  }
  const rows = await getDb()
    .select({
      mimeType: schema.messageMedia.mimeType,
      fileName: schema.messageMedia.fileName,
      data: schema.messageMedia.data,
    })
    .from(schema.messageMedia)
    .innerJoin(schema.message, eq(schema.message.id, schema.messageMedia.messageId))
    .where(and(eq(schema.messageMedia.id, id), eq(schema.message.direction, "out")))
    .limit(1);
  const media = rows[0];
  if (!media) return notFound();

  const body = new Uint8Array(media.data);
  const policy = servingPolicy(media.mimeType);
  return new Response(body, {
    headers: {
      "Content-Type": policy.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(
        policy.inline ? "inline" : "attachment",
        media.fileName
      ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
