import { inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { DEFAULT_METRICS_TIMEZONE } from "@/lib/metrics";
import { workspaceStatuses } from "../access";
import type { AssistantTool } from "./common";

/**
 * `list_workspaces` (040, contracts/mcp-tools.md §1): las empresas de la
 * conexión y si se pueden consultar ahora. De las que NO están activas solo
 * se dice el nombre y el motivo: ningún dato más.
 */

const INACTIVE_REASON = {
  disabled: "El propietario no activó «Permitir asistentes externos» en Ajustes → Asistentes.",
  not_owner: "Ya no sos propietario de esta empresa.",
  not_authorized: "No autorizada en esta conexión.",
} as const;

/** «+5493516882234» → «+54935…34»: identifica el número sin repetirlo entero. */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `+${digits.slice(0, 5)}…${digits.slice(-2)}`;
}

export const listWorkspacesTool: AssistantTool = {
  name: "list_workspaces",
  title: "Empresas conectadas",
  description:
    "Lista las empresas del CRM que esta conexión puede consultar, con sus canales (WhatsApp, Instagram) y si el acceso está activo. Usala primero: las demás herramientas necesitan el id o el nombre de la empresa.",
  input: z.object({}),
  needsWorkspace: false,
  describe: () => "Listó las empresas conectadas",
  async run({ call }) {
    const statuses = await workspaceStatuses(call);
    const activeIds = call.workspaces.filter((w) => statuses.get(w.id) === "ok").map((w) => w.id);
    const db = getDb();
    const [wa, ig] =
      activeIds.length === 0
        ? [[], []]
        : await Promise.all([
            db
              .select({
                organizationId: schema.metaCredentials.organizationId,
                phone: schema.metaCredentials.displayPhoneNumber,
                status: schema.metaCredentials.status,
              })
              .from(schema.metaCredentials)
              .where(inArray(schema.metaCredentials.organizationId, activeIds)),
            db
              .select({
                organizationId: schema.instagramIntegration.organizationId,
                username: schema.instagramIntegration.username,
                status: schema.instagramIntegration.status,
              })
              .from(schema.instagramIntegration)
              .where(inArray(schema.instagramIntegration.organizationId, activeIds)),
          ]);
    const waByOrg = new Map(wa.map((r) => [r.organizationId, r]));
    const igByOrg = new Map(ig.map((r) => [r.organizationId, r]));

    return {
      data: {
        workspaces: call.workspaces.map((w) => {
          const status = statuses.get(w.id) ?? "not_authorized";
          if (status !== "ok") {
            return {
              id: w.id,
              name: w.name,
              active: false,
              inactive_reason: status,
              inactive_reason_text: INACTIVE_REASON[status],
            };
          }
          const whatsapp = waByOrg.get(w.id);
          const instagram = igByOrg.get(w.id);
          return {
            id: w.id,
            name: w.name,
            slug: w.slug,
            active: true,
            inactive_reason: null,
            channels: {
              whatsapp: whatsapp
                ? { number: maskPhone(whatsapp.phone), connected: whatsapp.status === "connected" }
                : null,
              instagram: instagram
                ? {
                    username: instagram.username ? `@${instagram.username}` : null,
                    connected: instagram.status === "connected",
                  }
                : null,
            },
            timezone: DEFAULT_METRICS_TIMEZONE,
          };
        }),
      },
    };
  },
};
