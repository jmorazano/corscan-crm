import { requireOwnerPage } from "@/lib/auth/owner-page";
import { AgentClient } from "@/components/agent/agent-client";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <AgentClient />;
}
