import { z } from "zod";
import {
  ForbiddenError,
  PasswordChangeRequiredError,
  requireSession,
  requireSuperAdmin,
  UnauthorizedError,
  type SessionContext,
  type SuperAdminContext,
} from "@/lib/auth/session";
import { bearerFromHeader, looksLikeApiKey } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";
import { canManageConfig } from "@/lib/roles";
import { touchApiKey, verifyApiKey } from "@/server/api-keys/keys";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): Response {
  return Response.json(
    { error: { code, message, ...(extra ?? {}) } },
    { status }
  );
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      if (err instanceof PasswordChangeRequiredError) {
        return apiError(
          403,
          "password_change_required",
          "Debés cambiar tu contraseña temporal antes de operar"
        );
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * 022: escrituras de CONFIGURACIÓN de la empresa (agente, conocimiento,
 * plantillas, WhatsApp, envíos, Laboratorio, Entrenador): sesión válida Y
 * rol `owner`. Un miembro recibe 403 `forbidden` con el mismo mensaje en
 * todos lados. Las lecturas que la operación necesita siguen en `withAuth`.
 */
export function withOwner<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args: Args) => {
    if (!canManageConfig(session.role)) return ownerOnlyError();
    return handler(session, ...args);
  });
}

/** 403 estándar cuando un miembro intenta configurar la empresa. */
export function ownerOnlyError(): Response {
  return apiError(403, "forbidden", "Solo el propietario de la empresa puede hacer esto");
}

/**
 * Envuelve un route handler de Administración (contrato admin-api.md):
 * sesión válida SIN exigir membresía + email en SUPER_ADMIN_EMAILS.
 * Sin sesión → 401; sesión sin rol de plataforma → 403 `forbidden`
 * (no 404: la sección existe, el acceso no).
 */
export function withSuperAdmin<Args extends unknown[]>(
  handler: (ctx: SuperAdminContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let ctx: SuperAdminContext;
    try {
      ctx = await requireSuperAdmin();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      if (err instanceof ForbiddenError) {
        return apiError(403, "forbidden", "Solo el super admin puede acceder");
      }
      if (err instanceof PasswordChangeRequiredError) {
        return apiError(
          403,
          "password_change_required",
          "Debés cambiar tu contraseña temporal antes de operar"
        );
      }
      throw err;
    }
    try {
      return await handler(ctx, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Contexto de una llamada autenticada por clave de API (014). */
export type ApiKeyContext = {
  organizationId: string;
  apiKeyId: string;
  apiKeyName: string;
};

/** 60 llamadas por minuto por clave (contrato api.md, research D7). */
export const API_KEY_RATE_LIMIT = { windowMs: 60 * 1000, max: 60 };

/**
 * Envuelve un route handler de la API PÚBLICA (`/api/v1/*`, contrato
 * specs/014-public-api/contracts/api.md): `Authorization: Bearer vk_…` →
 * empresa. Sin clave, clave inválida o revocada → 401 `invalid_api_key`
 * (mismo código para no revelar cuál existe); exceso → 429 `rate_limited`.
 * El secreto jamás se loguea.
 */
export function withApiKey<Args extends unknown[]>(
  handler: (ctx: ApiKeyContext, req: Request, ...args: Args) => Promise<Response>
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args) => {
    const token = bearerFromHeader(req.headers.get("authorization"));
    if (!token || !looksLikeApiKey(token)) {
      return apiError(
        401,
        "invalid_api_key",
        "Falta o es inválida la clave de API (header Authorization: Bearer vk_…)"
      );
    }
    const key = await verifyApiKey(token);
    if (!key) {
      return apiError(401, "invalid_api_key", "Clave de API inválida o revocada");
    }
    const rl = checkRateLimit(`apikey:${key.id}`, API_KEY_RATE_LIMIT);
    if (!rl.allowed) {
      return apiError(
        429,
        "rate_limited",
        `Demasiadas llamadas: máximo ${API_KEY_RATE_LIMIT.max} por minuto por clave`,
        { retryInSeconds: 60 }
      );
    }
    void touchApiKey(key.id, key.lastUsedAt).catch(() => undefined);
    try {
      return await handler(
        { organizationId: key.organizationId, apiKeyId: key.id, apiKeyName: key.name },
        req,
        ...args
      );
    } catch (err) {
      console.error("[api/v1] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  // Input desacoplado del Output: los schemas con transform (p. ej. las
  // reglas de turnos) infieren `T` desde la salida, no desde la entrada.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
