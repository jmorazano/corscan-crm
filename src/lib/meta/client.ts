import { getEnv, isMockEnabled } from "@/lib/env";

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

/* ============================================================
 * Descarga de adjuntos entrantes (020)
 * ============================================================ */

export type MediaHandle = {
  url: string;
  mimeType: string;
  /** Bytes declarados por Meta: permite rechazar ANTES de bajar el cuerpo. */
  fileSize: number | null;
};

/**
 * Paso 1 de la descarga: el `media_id` del webhook se canjea por una URL
 * temporal. El binario NO vive en la Graph API sino en la CDN de Meta, así
 * que esta llamada solo trae el handle.
 */
export async function fetchMediaHandle(
  mediaId: string,
  token: string
): Promise<MediaHandle> {
  const res = await graphRequest<{
    url?: string;
    mime_type?: string;
    file_size?: number | string;
  }>(mediaId, { token });
  if (!res.url) {
    throw new MetaApiError("Meta no devolvió la URL del archivo", {
      status: 0,
      details: res,
    });
  }
  const size = Number(res.file_size);
  return {
    url: res.url,
    mimeType: (res.mime_type ?? "").split(";")[0]!.trim().toLowerCase(),
    fileSize: Number.isFinite(size) && size > 0 ? size : null,
  };
}

/**
 * Hosts de los que aceptamos bajar un binario. La URL sale de una respuesta
 * de Meta que a su vez sale de un webhook: es un dato EXTERNO que termina en
 * un `fetch` del servidor, el mismo riesgo que cerró el guard anti-SSRF de
 * 016. Sin allowlist, un webhook falsificado apunta el fetch a donde quiera.
 */
function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "lookaside.facebook.com" || h === "lookaside.fbsbx.com") return true;
  if (h === "fbcdn.net" || h.endsWith(".fbcdn.net")) return true;
  // Self-test: el wa-mock sirve el binario desde su propio host. Solo con el
  // gate de mocks activo — en producción esta rama no existe.
  if (isMockEnabled()) {
    try {
      const mockHost = new URL(getEnv().META_GRAPH_BASE_URL).hostname.toLowerCase();
      if (h === mockHost) return true;
    } catch {
      // base mal formada: no habilita nada
    }
  }
  return false;
}

/**
 * Paso 2: los bytes. No pasa por `graphRequest` porque la URL es absoluta y
 * de otro host. Meta exige un `User-Agent` explícito: sin él la CDN responde
 * 403 aunque el token sea válido.
 */
export async function downloadMediaBinary(
  url: string,
  token: string,
  maxBytes: number
): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MetaApiError("La URL del archivo no es válida", { status: 0 });
  }
  if (parsed.protocol !== "https:" && !isMockEnabled()) {
    throw new MetaApiError("La URL del archivo no usa HTTPS", { status: 0 });
  }
  if (!isAllowedMediaHost(parsed.hostname)) {
    throw new MetaApiError(
      `La URL del archivo apunta a un host no permitido (${parsed.hostname})`,
      { status: 0 }
    );
  }

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Vocero-CRM/1.0",
      },
      redirect: "follow",
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo descargar el archivo de Meta", {
      status: 0,
      details: cause,
    });
  }
  if (!res.ok) {
    throw new MetaApiError(`Meta respondió ${res.status} al descargar el archivo`, {
      status: res.status,
    });
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MetaApiError("El archivo supera el tamaño máximo aceptado", {
      status: 413,
    });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new MetaApiError("El archivo supera el tamaño máximo aceptado", {
      status: 413,
    });
  }
  return {
    bytes,
    contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
  };
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
