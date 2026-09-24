import { redirect } from "next/navigation";
import { getSessionOrNull, type SessionContext } from "@/lib/auth/session";
import { canManageConfig } from "@/lib/roles";

/**
 * Guarda de PÁGINA para las secciones de configuración (022): Agente,
 * Laboratorio, Integraciones y las pestañas de Ajustes que no son
 * personales. Sin sesión → login; con sesión de miembro → Bandeja. Es la
 * segunda capa (la primera es no mostrar el enlace; la tercera, el 403 de
 * cada endpoint de escritura): pegar la URL no alcanza para entrar.
 */
export async function requireOwnerPage(): Promise<SessionContext> {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!canManageConfig(session.role)) redirect("/inbox");
  return session;
}
