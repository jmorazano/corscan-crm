import { getEnv, isMockEnabled } from "@/lib/env";
import { redactValue } from "@/lib/redact";
import { parseMetaJson } from "@/lib/instagram/json";

/**
 * Cliente propio de Instagram (023): Instagram API with Instagram Login.
 * Única frontera de salida hacia `graph.instagram.com`, `api.instagram.com`
 * y la CDN de adjuntos (Constitución II, categoría 1). En self-test las tres
 * bases apuntan al ig-mock.
 *
 * Por qué NO reutiliza `graphRequest` de `src/lib/meta`: es otro host, otro
 * token (Instagram User, no el de la WABA) y otro formato de error en el
 * intercambio de código. Compartir la función mezclaría las dos fronteras.
 */

/** Permisos que pide el Business Login: SOLO los dos del App Review (FR-002). */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

/** Campos del webhook a los que se suscribe cada cuenta (FR-004). */
export const INSTAGRAM_WEBHOOK_FIELDS = [
  "messages",
  "messaging_seen",
  "messaging_postbacks",
  "message_reactions",
  "messaging_referral",
] as const;

const TIMEOUT_MS = 15_000;

export class InstagramApiError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;

  constructor(
    message: string,
    opts: { status: number; code?: number | null; subcode?: number | null }
  ) {
    super(message);
    this.name = "InstagramApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
  }

  /**
   * Token vencido o revocado. Igual que en WhatsApp (ver MetaApiError), el
   * `type: OAuthException` NO alcanza: Meta lo usa para casi todo. Solo el
   * 401 y los códigos 190/102 son de autorización.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 102;
  }

  /** Meta caído o red: el envío se reintenta a mano, la conexión sigue. */
  get isUnavailable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

function graphBase(): string {
  const env = getEnv();
  return `${env.INSTAGRAM_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}`;
}

function requireAppCredentials(): { appId: string; appSecret: string } {
  const env = getEnv();
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    throw new InstagramApiError(
      "Instagram no está habilitado en esta instancia: faltan INSTAGRAM_APP_ID o INSTAGRAM_APP_SECRET",
      { status: 0 }
    );
  }
  return { appId: env.INSTAGRAM_APP_ID, appSecret: env.INSTAGRAM_APP_SECRET };
}

/**
 * Secreto con el que se firma el `state` del Business Login: DERIVADO del de
 * la sesión, para que un state emitido para Google no sirva acá.
 */
export function instagramStateSecret(): string {
  return `${getEnv().BETTER_AUTH_SECRET}:instagram`;
}

/** Redirect URI registrada en el panel (Business login settings). */
export function instagramRedirectUri(): string {
  return `${getEnv().APP_BASE_URL}/api/integrations/instagram/callback`;
}

/** URL del diálogo de autorización de Instagram (Business Login). */
export function buildInstagramAuthUrl(state: string): string {
  const { appId } = requireAppCredentials();
  const url = new URL(getEnv().INSTAGRAM_AUTH_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", instagramRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * fetch con timeout que JAMÁS deja el token ni el secreto en el mensaje de
 * error: las URLs de intercambio llevan `client_secret`/`access_token` en la
 * query y un error de red las podría arrastrar a un log.
 */
async function request(
  url: string,
  init: RequestInit,
  secrets: (string | undefined)[]
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new InstagramApiError("No se pudo contactar a Instagram", {
      status: 0,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? parseMetaJson(text) : null;
  } catch {
    // no-JSON: se conserva el texto (redactado) en el mensaje
  }
  if (!res.ok) {
    throw toApiError(res.status, json, text, secrets);
  }
  return { status: res.status, json, text };
}

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
  // Formato de api.instagram.com/oauth/access_token
  error_type?: string;
  code?: number;
  error_message?: string;
};

function toApiError(
  status: number,
  json: unknown,
  text: string,
  secrets: (string | undefined)[]
): InstagramApiError {
  const body = (json ?? {}) as GraphErrorBody;
  const raw =
    body.error?.error_user_msg ??
    body.error?.message ??
    body.error_message ??
    (text ? text.slice(0, 200) : `Instagram respondió ${status}`);
  return new InstagramApiError(redactValue(raw, ...secrets), {
    status,
    code: body.error?.code ?? body.code ?? null,
    subcode: body.error?.error_subcode ?? null,
  });
}

/** Request autenticado contra graph.instagram.com con el token de la cuenta. */
export async function igGraphRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    query?: Record<string, string>;
    body?: unknown;
  }
): Promise<T> {
  const url = new URL(`${graphBase()}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    url.searchParams.set(k, v);
  }
  const { json } = await request(
    url.toString(),
    {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    },
    [opts.token]
  );
  return json as T;
}

export type ShortLivedToken = { accessToken: string; userId: string | null };

/** Paso 2 del Business Login: `code` → token corto (1 h). */
export async function exchangeInstagramCode(code: string): Promise<ShortLivedToken> {
  const { appId, appSecret } = requireAppCredentials();
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: instagramRedirectUri(),
    code,
  });
  const { json } = await request(
    getEnv().INSTAGRAM_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    [appSecret, code]
  );
  // La doc muestra `{data:[{...}]}`; en la práctica también llega plano.
  const body = json as
    | { access_token?: string; user_id?: string | number }
    | { data?: { access_token?: string; user_id?: string | number }[] };
  const flat = "data" in body && Array.isArray(body.data) ? body.data[0] : body;
  const accessToken = (flat as { access_token?: string } | undefined)?.access_token;
  if (!accessToken) {
    throw new InstagramApiError("Instagram no devolvió un token", { status: 502 });
  }
  const userId = (flat as { user_id?: string | number }).user_id;
  return { accessToken, userId: userId != null ? String(userId) : null };
}

export type LongLivedToken = { accessToken: string; expiresAt: Date };

function toLongLived(json: unknown, now: Date): LongLivedToken {
  const body = json as { access_token?: string; expires_in?: number };
  if (!body?.access_token) {
    throw new InstagramApiError("Instagram no devolvió un token de larga duración", {
      status: 502,
    });
  }
  // 60 días por contrato; si Meta no manda expires_in, se asume eso.
  const seconds =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : 60 * 24 * 60 * 60;
  return {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + seconds * 1000),
  };
}

/** Paso 3: token corto → token largo (60 días). */
export async function exchangeLongLivedToken(
  shortToken: string,
  now: Date = new Date()
): Promise<LongLivedToken> {
  const { appSecret } = requireAppCredentials();
  const url = new URL(`${getEnv().INSTAGRAM_GRAPH_BASE_URL}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);
  const { json } = await request(url.toString(), { method: "GET" }, [
    appSecret,
    shortToken,
  ]);
  return toLongLived(json, now);
}

/** Renueva un token largo por otros 60 días (debe tener ≥24 h y no vencido). */
export async function refreshLongLivedToken(
  token: string,
  now: Date = new Date()
): Promise<LongLivedToken> {
  const url = new URL(`${getEnv().INSTAGRAM_GRAPH_BASE_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const { json } = await request(url.toString(), { method: "GET" }, [token]);
  return toLongLived(json, now);
}

export type InstagramAccount = {
  /** ID de la cuenta profesional: el `entry.id` de los webhooks. */
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
};

/** Datos de la cuenta conectada (`/me`). */
export async function getInstagramAccount(token: string): Promise<InstagramAccount> {
  const me = await igGraphRequest<{
    id?: string;
    user_id?: string | number;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
  }>("me", {
    token,
    query: { fields: "user_id,username,name,profile_picture_url,account_type" },
  });
  // `user_id` es el ID profesional (el que llega en los webhooks); `id` es el
  // app-scoped. Se prefiere el primero y se cae al segundo por robustez.
  const igUserId = me.user_id != null ? String(me.user_id) : me.id;
  if (!igUserId) {
    throw new InstagramApiError("Instagram no devolvió el ID de la cuenta", {
      status: 502,
    });
  }
  return {
    igUserId,
    username: me.username ?? null,
    name: me.name ?? null,
    profilePictureUrl: me.profile_picture_url ?? null,
    accountType: me.account_type ?? null,
  };
}

/** Suscribe la cuenta a los campos de mensajería (paso 3 de los webhooks). */
export async function subscribeInstagramWebhooks(token: string): Promise<void> {
  const res = await igGraphRequest<{ success?: boolean }>("me/subscribed_apps", {
    method: "POST",
    token,
    query: { subscribed_fields: INSTAGRAM_WEBHOOK_FIELDS.join(",") },
  });
  if (res?.success === false) {
    throw new InstagramApiError("Instagram rechazó la suscripción a mensajes", {
      status: 502,
    });
  }
}

/** Best effort: al desconectar se deja de recibir mensajes de esa cuenta. */
export async function unsubscribeInstagramWebhooks(token: string): Promise<void> {
  try {
    await igGraphRequest("me/subscribed_apps", { method: "DELETE", token });
  } catch {
    // El token puede estar vencido o revocado: borrar la fila alcanza.
  }
}

export type InstagramUserProfile = {
  name: string | null;
  username: string | null;
  profilePic: string | null;
};

/** Perfil del cliente que escribió (User Profile API; requiere su mensaje). */
export async function getInstagramUserProfile(
  igsid: string,
  token: string
): Promise<InstagramUserProfile> {
  const p = await igGraphRequest<{
    name?: string | null;
    username?: string | null;
    profile_pic?: string | null;
  }>(encodeURIComponent(igsid), {
    token,
    query: { fields: "name,username,profile_pic" },
  });
  return {
    name: p.name ?? null,
    username: p.username ?? null,
    profilePic: p.profile_pic ?? null,
  };
}

/**
 * Envía UN mensaje de texto (≤1.000 caracteres: partirlo es responsabilidad
 * del llamador). `humanAgent` agrega la etiqueta HUMAN_AGENT para responder
 * entre las 24 h y los 7 días — solo personas, nunca el agente de IA.
 */
export async function sendInstagramText(input: {
  igUserId: string;
  token: string;
  recipientId: string;
  text: string;
  humanAgent?: boolean;
}): Promise<{ messageId: string }> {
  const body: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message: { text: input.text },
  };
  if (input.humanAgent) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }
  const res = await igGraphRequest<{ message_id?: string; recipient_id?: string }>(
    `${encodeURIComponent(input.igUserId)}/messages`,
    { method: "POST", token: input.token, body }
  );
  if (!res?.message_id) {
    throw new InstagramApiError("Instagram no devolvió el ID del mensaje", {
      status: 502,
    });
  }
  return { messageId: res.message_id };
}

/**
 * Hosts de los que aceptamos bajar un adjunto de Instagram. La URL llega en
 * el webhook: es un dato EXTERNO que termina en un `fetch` del servidor
 * (mismo riesgo que cerró el guard anti-SSRF de 016).
 */
export function isAllowedInstagramMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "lookaside.fbsbx.com" || h === "lookaside.facebook.com") return true;
  if (h === "fbcdn.net" || h.endsWith(".fbcdn.net")) return true;
  if (h === "cdninstagram.com" || h.endsWith(".cdninstagram.com")) return true;
  if (isMockEnabled()) {
    try {
      const mockHost = new URL(getEnv().INSTAGRAM_GRAPH_BASE_URL).hostname.toLowerCase();
      if (h === mockHost) return true;
    } catch {
      // base mal formada: no habilita nada
    }
  }
  return false;
}

/**
 * Baja un adjunto de la CDN de Instagram. La URL ya viene firmada por Meta:
 * NO se manda el token (no hace falta y no conviene esparcirlo).
 */
export async function downloadInstagramMedia(
  url: string,
  maxBytes: number
): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InstagramApiError("La URL del archivo no es válida", { status: 0 });
  }
  if (parsed.protocol !== "https:" && !isMockEnabled()) {
    throw new InstagramApiError("La URL del archivo no usa HTTPS", { status: 0 });
  }
  if (!isAllowedInstagramMediaHost(parsed.hostname)) {
    throw new InstagramApiError(
      `La URL del archivo apunta a un host no permitido (${parsed.hostname})`,
      { status: 0 }
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Vocero-CRM/1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch {
    throw new InstagramApiError("No se pudo descargar el archivo de Instagram", {
      status: 0,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new InstagramApiError(
      `Instagram respondió ${res.status} al descargar el archivo`,
      { status: res.status }
    );
  }
  // Tras una redirección el host final también tiene que ser de Meta.
  try {
    if (res.url && !isAllowedInstagramMediaHost(new URL(res.url).hostname)) {
      throw new InstagramApiError("El archivo redirigió a un host no permitido", {
        status: 0,
      });
    }
  } catch (err) {
    if (err instanceof InstagramApiError) throw err;
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new InstagramApiError("El archivo supera el tamaño máximo aceptado", {
      status: 413,
    });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new InstagramApiError("El archivo supera el tamaño máximo aceptado", {
      status: 413,
    });
  }
  return {
    bytes,
    contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
  };
}
