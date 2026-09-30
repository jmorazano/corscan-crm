import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseByteRange } from "@/lib/http-range";
import { contentDisposition, servingPolicy } from "@/lib/outbound-media";

/**
 * Binario de un adjunto (015 notas de voz; 020 lo que manda el cliente;
 * 026 lo que manda el equipo). PRIVADO: sesión + tenant (a diferencia de
 * template_media, nadie externo lo necesita). Soporta `Range` (206): iOS
 * Safari no reproduce un `<audio>`/`<video>` cuyo origen no responda 206 a
 * `bytes=0-1`.
 *
 * 026: lo que manda un cliente es un dato EXTERNO — inline solo los tipos
 * que el navegador muestra sin ejecutar (`servingPolicy`), `nosniff`
 * siempre, y `?download=1` baja el archivo con su nombre original.
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
      fileName: schema.messageMedia.fileName,
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
  if (!media) return apiError(404, "not_found", "Archivo no encontrado");

  const full = new Uint8Array(media.data);
  const total = full.byteLength;
  const policy = servingPolicy(media.mimeType);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const baseHeaders: Record<string, string> = {
    "Content-Type": policy.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": contentDisposition(
      policy.inline && !download ? "inline" : "attachment",
      media.fileName
    ),
    "X-Content-Type-Options": "nosniff",
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
