import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import {
  assertResolvable,
  checkEndpointSyntax,
  isReadOnlyTool,
  mcpInitialize,
  mcpListTools,
  toMcpError,
  type McpAuthScheme,
  type McpEndpointConfig,
  type McpErrorCode,
  type McpSession,
  type McpTool,
} from "@/lib/mcp";
import { redactForLog } from "@/lib/redact";
import { sanitizeForeignText } from "@/server/mcp/sanitize";
import {
  getProfile,
  isProfileKey,
  type McpProfile,
  type McpProfileKey,
  type StayCatalog,
} from "@/server/mcp/profiles";

/**
 * Conexión MCP POR EMPRESA (016, design §C.2) — patrón calcado de
 * `src/server/calendar/integration.ts` y `src/server/ai/credentials.ts`:
 * credencial cifrada en reposo (AES-256-GCM), a la UI solo viaja lo visible,
 * y **todo** acceso —incluidos los UPDATE— pasa por `scoped()` cuando el
 * `organizationId` está en mano (corrección #38: no se gasta la excepción del
 * UPDATE-por-PK de `calendar/integration.ts:267`).
 *
 * Dos cosas NUNCA salen de este módulo hacia un usuario de empresa:
 *   1. la credencial (FR-004, Constitución I): solo `credentialLast4`;
 *   2. la `endpointUrl` completa (FR-002): solo el **host**. La URL entera
 *      vive en `McpAdminView`, que es del super admin.
 */

type Row = typeof schema.mcpIntegration.$inferSelect;

export type McpRowStatus = Row["status"];
export type McpSessionMode = Row["sessionMode"];

/** Largos de persistencia del texto ajeno (data-model, FR-011 y c#22). */
const MAX_INSTRUCTIONS_CHARS = 1500;
const MAX_TOOL_DESCRIPTION_CHARS = 300;

/* ============================================================
 * Vistas
 * ============================================================ */

export type McpToolView = {
  name: string;
  /** Texto del PROVEEDOR, ya saneado (c#22). La UI lo rotula como tal. */
  description: string | null;
  readOnly: boolean;
};

/** Catálogo tal como lo ve la UI: conteo, no las 82 características. */
export type McpCatalogView = {
  propertyTypes: string[];
  cities: string[];
  facilitiesCount: number;
  window: { from: string; to: string } | null;
  currency: string;
  maxGuests: number | null;
};

/**
 * Lo ÚNICO que ve una empresa (contrato `mcp-integration-api.md`). Sin
 * credencial, sin URL completa, sin texto del tercero sin rotular.
 */
export type McpIntegrationView = {
  profile: McpProfileKey;
  profileName: string;
  label: string;
  /** SOLO el host (FR-002). */
  endpointHost: string;
  status: McpRowStatus;
  credentialLast4: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  sessionMode: McpSessionMode;
  timezone: string;
  tools: McpToolView[];
  instructions: string | null;
  useServerInstructions: boolean;
  agentToolsEnabled: boolean;
  catalog: McpCatalogView | null;
  catalogFetchedAt: string | null;
  lastHandshakeAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  enabledAt: string;
};

/** Otra empresa de la instancia apuntando al MISMO host (corrección #23). */
export type McpSharedWith = { organizationId: string; name: string };

/**
 * Vista del SUPER ADMIN (corrección #36): acá sí va la `endpointUrl`
 * completa, porque sin ella el botón «Editar» no tiene con qué precargar el
 * formulario. La credencial sigue sin salir: solo `hasCredential`/`last4`.
 */
export type McpAdminView = {
  organizationId: string;
  profile: McpProfileKey;
  label: string;
  /** Completa. JAMÁS se devuelve a un usuario de empresa. */
  endpointUrl: string;
  endpointHost: string;
  authScheme: McpAuthScheme;
  status: McpRowStatus;
  hasCredential: boolean;
  credentialLast4: string | null;
  sessionMode: McpSessionMode;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
  agentToolsEnabled: boolean;
  useServerInstructions: boolean;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  lastHandshakeAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  enabledBy: string | null;
  enabledAt: string;
  sharedWith: McpSharedWith[];
};

/**
 * Lo que consume el runtime (agente, catálogo, vista previa): perfil ya
 * resuelto y credencial **bajo demanda**. El blob cifrado queda encerrado en
 * la clausura de `resolveCredential`: no viaja como propiedad del objeto, así
 * que un `JSON.stringify(integration)` en un log no puede filtrarlo.
 */
export type McpIntegration = {
  id: string;
  organizationId: string;
  profileKey: McpProfileKey;
  profile: McpProfile;
  label: string;
  endpointUrl: string;
  endpointHost: string;
  authScheme: McpAuthScheme;
  status: McpRowStatus;
  sessionMode: McpSessionMode;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  agentToolsEnabled: boolean;
  instructions: string | null;
  useServerInstructions: boolean;
  catalog: StayCatalog | null;
  catalogFetchedAt: Date | null;
  catalogTtlMinutes: number;
  hasCredential: boolean;
  /** Descifra en el momento del uso. `null` = habilitada sin conectar. */
  resolveCredential: () => string | null;
};

/* ============================================================
 * Lectura de la fila
 * ============================================================ */

async function getRow(organizationId: string): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mcpIntegration)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Host de una URL guardada. Una fila corrupta no rompe el turno. */
export function endpointHostOf(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}

function toCatalog(raw: unknown): StayCatalog | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const windowRaw = r.window;
  let win: { from: string; to: string } | null = null;
  if (windowRaw && typeof windowRaw === "object" && !Array.isArray(windowRaw)) {
    const w = windowRaw as Record<string, unknown>;
    if (typeof w.from === "string" && typeof w.to === "string") {
      win = { from: w.from, to: w.to };
    }
  }
  return {
    propertyTypes: strings(r.propertyTypes),
    cities: strings(r.cities),
    facilities: strings(r.facilities),
    window: win,
    currency: typeof r.currency === "string" ? r.currency : "ARS",
    maxGuests: typeof r.maxGuests === "number" ? r.maxGuests : null,
    searchBase: typeof r.searchBase === "string" ? r.searchBase : null,
  };
}

function toolsOf(row: Row): McpToolView[] {
  const raw = row.tools;
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    name: typeof t?.name === "string" ? t.name : "",
    description: typeof t?.description === "string" ? t.description : null,
    readOnly: t?.readOnly === true,
  }));
}

function toIntegration(row: Row): McpIntegration {
  const profileKey: McpProfileKey = isProfileKey(row.profile) ? row.profile : "generic";
  const blob = row.credential;
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileKey,
    profile: getProfile(profileKey),
    label: row.label,
    endpointUrl: row.endpointUrl,
    endpointHost: endpointHostOf(row.endpointUrl),
    authScheme: row.authScheme,
    status: row.status,
    sessionMode: row.sessionMode,
    timezone: row.timezone,
    timeoutMs: row.timeoutMs,
    maxResponseBytes: row.maxResponseBytes,
    agentToolsEnabled: row.agentToolsEnabled,
    instructions: row.instructions,
    useServerInstructions: row.useServerInstructions,
    catalog: toCatalog(row.catalog),
    catalogFetchedAt: row.catalogFetchedAt,
    catalogTtlMinutes: row.catalogTtlMinutes,
    hasCredential: blob !== null && blob !== undefined,
    resolveCredential: () => {
      if (!blob) return null;
      try {
        return decryptSecret(blob);
      } catch {
        // ENCRYPTION_KEY rotada sin migrar: se degrada como "sin credencial".
        return null;
      }
    },
  };
}

export async function getMcpIntegration(
  organizationId: string
): Promise<McpIntegration | null> {
  const row = await getRow(organizationId);
  return row ? toIntegration(row) : null;
}

/** ¿La empresa tiene el conector habilitado? (sin descifrar nada). */
export async function isMcpEnabled(organizationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.mcpIntegration.id })
    .from(schema.mcpIntegration)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}

export function toMcpIntegrationView(row: Row): McpIntegrationView {
  const profileKey: McpProfileKey = isProfileKey(row.profile) ? row.profile : "generic";
  const catalog = toCatalog(row.catalog);
  return {
    profile: profileKey,
    profileName: getProfile(profileKey).name,
    label: row.label,
    endpointHost: endpointHostOf(row.endpointUrl),
    status: row.status,
    credentialLast4: row.credentialLast4,
    serverName: row.serverName,
    serverVersion: row.serverVersion,
    protocolVersion: row.protocolVersion,
    sessionMode: row.sessionMode,
    timezone: row.timezone,
    tools: toolsOf(row),
    instructions: row.instructions,
    useServerInstructions: row.useServerInstructions,
    agentToolsEnabled: row.agentToolsEnabled,
    catalog: catalog
      ? {
          propertyTypes: catalog.propertyTypes,
          cities: catalog.cities,
          facilitiesCount: catalog.facilities.length,
          window: catalog.window,
          currency: catalog.currency,
          maxGuests: catalog.maxGuests,
        }
      : null,
    catalogFetchedAt: row.catalogFetchedAt?.toISOString() ?? null,
    lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    enabledAt: row.enabledAt.toISOString(),
  };
}

export async function getMcpIntegrationView(
  organizationId: string
): Promise<McpIntegrationView | null> {
  const row = await getRow(organizationId);
  return row ? toMcpIntegrationView(row) : null;
}

/**
 * Otras empresas con el MISMO host (corrección #23). Lectura CROSS-TENANT a
 * propósito y exclusiva del super admin: es justamente la correlación que él
 * necesita ver ANTES de crearla (mismo proveedor ⇒ posible credencial
 * compartida ⇒ atribución de leads compartida). Mismo patrón de lectura
 * global que `src/server/admin/organizations.ts:288-302`. La UI lo muestra
 * como aviso; no bloquea nada.
 */
async function sharedWithFor(row: Row): Promise<McpSharedWith[]> {
  const host = endpointHostOf(row.endpointUrl);
  if (!host) return [];
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.mcpIntegration.organizationId,
      endpointUrl: schema.mcpIntegration.endpointUrl,
      name: schema.organization.name,
    })
    .from(schema.mcpIntegration)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.mcpIntegration.organizationId)
    );
  return rows
    .filter(
      (r) => r.organizationId !== row.organizationId && endpointHostOf(r.endpointUrl) === host
    )
    .map((r) => ({ organizationId: r.organizationId, name: r.name }));
}

export async function getMcpAdminView(
  organizationId: string
): Promise<McpAdminView | null> {
  const row = await getRow(organizationId);
  if (!row) return null;
  const shared = await sharedWithFor(row);
  return {
    organizationId: row.organizationId,
    profile: isProfileKey(row.profile) ? row.profile : "generic",
    label: row.label,
    endpointUrl: row.endpointUrl,
    endpointHost: endpointHostOf(row.endpointUrl),
    authScheme: row.authScheme,
    status: row.status,
    hasCredential: row.credential !== null && row.credential !== undefined,
    credentialLast4: row.credentialLast4,
    sessionMode: row.sessionMode,
    timezone: row.timezone,
    timeoutMs: row.timeoutMs,
    maxResponseBytes: row.maxResponseBytes,
    catalogTtlMinutes: row.catalogTtlMinutes,
    agentToolsEnabled: row.agentToolsEnabled,
    useServerInstructions: row.useServerInstructions,
    serverName: row.serverName,
    serverVersion: row.serverVersion,
    protocolVersion: row.protocolVersion,
    lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    enabledBy: row.enabledBy,
    enabledAt: row.enabledAt.toISOString(),
    sharedWith: shared,
  };
}

/* ============================================================
 * Alta y reconfiguración (SUPER ADMIN)
 * ============================================================ */

export type EnableMcpInput = {
  organizationId: string;
  /** User id del super admin que la habilita. */
  userId: string;
  profile: McpProfileKey;
  label: string;
  endpointUrl: string;
  authScheme: McpAuthScheme;
  /** Opcional: el dueño de la instancia puede dejarla cargada. */
  credential?: string | null;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
};

/** Últimos 4 caracteres (patrón `tokenLast4`, `ai/credentials.ts:91-101`). */
export function credentialLast4(credential: string): string {
  return credential.slice(-4);
}

/**
 * Qué se borra cuando cambia el endpoint o el esquema de auth (FR-005,
 * corrección #15). Un super admin comprometido que reapunte el endpoint
 * **no** cosecha el bearer en la llamada siguiente.
 */
const RESET_ON_ENDPOINT_CHANGE = {
  credential: null,
  credentialLast4: null,
  status: "enabled" as const,
  catalog: null,
  catalogFetchedAt: null,
  tools: null,
  serverName: null,
  serverVersion: null,
  protocolVersion: null,
  instructions: null,
  sessionMode: "stateless" as const,
  connectedBy: null,
  connectedAt: null,
  lastHandshakeAt: null,
  lastErrorCode: null,
  lastErrorAt: null,
};

/**
 * Habilita (crea) o reconfigura la integración de una empresa. Upsert por
 * `organization_id`: hay a lo sumo una fila, y su EXISTENCIA es la
 * habilitación (D2). **No dispara red**: verificar es del `owner`, así que un
 * servidor caído no impide habilitar.
 */
export async function enableMcpIntegration(
  input: EnableMcpInput
): Promise<McpAdminView | null> {
  const db = getDb();
  const existing = await getRow(input.organizationId);
  const enc = input.credential ? encryptSecret(input.credential) : null;
  const last4 = input.credential ? credentialLast4(input.credential) : null;

  if (!existing) {
    await db.insert(schema.mcpIntegration).values({
      id: newId("mcpIntegration"),
      organizationId: input.organizationId,
      profile: input.profile,
      label: input.label,
      endpointUrl: input.endpointUrl,
      authScheme: input.authScheme,
      credential: enc,
      credentialLast4: last4,
      status: "enabled",
      timezone: input.timezone,
      timeoutMs: input.timeoutMs,
      maxResponseBytes: input.maxResponseBytes,
      catalogTtlMinutes: input.catalogTtlMinutes,
      enabledBy: input.userId,
    });
    return getMcpAdminView(input.organizationId);
  }

  const endpointChanged =
    existing.endpointUrl !== input.endpointUrl || existing.authScheme !== input.authScheme;

  const patch: Partial<typeof schema.mcpIntegration.$inferInsert> = {
    profile: input.profile,
    label: input.label,
    endpointUrl: input.endpointUrl,
    authScheme: input.authScheme,
    timezone: input.timezone,
    timeoutMs: input.timeoutMs,
    maxResponseBytes: input.maxResponseBytes,
    catalogTtlMinutes: input.catalogTtlMinutes,
    updatedAt: new Date(),
  };
  if (endpointChanged) Object.assign(patch, RESET_ON_ENDPOINT_CHANGE);
  // Una credencial nueva en el mismo PUT gana sobre el borrado de arriba: el
  // super admin la está cargando A PROPÓSITO para el endpoint nuevo.
  if (enc) {
    patch.credential = enc;
    patch.credentialLast4 = last4;
    patch.connectedBy = input.userId;
    patch.connectedAt = new Date();
    if (existing.status === "disabled" || endpointChanged) patch.status = "enabled";
  }

  await db
    .update(schema.mcpIntegration)
    .set(patch)
    .where(scoped(schema.mcpIntegration.organizationId, input.organizationId));
  return getMcpAdminView(input.organizationId);
}

/**
 * Parche del super admin sobre una fila existente. Mismo efecto FR-005 que
 * `enableMcpIntegration` si cambia `endpointUrl` **o** `authScheme`.
 */
export async function updateMcpAdminSettings(
  organizationId: string,
  patch: {
    profile?: McpProfileKey;
    label?: string;
    endpointUrl?: string;
    authScheme?: McpAuthScheme;
    timezone?: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    catalogTtlMinutes?: number;
    agentToolsEnabled?: boolean;
    useServerInstructions?: boolean;
  }
): Promise<McpAdminView | null> {
  const existing = await getRow(organizationId);
  if (!existing) return null;

  const set: Partial<typeof schema.mcpIntegration.$inferInsert> = { updatedAt: new Date() };
  if (patch.profile !== undefined) set.profile = patch.profile;
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.endpointUrl !== undefined) set.endpointUrl = patch.endpointUrl;
  if (patch.authScheme !== undefined) set.authScheme = patch.authScheme;
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.timeoutMs !== undefined) set.timeoutMs = patch.timeoutMs;
  if (patch.maxResponseBytes !== undefined) set.maxResponseBytes = patch.maxResponseBytes;
  if (patch.catalogTtlMinutes !== undefined) set.catalogTtlMinutes = patch.catalogTtlMinutes;
  if (patch.agentToolsEnabled !== undefined) set.agentToolsEnabled = patch.agentToolsEnabled;
  if (patch.useServerInstructions !== undefined) {
    set.useServerInstructions = patch.useServerInstructions;
  }

  const endpointChanged =
    (patch.endpointUrl !== undefined && patch.endpointUrl !== existing.endpointUrl) ||
    (patch.authScheme !== undefined && patch.authScheme !== existing.authScheme);
  if (endpointChanged) Object.assign(set, RESET_ON_ENDPOINT_CHANGE);

  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set(set)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
  return getMcpAdminView(organizationId);
}

/**
 * Deshabilita (super admin): apaga sin perder catálogo, `tools` ni bitácora.
 * La credencial se borra igual — deshabilitada no significa "guardada".
 * Idempotente.
 */
export async function disableMcpIntegration(organizationId: string): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.mcpIntegration)
    .set({
      status: "disabled",
      credential: null,
      credentialLast4: null,
      connectedBy: null,
      connectedAt: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.mcpIntegration.organizationId, organizationId))
    .returning({ id: schema.mcpIntegration.id });
  return updated.length > 0;
}

/** Borra la fila (super admin, `?mode=remove`): cascade a `mcp_tool_call`. */
export async function removeMcpIntegration(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.mcpIntegration)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
}

/* ============================================================
 * Credencial (OWNER de la empresa)
 * ============================================================ */

export type CredentialResult = { ok: true } | { ok: false; code: "not_enabled" };

/**
 * Carga o ROTA la credencial. No dispara red (verificar es explícito), para
 * que un servidor caído no impida guardar. Vuelve a `enabled` desde
 * `reconnect_required`: una credencial nueva merece otro intento.
 */
export async function setMcpCredential(input: {
  organizationId: string;
  userId: string;
  credential: string;
}): Promise<CredentialResult> {
  const row = await getRow(input.organizationId);
  if (!row) return { ok: false, code: "not_enabled" };
  const enc = encryptSecret(input.credential);
  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set({
      credential: enc,
      credentialLast4: credentialLast4(input.credential),
      status: row.status === "disabled" ? "disabled" : "enabled",
      connectedBy: input.userId,
      connectedAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.mcpIntegration.organizationId, input.organizationId));
  return { ok: true };
}

/**
 * DESCONECTAR (empresa) ≠ deshabilitar (super admin): borra la credencial y
 * vuelve a `enabled`; **conserva** catálogo y `tools` porque son públicos, no
 * son secreto, y evitan un vacío en el prompt mientras se rota la credencial.
 * Idempotente.
 */
export async function clearMcpCredential(
  organizationId: string
): Promise<CredentialResult> {
  const row = await getRow(organizationId);
  if (!row) return { ok: false, code: "not_enabled" };
  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set({
      credential: null,
      credentialLast4: null,
      status: row.status === "disabled" ? "disabled" : "enabled",
      connectedBy: null,
      connectedAt: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
  return { ok: true };
}

/** Ajustes del `owner` (PUT de empresa). */
export async function updateMcpSettings(
  organizationId: string,
  patch: {
    agentToolsEnabled?: boolean;
    useServerInstructions?: boolean;
    timezone?: string;
    /** Rótulo visible de la empresa. No toca dirección ni perfil (FR-002). */
    label?: string;
  }
): Promise<boolean> {
  const set: Partial<typeof schema.mcpIntegration.$inferInsert> = { updatedAt: new Date() };
  if (patch.agentToolsEnabled !== undefined) set.agentToolsEnabled = patch.agentToolsEnabled;
  if (patch.useServerInstructions !== undefined) {
    set.useServerInstructions = patch.useServerInstructions;
  }
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.label !== undefined) set.label = patch.label;
  const db = getDb();
  const updated = await db
    .update(schema.mcpIntegration)
    .set(set)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId))
    .returning({ id: schema.mcpIntegration.id });
  return updated.length > 0;
}

/* ============================================================
 * Estado tras una llamada
 * ============================================================ */

/**
 * `reconnect_required` SOLO ante `unauthorized` (data-model, Transiciones):
 * un `timeout` o un `too_large` no son una credencial rota, y degradar el
 * estado por una caída pasajera obligaría al dueño a re-pegar un secreto que
 * está perfecto.
 */
export async function markReconnectRequired(
  organizationId: string,
  code = "unauthorized"
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set({
      status: "reconnect_required",
      lastErrorCode: code,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
}

/** Deja la huella del fallo SIN tocar el estado. `code`, nunca bytes (#13). */
export async function recordMcpError(
  organizationId: string,
  code: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set({ lastErrorCode: code, lastErrorAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
}

/** Persiste el catálogo YA CONDENSADO por `profile.parseCatalog` (nunca los 16 KB crudos). */
export async function saveCatalog(
  organizationId: string,
  catalog: StayCatalog
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set({
      catalog: catalog as unknown as Record<string, unknown>,
      catalogFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
}

/**
 * Congela el resultado del handshake. `instructions` y las descripciones de
 * las herramientas se guardan **ya saneadas** (FR-011, corrección #22): las
 * lee cualquier `member` por `GET /api/integrations/mcp`, así que el saneo no
 * puede quedar a cargo de la UI.
 */
export async function recordHandshake(
  organizationId: string,
  session: McpSession,
  tools: McpTool[],
  sessionMode: McpSessionMode,
  opts: { connected: boolean } = { connected: true }
): Promise<void> {
  const instructions = session.instructions
    ? sanitizeForeignText(session.instructions, MAX_INSTRUCTIONS_CHARS) || null
    : null;
  const toolViews: McpToolView[] = tools.map((t) => ({
    name: sanitizeForeignText(t.name, 200),
    description: t.description
      ? sanitizeForeignText(t.description, MAX_TOOL_DESCRIPTION_CHARS) || null
      : null,
    readOnly: isReadOnlyTool(t),
  }));

  const set: Partial<typeof schema.mcpIntegration.$inferInsert> = {
    serverName: session.serverName,
    serverVersion: session.serverVersion,
    protocolVersion: session.protocolVersion,
    instructions,
    tools: toolViews,
    sessionMode,
    lastHandshakeAt: new Date(),
    updatedAt: new Date(),
  };
  if (opts.connected) {
    set.status = "connected";
    set.lastErrorCode = null;
    set.lastErrorAt = null;
  }

  const db = getDb();
  await db
    .update(schema.mcpIntegration)
    .set(set)
    .where(scoped(schema.mcpIntegration.organizationId, organizationId));
}

/* ============================================================
 * Handshake en vivo
 * ============================================================ */

export type HandshakeFailureCode = McpErrorCode | "not_enabled" | "no_credential";

export type HandshakeResult =
  | { ok: true; integration: McpIntegrationView }
  | {
      ok: false;
      code: HandshakeFailureCode;
      /** Nombres de NUESTRA lista, nunca texto del remoto. */
      missingTools?: string[];
    };

/**
 * `initialize` + `tools/list`: persiste `serverName`/`serverVersion`/
 * `protocolVersion`/`instructions`/`tools` y **decide** `sessionMode` en vez
 * de suponerlo (el servidor real de Altos resultó `stateless`, hallazgo 1).
 *
 * Nunca lanza: todo `catch` degrada a un código de `MCP_ERROR_TEXT`
 * (Constitución II, categoría 5, letra j). Un `unauthorized` deja la fila en
 * `reconnect_required`; cualquier otro fallo solo mueve `lastError*`.
 *
 * El rate limit (6/min por empresa, corrección #16) NO vive acá sino en
 * `handshakeGuarded` de `calls.ts`, para que «`calls.ts` es la única puerta
 * al MCP» sea cierto. Las rutas llaman a `handshakeGuarded`, no a esto.
 */
export async function handshake(organizationId: string): Promise<HandshakeResult> {
  const row = await getRow(organizationId);
  if (!row || row.status === "disabled") return { ok: false, code: "not_enabled" };

  const integration = toIntegration(row);
  const credential = integration.resolveCredential();
  if (!credential) return { ok: false, code: "no_credential" };

  const syntax = checkEndpointSyntax(row.endpointUrl);
  if (!syntax.ok) {
    const code: McpErrorCode = syntax.reason === "bad_host" ? "blocked_host" : "invalid_url";
    await recordMcpError(organizationId, code);
    return { ok: false, code };
  }

  const cfg: McpEndpointConfig = {
    endpointUrl: row.endpointUrl,
    credential,
    authScheme: row.authScheme,
    timeoutMs: row.timeoutMs,
    maxResponseBytes: row.maxResponseBytes,
    sandbox: false,
  };

  try {
    // Resolución previa: da el error útil antes de abrir el socket. NO
    // reemplaza a `guardedLookup`, que es el control real (TOCTOU).
    await assertResolvable(syntax.url);

    const session = await mcpInitialize(cfg);
    // El modo lo DICE el servidor: si emitió `Mcp-Session-Id`, se la
    // reenviamos en cada llamada; si no, un POST por llamada y listo.
    const sessionMode: McpSessionMode = session.sessionId ? "initialize" : "stateless";
    const tools = await mcpListTools(cfg, sessionMode === "initialize" ? session : undefined);

    const profile = getProfile(row.profile);
    const names = new Set(tools.map((t) => t.name));
    const missing = profile.requiredTools.filter((t) => !names.has(t));

    // Se persiste el handshake aunque falten herramientas: el super admin
    // necesita VER qué expone el servidor para diagnosticar. Lo que no se
    // otorga es `status='connected'`.
    await recordHandshake(organizationId, session, tools, sessionMode, {
      connected: missing.length === 0,
    });

    if (missing.length > 0) {
      await recordMcpError(organizationId, "bad_payload");
      return { ok: false, code: "bad_payload", missingTools: [...missing] };
    }

    const view = await getMcpIntegrationView(organizationId);
    return view ? { ok: true, integration: view } : { ok: false, code: "not_enabled" };
  } catch (err) {
    const mcpError = toMcpError(err);
    if (mcpError.code === "unauthorized") {
      await markReconnectRequired(organizationId, "unauthorized");
    } else {
      await recordMcpError(organizationId, mcpError.code);
    }
    console.error(
      "[mcp] handshake fallido:",
      redactForLog(`${mcpError.code} ${integration.endpointHost}`, [credential])
    );
    return { ok: false, code: mcpError.code };
  }
}
