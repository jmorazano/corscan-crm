import { getEnv } from "@/lib/env";

/**
 * Cliente propio de la Graph API de Meta (WhatsApp Cloud API).
 * Única frontera de salida hacia Meta (Constitución II): todo request pasa
 * por graphRequest. En self-test, META_GRAPH_BASE_URL apunta al wa-mock.
 */

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  type: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: number | null; type?: string | null; details?: unknown }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.type = opts.type ?? null;
    this.details = opts.details;
  }

  /**
   * Token vencido/revocado → la conexión requiere re-autenticación.
   * OJO: Graph etiqueta como `OAuthException` casi todos sus errores (100
   * parámetro inválido, 200 permisos, 33 objeto inexistente…), así que el
   * `type` NO alcanza: solo el 401 y los códigos 190/102 son de token.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 102;
  }
}

export async function graphRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    body?: unknown;
  }
): Promise<T> {
  const env = getEnv();
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }

  if (!res.ok) {
    const err = (
      json as {
        error?: {
          message?: string;
          code?: number;
          type?: string;
          error_user_msg?: string;
          error_data?: { details?: string };
        };
      }
    )?.error;
    const detail = err?.error_data?.details ?? err?.error_user_msg;
    const message = err?.message ?? `Meta respondió ${res.status}`;
    throw new MetaApiError(detail ? `${message}: ${detail}` : message, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

/**
 * Intercambia el `code` de Embedded Signup por un token de acceso.
 *
 * A diferencia del resto de la Graph API este endpoint NO lleva Authorization:
 * se autentica con client_id + client_secret en la query. Igual pasa por
 * META_GRAPH_BASE_URL para que el wa-mock lo pueda imitar en el self-test.
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new MetaApiError(
      "Embedded Signup no está configurado: faltan META_APP_ID o META_APP_SECRET",
      { status: 0 }
    );
  }
  const qs = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    code,
  });
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/oauth/access_token?${qs}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }

  if (!res.ok) {
    const err = (
      json as {
        error?: {
          message?: string;
          code?: number;
          type?: string;
          error_user_msg?: string;
          error_data?: { details?: string };
        };
      }
    )?.error;
    const detail = err?.error_data?.details ?? err?.error_user_msg;
    const message = err?.message ?? `Meta respondió ${res.status}`;
    throw new MetaApiError(detail ? `${message}: ${detail}` : message, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }

  const token = (json as { access_token?: string } | null)?.access_token;
  if (!token) {
    throw new MetaApiError("Meta no devolvió access_token en el intercambio", {
      status: res.status,
      details: json ?? text,
    });
  }
  return token;
}

/**
 * Sube un binario por la Resumable Upload API y devuelve el handle (`h`)
 * que Meta acepta como `example.header_handle` en el alta de plantillas
 * (008). Dos pasos: crear la sesión bajo el APP id y subir los bytes a la
 * sesión. El paso 2 usa `Authorization: OAuth` (no Bearer) y body binario —
 * por eso no pasa por graphRequest, pero vive acá: única frontera con Meta.
 */
export async function uploadResumable(input: {
  appId: string;
  token: string;
  bytes: Buffer;
  mime: string;
}): Promise<string> {
  const env = getEnv();
  const qs = new URLSearchParams({
    file_length: String(input.bytes.byteLength),
    file_type: input.mime,
  });
  const session = await graphRequest<{ id?: string }>(
    `${input.appId}/uploads?${qs}`,
    { method: "POST", token: input.token }
  );
  if (!session.id) {
    throw new MetaApiError("Meta no devolvió la sesión de subida", {
      status: 0,
      details: session,
    });
  }

  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${session.id}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${input.token}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(input.bytes),
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  const handle = (json as { h?: string } | null)?.h;
  if (!handle) {
    throw new MetaApiError("Meta no devolvió el handle de la subida", {
      status: res.status,
      details: json ?? text,
    });
  }
  return handle;
}

/**
 * Normaliza el destinatario para el envío. Números móviles de México llegan
 * de Meta como `521` + 10 dígitos (13 en total); enviar con ese `1` extra
 * produce el error 131030 — se envía como `52` + 10 dígitos.
 * El wa_id almacenado NO se modifica; esto aplica solo al enviar.
 */
export function normalizeRecipient(waId: string): string {
  if (/^521\d{10}$/.test(waId)) {
    return `52${waId.slice(3)}`;
  }
  return waId;
}
