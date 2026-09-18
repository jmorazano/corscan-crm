import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isMockEnabled } from "@/lib/env";
import {
  listSubscriptions,
  removeSubscription,
  serializeSubscription,
  updateSubscriptionMode,
  upsertSubscription,
} from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

const modeSchema = z.enum(["all", "handoff"]);

/** El endpoint lo entrega el navegador: siempre https salvo en el modo de
 * pruebas (push-mock local por http). */
const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (u) => u.startsWith("https://") || (isMockEnabled() && u.startsWith("http://")),
    "El endpoint del push service debe ser https"
  );

const createSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(128),
  }),
  mode: modeSchema.optional(),
  userAgent: z.string().max(400).optional().nullable(),
});

const patchSchema = z.object({ endpoint: endpointSchema, mode: modeSchema });
const deleteSchema = z.object({ endpoint: endpointSchema });

/** Dispositivos del usuario en esta empresa (FR-003). */
export const GET = withAuth(async (session) => {
  const rows = await listSubscriptions(session.organizationId, {
    userId: session.userId,
  });
  return Response.json({ subscriptions: rows.map(serializeSubscription) });
});

/** Alta idempotente por endpoint. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const row = await upsertSubscription(session.organizationId, session.userId, {
    endpoint: body.data.endpoint,
    p256dh: body.data.keys.p256dh,
    auth: body.data.keys.auth,
    mode: body.data.mode,
    userAgent: body.data.userAgent ?? null,
  });
  return Response.json({ subscription: serializeSubscription(row) });
});

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const row = await updateSubscriptionMode(
    session.organizationId,
    session.userId,
    body.data.endpoint,
    body.data.mode
  );
  if (!row) return apiError(404, "not_found", "Suscripción no encontrada");
  return Response.json({ subscription: serializeSubscription(row) });
});

export const DELETE = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, deleteSchema);
  if (!body.ok) return body.response;
  const removed = await removeSubscription(
    session.organizationId,
    session.userId,
    body.data.endpoint
  );
  return Response.json({ removed });
});
