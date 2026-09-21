import { JUDGE_MARKER, TRANSACTIONAL_MARKER } from "@/server/ai/prompts";
import { TRAINER_MARKER } from "@/server/ai/trainer-prompts";
import { MCP_MARKER } from "@/server/mcp/markers";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

/** 015: el contenido puede venir en partes (texto + input_audio). */
type InContent =
  | string
  | { type: string; text?: string; input_audio?: { data: string; format: string } }[];
type InMessage = { role: string; content: InContent };

/** Transcripción fija que devuelve el mock ante cualquier `input_audio`. */
export const MOCK_TRANSCRIPTION =
  "Cuando pregunten por precio de mensura decí que arranca en ciento cincuenta mil pesos";

function textOf(c: InContent | undefined): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  return c
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n");
}

function hasAudio(c: InContent | undefined): boolean {
  return Array.isArray(c) && c.some((p) => p.type === "input_audio");
}

export function aiMockCompletion(messages: InMessage[]): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  // 015: nota de voz → transcripción en texto plano (no JSON). Un `format`
  // flac dispara el sentinel de "sin contenido" para el camino infeliz.
  if (lastUserMsg && hasAudio(lastUserMsg.content)) {
    const parts = lastUserMsg.content as Exclude<InContent, string>;
    const audio = parts.find((p) => p.type === "input_audio")?.input_audio;
    if (audio?.format === "flac") return "[SIN_CONTENIDO]";
    return MOCK_TRANSCRIPTION;
  }

  const system = textOf(messages.find((m) => m.role === "system")?.content);
  const lastUser = textOf(lastUserMsg?.content);

  // 015: entrenador — el dueño enseña, el mock traduce a cambios.
  if (system.includes(TRAINER_MARKER)) return dispatchTrainer(system, lastUser);

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

  // 014: tras una notificación por API, un modelo sensato calla si el
  // cliente no pregunta ni pide nada (sin `?` ni vocabulario de pedido).
  if (
    system.includes(TRANSACTIONAL_MARKER) &&
    !/[?¿]/.test(lastUser) &&
    !/\b(necesito|quiero|quisiera|puedo|podr[ií]a|c[oó]mo|cu[aá]ndo|d[oó]nde|problema|ayuda|no (puedo|encuentro|me)|cambiar|cancelar)\b/.test(text)
  ) {
    return JSON.stringify({ action: "none" });
  }

  // Conector MCP (016): VA ANTES QUE LA AGENDA a propósito. El regex de
  // `mentionsCalendar` incluye "disponibilidad" y "reservar", así que una
  // empresa con agenda Y conector le ofrecería un turno de 30 minutos a
  // quien está preguntando por una cabaña. El orden es el desempate.
  const stayTurn = dispatchStays(messages, system);
  if (stayTurn) return stayTurn;

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
 * Turno del entrenador (015). Reglas deterministas sobre el último mensaje
 * del dueño (y el conocimiento con ids que trae el system prompt):
 * - `borr`/`elimin` → kb_delete del primer [kb_…] del prompt (sin ids →
 *   pregunta cuál).
 * - `emoji` → profile_append tone «No usar emojis.».
 * - `escal` → profile_append escalationRules con el texto.
 * - `llamate` → profile_set name con la última palabra.
 * - `precio`/`cuesta`: si el prompt ya tiene una P/R con «precio» →
 *   kb_update de esa id; si no → kb_add qa.
 * - termina en `?` o trae `¿` → reply aclaratorio (sin cambios).
 * - resto → reply «Recibido: …».
 */
function dispatchTrainer(system: string, lastUser: string): string {
  const text = lastUser.toLowerCase();
  const ids = [...system.matchAll(/\[(kb_[0-9a-z]+)\]/g)].map((m) => m[1]!);

  if (/[?¿]/.test(lastUser) && !/precio|cuesta/.test(text)) {
    return JSON.stringify({
      action: "reply",
      text: "Contame un poco más: ¿qué tiene que responder exactamente?",
    });
  }
  if (/\bborr|\belimin/.test(text)) {
    const id = ids[0];
    if (!id) {
      return JSON.stringify({ action: "reply", text: "¿Cuál entrada querés borrar?" });
    }
    return JSON.stringify({
      action: "apply",
      changes: [{ op: "kb_delete", id }],
      reply: "Listo, borré esa entrada del conocimiento.",
    });
  }
  if (text.includes("emoji")) {
    return JSON.stringify({
      action: "apply",
      changes: [{ op: "profile_append", field: "tone", text: "No usar emojis." }],
      reply: "Anotado: no uso más emojis.",
    });
  }
  if (text.includes("escal")) {
    return JSON.stringify({
      action: "apply",
      changes: [{ op: "profile_append", field: "escalationRules", text: lastUser.trim() }],
      reply: "Listo, agregué esa regla de escalado.",
    });
  }
  if (text.includes("llamate")) {
    const name = lastUser.trim().split(/\s+/).pop() ?? "Asistente";
    const cap = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    return JSON.stringify({
      action: "apply",
      changes: [{ op: "profile_set", field: "name", value: cap }],
      reply: `Perfecto, desde ahora me llamo ${cap}.`,
    });
  }
  if (/precio|cuesta/.test(text)) {
    const priceLine = system
      .split("\n")
      .find((l) => /^\[(kb_[0-9a-z]+)\] P: .*precio/i.test(l));
    const existing = priceLine?.match(/^\[(kb_[0-9a-z]+)\]/)?.[1];
    if (existing) {
      return JSON.stringify({
        action: "apply",
        changes: [{ op: "kb_update", id: existing, answer: lastUser.trim() }],
        reply: "Actualicé la respuesta sobre el precio.",
      });
    }
    const term =
      lastUser.match(/precio de ([^?,.]+?)(?:\s+dec[ií]|\s*[?,.]|$)/i)?.[1]?.trim() ??
      "el servicio";
    return JSON.stringify({
      action: "apply",
      changes: [
        {
          op: "kb_add",
          kind: "qa",
          question: `¿Cuál es el precio de ${term}?`,
          answer: lastUser.trim(),
        },
      ],
      reply: `Guardé el precio de ${term}. Cuando pregunten, respondo con eso.`,
    });
  }
  return JSON.stringify({ action: "reply", text: `Recibido: ${lastUser.slice(0, 80)}` });
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
/**
 * Despacho determinista del CONECTOR MCP (016): emula lo que haría un modelo
 * sensato con la sección de alojamientos en el prompt.
 *
 * Con esa sección presente, el negocio ES de alojamientos: el despacho
 * atiende TODA la conversación y acumula el contexto (fechas y huéspedes
 * pueden venir en mensajes distintos), igual que haría un modelo real. Por
 * eso devuelve null solo cuando la empresa no tiene conector.
 *
 * El `toolText` del conector llega con `role:"user"` (corrección #7), no
 * "system" como el de la agenda: se lo busca entre los mensajes de usuario.
 */
function dispatchStays(
  messages: InMessage[],
  system: string
): string | null {
  if (!system.includes(MCP_MARKER)) return null;

  const last = messages[messages.length - 1];
  const lastText = last ? textOf(last.content) : "";

  if (last?.role === "user" && lastText.startsWith("[HERRAMIENTA]")) {
    if (lastText.includes("FUERA DE LA VENTANA")) {
      return JSON.stringify({
        action: "update_lead",
        note: "Consultó por fechas fuera de la ventana publicada.",
        reply:
          "Para esas fechas todavía no tenemos los valores publicados. ¿Querés que te avise cuando salgan, o vemos alguna fecha más cercana?",
      });
    }
    if (/FALTAN DATOS|RECHAZAD|DESCONOCID/i.test(lastText)) {
      return JSON.stringify({
        action: "reply",
        text: "¿Para qué fechas y cuántas personas serían? Así te paso las opciones con el precio.",
      });
    }
    if (lastText.includes("NO DISPONIBLE")) {
      return JSON.stringify({
        action: "handoff",
        reason: "modelo",
        farewell: "Dejame consultarlo con el equipo y te confirmo enseguida.",
      });
    }
    // Knob del guion E2E: fuerza una promesa de reserva para verificar que la
    // guarda del pipeline la intercepta ANTES de que salga a WhatsApp (#42).
    if (system.includes("[E2E_FORCE_PROMISE]")) {
      return JSON.stringify({
        action: "reply",
        text: "¡Listo! Te la reservo para esas fechas y quedás confirmado.",
      });
    }
    const lines = lastText.split("\n").filter((l) => l.startsWith("- ")).slice(0, 2);
    const link = lastText.match(/https:\/\/\S+/)?.[0] ?? "";
    if (lines.length === 0) {
      return JSON.stringify({
        action: "reply",
        text: "Para esas fechas no me quedó nada libre. ¿Probamos corriendo las fechas o con menos personas?",
      });
    }
    return JSON.stringify({
      action: "reply",
      text: `Tengo estas opciones:\n${lines.join("\n")}\nPodés ver fotos y reservar acá: ${link}`,
    });
  }

  // --- contexto ACUMULADO de toda la conversación (como un modelo real) ---
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => textOf(m.content))
    .filter((t) => !t.startsWith("[HERRAMIENTA]"));
  const todo = userTexts.join(" \n ").toLowerCase();

  const dates = [...todo.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!);

  const WORD_NUM: Record<string, number> = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  const num = (raw: string | undefined): number | null => {
    if (!raw) return null;
    return /^\d+$/.test(raw) ? Number(raw) : (WORD_NUM[raw] ?? null);
  };
  let guests =
    num(todo.match(/\bsomos\s+(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/)?.[1]) ??
    num(todo.match(/\b(\d{1,2})\s*(?:personas?|hu[eé]spedes?|adultos?|pax)\b/)?.[1]) ??
    num(todo.match(/\bpara\s+(\d{1,2})\s*(?:personas?|$|\s)/)?.[1]);
  // Los chicos CUENTAN (FR-008 / corrección #50): "somos 4 y dos nenes" = 6.
  const kids = todo.match(
    /\b(\d{1,2}|un|una|dos|tres|cuatro|cinco)\s*(?:nen[eo]s?|chic[oa]s?|ni[ñn][oa]s?|menores|peques?)\b/
  );
  if (guests !== null && kids) guests += num(kids[1]) ?? 0;

  // Resultado de herramienta YA presente en el contexto: un modelo sensato
  // responde con eso en vez de volver a consultar lo mismo cada turno.
  const previo = [...messages]
    .reverse()
    .map((m) => textOf(m.content))
    .find((t) => t.startsWith("[HERRAMIENTA]") && t.includes("ALOJAMIENTOS"));
  const enlacePrevio = previo?.match(/https:\/\/\S+/)?.[0] ?? null;

  // Pedido explícito de que reserve el agente. El servicio SOLO INFORMA
  // (FR-009): la respuesta correcta explica el circuito y pasa el enlace,
  // NUNCA promete. Es el caso que mide la persona `consulta_alojamiento`.
  const pideQueReserve =
    /\breserv(ámela|amela|ámelo|amelo|áme|ame|ala|alo)\b|me la reserv|me lo reserv|reserv(á|a)(me)?la vos|que la reserv/.test(
      todo
    );
  if (pideQueReserve) {
    return JSON.stringify({
      action: "reply",
      text: enlacePrevio
        ? `La reserva la hacés vos desde el sitio, con la seña — nosotros no la tomamos por WhatsApp. Te dejo el enlace con tus fechas ya cargadas: ${enlacePrevio}`
        : "La reserva se completa en nuestro sitio con la seña; por WhatsApp no la tomamos. Decime las fechas y cuántas personas son y te paso el enlace con todo cargado.",
    });
  }

  // Ya hay resultados y el cliente pregunta por el precio: responder con eso.
  if (previo && /cu[aá]nto|precio|sale|vale|total|cuesta/.test(todo)) {
    const lineas = previo.split("\n").filter((l) => l.startsWith("- ")).slice(0, 2);
    if (lineas.length > 0) {
      return JSON.stringify({
        action: "reply",
        text: `Los totales por toda la estadía son:\n${lineas.join("\n")}\nPodés ver fotos y reservar acá: ${enlacePrevio ?? ""}`,
      });
    }
  }

  if (dates.length >= 2 && guests !== null) {
    const args: Record<string, unknown> = {
      action: "search_stays",
      check_in: dates[dates.length - 2],
      check_out: dates[dates.length - 1],
      guests,
    };
    if (/pileta|piscina/.test(todo)) args.facilities_any = ["Piscina", "Minipiscina"];
    else if (/cochera|garage|garaje/.test(todo)) {
      args.facilities_any = ["Cochera", "Cochera Cubierta", "Cochera opcional (no apta camionetas)"];
    }
    return JSON.stringify(args);
  }

  // Falta algo: preguntar UNA cosa a la vez, sin gastar la llamada.
  if (dates.length < 2) {
    return JSON.stringify({
      action: "reply",
      text: "¡Hola! ¿Para qué fechas lo estás buscando? Decime el día de entrada y el de salida.",
    });
  }
  return JSON.stringify({
    action: "reply",
    text: "¿Cuántas personas se alojan? Contá también a los chicos, así te cotizo bien.",
  });
}

function dispatchCalendar(
  messages: InMessage[],
  system: string,
  lastUser: string,
  text: string
): string | null {
  if (!system.includes("AGENDA DE TURNOS")) return null;
  const tool = [...messages]
    .reverse()
    .find((m) => m.role === "system" && textOf(m.content).startsWith("[HERRAMIENTA]"));
  const wantsBooking =
    /\b(dale|reserv|agend[aá]me|agendalo|confirm[aá]|el de las|quiero el|me viene|ese me sirve|perfecto el)\b/.test(
      text
    );
  // "disponibles" (producto) NO cuenta: solo vocabulario de agenda.
  const mentionsCalendar = /\b(turno|cita|horarios?|disponibilidad|agendar|reservar)\b/.test(text);

  if (tool) {
    const slots = [...textOf(tool.content).matchAll(/^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}) \((.+)\)$/gm)].map(
      (m) => ({ key: m[1]!, label: m[2]! })
    );
    // Reserva rechazada por el servidor (ocupado / fuera de reglas): un
    // modelo sensato ofrece las alternativas, no vuelve a reservar a ciegas.
    if (textOf(tool.content).startsWith("[HERRAMIENTA] RESERVA RECHAZADA") && slots.length > 0) {
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
      .map((m) => /(\d{4}-\d{2}-\d{2})/.exec(textOf(m.content))?.[1])
      .find((d): d is string => Boolean(d));
    return JSON.stringify(
      date ? { action: "check_availability", date } : { action: "check_availability" }
    );
  }
  return null;
}
