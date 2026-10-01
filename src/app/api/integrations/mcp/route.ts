import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isValidTimeZone } from "@/lib/time";
import {
  miniHotelCredentialLast4,
  normalizeMiniHotelCredential,
  serializeMiniHotelCredential,
} from "@/lib/minihotel";
import {
  clearMcpCredential,
  getMcpIntegration,
  getMcpIntegrationView,
  setMcpCredential,
  updateMcpSettings,
} from "@/server/mcp/integration";
import { withMiniHotelOwnerSettings } from "@/server/mcp/profiles/minihotel-config";

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
    /**
     * Nombre visible del conector en el panel de esta empresa y en la sección
     * del prompt del agente. Lo propone el super admin al habilitar, pero es
     * texto de presentación de la propia empresa: que lo pueda corregir acá
     * evita tener que pedirle al operador de la instancia que le cambie un
     * rótulo. NO toca la dirección ni el perfil, que siguen siendo del admin.
     */
    label: z.string().trim().min(2).max(80).optional(),
    // Corrección #45: qué día es «hoy» para el agente y para el validador.
    // En UTC, después de las 21 hs de Córdoba, "mañana" da un día de más.
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine(isValidTimeZone, "La zona horaria no es válida")
      .optional(),
    /**
     * 028: credenciales de la API de MiniHotel (usuario + contraseña). Se
     * guardan como UN secreto cifrado; la interfaz solo ve los últimos 4 de
     * la contraseña. Solo vale con el perfil `minihotel`.
     */
    minihotel: z
      .object({ username: z.string().max(128), password: z.string().max(256) })
      .optional(),
    /** 028: regla comercial del hotel. Solo con el perfil `minihotel`. */
    showPrices: z.boolean().optional(),
    showNonRefundable: z.boolean().optional(),
    /** 028: con qué tarifa de MiniHotel cotiza el asistente (define la moneda). */
    rateCode: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/, "Código de tarifa inválido").optional(),
    /** 028: el código de hotel en MiniHotel (Hotel ID). */
    hotelId: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/, "Código de hotel inválido").optional(),
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

  const { credential, minihotel, showPrices, showNonRefundable, rateCode, hotelId, ...settings } =
    body.data;

  // 028: lo propio de MiniHotel exige que el conector SEA de MiniHotel. Un
  // token plano en un hotel (o usuario/contraseña en un MCP) no se guarda.
  const wantsMiniHotel =
    minihotel !== undefined ||
    showPrices !== undefined ||
    showNonRefundable !== undefined ||
    rateCode !== undefined ||
    hotelId !== undefined;
  const current =
    wantsMiniHotel || credential !== undefined
      ? await getMcpIntegration(session.organizationId)
      : null;
  if ((wantsMiniHotel || credential !== undefined) && !current) {
    return apiError(404, "not_enabled", NOT_ENABLED);
  }
  const isMiniHotel = current?.profileKey === "minihotel";
  if (wantsMiniHotel && !isMiniHotel) {
    return apiError(422, "invalid_body", "Estos ajustes son solo para un conector de MiniHotel.");
  }
  if (credential !== undefined && isMiniHotel) {
    return apiError(422, "invalid_body", "Para MiniHotel cargá el usuario y la contraseña de la API.");
  }

  if (minihotel !== undefined) {
    const c = normalizeMiniHotelCredential(minihotel);
    if (!c) {
      return apiError(422, "invalid_body", "Completá el usuario y la contraseña de la API de MiniHotel.");
    }
    const result = await setMcpCredential({
      organizationId: session.organizationId,
      userId: session.userId,
      credential: serializeMiniHotelCredential(c),
      last4: miniHotelCredentialLast4(c),
    });
    if (!result.ok) return apiError(404, "not_enabled", NOT_ENABLED);
  }

  if (
    showPrices !== undefined ||
    showNonRefundable !== undefined ||
    rateCode !== undefined ||
    hotelId !== undefined
  ) {
    const previousHotel =
      typeof current?.providerConfig?.hotelId === "string" ? current.providerConfig.hotelId : null;
    const providerConfig = withMiniHotelOwnerSettings(current?.providerConfig ?? null, {
      ...(showPrices !== undefined ? { showPrices } : {}),
      ...(showNonRefundable !== undefined ? { showNonRefundable } : {}),
      ...(rateCode !== undefined ? { rateCode } : {}),
      ...(hotelId !== undefined ? { hotelId } : {}),
    });
    const ok = await updateMcpSettings(session.organizationId, {
      providerConfig,
      // Otro hotel = otra conexión: hay que volver a verificar.
      ...(hotelId !== undefined && hotelId !== previousHotel ? { resetConnection: true } : {}),
    });
    if (!ok) return apiError(404, "not_enabled", NOT_ENABLED);
  }

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
  } else if (credential === undefined && !wantsMiniHotel) {
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
