import { mockGuard } from "@/lib/dev-guard";
import { getGoogleMockState, isValidAccessToken } from "@/server/dev/google-mock-state";

/**
 * Guard común de la API de Calendar simulada: gate de mocks, Bearer válido
 * (401 estilo Google si no) y la bandera "la próxima llamada falla" (500).
 */
export function googleApiGuard(req: Request): Response | null {
  const guard = mockGuard();
  if (guard) return guard;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!isValidAccessToken(bearer)) {
    return Response.json(
      { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } },
      { status: 401 }
    );
  }
  const s = getGoogleMockState();
  if (s.failNextApi) {
    s.failNextApi = false;
    return Response.json(
      { error: { code: 500, message: "Backend Error", status: "INTERNAL" } },
      { status: 500 }
    );
  }
  return null;
}
