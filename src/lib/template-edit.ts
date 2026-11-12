/**
 * Reglas PURAS de la edición de plantillas (052), compartidas por el servidor
 * y la UI. Las fija Meta («Template management», verificado 12-nov-2026):
 * se editan APPROVED / REJECTED / PAUSED (no las que están en revisión), la
 * categoría de una aprobada es fija y una aprobada admite 1 edición cada
 * 24 h y 10 cada 30 días. Meta sigue siendo la autoridad: esto evita gastar
 * un intento que de todos modos va a rechazar y le dice al dueño desde cuándo.
 */

export const APPROVED_EDITS_PER_DAY = 1;
export const APPROVED_EDITS_PER_MONTH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export type TemplateStatus = "draft" | "pending" | "approved" | "rejected";

export type TemplateEditability = {
  canEdit: boolean;
  /** Motivo cuando no se puede: en revisión, tope diario o tope mensual. */
  reason: "in_review" | "daily_limit" | "monthly_limit" | null;
  /** Texto para el dueño (vacío si se puede). */
  message: string | null;
  /** ISO: desde cuándo se puede volver a editar (topes). */
  nextEditAt: string | null;
  /** Una aprobada no cambia de categoría. */
  categoryLocked: boolean;
};

/** Marcas de ediciones de aprobadas dentro de la ventana de 30 días, ordenadas. */
export function pruneApprovedEdits(
  edits: readonly string[] | null | undefined,
  now: Date
): string[] {
  const floor = now.getTime() - MONTH_MS;
  return (edits ?? [])
    .filter((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t > floor && t <= now.getTime() + 60_000;
    })
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

export function templateEditability(
  status: TemplateStatus,
  approvedEdits: readonly string[] | null | undefined,
  now: Date
): TemplateEditability {
  if (status === "pending" || status === "draft") {
    return {
      canEdit: false,
      reason: "in_review",
      message:
        "Meta la está revisando: se puede editar cuando la apruebe o la rechace.",
      nextEditAt: null,
      categoryLocked: false,
    };
  }
  if (status === "rejected") {
    return {
      canEdit: true,
      reason: null,
      message: null,
      nextEditAt: null,
      categoryLocked: false,
    };
  }

  const edits = pruneApprovedEdits(approvedEdits, now);
  const lastDay = edits.filter((iso) => Date.parse(iso) > now.getTime() - DAY_MS);
  if (lastDay.length >= APPROVED_EDITS_PER_DAY) {
    const next = new Date(Date.parse(lastDay[0]!) + DAY_MS).toISOString();
    return {
      canEdit: false,
      reason: "daily_limit",
      message: "Meta permite editar una plantilla aprobada una vez por día.",
      nextEditAt: next,
      categoryLocked: true,
    };
  }
  if (edits.length >= APPROVED_EDITS_PER_MONTH) {
    // La ventana se libera cuando la más vieja cumple 30 días.
    const oldest = edits[edits.length - APPROVED_EDITS_PER_MONTH]!;
    const next = new Date(Date.parse(oldest) + MONTH_MS).toISOString();
    return {
      canEdit: false,
      reason: "monthly_limit",
      message: `Meta permite ${APPROVED_EDITS_PER_MONTH} ediciones de una plantilla aprobada cada 30 días.`,
      nextEditAt: next,
      categoryLocked: true,
    };
  }
  return {
    canEdit: true,
    reason: null,
    message: null,
    nextEditAt: null,
    categoryLocked: true,
  };
}

/** Orígenes de variables iguales (null = legada sin orígenes). */
export function sameBindings(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export type CampaignRef = { id: string; name: string; status: string };

/**
 * Campañas que impiden la edición: en curso o pausadas SIEMPRE (el texto
 * cambiaría a mitad de envío y la plantilla vuelve a revisión); borradores
 * solo si cambian los orígenes (sus textos libres congelados dejarían de
 * corresponder).
 */
export function editBlockingCampaigns(
  campaigns: readonly CampaignRef[],
  bindingsUnchanged: boolean
): CampaignRef[] {
  return campaigns.filter(
    (c) =>
      c.status === "running" ||
      c.status === "paused" ||
      (c.status === "draft" && !bindingsUnchanged)
  );
}
