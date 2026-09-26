import type { ListingRecord } from "@/lib/meli/listing";
import { resolveListing, searchListings, type ListingFilters } from "@/lib/meli/search";
import {
  clientSummaryFor,
  renderListingDetail,
  renderListingsSection,
  renderNotFound,
  renderSearchResult,
} from "@/lib/meli/render";
import { getMeliRow } from "@/server/meli/integration";
import { loadListings, refreshIfStale } from "@/server/meli/sync";

/**
 * Puente agente ↔ publicaciones de Mercado Libre (025). Mismo contrato de
 * tres piezas que la agenda (005) y el conector MCP (016):
 * `loadListingsContext` → `renderListingsSection` → `executeListingsAction`.
 *
 * Diferencia de fondo con el MCP: acá el turno NO sale a la red. Consulta el
 * snapshot en la base (plan D1), así que el Laboratorio (`is_test`) queda
 * aislado de ML por construcción, y un hipo de ML nunca demora una
 * respuesta: a lo sumo el inventario tiene unas horas.
 *
 * Nada de acá lanza hacia el pipeline: todo termina en texto.
 */

export type ListingsContext = {
  listings: ListingRecord[];
  nickname: string | null;
  lastSyncAt: Date | null;
  now: Date;
};

export type ListingsAction =
  | ({ action: "search_listings" } & ListingFilters)
  | { action: "show_listing"; listing: string };

/**
 * `null` = el agente atiende como antes de esta feature: sin conexión, con
 * el ajuste «El agente ofrece estas publicaciones» apagado, o sin ninguna
 * sincronización completa todavía (no hay inventario que prometer).
 */
export async function loadListingsContext(
  organizationId: string,
  options: { sandbox: boolean; now?: Date }
): Promise<ListingsContext | null> {
  const row = await getMeliRow(organizationId);
  if (!row || !row.agentEnabled || !row.lastSyncAt) return null;
  const now = options.now ?? new Date();
  // Stale-while-revalidate SOLO fuera del sandbox: el Laboratorio usa el
  // snapshot tal como está y jamás dispara tráfico a ML.
  if (!options.sandbox) {
    void refreshIfStale(organizationId, now).catch(() => undefined);
  }
  const listings = await loadListings(organizationId);
  return { listings, nickname: row.nickname, lastSyncAt: row.lastSyncAt, now };
}

export function renderListingsPromptSection(
  ctx: ListingsContext,
  options: { calendarBookable: boolean }
): string {
  return renderListingsSection({
    listings: ctx.listings,
    nickname: ctx.nickname,
    lastSyncAt: ctx.lastSyncAt,
    now: ctx.now,
    calendarBookable: options.calendarBookable,
  });
}

export type ListingsToolResult = {
  /** Lo que ve el modelo en la vuelta siguiente (`[HERRAMIENTA] …`). */
  toolText: string;
  /** Frase segura para el cliente si el modelo se cuelga después. */
  clientSummary: string | null;
};

export function executeListingsAction(
  ctx: ListingsContext,
  action: ListingsAction
): ListingsToolResult {
  try {
    if (action.action === "show_listing") {
      const found = resolveListing(ctx.listings, action.listing);
      if (!found) return { toolText: renderNotFound(action.listing), clientSummary: null };
      return { toolText: renderListingDetail(found), clientSummary: clientSummaryFor([found]) };
    }
    const { action: _kind, ...filters } = action;
    const outcome = searchListings(ctx.listings, filters);
    return {
      toolText: renderSearchResult(outcome, filters, ctx.listings),
      clientSummary: clientSummaryFor(outcome.results),
    };
  } catch (err) {
    console.error("[agente] consulta de publicaciones falló:", err instanceof Error ? err.message : err);
    return {
      toolText:
        "[HERRAMIENTA] NO PUDE CONSULTAR LAS PUBLICACIONES en este momento. No inventes propiedades ni precios: decile que le pasás las opciones enseguida.",
      clientSummary: null,
    };
  }
}

/** Resuelve la publicación de un pedido de visita (puede no existir). */
export function listingForVisit(ctx: ListingsContext | null, ref: string | undefined): ListingRecord | null {
  if (!ctx || !ref) return null;
  return resolveListing(ctx.listings, ref);
}
