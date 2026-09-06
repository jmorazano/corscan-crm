import { mockGuard } from "@/lib/dev-guard";
import { getGoogleMockState } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/** Revocación simulada: el token (refresh o access) deja de servir. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token) getGoogleMockState().revoked.add(token);
  return Response.json({});
}
