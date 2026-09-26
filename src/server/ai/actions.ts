import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  /**
   * 021: `contact_name` viaja CON la respuesta en vez de ser una acción
   * propia. Con una acción por turno, un agente que tuviera que elegir entre
   * contestar y guardar el nombre elegiría contestar — y el nombre se
   * perdería justo en el mensaje donde el huésped lo dice.
   * El servidor lo valida (`normalizeContactName`) y decide si puede pisar
   * el nombre actual (`canOverwriteContactName`): nunca se escribe a ciegas.
   */
  z.object({
    action: z.literal("reply"),
    text: z.string().min(1),
    contact_name: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
    contact_name: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  /**
   * Acciones "herramienta" de la agenda (005, research D6): el servidor las
   * ejecuta y vuelve a llamar al modelo con el resultado (máx. 2 vueltas).
   * Solo se ofrecen en el prompt cuando la empresa tiene calendario.
   */
  z.object({
    action: z.literal("check_availability"),
    /** "YYYY-MM-DD" local del negocio; sin fecha: próximos días. */
    date: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("book_appointment"),
    /** "YYYY-MM-DDTHH:MM" local del negocio (un hueco ofrecido). */
    start: z.string().trim().min(1),
    note: z.string().trim().max(500).optional(),
    reply: z.string().optional(),
  }),
  /**
   * Acciones-herramienta del CONECTOR MCP (016): el servidor las ejecuta
   * contra el sistema del cliente —de SOLO LECTURA— y vuelve a llamar al
   * modelo con el resultado condensado. Solo se ofrecen en el prompt cuando
   * la empresa tiene un conector habilitado con un perfil que las declara
   * (`profile.agentActions`); un perfil `generic` no ofrece ninguna.
   *
   * check_in / check_out / guests son OPCIONALES en el esquema a propósito
   * (research D14): si el modelo omite uno, el perfil responde con un texto
   * educativo que le dice qué preguntarle al cliente — mucho mejor que
   * gastar tres llamadas al proveedor y terminar en handoff.
   */
  z.object({
    action: z.literal("search_stays"),
    check_in: z.string().trim().optional(),
    check_out: z.string().trim().optional(),
    guests: z.coerce.number().int().optional(),
    property_type: z.string().trim().optional(),
    city: z.string().trim().optional(),
    bedrooms: z.coerce.number().int().optional(),
    bathrooms: z.coerce.number().int().optional(),
    /** Todas obligatorias (AND). */
    facilities: z.array(z.string().trim()).max(20).optional(),
    /** Al menos una (OR): la forma de preguntar por "cochera" o "pileta". */
    facilities_any: z.array(z.string().trim()).max(20).optional(),
  }),
  z.object({
    action: z.literal("show_stay"),
    /** Código (AC-003), slug o enlace de la ficha. */
    property: z.string().trim().min(1),
  }),
  /**
   * Publicaciones de Mercado Libre (025): consultas sobre el SNAPSHOT local
   * de la empresa (nunca la red en el turno). Solo se ofrecen en el prompt
   * cuando la empresa tiene publicaciones sincronizadas. Todos los filtros
   * son opcionales: un modelo que omite uno recibe más resultados, no un
   * error.
   */
  z.object({
    action: z.literal("search_listings"),
    operation: z.string().trim().max(40).optional(),
    property_type: z.string().trim().max(40).optional(),
    zone: z.string().trim().max(80).optional(),
    bedrooms_min: z.coerce.number().int().min(0).max(20).optional(),
    rooms_min: z.coerce.number().int().min(0).max(20).optional(),
    price_min: z.coerce.number().min(0).optional(),
    price_max: z.coerce.number().min(0).optional(),
    currency: z.string().trim().max(10).optional(),
    query: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("show_listing"),
    /** Id de ML (MLA123…), enlace de la ficha o parte del título. */
    listing: z.string().trim().min(1).max(512),
  }),
  /**
   * Pedido de visita (025): TERMINAL. El servidor anota la propiedad y la
   * disponibilidad en el contacto, mueve el lead a una etapa de visita si
   * existe, manda `reply` y escala a una persona (motivo `visita`) para que
   * confirme el horario. El agente jamás confirma una visita por su cuenta.
   */
  z.object({
    action: z.literal("request_visit"),
    listing: z.string().trim().max(512).optional(),
    when: z.string().trim().max(200).optional(),
    reply: z.string().optional(),
    contact_name: z.string().trim().optional(),
  }),
]);

/** Consultas de publicaciones (025): las despacha el pipeline. */
export function isListingsAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "search_listings" | "show_listing" }> {
  return action.action === "search_listings" || action.action === "show_listing";
}

/** Acciones-herramienta del conector MCP (016): las despacha el pipeline. */
export function isMcpAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "search_stays" | "show_stay" }> {
  return action.action === "search_stays" || action.action === "show_stay";
}

/** Acciones-herramienta de la agenda (005). */
export function isCalendarAction(
  action: AgentActionType
): action is Extract<
  AgentActionType,
  { action: "check_availability" | "book_appointment" }
> {
  return (
    action.action === "check_availability" || action.action === "book_appointment"
  );
}

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
