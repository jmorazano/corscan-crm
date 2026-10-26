import type { OAuthError } from "./params";

/**
 * Respuestas HTTP del servidor de autorización de los asistentes (040).
 * Todo lo que lleva un secreto o un error de OAuth va con `no-store`.
 */

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...headers },
  });
}

export function oauthErrorResponse(error: OAuthError, status = 400): Response {
  return oauthJson(error, status);
}

export function tooManyRequests(): Response {
  return oauthJson(
    { error: "too_many_requests", error_description: "Demasiados intentos: esperá unos minutos" },
    429,
    { "Retry-After": "60" }
  );
}

export function publicMetadata(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
