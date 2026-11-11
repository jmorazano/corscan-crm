import { apiError } from "@/lib/api";
import type { UnitFailure } from "./integration";

/** Falla de alta/edición → respuesta HTTP con el texto en criollo (051). */
export function unitFailureResponse(failure: UnitFailure): Response {
  const status =
    failure.reason === "not_found"
      ? 404
      : failure.reason === "duplicate" || failure.reason === "limit"
        ? 409
        : failure.reason === "feed"
          ? 422
          : 400;
  return apiError(status, failure.reason, failure.message, failure.reason === "feed" ? { feedError: failure.code } : undefined);
}
