import { requireOwnerPage } from "@/lib/auth/owner-page";
import { LabClient } from "@/components/lab/lab-client";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <LabClient />;
}
