import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { requireSessionUser } from "@/lib/auth/session";
import { buildRedirect } from "@/lib/oauth-server/params";
import { clientLabelFor } from "@/lib/oauth-server/redirect-uris";
import { getBranding } from "@/server/branding";
import { consentWorkspaces, validateAuthorize } from "@/server/assistants/authorize";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Consentimiento de un asistente (040, research D6, contracts/oauth.md §4).
 * Fuera de `(app)`: sin shell ni redirección por rol. Cliente o retorno
 * desconocidos → error acá, sin redirigir a un destino no validado.
 */
export default async function AuthorizePage({ searchParams }: Props) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string") params[k] = value;
  }
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);

  const { validation, clientName } = await validateAuthorize(params);
  if (validation.kind === "fatal") {
    return (
      <Frame brand={branding.name}>
        <Card>
          <CardHeader>
            <CardTitle>No se puede conectar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-2">{validation.message}</p>
          </CardContent>
        </Card>
      </Frame>
    );
  }
  if (validation.kind === "redirect") {
    redirect(
      buildRedirect(
        validation.redirectUri,
        { error: validation.error, error_description: validation.description },
        validation.state
      )
    );
  }

  const selfPath = `/oauth/authorize?${new URLSearchParams(params).toString()}`;
  const user = await requireSessionUser().catch(() => null);
  if (!user) redirect(`/login?next=${encodeURIComponent(selfPath)}`);
  const pending = await getDb()
    .select({ pending: schema.user.mustChangePassword })
    .from(schema.user)
    .where(eq(schema.user.id, user.userId))
    .limit(1);
  if (pending[0]?.pending) redirect(`/change-password?next=${encodeURIComponent(selfPath)}`);

  const workspaces = await consentWorkspaces(user.userId);
  const request = validation.request;
  return (
    <Frame brand={branding.name}>
      <ConsentForm
        request={request}
        clientLabel={clientLabelFor(request.redirectUri)}
        clientName={clientName}
        email={user.email}
        workspaces={workspaces}
      />
    </Frame>
  );
}

function Frame({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-lg font-bold text-white">
            {brand.charAt(0).toUpperCase()}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{brand}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
