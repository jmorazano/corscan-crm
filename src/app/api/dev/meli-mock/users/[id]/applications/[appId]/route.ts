import { mockGuard } from "@/lib/dev-guard";
import { getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/** Revocación del permiso de la app (desconectar). */
export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getMeliMockState();
  s.revoked = true;
  s.validAccess.clear();
  s.currentRefresh = null;
  return Response.json({ user_id: s.userId, app_id: "mock", msg: "Autorización eliminada" });
}
