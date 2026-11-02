import { QuickRepliesSettingsClient } from "@/components/settings/quick-replies-client";

export const dynamic = "force-dynamic";

export default function QuickRepliesSettingsPage() {
  // 047: herramienta de operación — la abre todo el equipo (MEMBER_SETTINGS_PATHS).
  return <QuickRepliesSettingsClient />;
}
