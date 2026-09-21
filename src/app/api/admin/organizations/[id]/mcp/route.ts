import net from "node:net";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withSuperAdmin } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { isValidTimeZone } from "@/lib/time";
import { assertResolvable, checkEndpointSyntax, McpError } from "@/lib/mcp";
import {
  disableMcpIntegration,
  enableMcpIntegration,
  getMcpAdminView,
  removeMcpIntegration,
} from "@/server/mcp/integration";

export const dynamic = "force-dynamic";

/**
 * Administración del conector MCP (016, contrato
 * `specs/016-mcp-connector/contracts/admin-mcp-api.md`). Todo bajo
 * `withSuperAdmin`: sin sesión → 401, sesión sin rol de plataforma → 403
 * (no 404: la sección existe, el acceso no).
 *
 * Por qué acá y no en Ajustes de la empresa: la `endpointUrl` la fija
 * ÚNICAMENTE el super admin (FR-001/FR-002, Constitución II categoría 5,
 * letra b). Un usuario de empresa no la escribe ni la lee; solo carga la
 * credencial que le pasó el proveedor.
 *
 * La EXISTENCIA de la fila `mcp_integration` es la habilitación: crearla
 * hace aparecer la tarjeta en esa empresa y en ninguna otra.
 *
 * Este PUT **no dispara red**: verificar es del `owner` de la empresa, así
 * que un servidor caído no impide habilitar.
 */

type Params = { params: Promise<{ id: string }> };

const ORG_NOT_FOUND = "La empresa no existe";

/** ¿Existe la empresa? Lectura de plataforma, sin `scoped()` a propósito:
 * `organization` es la tabla de tenants, no una tabla de dominio (mismo
 * sombrero que `listOrganizations`). Sin esto, un id inventado terminaría en
 * un 500 por violación de clave foránea en vez de un 404 honesto. */
async function organizationExists(id: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, id))
    .limit(1);
  return rows.length > 0;
}

/* ============================================================
 * Validación anti-SSRF de la URL (FR-003)
 * ============================================================ */

/**
 * `reason` tipado del contrato. `ip_literal` no lo distingue
 * `checkEndpointSyntax` (devuelve `bad_host`): se separa acá porque para el
 * super admin «pusiste una IP» y «ese host no parece un dominio» son dos
 * arreglos distintos.
 */
type EndpointRejection =
  | "invalid_url"
  | "not_https"
  | "userinfo"
  | "bad_port"
  | "ip_literal"
  | "bad_host"
  | "too_long"
  | "blocked_host"
  | "unresolvable";

/** Textos FIJOS nuestros. Ni uno solo viene del servidor remoto (#13). */
const ENDPOINT_REASON_TEXT: Record<EndpointRejection, string> = {
  invalid_url: "La dirección no es una URL válida.",
  not_https: "La dirección tiene que empezar con https://.",
  userinfo: "La dirección no puede llevar usuario ni contraseña embebidos.",
  bad_port: "La dirección tiene que usar el puerto 443 (el de https).",
  ip_literal: "Poné el dominio del servidor, no una dirección IP.",
  bad_host: "El host de la dirección no parece un dominio público.",
  too_long: "La dirección es demasiado larga.",
  blocked_host: "Esa dirección no es válida como servidor externo.",
  unresolvable: "El dominio de la dirección no resuelve.",
};

function looksLikeIpLiteral(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    return net.isIP(host) !== 0;
  } catch {
    return false;
  }
}

/**
 * Sintaxis + resolución previa. La validación que PROTEGE es la del socket
 * (`guardedLookup` dentro de `https.request`), que cierra la ventana de DNS
 * rebinding; esta corre acá para dar un error útil al guardar.
 */
async function rejectEndpoint(raw: string): Promise<EndpointRejection | null> {
  const syntax = checkEndpointSyntax(raw);
  if (!syntax.ok) {
    if (syntax.reason === "bad_host" && looksLikeIpLiteral(raw)) return "ip_literal";
    return syntax.reason;
  }
  try {
    await assertResolvable(syntax.url);
  } catch (err) {
    // `assertResolvable` colapsa «no resuelve» y «resuelve a un rango
    // prohibido» en un solo código; se separan por la causa de DNS para que
    // el mensaje sea accionable. Ante la duda, `blocked_host`.
    if (err instanceof McpError) {
      const cause = (err as { cause?: unknown }).cause;
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? String((cause as { code?: unknown }).code)
          : "";
      return code === "ENOTFOUND" || code === "EAI_AGAIN" ? "unresolvable" : "blocked_host";
    }
    return "blocked_host";
  }
  return null;
}

/* ============================================================
 * GET — detalle para precargar el formulario de «Editar»
 * ============================================================ */

/**
 * `McpAdminView`: acá SÍ va la `endpointUrl` completa (corrección #36),
 * porque sin ella el botón «Editar» no tiene con qué precargar el
 * formulario. La credencial nunca: solo `hasCredential` y `credentialLast4`.
 */
export const GET = withSuperAdmin(async (_ctx, _req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;
  if (!(await organizationExists(id))) {
    return apiError(404, "organization_not_found", ORG_NOT_FOUND);
  }
  return Response.json({ integration: await getMcpAdminView(id) });
});

/* ============================================================
 * PUT — habilitar o reconfigurar (upsert por organization_id)
 * ============================================================ */

const enableSchema = z.object({
  profile: z.enum(["generic", "altos_de_calamuchita"]),
  label: z.string().trim().min(2).max(80),
  endpointUrl: z.string().trim().url().max(2048),
  // Corrección #15: `meta` NO existe en v1 (metía el secreto en el cuerpo
  // JSON-RPC, que se audita y se loguea; el header no).
  authScheme: z.enum(["bearer", "api_key_header"]).default("bearer"),
  /** Opcional: el dueño de la instancia puede dejarla cargada. */
  credential: z.string().trim().min(8).max(4096).optional(),
  /** Corrección #45: qué día es «hoy» para el agente. */
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine(isValidTimeZone, "La zona horaria no es válida")
    .default("America/Argentina/Cordoba"),
  timeoutMs: z.coerce.number().int().min(2000).max(30000).default(10000),
  maxResponseBytes: z.coerce.number().int().min(16384).max(4194304).default(524288),
  catalogTtlMinutes: z.coerce.number().int().min(5).max(1440).default(60),
});

export const PUT = withSuperAdmin(async (ctx, req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;
  const body = await parseBody(req, enableSchema);
  if (!body.ok) return body.response;

  if (!(await organizationExists(id))) {
    return apiError(404, "organization_not_found", ORG_NOT_FOUND);
  }

  const rejection = await rejectEndpoint(body.data.endpointUrl);
  if (rejection) {
    return apiError(422, "invalid_endpoint", ENDPOINT_REASON_TEXT[rejection], {
      reason: rejection,
    });
  }

  // Efecto FR-005 (dentro de `enableMcpIntegration`): si cambian
  // `endpointUrl` o `authScheme`, se borran credencial, `last4`, catálogo y
  // `tools`, y la fila vuelve a `enabled`. Un super admin comprometido que
  // reapunte el endpoint NO cosecha el bearer en la llamada siguiente.
  const integration = await enableMcpIntegration({
    organizationId: id,
    userId: ctx.userId,
    profile: body.data.profile,
    label: body.data.label,
    endpointUrl: body.data.endpointUrl,
    authScheme: body.data.authScheme,
    ...(body.data.credential !== undefined ? { credential: body.data.credential } : {}),
    timezone: body.data.timezone,
    timeoutMs: body.data.timeoutMs,
    maxResponseBytes: body.data.maxResponseBytes,
    catalogTtlMinutes: body.data.catalogTtlMinutes,
  });
  if (!integration) {
    return apiError(404, "organization_not_found", ORG_NOT_FOUND);
  }
  return Response.json({ ok: true, integration });
});

/* ============================================================
 * DELETE — deshabilitar o borrar
 * ============================================================ */

const modeSchema = z.enum(["disable", "remove"]);

export const DELETE = withSuperAdmin(async (_ctx, req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;
  const parsed = modeSchema.safeParse(new URL(req.url).searchParams.get("mode") ?? "disable");
  if (!parsed.success) {
    return apiError(422, "invalid_body", "mode debe ser disable o remove");
  }
  if (!(await organizationExists(id))) {
    return apiError(404, "organization_not_found", ORG_NOT_FOUND);
  }

  if (parsed.data === "remove") {
    // Borra la fila: cascade a `mcp_tool_call`. Se pierde la evidencia del
    // sandbox y el historial — por eso el default es `disable`.
    await removeMcpIntegration(id);
  } else {
    // Apaga sin perder catálogo, `tools` ni bitácora; la credencial se borra
    // igual: deshabilitada no significa "guardada".
    await disableMcpIntegration(id);
  }
  // Idempotente: sin fila también responde 200.
  return Response.json({ ok: true });
});
