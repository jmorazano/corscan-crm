import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { callGuarded } from "@/server/mcp/calls";
import { getCatalogStaleWhileRevalidate } from "@/server/mcp/catalog";
import { getMcpIntegration } from "@/server/mcp/integration";
import { condenseProperty } from "@/server/mcp/profiles/altos";
import { safeLink } from "@/server/mcp/sanitize";

export const dynamic = "force-dynamic";

/**
 * Búsqueda de PRUEBA del dueño (016, contrato `mcp-integration-api.md`) — el
 * «lo probé y anda», análogo de `GET …/google-calendar/availability`.
 *
 * Pasa por `callGuarded` como cualquier otra llamada: allowlist del perfil →
 * cupo por empresa (60/min) → caché 90 s → bitácora en `mcp_tool_call`. Con
 * `sandbox: false` y `conversationId: null`: la vista previa es del dueño, no
 * de una conversación, así que el proveedor no recibe ni siquiera el `cv_…`.
 *
 * Reglas del render, iguales a las del `[HERRAMIENTA]` del agente:
 *  - el `message` es NUESTRO, compuesto con el conteo: el texto «listo para
 *    enviar» del proveedor no se propaga ni como respaldo de
 *    `properties: []`, que es un estado que el servidor elige (corrección #8);
 *  - `deposit` se MUESTRA, jamás se calcula: no es un % fijo (hallazgo 14);
 *  - `currency` se imprime tal cual y no se convierte;
 *  - toda URL pasa por `safeLink` contra `profile.linkHosts` (FR-010) y lo
 *    que no matchea se omite; nunca se arma un enlace a mano.
 */

const previewSchema = z.object({
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usá el formato AAAA-MM-DD"),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usá el formato AAAA-MM-DD"),
  guests: z.coerce.number().int().min(1).max(50),
});

/** Tope de propiedades de la vista previa: es del dueño, no del modelo. */
const MAX_PREVIEW_PROPERTIES = 10;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(source: Record<string, unknown> | null, key: string): number | null {
  const raw = source?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede probar el conector");
  }

  const integration = await getMcpIntegration(session.organizationId);
  if (!integration) {
    return apiError(404, "not_enabled", "Esta empresa no tiene el conector habilitado");
  }
  if (integration.status !== "connected" || !integration.hasCredential) {
    return apiError(
      409,
      "not_connected",
      "Cargá la credencial y verificá la conexión antes de probar una búsqueda"
    );
  }

  const body = await parseBody(req, previewSchema);
  if (!body.ok) return body.response;

  const catalog = getCatalogStaleWhileRevalidate(integration, { sandbox: false });
  const validated = integration.profile.validate(
    {
      action: "search_stays",
      check_in: body.data.check_in,
      check_out: body.data.check_out,
      guests: body.data.guests,
    },
    catalog,
    new Date(),
    // Sin conversación: la vista previa no es un lead y no lleva atribución.
    { conversationId: null, timezone: integration.timezone }
  );
  if (!validated.ok) {
    // El texto educativo del perfil está escrito PARA EL MODELO; al dueño se
    // le responde con un mensaje propio y corto.
    return apiError(
      422,
      "invalid_body",
      "Revisá las fechas y la cantidad de personas: la salida tiene que ser posterior a la entrada y las fechas tienen que caer dentro de la ventana publicada por el servidor"
    );
  }

  const outcome = await callGuarded({
    integration,
    tool: validated.tool,
    args: validated.args,
    conversationId: null,
    sandbox: false,
    source: "owner",
  });

  if (!outcome.ok) {
    if (outcome.code === "rate_limited") {
      return apiError(429, "rate_limited", outcome.message, { retryInSeconds: 60 });
    }
    // `message` SIEMPRE de `MCP_ERROR_TEXT` (FR-016, corrección #13);
    // `providerCode` es el código ESTABLE del proveedor, ya saneado a un
    // identificador, para que la UI muestre su propia ayuda.
    return apiError(502, "provider_error", outcome.message, {
      mcpCode: outcome.code,
      ...(outcome.providerCode ? { providerCode: outcome.providerCode } : {}),
    });
  }

  const root = asRecord(outcome.data) ?? {};
  const fallbackCurrency = catalog?.currency ?? "ARS";
  const rawProperties = Array.isArray(root.properties) ? root.properties : [];
  // Hoy el único perfil con búsqueda es `altos`; para los demás `validate`
  // rechaza antes de llegar acá, así que el condensador nunca corre fuera de
  // su propio payload.
  const properties = rawProperties
    .slice(0, MAX_PREVIEW_PROPERTIES)
    .map((raw) => {
      const condensed = condenseProperty(raw, fallbackCurrency);
      if (!condensed) return null;
      const pricing = asRecord(asRecord(raw)?.pricing);
      return {
        code: condensed.code,
        name: condensed.name,
        city: condensed.city,
        capacity: condensed.capacity,
        bedrooms: condensed.bedrooms,
        bathrooms: condensed.bathrooms,
        minStay: condensed.minStay,
        facilities: condensed.facilities,
        pricing: {
          currency: condensed.currency,
          nights: condensed.nights,
          pricePerNight: condensed.pricePerNight,
          accommodation: readNumber(pricing, "accommodation"),
          services: condensed.services,
          total: condensed.total,
          deposit: condensed.deposit,
        },
        url: condensed.url,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const availableCount = readNumber(root, "available_count") ?? properties.length;
  const searchUrl =
    safeLink(root.search_url, integration.profile.linkHosts) ?? catalog?.searchBase ?? null;

  const message =
    availableCount > 0
      ? `${availableCount} ${availableCount === 1 ? "alojamiento disponible" : "alojamientos disponibles"} para las fechas y la cantidad de huéspedes consultadas.`
      : "No hay alojamientos disponibles para las fechas y la cantidad de huéspedes consultadas.";

  return Response.json({
    message,
    searchUrl,
    availableCount,
    properties,
  });
});
