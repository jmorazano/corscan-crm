import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { pwaIconUrl } from "@/lib/pwa";
import { getBranding } from "@/server/branding";
import { getOrCreateVapidKeys, vapidSubject } from "./keys";
import { sendPush, type SendResult } from "./notify";
import {
  buildHandoffPayload,
  buildInboundPayload,
  buildTestPayload,
  shouldNotifyInbound,
  type PushPayload,
} from "./payload";
import {
  deleteByEndpoints,
  listSubscriptions,
  touchSubscriptions,
  type PushSubscriptionRow,
} from "./subscriptions";

/**
 * Envía a las suscripciones de la empresa que pasen el filtro, poda las
 * muertas (404/410) y marca uso. Es el único punto que toca red.
 */
export async function notifyOrganization(
  organizationId: string,
  payload: PushPayload,
  filter: (sub: PushSubscriptionRow) => boolean = () => true
): Promise<SendResult[]> {
  const subs = (await listSubscriptions(organizationId)).filter(filter);
  if (subs.length === 0) return [];
  const keys = await getOrCreateVapidKeys(organizationId);
  const results = await sendPush(subs, keys, vapidSubject(), payload);
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  const ok = results.filter((r) => r.ok).map((r) => r.endpoint);
  await Promise.all([
    deleteByEndpoints(organizationId, gone),
    touchSubscriptions(organizationId, ok),
  ]);
  for (const r of results) {
    if (!r.ok && !r.gone) {
      console.warn(`[push] no entregado (${r.status ?? "sin respuesta"}): ${r.error ?? ""}`);
    }
  }
  return results;
}

async function brandIcon(organizationId: string): Promise<string> {
  const branding = await getBranding(organizationId);
  return pwaIconUrl(192, branding);
}

/** Corre en segundo plano: un fallo del push jamás afecta al llamador. */
function inBackground(label: string, work: () => Promise<unknown>): void {
  void work().catch((err) => {
    console.error(`[push] ${label}:`, err instanceof Error ? err.message : err);
  });
}

/** Mensaje entrante (FR-005): según el modo de cada dispositivo. */
export function notifyInboundMessage(input: {
  organizationId: string;
  conversation: {
    id: string;
    isTest: boolean;
    aiEnabled: boolean;
    handoffAt: Date | null;
  };
  contactName: string;
  message: { type: string; text: string | null };
}): void {
  if (input.conversation.isTest) return; // sandbox: jamás (FR-012)
  inBackground("entrante", async () => {
    const payload = buildInboundPayload({
      contactName: input.contactName,
      conversationId: input.conversation.id,
      type: input.message.type,
      text: input.message.text,
      icon: await brandIcon(input.organizationId),
    });
    await notifyOrganization(input.organizationId, payload, (sub) =>
      shouldNotifyInbound(sub.mode, input.conversation)
    );
  });
}

/** Escalado a humano (FR-006): a todos los dispositivos de la empresa. */
export function notifyHandoff(input: {
  organizationId: string;
  conversationId: string;
  reason: string;
}): void {
  inBackground("handoff", async () => {
    const db = getDb();
    const [row] = await db
      .select({
        isTest: schema.conversation.isTest,
        contactName: schema.contact.name,
      })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(
        scoped(
          schema.conversation.organizationId,
          input.organizationId,
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    if (!row || row.isTest) return;
    const payload = buildHandoffPayload({
      contactName: row.contactName,
      conversationId: input.conversationId,
      reason: input.reason,
      icon: await brandIcon(input.organizationId),
    });
    await notifyOrganization(input.organizationId, payload);
  });
}

/** Prueba desde Ajustes (FR-004): solo a los dispositivos del usuario. */
export async function sendTestNotification(
  organizationId: string,
  userId: string
): Promise<{ sent: number; total: number; results: SendResult[] }> {
  const branding = await getBranding(organizationId);
  const payload = buildTestPayload({
    appName: branding.name,
    icon: pwaIconUrl(192, branding),
  });
  const results = await notifyOrganization(
    organizationId,
    payload,
    (sub) => sub.userId === userId
  );
  return {
    sent: results.filter((r) => r.ok).length,
    total: results.length,
    results,
  };
}
