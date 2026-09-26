import { createHmac, timingSafeEqual } from "node:crypto";
import { parseMetaJson } from "@/lib/instagram/json";

/**
 * `signed_request` de Meta (023): lo mandan los callbacks de
 * desautorización y de eliminación de datos del Business Login.
 * Formato: `<firma base64url>.<payload base64url>`, firma = HMAC-SHA256 del
 * payload (tal cual, codificado) con el secreto de la app. PURO.
 */

export type SignedRequest = {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
  [k: string]: unknown;
};

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Devuelve el payload si la firma coincide con ALGUNO de los secretos
 * (Instagram y, por robustez, el de la app de Meta); `null` si no.
 */
export function parseSignedRequest(
  signedRequest: string,
  secrets: (string | null | undefined)[]
): SignedRequest | null {
  const [sig, payload] = signedRequest.split(".", 2);
  if (!sig || !payload) return null;
  const given = fromB64url(sig);
  const valid = secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(payload).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return null;
  try {
    const data = parseMetaJson(fromB64url(payload).toString("utf8")) as SignedRequest;
    if (data.algorithm && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    if (data.user_id != null) data.user_id = String(data.user_id);
    return data;
  } catch {
    return null;
  }
}

/** Arma un `signed_request` válido (tests y el ig-mock). */
export function buildSignedRequest(data: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ algorithm: "HMAC-SHA256", ...data }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${sig}.${payload}`;
}

/** Lee `signed_request` del cuerpo (form-urlencoded, multipart o JSON). */
export async function readSignedRequest(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as { signed_request?: unknown };
      return typeof body.signed_request === "string" ? body.signed_request : null;
    }
    const form = await req.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
