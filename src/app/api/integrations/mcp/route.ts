import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isValidTimeZone } from "@/lib/time";
import {
  clearMcpCredential,
  getMcpIntegrationView,
  setMcpCredential,
  updateMcpSettings,
} from "@/server/mcp/integration";

export const dynamic = "force-dynamic";

/**
 * Conector MCP de la PROPIA empresa (016, contrato
 * `specs/016-mcp-connector/contracts/mcp-integration-api.md`).
 *
 * GET lo lee cualquier miembro; las mutaciones son SOLO del `owner`
 * (FR-006), igual que en `google-calendar/route.ts`.
 *
 * Dos cosas que JAMÁS salen por acá:
 *   1. la credencial (FR-004): a la UI solo `credentialLast4`;
 *   2. la `endpointUrl` completa (FR-002): solo el **host**. La URL entera
 *      es del super admin (`/api/admin/organizations/[id]/mcp`).
 *
 * Y la tercera capa de defensa de D2: sin fila, cada endpoint responde
 * `404 not_enabled` aunque adivinen la URL. Ocultar la tarjeta del índice es
 * cosmética; la defensa es server-side.
 */

const NOT_ENABLED = "Esta empresa no tiene el conector habilitado";

export const GET = withAuth(async (session) => {
  const integration = await getMcpIntegrationView(session.organizationId);
  // Sin fila habilitada, este endpoint no confirma que exista: 404, igual
  // que PUT/DELETE/verify/preview. Devolver 200 con `integration: null` le
  // dice a cualquier empresa que el conector existe como funcionalidad y
  // que a ella no se lo dieron — justo lo que la regla de arriba evita.
  if (!integration) return apiError(404, "not_enabled", NOT_ENABLED);
  return Response.json({
    available: true,
    integration,
    canManage: session.role === "owner",
  });
});

const putSchema = z
  .object({
    credential: z.string().trim().min(8).max(4096).optional(),
    agentToolsEnabled: z.boolean().optional(),
    useServerInstructions: z.boolean().optional(),
    // Corrección #45: qué día es «hoy» para el agente y para el validador.
    // En UTC, después de las 21 hs de Córdoba, "mañana" da un día de más.
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine(isValidTimeZone, "La zona horaria no es válida")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada que actualizar");

/**
 * Carga o ROTA la credencial y los ajustes del dueño. **No dispara red**:
 * verificar es explícito (`POST …/verify`), para que un servidor caído no
 * impida guardar la credencial.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede editar el conector");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const { credential, ...settings } = body.data;

  if (credential !== undefined) {
    const result = await setMcpCredential({
      organizationId: session.organizationId,
      userId: session.userId,
      credential,
    });
    if (!result.ok) return apiError(404, "not_enabled", NOT_ENABLED);
  }

  if (Object.keys(settings).length > 0) {
    const ok = await updateMcpSettings(session.organizationId, settings);
    if (!ok) return apiError(404, "not_enabled", NOT_ENABLED);
  } else if (credential === undefined) {
    // Inalcanzable por el `.refine`, pero deja el 404 sin fila también acá.
    const view = await getMcpIntegrationView(session.organizationId);
    if (!view) return apiError(404, "not_enabled", NOT_ENABLED);
  }

  return Response.json({ ok: true });
});

/**
 * DESCONECTAR ≠ deshabilitar: borra la credencial y vuelve a `enabled`;
 * `catalog` y `tools` se conservan (son públicos, no son secreto, y evitan
 * un vacío en el prompt mientras se rota la credencial). Idempotente.
 * La fila solo la borra el super admin (`?mode=remove`).
 */
export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede desconectar el conector");
  }
  const result = await clearMcpCredential(session.organizationId);
  if (!result.ok) return apiError(404, "not_enabled", NOT_ENABLED);
  return Response.json({ ok: true });
});
