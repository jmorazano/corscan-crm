import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseByteRange } from "@/lib/http-range";

/**
 * Binario de una nota de voz (015). PRIVADO: sesión + tenant (a diferencia
 * de template_media, nadie externo lo necesita). Soporta `Range` (206):
 * iOS Safari no reproduce un `<audio>` cuyo origen no responda 206 a
 * `bytes=0-1`.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const rows = await db
    .select({
      mimeType: schema.messageMedia.mimeType,
      sizeBytes: schema.messageMedia.sizeBytes,
      data: schema.messageMedia.data,
    })
    .from(schema.messageMedia)
    .where(
      scoped(
        schema.messageMedia.organizationId,
        session.organizationId,
        eq(schema.messageMedia.id, id)
      )
    )
    .limit(1);
  const media = rows[0];
  if (!media) return apiError(404, "not_found", "Audio no encontrado");

  const full = new Uint8Array(media.data);
  const total = full.byteLength;
  const baseHeaders: Record<string, string> = {
    "Content-Type": media.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": "inline",
  };

  const range = parseByteRange(req.headers.get("range"), total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
    });
  }
  if (range) {
    const slice = full.subarray(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        "Content-Length": String(slice.byteLength),
      },
    });
  }
  return new Response(full, {
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
});
