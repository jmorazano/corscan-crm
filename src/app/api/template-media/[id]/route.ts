import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Binario del encabezado de una plantilla (008). PÚBLICO sin auth: Meta
 * descarga esta URL en cada envío de la plantilla. El id (tm_… nanoid) es el
 * secreto de la URL; solo expone la imagen de marketing que el operador
 * eligió difundir masivamente — jamás datos de contactos ni de la empresa.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  const rows = await db
    .select({
      mime: schema.templateMedia.mime,
      bytes: schema.templateMedia.bytes,
    })
    .from(schema.templateMedia)
    .where(eq(schema.templateMedia.id, id))
    .limit(1);
  const media = rows[0];
  if (!media) {
    return new Response("No encontrado", { status: 404 });
  }
  const body = new Uint8Array(media.bytes);
  return new Response(body, {
    headers: {
      "Content-Type": media.mime,
      "Content-Length": String(body.byteLength),
      // El binario de un tm_ jamás cambia (reemplazo = id nuevo): cacheable
      // para siempre, y Meta lo re-pide poco.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
