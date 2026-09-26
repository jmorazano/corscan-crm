import { z } from "zod";
import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import { canManageConfig } from "@/lib/roles";
import { isMeliConfigured } from "@/lib/env";
import { OPERATION_LABEL } from "@/lib/meli/listing";
import { formatPrice } from "@/lib/meli/search";
import { disconnectMeli, getMeliView, updateMeliSettings } from "@/server/meli/integration";
import { isSyncRunning, loadListings, refreshIfStale } from "@/server/meli/sync";

export const dynamic = "force-dynamic";

/**
 * Integración Mercado Libre de la PROPIA empresa (025). GET para cualquier
 * miembro (lectura); PATCH/DELETE solo el propietario. Jamás tokens: a la
 * UI viajan la cuenta, el estado de la sync y las publicaciones tal como las
 * ve el agente (sin la dirección exacta, que el agente no da).
 */

/** Tope de publicaciones que se listan en la página (el agente ve todas). */
const PREVIEW_LIMIT = 200;

export const GET = withAuth(async (session) => {
  const orgId = session.organizationId;
  const integration = await getMeliView(orgId);
  if (integration) {
    // Abrir la página también refresca un snapshot viejo (en segundo plano).
    void refreshIfStale(orgId).catch(() => undefined);
    if (isSyncRunning(orgId)) integration.sync.status = "running";
  }
  const listings = integration ? await loadListings(orgId) : [];
  listings.sort((a, b) => (b.mlUpdatedAt?.getTime() ?? 0) - (a.mlUpdatedAt?.getTime() ?? 0));
  return Response.json({
    available: isMeliConfigured(),
    integration,
    canManage: canManageConfig(session.role),
    listings: listings.slice(0, PREVIEW_LIMIT).map((l) => ({
      itemId: l.itemId,
      title: l.title,
      operation: l.operation ? OPERATION_LABEL[l.operation] : null,
      propertyType: l.propertyType,
      price: l.price !== null ? formatPrice(l.price, l.currency) : null,
      zone: [l.neighborhood, l.city].filter(Boolean).join(", ") || null,
      bedrooms: l.bedrooms,
      rooms: l.rooms,
      permalink: l.permalink,
      thumbnail: l.thumbnail,
    })),
    totalListings: listings.length,
  });
});

const patchSchema = z.object({ agentEnabled: z.boolean() });

export const PATCH = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const ok = await updateMeliSettings(session.organizationId, body.data);
  if (!ok) return apiError(404, "not_connected", "Mercado Libre no está conectado");
  return Response.json({ ok: true });
});

export const DELETE = withOwner(async (session) => {
  await disconnectMeli(session.organizationId);
  return Response.json({ ok: true });
});
