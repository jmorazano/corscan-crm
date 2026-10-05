import { mockGuard } from "@/lib/dev-guard";
import { getIgMockState, resetIgMockState } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

/** Lo que el CRM mandó por Instagram (y las suscripciones), para el self-test. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getIgMockState();
  return Response.json({
    outbox: s.outbox,
    subscriptions: s.subscriptions,
    account: s.account,
    // 030
    comments: s.comments,
    publicReplies: s.publicReplies,
    hiddenComments: s.hiddenComments,
    messengerProfile: s.messengerProfile,
    lastScope: s.lastScope,
  });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetIgMockState();
  return Response.json({ reset: true });
}
