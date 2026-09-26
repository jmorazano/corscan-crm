import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * 023: Instagram es un CANAL (como WhatsApp) y vive en Ajustes → Instagram.
 * Esta ruta queda solo para no romper enlaces viejos.
 */
export default async function InstagramIntegrationRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }
  const qs = params.toString();
  redirect(`/settings/instagram${qs ? `?${qs}` : ""}`);
}
