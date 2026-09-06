import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { exchangeCode, GoogleAuthError, verifyState } from "@/lib/google/oauth";
import {
  connectCalendarIntegration,
  getCalendarIntegrationView,
  listCalendars,
  updateCalendarIntegration,
} from "@/server/calendar/integration";

export const dynamic = "force-dynamic";

/**
 * Callback del OAuth (contrato integrations-api.md): SIEMPRE redirige a la
 * página de la integración con `?connected=1` o `?error=…`. Nada de acá
 * loguea el `code` ni tokens.
 */
export async function GET(req: Request): Promise<Response> {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/integrations/google-calendar?${q}`, 302);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const providerError = url.searchParams.get("error");

  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.redirect(`${base}/login`, 302);
  }
  if (session.role !== "owner") return back("error=forbidden");

  const parsed = verifyState(state, env.BETTER_AUTH_SECRET);
  if (!parsed || parsed.orgId !== session.organizationId || parsed.userId !== session.userId) {
    return back("error=state");
  }
  if (providerError || !code) {
    return back(providerError === "access_denied" ? "error=cancelled" : "error=exchange");
  }

  try {
    const tokens = await exchangeCode(code);
    await connectCalendarIntegration({
      organizationId: session.organizationId,
      userId: session.userId,
      tokens,
    });
  } catch (err) {
    console.error(
      "[integraciones] canje de Google falló:",
      err instanceof GoogleAuthError ? `${err.code}: ${err.message}` : err
    );
    return back("error=exchange");
  }

  // Best-effort: nombre del calendario principal para la UI. Solo en la
  // primera conexión (una reconexión conserva el calendario ya elegido).
  try {
    const current = await getCalendarIntegrationView(session.organizationId);
    const calendars = current?.calendarId === "primary" ? await listCalendars(session.organizationId) : [];
    const primary = calendars.find((c) => c.primary) ?? calendars[0];
    if (primary) {
      await updateCalendarIntegration(session.organizationId, {
        calendarId: primary.id,
        calendarName: primary.summary,
      });
    }
  } catch {
    // la conexión ya quedó hecha; el nombre se resuelve después
  }
  return back("connected=1");
}
