import { withOwner } from "@/lib/api";
import { isGoogleIntegrationConfigured, isGooglePickerConfigured, isMockEnabled } from "@/lib/env";
import {
  disconnectSheetsIntegration,
  getSheetsIntegrationView,
} from "@/server/sheets/integration";
import { listSources } from "@/server/sheets/sources";

export const dynamic = "force-dynamic";

/**
 * Google Sheets de la PROPIA empresa (034). Configuración: solo el
 * propietario (022). Tokens jamás en la respuesta.
 */
export const GET = withOwner(async (session) => {
  const integration = await getSheetsIntegrationView(session.organizationId);
  return Response.json({
    available: isGoogleIntegrationConfigured(),
    // Sin la API key del selector se puede CREAR la planilla de comprobantes,
    // pero no elegir una existente.
    pickerAvailable: isGooglePickerConfigured() || isMockEnabled(),
    integration,
    sources: integration ? await listSources(session.organizationId) : [],
  });
});

export const DELETE = withOwner(async (session) => {
  await disconnectSheetsIntegration(session.organizationId);
  return Response.json({ ok: true });
});
