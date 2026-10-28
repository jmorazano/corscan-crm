import { z } from "zod";

/**
 * 030: el email y el teléfono que la persona dio en el chat. Como el nombre
 * (021), viajan con la respuesta y el servidor los valida antes de guardar.
 */
const CONTACT_DATA_FIELDS = {
  contact_email: z.string().trim().max(254).optional(),
  contact_phone: z.string().trim().max(40).optional(),
};

/**
 * 030 (US3): extras de Instagram. Laxos A PROPÓSITO: un modelo que manda una
 * forma rara no tumba el turno — `sanitizeInteractive` decide qué sale (y
 * descarta enlaces que no estén en el contexto del turno).
 */
const INTERACTIVE_FIELDS = {
  quick_replies: z.array(z.unknown()).max(20).optional(),
  buttons: z.array(z.unknown()).max(10).optional(),
  cards: z.array(z.unknown()).max(20).optional(),
};

/**
 * 031: la nota del lead puede viajar CON una consulta. Antes el modelo que
 * quería anotar «consulta para 10 personas del 27 al 29» elegía `update_lead`
 * —que es terminal—, mandaba «busco opciones…» y nunca buscaba.
 */
const LEAD_NOTE_FIELD = {
  lead_note: z.string().trim().max(500).optional(),
};

/**
 * 042: marcas para el seguimiento automático. Viajan con la respuesta (como
 * el nombre en 021) y son LAXAS: «true», "si" o 1 valen; cualquier otra cosa
 * queda como «sin marca» (sin marca no hay seguimiento — el error seguro).
 */
const looseBool = z
  .unknown()
  .optional()
  .transform((v): boolean | undefined => {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1") return true;
    if (v === 0 || v === "0") return false;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (["true", "si", "sí", "yes"].includes(t)) return true;
      if (["false", "no"].includes(t)) return false;
    }
    return undefined;
  });

const FOLLOW_UP_FIELDS = {
  /** Quedaste esperando que el cliente conteste (pediste fechas, pasaste precio…). */
  awaiting_reply: looseBool,
  /** El cliente pidió claramente que no le escriban más / no le interesa. */
  opt_out: looseBool,
};

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  /** 031: `reason` (opcional) es el porqué breve; se ve en el hilo, nunca lo lee el cliente. */
  z.object({ action: z.literal("none"), reason: z.string().optional() }),
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
    ...CONTACT_DATA_FIELDS,
    ...INTERACTIVE_FIELDS,
    ...FOLLOW_UP_FIELDS,
  }),
  /**
   * `note` es OPCIONAL a propósito: en producción (14-oct-2026, Altos) el
   * modelo mandó un `update_lead` con `contact_name` y una respuesta perfecta
   * pero sin nota, tres veces seguidas, y el turno terminó en «no se pudo
   * leer» + atención humana. Sin nota es una respuesta como cualquier otra.
   */
  z.object({
    action: z.literal("update_lead"),
    note: z.string().optional(),
    reply: z.string().optional(),
    contact_name: z.string().trim().optional(),
    ...CONTACT_DATA_FIELDS,
    ...INTERACTIVE_FIELDS,
    ...FOLLOW_UP_FIELDS,
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
    ...FOLLOW_UP_FIELDS,
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
    ...LEAD_NOTE_FIELD,
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
    /**
     * 028 (hoteles): el precio depende de la ocupación. Opcionales por la
     * misma razón que el resto (D14): si faltan, el perfil pregunta.
     */
    adults: z.coerce.number().int().optional(),
    children: z.coerce.number().int().optional(),
    babies: z.coerce.number().int().optional(),
    room_type: z.string().trim().max(60).optional(),
    /** 028: comparar rangos. El perfil corta en 3 y lo dice. */
    ranges: z
      .array(
        z.object({
          check_in: z.string().trim().optional(),
          check_out: z.string().trim().optional(),
        })
      )
      .max(10)
      .optional(),
    ...LEAD_NOTE_FIELD,
  }),
  z.object({
    action: z.literal("show_stay"),
    /** Código (AC-003), slug o enlace de la ficha. */
    property: z.string().trim().min(1),
    ...LEAD_NOTE_FIELD,
  }),
  /**
   * 032: cualquier herramienta que el servidor del conector publicó y una
   * persona dejó activa, sin un deploy. Los argumentos son LAXOS a propósito:
   * los valida el servidor del CRM contra el `inputSchema` publicado
   * (`validateToolArgs`), y un modelo que manda una forma rara recibe qué
   * corregir en vez de tumbar el turno.
   */
  z.object({
    action: z.literal("use_tool"),
    tool: z.string().trim().min(1).max(128),
    args: z.record(z.unknown()).optional(),
    ...LEAD_NOTE_FIELD,
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
    ...LEAD_NOTE_FIELD,
  }),
  z.object({
    action: z.literal("show_listing"),
    /** Id de ML (MLA123…), enlace de la ficha o parte del título. */
    listing: z.string().trim().min(1).max(512),
    ...LEAD_NOTE_FIELD,
  }),
  /**
   * 034: búsqueda en la COPIA de una planilla de consulta (nunca la red en
   * el turno). Solo se ofrece cuando alguna planilla no entró completa.
   */
  z.object({
    action: z.literal("search_sheet"),
    sheet: z.string().trim().max(300).optional(),
    query: z.string().trim().max(200).default(""),
    ...LEAD_NOTE_FIELD,
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

/** 034: búsqueda en una planilla de consulta (la despacha el pipeline). */
export function isSheetsAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "search_sheet" }> {
  return action.action === "search_sheet";
}

/** Acciones-herramienta del conector MCP (016): las despacha el pipeline. */
export function isMcpAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "search_stays" | "show_stay" }> {
  return action.action === "search_stays" || action.action === "show_stay";
}

/** 032: herramienta GENÉRICA del conector (lo que el servidor publique). */
export function isGenericToolAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "use_tool" }> {
  return action.action === "use_tool";
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
 * 038, PURA: un `none` cuyo motivo habla del FORMATO de la respuesta (JSON,
 * esquema) no es una decisión sobre la conversación: el modelo contestó al
 * aviso del reintento en vez de al cliente. Pasó con un 🙀: el hilo mostró
 * «decidió no responder: previous response was not valid JSON».
 */
export function isFormatArtifactReason(reason: string | undefined | null): boolean {
  if (!reason) return false;
  return /\bjson\b|esquema|schema|formato v[aá]lido|valid format|not valid|no (fue|es) v[aá]lid/i.test(reason);
}

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
      ? {
          action: "reply",
          text: action.reply,
          awaiting_reply: action.awaiting_reply,
          opt_out: action.opt_out,
        }
      : { action: "none" };
  }
  return action;
}
