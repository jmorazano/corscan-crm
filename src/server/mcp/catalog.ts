import { callGuarded } from "@/server/mcp/calls";
import {
  getMcpIntegration,
  saveCatalog,
  type McpIntegration,
} from "@/server/mcp/integration";
import type { StayCatalog } from "@/server/mcp/profiles";

/**
 * Prefetch y caché del CATÁLOGO del proveedor (016, design §F.8).
 *
 * El catálogo (`list-search-options`) es lo que le dice al modelo qué tipos
 * de alojamiento, qué localidades, qué características y qué ventana de
 * fechas existen de verdad. Nada de eso se hard-codea: sale de acá y cambia
 * sin avisar (hallazgo §12 — la documentación del dueño estaba vieja).
 *
 * Tres decisiones que valen más que el código:
 *
 * 1. **La clave es la fila** (`mcp_integration.catalog`), no un `Map`: así
 *    sobrevive a los reinicios del proceso y es 1:1 con la integración.
 * 2. **Se persiste el CONDENSADO** de `profile.parseCatalog`, jamás los 16 KB
 *    crudos: el prompt no los soporta y la fila tampoco tiene por qué.
 * 3. **Stale-while-revalidate**: el turno usa el catálogo que haya y dispara
 *    el refresco en segundo plano. Nunca espera.
 *
 * Y la regla dura (corrección #9): **jamás se refresca con `sandbox: true`**.
 * El Laboratorio corre `runAgentTurn`; una corrida con el catálogo vencido
 * habría generado tráfico REAL al PMS del cliente, registrado con
 * `is_test=false` e invisible para la evidencia del sandbox.
 */

/** Lock in-process por integración: dos turnos simultáneos no se pisan. */
const globalForCatalog = globalThis as unknown as {
  __mcpCatalogLocks?: Map<string, Promise<StayCatalog | null>>;
};

function locks(): Map<string, Promise<StayCatalog | null>> {
  return (globalForCatalog.__mcpCatalogLocks ??= new Map());
}

/** Solo para tests. */
export function resetCatalogLocks(): void {
  locks().clear();
}

/** ¿Venció el TTL de la empresa (`catalog_ttl_minutes`, 5..1440)? */
export function isCatalogStale(
  integration: Pick<McpIntegration, "catalog" | "catalogFetchedAt" | "catalogTtlMinutes">,
  now: Date = new Date()
): boolean {
  if (!integration.catalog || !integration.catalogFetchedAt) return true;
  const ageMs = now.getTime() - integration.catalogFetchedAt.getTime();
  return ageMs >= integration.catalogTtlMinutes * 60_000;
}

/** ¿Este perfil tiene catálogo que traer? (`generic` no tiene ninguno). */
export function hasCatalogTool(integration: McpIntegration): boolean {
  const tool = integration.profile.catalogTool;
  return typeof tool === "string" && tool.length > 0;
}

export type RefreshCatalogOptions = {
  /** Evita una segunda lectura de la fila cuando el caller ya la tiene. */
  integration?: McpIntegration;
  /**
   * Corrección #9: con `true` no se toca la red. Se acepta el parámetro —en
   * vez de prohibirlo por tipo— para que el caller pueda propagar su
   * booleano sin ramificar, y que el corte viva en un solo lugar.
   */
  sandbox?: boolean;
  /** Corrección #11: acota el reloj cuando el refresco corre en el turno. */
  budgetMs?: number;
};

/**
 * Trae el catálogo y lo persiste ya condensado. Devuelve el catálogo nuevo,
 * o el que ya estaba si no se pudo traer. **Nunca lanza** y nunca deja la
 * fila peor de lo que estaba: un fallo del PMS conserva el catálogo viejo,
 * que es mucho mejor que un prompt sin listas.
 */
export async function refreshCatalog(
  organizationId: string,
  options: RefreshCatalogOptions = {}
): Promise<StayCatalog | null> {
  const integration = options.integration ?? (await getMcpIntegration(organizationId));
  if (!integration) return null;

  // Corte de sandbox: el Laboratorio se queda con lo que haya en la fila.
  if (options.sandbox) return integration.catalog;
  if (!hasCatalogTool(integration)) return integration.catalog;
  if (integration.status === "disabled") return integration.catalog;

  const key = integration.id;
  const running = locks().get(key);
  if (running) return running;

  const task = fetchCatalog(integration, options.budgetMs).finally(() => {
    locks().delete(key);
  });
  locks().set(key, task);
  return task;
}

async function fetchCatalog(
  integration: McpIntegration,
  budgetMs?: number
): Promise<StayCatalog | null> {
  const tool = integration.profile.catalogTool;
  if (!tool) return integration.catalog;

  const outcome = await callGuarded({
    integration,
    tool,
    args: {},
    conversationId: null,
    sandbox: false,
    // El prefetch es del sistema: sigue andando aunque el dueño haya apagado
    // las herramientas del agente (la tarjeta y la vista previa lo necesitan).
    source: "catalog",
    ...(budgetMs !== undefined ? { budgetMs } : {}),
  });

  if (!outcome.ok) return integration.catalog;

  const parsed = integration.profile.parseCatalog(outcome.data, {
    // 022: el `search_link.base` del catálogo es del sitio de esta empresa.
    linkHosts: integration.endpointHost ? [integration.endpointHost] : [],
  });
  if (!parsed) return integration.catalog;

  try {
    await saveCatalog(integration.organizationId, parsed);
  } catch {
    // La fila no se pudo escribir: el catálogo igual sirve para ESTE turno.
    return parsed;
  }
  return parsed;
}

/**
 * Lo que llama el turno: devuelve el catálogo **tal cual esté**, sin esperar
 * red, y dispara el refresco en segundo plano si venció. El `void` lleva
 * `.catch(() => undefined)` (corrección #10): una promesa rechazada sin
 * manejar es fatal en Node, y un 500 del PMS habría reiniciado el proceso de
 * Next.js tumbando los turnos en vuelo, el mapa de coalesce, el lock del
 * entrenador y los buckets de rate limit — justo lo que la letra (j) de la
 * quinta categoría prohíbe.
 */
export function getCatalogStaleWhileRevalidate(
  integration: McpIntegration,
  opts: { sandbox: boolean; now?: Date }
): StayCatalog | null {
  if (
    !opts.sandbox &&
    hasCatalogTool(integration) &&
    integration.status !== "disabled" &&
    integration.hasCredential &&
    isCatalogStale(integration, opts.now ?? new Date())
  ) {
    void refreshCatalog(integration.organizationId, { integration }).catch(() => undefined);
  }
  return integration.catalog;
}
