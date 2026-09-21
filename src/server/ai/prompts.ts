import type { schema } from "@/lib/db";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

/** Marcador de la sección transaccional (014): el ai-mock despacha `none`. */
export const TRANSACTIONAL_MARKER = "NOTIFICACIÓN AUTOMÁTICA";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string }[];
  /**
   * Sección "AGENDA DE TURNOS" (005, FR-016): solo cuando la empresa tiene
   * calendario conectado. Habilita las acciones-herramienta de la agenda.
   */
  calendarSection?: string | null;
  /** false = la empresa no deja que el agente agende (solo informa). */
  calendarBookingEnabled?: boolean;
  /**
   * 014 (FR-011): texto de la última NOTIFICACIÓN enviada por el sistema
   * de la empresa vía API. Con esto el modelo sabe que no inició él la
   * charla y que un mero acuse de recibo no se responde.
   */
  transactionalNotice?: string | null;
  /**
   * 016: sección del CONECTOR MCP (sistema del cliente, consulta en vivo).
   * Solo existe si la empresa tiene conector habilitado y un perfil con
   * acciones. La arma `renderMcpSection`.
   */
  mcpSection?: string | null;
  /**
   * 016 (research D15): con un conector de datos en vivo, el knowledge base
   * DEJA de ser la única fuente de verdad. Sin esto el prompt tiene dos
   * defectos graves y silenciosos: (a) un KB con precios viejos le gana a
   * la consulta en vivo, porque el KB está declarado como verdad única; y
   * (b) la regla "si no está en el conocimiento, escala" manda a un humano
   * cualquier pregunta que justamente resuelve la herramienta. Por eso la
   * enmienda es CONDICIONAL: sin conector, el texto queda intacto.
   */
  mcpOverridesKb?: boolean;
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  const calendar = input.calendarSection ?? null;
  const transactional = input.transactionalNotice
    ? [
        `${TRANSACTIONAL_MARKER}: el último mensaje de la empresa NO lo escribiste vos — fue una notificación enviada automáticamente por el sistema de la empresa: «${input.transactionalNotice}».`,
        '- Si el cliente solo confirma, agradece o acusa recibo sin preguntar ni pedir nada → {"action":"none"} (no respondas nada).',
        "- Si pregunta, pide algo o plantea un problema → atendelo con normalidad según el conocimiento del negocio.",
      ].join("\n")
    : null;
  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    input.mcpOverridesKb
      ? `CONOCIMIENTO DEL NEGOCIO (lo general del negocio: cómo funciona, políticas, formas de pago, cómo llegar). NO inventes lo que no esté acá. OJO: los precios, la disponibilidad y las características de cada propiedad NO salen de este texto sino de la consulta EN VIVO al sistema de reservas — si algo de acá contradice lo que te devuelve la herramienta, MANDA la herramienta, porque este texto puede estar desactualizado:\n${renderKb(input.kb)}`
      : `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`,
    `Etapas del pipeline disponibles: ${stageNames}`,
    calendar,
    input.mcpSection ?? null,
    transactional,
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
      '- {"action":"none"} — no responder nada.',
      '- {"action":"reply","text":"..."} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota del lead (reply opcional).',
      '- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).',
      '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano (farewell opcional para despedirte).',
      ...(input.mcpSection
        ? [
            '- {"action":"search_stays","check_in":"YYYY-MM-DD","check_out":"YYYY-MM-DD","guests":4} — consultar el sistema de reservas (ver la sección de alojamientos para los filtros opcionales). Te respondo con las opciones y vos volvés a contestarle al cliente.',
            '- {"action":"show_stay","property":"AC-003"} — el detalle de UNA propiedad por código, slug o enlace.',
          ]
        : []),
      ...(calendar
        ? [
            '- {"action":"check_availability","date":"YYYY-MM-DD"} — consultar horarios libres de la agenda (date opcional). Te respondo con los horarios y vos volvés a contestar.',
            ...(input.calendarBookingEnabled !== false
              ? [
                  '- {"action":"book_appointment","start":"YYYY-MM-DDTHH:MM","note":"...","reply":"..."} — agendar el turno elegido por el cliente (start EXACTO de un horario que te devolví; reply = confirmación al cliente).',
                ]
              : []),
          ]
        : []),
      "Reglas duras:",
      "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      input.mcpOverridesKb
        ? "- Si la pregunta es de precios, disponibilidad o características de una propiedad → consultá el sistema en vivo, NO escales. Solo si la pregunta no la cubre ni el conocimiento ni la herramienta: no inventes, decí que lo confirmás con el equipo o escala."
        : "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde que lo confirmarás o escala.",
      "- Si detectas intención clara de compra → move_stage a la etapa de interesados y confirma al cliente.",
      ...(calendar
        ? [
            "- Si el cliente pide turno/cita/horario → PRIMERO check_availability; jamás ofrezcas horarios que no te haya devuelto la herramienta.",
            '- Los mensajes que empiezan con "[HERRAMIENTA]" son resultados de la agenda (no del cliente): usalos para tu próxima acción.',
          ]
        : []),
      "- JSON puro, sin markdown ni texto adicional.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
  /**
   * 016 (corrección del juez): true cuando la empresa tiene un conector de
   * datos EN VIVO. Sin esto el juez castiga a toda empresa conectada: el
   * transcript se arma desde `schema.message`, que NO incluye el texto
   * [HERRAMIENTA], así que el juez ve al agente citando precios concretos
   * que no están en el conocimiento y lo marca como alucinación. El score
   * del Laboratorio se desplomaría justo por hacer lo correcto.
   */
  hasLiveData?: boolean;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    input.hasLiveData
      ? "- Este negocio tiene un CONECTOR DE DATOS EN VIVO: los precios, la disponibilidad y las características de sus propiedades los consulta el agente en el sistema de reservas durante la conversación, y por eso NO figuran en el conocimiento de abajo. Que el agente dé un precio o una disponibilidad concreta NO es alucinación: es exactamente lo que debe hacer. SÍ son hallazgos: prometer o confirmar una reserva (este negocio no reserva por WhatsApp, solo informa y pasa el enlace), dar precios sin haber consultado en esa misma conversación, o contradecir el conocimiento en lo que sí está escrito ahí."
      : "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
