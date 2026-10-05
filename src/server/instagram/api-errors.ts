import { apiError } from "@/lib/api";
import { InstagramConfigError } from "@/server/instagram/profile";

/** 030: un error de configuración de Instagram → respuesta de la API. */
export function instagramConfigErrorResponse(err: unknown): Response {
  if (err instanceof InstagramConfigError) {
    const status = err.code === "not_found" ? 404 : err.code === "meta_error" ? 502 : 409;
    return apiError(status, err.code, err.message);
  }
  throw err;
}

/** Formatea un error de Zod como 422 con el primer motivo legible. */
export function validationError(issues: { message: string; path: (string | number)[] }[]): Response {
  const first = issues[0];
  return apiError(422, "invalid", first?.message ?? "Datos inválidos", {
    fields: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}
