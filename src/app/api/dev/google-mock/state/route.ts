import { mockGuard } from "@/lib/dev-guard";
import { getGoogleMockState, resetGoogleMockState } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/**
 * Inspección y control del mock para conducir el self-test:
 * GET → eventos creados, ocupados externos, tokens revocados, banderas.
 * POST → { busy?: {start,end}, nextAuthError?, issueInvalidRefresh?,
 *          failNextApi?, revokeAll? }.
 * DELETE → reset total.
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getGoogleMockState();
  return Response.json({
    events: s.events,
    busy: s.busy,
    revoked: [...s.revoked],
    nextAuthError: s.nextAuthError,
    issueInvalidRefresh: s.issueInvalidRefresh,
    failNextApi: s.failNextApi,
  });
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as {
    busy?: { start: string; end: string };
    nextAuthError?: string | null;
    issueInvalidRefresh?: boolean;
    failNextApi?: boolean;
    /** Revoca TODO refresh emitido: el próximo refresh → invalid_grant. */
    revokeAll?: boolean;
  };
  const s = getGoogleMockState();
  if (body.busy) s.busy.push(body.busy);
  if (body.nextAuthError !== undefined) s.nextAuthError = body.nextAuthError;
  if (body.issueInvalidRefresh !== undefined) s.issueInvalidRefresh = body.issueInvalidRefresh;
  if (body.failNextApi !== undefined) s.failNextApi = body.failNextApi;
  if (body.revokeAll) {
    for (let i = 1; i <= s.n; i++) s.revoked.add(`mock-refresh-${i}`).add(`mock-access-${i}`);
  }
  return Response.json({ ok: true });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetGoogleMockState();
  return Response.json({ ok: true });
}
