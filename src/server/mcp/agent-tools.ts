import type { McpErrorCode } from "@/lib/mcp";
import { callGuarded, lastCallArgs } from "@/server/mcp/calls";
import { getCatalogStaleWhileRevalidate } from "@/server/mcp/catalog";
import { getMcpIntegration, type McpIntegration } from "@/server/mcp/integration";
import { MCP_MARKER, TOOL_MARKER_LITERAL } from "@/server/mcp/markers";
import type {
  McpAgentAction,
  McpAgentActionKind,
  McpProfile,
  McpTransportErrorCode,
  RenderResult,
  StayCatalog,
} from "@/server/mcp/profiles";
import { makeForeignFence } from "@/server/mcp/sanitize";

/**
 * Puente agente ↔ conector MCP (016, FR-008/FR-009/FR-016, design §F.3-§F.6).
 *
 * Calcado de `src/server/calendar/agent-tools.ts`: mismo contrato de tres
 * piezas —`loadMcpContext` → `renderMcpSection` → `executeMcpAction`— para que
 * el pipeline trate las dos familias de herramientas igual. Y la misma promesa
 * dura: **nada de acá lanza**. Todo error del proveedor, del transporte o de
 * los guardrails degrada a un `toolText` que el modelo puede leer y usar para
 * corregirse solo. Un hipo del PMS jamás tumba el turno, la ingesta ni el envío
 * (Constitución II, categoría 5, letra j).
 *
 * Tres fronteras que este archivo NO cruza:
 *
 * 1. **No conoce a ningún proveedor.** Todo lo específico de un PMS —qué
 *    herramienta se llama, cómo se condensa la respuesta, qué texto ve el
 *    modelo— vive en el perfil (`src/server/mcp/profiles/`). Acá solo se
 *    orquesta. Un segundo PMS es un archivo nuevo de perfil y cero cambios acá.
 * 2. **No llama al MCP.** La única puerta a la red es `callGuarded`
 *    (`calls.ts`), que concentra allowlist, corte de sandbox, cupo, caché y
 *    bitácora, justamente para que este archivo no pueda olvidarse de ninguno.
 * 3. **No decide el texto de los errores.** Los mensajes salen de
 *    `MCP_ERROR_TEXT` o del perfil; ni un byte del cuerpo remoto se propaga.
 */

/* ============================================================
 * Marcadores y constantes
 * ============================================================ */

/**
 * Prefijo de todo resultado de herramienta MCP que ve el modelo.
 *
 * Es la MISMA literal que `TOOL_MARKER` de la agenda —el prompt enseña una
 * sola convención— pero se define acá desde el módulo hoja `markers.ts` y NO
 * se importa de `src/server/calendar/agent-tools.ts`: ese archivo arrastra la
 * agenda entera (disponibilidad, reservas, Google) dentro del conector, y las
 * dos features tienen que poder moverse por separado.
 */
export const MCP_TOOL_MARKER = TOOL_MARKER_LITERAL;

/** Re-exportado por comodidad: el ai-mock y `prompts.ts` despachan por él. */
export { MCP_MARKER };

/**
 * Rol con el que el pipeline inyecta el `toolText` en la vuelta siguiente
 * (corrección #7). La agenda usa `system`; acá **no**: el resultado de una
 * herramienta que consultó a un tercero es contenido, no una regla del
 * sistema, y meterlo como `system` le da al texto del proveedor el mismo peso
 * que a nuestras reglas duras. Como `user`, el modelo lo lee como el dato que
 * es, y la sección del prompt ya le enseña que los mensajes que empiezan con
 * `[HERRAMIENTA]` son datos y nunca instrucciones.
 */
export const MCP_TOOL_TEXT_ROLE = "user" as const;

/**
 * Línea de desambiguación cuando la empresa tiene agenda Y conector a la vez
 * (corrección #48). Sin ella, `mentionsCalendar` cubre «disponibilidad» y
 * «reservar», y una empresa con las dos cosas ofrecía turnos de 30 minutos a
 * quien quería una cabaña por tres noches.
 */
const CALENDAR_DISAMBIGUATION = [
  "Agenda de turnos vs. alojamientos: si el cliente habla de NOCHES, fechas de entrada y salida, cabañas, casas o departamentos, es una ESTADÍA y va por el sistema de reservas de esta sección.",
  "La agenda de turnos es solo para visitas, reuniones o llamadas cortas: no ofrezcas turnos de la agenda a quien pregunta por alojamiento.",
].join("\n");

/* ============================================================
 * Contexto
 * ============================================================ */

export type McpContext = {
  integration: McpIntegration;
  /** Ya resuelto en la fila; nunca `generic` acá (ver `loadMcpContext`). */
  profile: McpProfile;
  /** Catálogo condensado tal como esté. Puede ser `null` y no pasa nada. */
  catalog: StayCatalog | null;
  /** Zona horaria de la EMPRESA (corrección #45), no la del proceso. */
  timezone: string;
  /** Instante del turno. */
  now: Date;
  /** Acciones que habilita el perfil. Nunca vacío (ver `loadMcpContext`). */
  actions: readonly McpAgentActionKind[];
  /**
   * Argumentos de la última búsqueda OK de ESTA conversación (corrección #46).
   * Sin esto, «¿y con pileta?» vuelve a preguntar las fechas que el cliente ya
   * dio hace dos mensajes, justo cuando estaba a un clic de reservar.
   */
  lastSearch: Record<string, unknown> | null;
  /**
   * `true` solo si se puede consultar de verdad: estado `connected` y la
   * empresa no apagó las herramientas del agente. Con `false` el contexto
   * sigue existiendo —la sección degradada le dice al modelo que NO invente
   * precios— pero el pipeline no debe despachar acciones.
   */
  toolsUsable: boolean;
};

/**
 * Lee la fila y arma el contexto del turno. **Nunca toca la red cuando
 * `sandbox`** (corrección #9): el Laboratorio corre `runAgentTurn`, y un
 * refresco de catálogo desde una corrida `is_test` habría generado tráfico
 * REAL al PMS del cliente, registrado con `is_test=false` e invisible para la
 * evidencia del sandbox.
 *
 * Devuelve `null` cuando la empresa no tiene un conector utilizable: sin fila,
 * apagado, o con un perfil que no le da herramientas al agente (`generic`).
 * En ese caso el agente atiende exactamente como antes de esta feature: sin
 * sección en el prompt y sin acciones en el menú (plan, letra (a)).
 */
export async function loadMcpContext(
  organizationId: string,
  conversationId: string | null,
  options: { sandbox: boolean; now?: Date }
): Promise<McpContext | null> {
  const integration = await getMcpIntegration(organizationId);
  if (!integration) return null;
  // `disabled` no es una degradación: es "acá no hay conector". Ni siquiera la
  // sección degradada corresponde, porque no hay nada que reconectar.
  if (integration.status === "disabled") return null;

  const profile = integration.profile;
  // `generic` (o cualquier perfil sin acciones) se conecta y se diagnostica en
  // la UI, pero no se le ofrece al modelo (FR-007, §C.4).
  if (profile.agentActions.length === 0) return null;

  const now = options.now ?? new Date();

  // Stale-while-revalidate: devuelve lo que haya sin esperar red, y el
  // refresco queda cortado por `sandbox` dentro de `catalog.ts`.
  const catalog = getCatalogStaleWhileRevalidate(integration, {
    sandbox: options.sandbox,
    now,
  });

  const lastSearch = conversationId
    ? await readLastSearch(organizationId, conversationId, profile)
    : null;

  return {
    integration,
    profile,
    catalog,
    timezone: integration.timezone,
    now,
    actions: profile.agentActions,
    lastSearch,
    toolsUsable: integration.status === "connected" && integration.agentToolsEnabled,
  };
}

/**
 * Argumentos de la última llamada OK de la conversación, sin el catálogo
 * (`list-search-options` no es una búsqueda del cliente: sus argumentos son
 * `{}` y no recuerdan nada).
 *
 * Es una lectura de BASE, no de red: vale igual en sandbox, y de hecho es
 * deseable —una persona del Laboratorio que pregunta «¿y con pileta?» tiene
 * que encontrarse el mismo comportamiento que un cliente real.
 *
 * Una fila corrupta o un fallo de la consulta NO rompen el turno: se pierde la
 * memoria de la búsqueda anterior, que es exactamente lo que pasaba antes de
 * la corrección #46.
 */
async function readLastSearch(
  organizationId: string,
  conversationId: string,
  profile: McpProfile
): Promise<Record<string, unknown> | null> {
  const tools = profile.allowedTools.filter((t) => t !== profile.catalogTool);
  if (tools.length === 0) return null;
  try {
    return await lastCallArgs(organizationId, conversationId, tools);
  } catch (err) {
    console.error(
      "[agente] no se pudo leer la última búsqueda:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/* ============================================================
 * Sección del system prompt (§F.4)
 * ============================================================ */

/**
 * Sección `ALOJAMIENTOS Y DISPONIBILIDAD` del system prompt.
 *
 * El texto lo escribe el PERFIL, no este archivo ni `prompts.ts`: qué se puede
 * buscar, la ventana de fechas publicadas, la fecha de hoy en la zona de la
 * empresa (corrección #45), los argumentos de la última búsqueda (#46), la
 * regla AND/OR de `facilities` vs `facilities_any` en prosa (#49), que los
 * chicos cuentan como huéspedes y que toda respuesta con precios repite
 * fechas, noches y personas (#50), y la REGLA DURA de que el negocio informa
 * pero **jamás promete una reserva** (FR-009).
 *
 * Acá se resuelven solo las dos cosas que el perfil no puede saber: la valla
 * con nonce del turno para encerrar las `instructions` del servidor
 * (corrección #6, y solo si un humano tildó `useServerInstructions` —
 * corrección #5) y la línea de desambiguación con la agenda (#48).
 */
export function renderMcpSection(
  ctx: McpContext,
  options: { hasCalendar?: boolean } = {}
): string | null {
  // Valla NUEVA por turno: un delimitador fijo es adivinable, y un proveedor
  // que lo adivina lo cierra y escribe un bloque que parece nuestro.
  const fence = makeForeignFence();

  const section = ctx.profile.renderSection({
    catalog: ctx.catalog,
    now: ctx.now,
    // `enabled` y `reconnect_required` caen los dos en la variante degradada:
    // el perfil solo distingue "se puede consultar" de "no se puede".
    status: ctx.integration.status === "connected" ? "connected" : "reconnect_required",
    agentToolsEnabled: ctx.integration.agentToolsEnabled,
    timezone: ctx.timezone,
    instructions: ctx.integration.instructions,
    useServerInstructions: ctx.integration.useServerInstructions,
    fence,
    lastSearch: ctx.lastSearch,
  });

  if (!section) return null;
  return options.hasCalendar ? `${section}\n\n${CALENDAR_DISAMBIGUATION}` : section;
}

/* ============================================================
 * Ejecución de una acción-herramienta (§F.5/§F.6)
 * ============================================================ */

export type ExecuteMcpOptions = {
  /** Viaja como `cid=` al proveedor: atribución del lead, jamás el teléfono. */
  conversationId: string | null;
  /** `true` ⇒ fixtures del perfil, sin red, con fila `is_test` de evidencia. */
  sandbox: boolean;
  /** Corrección #11: acota el reloj del turno (`min(timeoutMs, budgetMs)`). */
  budgetMs?: number;
};

/**
 * Ejecuta una acción del agente contra el conector y devuelve los dos textos
 * del render (§F.5):
 *
 * - `toolText`: lo que ve el MODELO en la vuelta siguiente, prefijado con
 *   `[HERRAMIENTA]` e inyectado con **`role: "user"`** (corrección #7).
 *   Condensado a propósito: los 19 KB crudos del proveedor no entran en un
 *   prompt de WhatsApp (hallazgo §8).
 * - `clientSummary`: la frase que se envía TAL CUAL a un cliente real si el
 *   modelo se cuelga en la vuelta siguiente. La compone el perfil con
 *   plantilla propia + números + enumerados + nombres que pasan por
 *   `SAFE_NAME` + URLs validadas contra `profile.linkHosts` (corrección #4).
 *   **Ni un carácter de texto libre del tercero.** `null` cuando no hay nada
 *   seguro que decir —un error, un rechazo o una respuesta vacía—, y ahí el
 *   pipeline degrada con su propia frase.
 *
 * **Nunca lanza.** Los tres caminos de fallo terminan en texto:
 *
 * 1. Argumentos incompletos o inválidos → el perfil rechaza ANTES de gastar
 *    una llamada, con un texto educativo que le dice al modelo qué preguntarle
 *    al cliente (corrección #43).
 * 2. Error del PROVEEDOR (`tool_error`) → se le reinyectan sus campos de
 *    autocorrección (`window{from,to}`, `accepted[]`, `max`) para que corrija
 *    en la vuelta siguiente en lugar de escalar (§10). El `message` del
 *    proveedor NO se propaga.
 * 3. Error de TRANSPORTE o de los guardrails → texto de primera parte del
 *    perfil, sin filtrar nada del remoto.
 */
export async function executeMcpAction(
  ctx: McpContext,
  action: McpAgentAction,
  options: ExecuteMcpOptions
): Promise<RenderResult> {
  const { profile, catalog } = ctx;

  try {
    // 1) Validación local: el reparto correcto es el de `check_availability`
    //    (Zod verifica la forma, el perfil verifica la semántica). Un campo
    //    faltante no puede costar tres POST al modelo y un handoff.
    const validated = profile.validate(action, catalog, ctx.now, {
      conversationId: options.conversationId,
      timezone: ctx.timezone,
    });
    if (!validated.ok) {
      return { toolText: validated.toolText, clientSummary: null };
    }

    // 2) Única puerta a la red del repo. El `sandbox` viaja EXPLÍCITO, con
    //    origen en `conversation.isTest`, y el corte vive adentro (c#25).
    const outcome = await callGuarded({
      integration: ctx.integration,
      tool: validated.tool,
      args: validated.args,
      conversationId: options.conversationId,
      sandbox: options.sandbox,
      action,
      source: "agent",
      ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
    });

    if (outcome.ok) {
      const rendered = profile.render(action, outcome.data, catalog);
      return appendNotes(rendered, validated.notes);
    }

    // 3) Error de la HERRAMIENTA: no es una falla nuestra, es material para
    //    que el modelo se corrija. Se reconstruye el sobre del proveedor con
    //    sus campos estructurados y lo traduce el perfil.
    if (outcome.code === "tool_error") {
      const error: Record<string, unknown> = { ...(outcome.details ?? {}) };
      if (outcome.providerCode) error.code = outcome.providerCode;
      const rendered = profile.render(action, { success: false, error }, catalog);
      return { toolText: rendered.toolText, clientSummary: null };
    }

    // 4) Transporte o guardrails: texto de primera parte, nada del remoto.
    return { toolText: transportText(profile, outcome.code), clientSummary: null };
  } catch (err) {
    // Cinturón final: si algo del perfil o de la orquestación lanza, el turno
    // sigue vivo. Lo que no puede pasar es que el cliente se quede sin
    // respuesta porque el PMS tuvo un hipo.
    console.error(
      "[agente] acción del conector falló:",
      err instanceof Error ? err.message : err
    );
    return { toolText: transportText(ctx.profile, "internal_error"), clientSummary: null };
  }
}

/** Alias legible para el pipeline: búsqueda de alojamientos. */
export async function executeStaySearch(
  ctx: McpContext,
  action: McpAgentAction,
  options: ExecuteMcpOptions
): Promise<RenderResult> {
  return executeMcpAction(ctx, action, options);
}

/** Alias legible para el pipeline: detalle de UNA propiedad. */
export async function executeShowStay(
  ctx: McpContext,
  action: McpAgentAction,
  options: ExecuteMcpOptions
): Promise<RenderResult> {
  return executeMcpAction(ctx, action, options);
}

/* ============================================================
 * Auxiliares
 * ============================================================ */

/**
 * Concatena los avisos de la validación (p. ej. «ignoré estas características
 * porque no existen en el catálogo»). Van al `toolText` y NUNCA al
 * `clientSummary`: el cliente no tiene por qué leer nuestra contabilidad.
 */
function appendNotes(rendered: RenderResult, notes: string[] | undefined): RenderResult {
  if (!notes || notes.length === 0) return rendered;
  return {
    toolText: `${rendered.toolText}\n${notes.join("\n")}`,
    clientSummary: rendered.clientSummary,
  };
}

/**
 * Códigos del adaptador (`McpErrorCode`) → códigos que entiende el perfil
 * (`McpTransportErrorCode`). Existen dos enums porque son dos capas: el
 * transporte distingue `bad_content_type` de `rpc_error` para la bitácora y
 * para el diagnóstico del super admin; al modelo, las dos cosas le dicen lo
 * mismo (no pude leer la respuesta).
 *
 * `tool_error` no entra acá: lo maneja `profile.render` con los campos del
 * proveedor, que es lo único que le permite al modelo autocorregirse.
 */
function toTransportCode(code: McpErrorCode): McpTransportErrorCode {
  switch (code) {
    case "unauthorized":
    case "timeout":
    case "too_large":
    case "http_error":
    case "bad_payload":
    case "blocked_host":
    case "unexpected_redirect":
    case "not_allowed":
    case "rate_limited":
      return code;
    case "invalid_url":
      return "blocked_host";
    case "bad_content_type":
    case "rpc_error":
      return "bad_payload";
    // El semáforo de salida lleno es congestión, igual que el cupo: el texto
    // correcto es "saturado, en un momento te confirmo", no "no disponible".
    case "busy":
      return "rate_limited";
    // `sandbox_violation` es un fusible nuestro que el cliente jamás debería
    // provocar: si suena, es un bug, y el modelo no tiene nada que corregir.
    case "sandbox_violation":
    case "tool_error":
    default:
      return "internal_error";
  }
}

/**
 * Texto de fallo de transporte. Si el perfil no trae `renderTransportError`
 * (no es obligatorio en el contrato), se cae a una frase propia: pase lo que
 * pase, el modelo recibe una instrucción clara de NO inventar precios.
 */
function transportText(profile: McpProfile, code: McpErrorCode | "internal_error"): string {
  const mapped: McpTransportErrorCode =
    code === "internal_error" ? "internal_error" : toTransportCode(code);
  const own = profile.renderTransportError?.(mapped);
  if (own) return own;
  return `${MCP_TOOL_MARKER} SISTEMA DE RESERVAS NO DISPONIBLE: no pude consultar disponibilidad. NO inventes precios ni propiedades: decile al cliente que el equipo le pasa la disponibilidad enseguida y usá handoff.`;
}
