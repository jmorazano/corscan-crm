import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING, isValidHex, resolveAccentSet } from "@/lib/branding";
import { PWA_ICON_SIZES, type PwaIconSize } from "@/lib/pwa";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ size: string }> };

/**
 * Ícono PWA generado en runtime (012, FR-003): la inicial de la marca sobre
 * su acento. `ImageResponse` viene con Next (sin dependencias nuevas ni
 * servicios externos). Público y cacheable: nombre y color ya son visibles
 * en la UI. `maskable=1` rellena todo el lienzo (Android recorta él).
 */
export async function GET(req: Request, ctx: Params) {
  const { size } = await ctx.params;
  const px = (PWA_ICON_SIZES as readonly number[]).includes(Number(size))
    ? (Number(size) as PwaIconSize)
    : 192;
  const url = new URL(req.url);
  const rawAccent = (url.searchParams.get("accent") ?? "").toLowerCase();
  const accentHex = isValidHex(`#${rawAccent}`) ? `#${rawAccent}` : DEFAULT_BRANDING.accent;
  const name = (url.searchParams.get("name") ?? DEFAULT_BRANDING.name).trim();
  const letter = (name.charAt(0) || "V").toUpperCase();
  const maskable = url.searchParams.get("maskable") === "1";
  const accent = resolveAccentSet(accentHex).accent;
  const radius = maskable ? 0 : Math.round(px * 0.22);
  const fontSize = Math.round(px * (maskable ? 0.44 : 0.56));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: accent,
          borderRadius: radius,
          color: "#ffffff",
          fontSize,
          fontFamily: "sans-serif",
        }}
      >
        {letter}
      </div>
    ),
    {
      width: px,
      height: px,
      headers: { "cache-control": "public, max-age=86400" },
    }
  );
}
