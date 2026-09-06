import { JUDGE_MARKER } from "@/server/ai/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Agenda de turnos (005, research D10): despacho determinista de las
  // acciones-herramienta. Solo si el prompt trae la sección de agenda.
  const calendarTurn = dispatchCalendar(messages, system, lastUser, text);
  if (calendarTurn) return calendarTurn;

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}

/**
 * Turno con agenda (005). Reglas:
 * - Con resultado de herramienta `[HERRAMIENTA]` en los mensajes:
 *   · DISPONIBILIDAD/RESERVA RECHAZADA con huecos + intención de reserva
 *     ("dale", "reservá", "el de las 10") → book_appointment del hueco
 *     elegido (por HH:MM si lo dijo; si no, el primero).
 *   · con huecos sin intención de reserva → reply listando 3 opciones.
 *   · sin huecos / agenda no disponible → handoff con despedida.
 * - Sin resultado de herramienta: cualquier mención de turno/horario o
 *   intención de reserva → check_availability (fecha YYYY-MM-DD si aparece).
 */
function dispatchCalendar(
  messages: InMessage[],
  system: string,
  lastUser: string,
  text: string
): string | null {
  if (!system.includes("AGENDA DE TURNOS")) return null;
  const tool = [...messages]
    .reverse()
    .find((m) => m.role === "system" && m.content.startsWith("[HERRAMIENTA]"));
  const wantsBooking =
    /\b(dale|reserv|agend[aá]me|agendalo|confirm[aá]|el de las|quiero el|me viene|ese me sirve|perfecto el)\b/.test(
      text
    );
  // "disponibles" (producto) NO cuenta: solo vocabulario de agenda.
  const mentionsCalendar = /\b(turno|cita|horarios?|disponibilidad|agendar|reservar)\b/.test(text);

  if (tool) {
    const slots = [...tool.content.matchAll(/^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}) \((.+)\)$/gm)].map(
      (m) => ({ key: m[1]!, label: m[2]! })
    );
    // Reserva rechazada por el servidor (ocupado / fuera de reglas): un
    // modelo sensato ofrece las alternativas, no vuelve a reservar a ciegas.
    if (tool.content.startsWith("[HERRAMIENTA] RESERVA RECHAZADA") && slots.length > 0) {
      const options = slots.slice(0, 3).map((s) => s.label).join(", ");
      return JSON.stringify({
        action: "reply",
        text: `Uy, ese horario se acaba de ocupar. Te puedo ofrecer: ${options}. ¿Cuál preferís?`,
      });
    }
    if (slots.length === 0) {
      return JSON.stringify({
        action: "handoff",
        reason: "agenda",
        farewell: "Te confirmo el turno con el equipo en un momento.",
      });
    }
    if (wantsBooking) {
      const cleaned = text.replace(/\b(dale|el de las|a las)\b/g, " ");
      const hm = /(\d{1,2})(?::(\d{2}))?\s*(?:hs|h)?\b/.exec(cleaned);
      const hour = hm ? Number(hm[1]) : null;
      const minute = hm?.[2] ? Number(hm[2]) : 0;
      const suffix = `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      // Hora pedida que NO está en la lista: el mock la reserva igual (emula
      // un modelo que ignora la herramienta) para ejercitar el rechazo
      // server-side; sin hora → el primer hueco.
      const chosen =
        hour !== null
          ? (slots.find((s) => s.key.endsWith(suffix)) ?? {
              key: `${slots[0]!.key.slice(0, 10)}${suffix}`,
              label: `${slots[0]!.label.slice(0, -5)}${suffix.slice(1)}`,
            })
          : slots[0]!;
      return JSON.stringify({
        action: "book_appointment",
        start: chosen.key,
        note: "Consulta por WhatsApp",
        reply: `¡Listo! Te agendé el turno para el ${chosen.label}. Te esperamos.`,
      });
    }
    const options = slots.slice(0, 3).map((s) => s.label).join(", ");
    return JSON.stringify({
      action: "reply",
      text: `Tengo estos horarios disponibles: ${options}. ¿Cuál te queda mejor?`,
    });
  }

  if (mentionsCalendar || wantsBooking) {
    // Fecha: la última YYYY-MM-DD que dijo el cliente en TODA la
    // conversación (un modelo real usa el contexto: "dale, el de las 9"
    // refiere al día que pidió antes).
    const date = [...messages]
      .reverse()
      .filter((m) => m.role === "user")
      .map((m) => /(\d{4}-\d{2}-\d{2})/.exec(m.content)?.[1])
      .find((d): d is string => Boolean(d));
    return JSON.stringify(
      date ? { action: "check_availability", date } : { action: "check_availability" }
    );
  }
  return null;
}
