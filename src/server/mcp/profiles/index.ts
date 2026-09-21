/**
 * Registro de perfiles de proveedor MCP (016, §C.3/§C.4).
 *
 * Las claves de `PROFILES` y el enum de la columna `mcp_integration.profile`
 * son LO MISMO. Sumar un segundo PMS = un archivo nuevo acá + una clave en
 * el enum. Cero columnas nuevas, cero cambios en el pipeline.
 */

import { altos } from "@/server/mcp/profiles/altos";
import type { McpProfile, McpProfileKey } from "@/server/mcp/profiles/types";

export * from "@/server/mcp/profiles/types";
export { altos };

/**
 * Degradación honesta para un servidor MCP SIN perfil conocido (§C.4): se
 * conecta, se hace el handshake y la UI muestra `serverInfo`, `instructions`
 * y la lista de herramientas — y ahí termina. El agente no recibe nada: ni
 * sección de prompt, ni acciones, ni llamadas.
 *
 * Por qué no "que el modelo elija la herramienta por su schema": habría que
 * (a) validar argumentos contra un JSON Schema arbitrario en runtime,
 * (b) renderizar un resultado de forma desconocida sin que sea un vector de
 * inyección y (c) garantizar que es de solo lectura — y lo único que lo
 * afirma es la descripción que escribe el propio servidor, que es dato no
 * confiable. Nada de eso es trabajo de v1.
 */
export const generic: McpProfile = {
  key: "generic",
  name: "Servidor MCP",
  description:
    "Servidor Model Context Protocol sin perfil conocido: se puede conectar y ver qué expone, pero el agente no recibe herramientas.",
  allowedTools: [],
  requiredTools: [],
  catalogTool: null,
  linkHosts: [],
  agentActions: [],
  parseCatalog: () => null,
  renderSection: () => null,
  validate: () => ({
    ok: false,
    toolText: "",
  }),
  render: () => ({ toolText: "", clientSummary: null }),
  renderTransportError: () => "",
  sandbox: () => null,
};

export const PROFILES: Record<McpProfileKey, McpProfile> = {
  generic,
  altos_de_calamuchita: altos,
};

export const PROFILE_KEYS = Object.keys(PROFILES) as McpProfileKey[];

export function isProfileKey(value: unknown): value is McpProfileKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROFILES, value);
}

/**
 * El perfil de una fila. Una clave desconocida (fila vieja, enum tocado a
 * mano) NO rompe el turno: degrada a `generic`, que no le da herramientas
 * a nadie.
 */
export function getProfile(key: unknown): McpProfile {
  return isProfileKey(key) ? PROFILES[key] : generic;
}
