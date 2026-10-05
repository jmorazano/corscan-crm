import { apiError, withOwner } from "@/lib/api";
import { qrSvg } from "@/lib/qr";
import { getEntryLink } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 030: QR del link en SVG (`?download=1` lo baja como archivo). */
export const GET = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const link = await getEntryLink(session.organizationId, id);
  if (!link) return apiError(404, "not_found", "El link no existe");
  if (!link.url) return apiError(409, "not_connected", "Conectá la cuenta de Instagram para generar el link");
  const svg = qrSvg(link.url);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="qr-instagram-${link.slug}.svg"` } : {}),
    },
  });
});
