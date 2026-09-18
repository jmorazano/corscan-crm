import { createHash } from "node:crypto";

/**
 * Huella del cuerpo de un request idempotente (014, research D2): JSON
 * canónico (claves ordenadas recursivamente, sin `undefined`) → SHA-256.
 * Dos cuerpos "iguales" con distinto orden de claves dan la misma huella;
 * cualquier diferencia de valor da otra → 422 `idempotency_mismatch`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

/** Límite del header `Idempotency-Key` (documentado en el contrato). */
export const IDEMPOTENCY_KEY_MAX = 200;
