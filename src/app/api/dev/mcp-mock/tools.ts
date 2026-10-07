/**
 * Declaración de protocolo del mcp-mock (016): `serverInfo`, `instructions` y
 * las TRES herramientas con sus `annotations`, calcadas del servidor real
 * (hallazgos 1, 4 y 6).
 *
 * Tres detalles que NO son adorno y que el conector genérico testea:
 *  - `protocolVersion` es `2025-06-18` y el servidor es SIN ESTADO: `tools/list`
 *    y `tools/call` responden sin `Mcp-Session-Id` y sin `notifications/
 *    initialized` (hallazgo 1).
 *  - las tres herramientas declaran `readOnlyHint: true` — el guardrail duro del
 *    conector solo ofrece al agente herramientas con esa anotación, así que si
 *    el mock no la publicara, el agente no vería ninguna.
 *  - ninguna publica `outputSchema` (hallazgo 5): la salida es opaca, un JSON
 *    dentro de `content[0].text`.
 */

export const MCP_MOCK_PROTOCOL_VERSION = "2025-06-18";

export const MCP_MOCK_SERVER_INFO = {
  name: "altos-de-calamuchita-assistant",
  version: "1.0.0",
};

/**
 * `instructions` del `initialize`. Texto del proveedor: el conector lo trata
 * como DATO (lo sanea, lo trunca a 1500 y lo mete entre vallas), nunca como
 * instrucción. Está en español, como el real.
 */
export const MCP_MOCK_INSTRUCTIONS = [
  "Asistente de alquiler temporario de Altos de Calamuchita (Valle de Calamuchita, Córdoba).",
  "Usá list-search-options para conocer tipos de alojamiento, localidades, características y la ventana de fechas vigente antes de filtrar.",
  "Usá check-availability con fecha de ingreso, fecha de salida y cantidad de huéspedes para obtener disponibilidad y precios en pesos argentinos.",
  "Usá show-property para ampliar el detalle de una propiedad concreta; esa consulta no cotiza ni informa disponibilidad.",
  "Pasá siempre conversation_id: los enlaces devueltos lo propagan como cid y así la consulta queda atribuida.",
  "Este servicio solo informa: no reserva, no bloquea fechas y no cobra.",
].join(" ");

export type McpMockTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: false;
    destructiveHint?: boolean;
  };
};

/** Las tres traen exactamente estas anotaciones (hallazgo 4). */
const SOLO_LECTURA = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const MCP_MOCK_TOOLS: readonly McpMockTool[] = [
  {
    name: "list-search-options",
    description:
      "Devuelve los valores válidos para filtrar: tipos de alojamiento, localidades, catálogo de características, ventana de fechas consultable y moneda.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "check-availability",
    description:
      "Informa qué alojamientos están disponibles para un rango de fechas y una cantidad de huéspedes, con su precio total en pesos argentinos y el enlace de cada uno. No reserva ni bloquea fechas.",
    inputSchema: {
      type: "object",
      properties: {
        // Los opcionales usan tipos UNIÓN con null (hallazgo 6): el conversor
        // JSON Schema → validador del conector debe soportar `type` como array.
        check_in: {
          type: "string",
          description: "Fecha de ingreso en formato AAAA-MM-DD.",
        },
        check_out: {
          type: "string",
          description: "Fecha de salida en formato AAAA-MM-DD.",
        },
        guests: {
          type: "integer",
          description: "Cantidad total de huéspedes, incluidos los menores.",
        },
        property_type: {
          type: ["string", "null"],
          description:
            "Tipo de alojamiento, tal como lo devuelve list-search-options.",
        },
        city: {
          type: ["string", "null"],
          description: "Localidad, tal como la devuelve list-search-options.",
        },
        bedrooms: {
          type: ["integer", "null"],
          description: "Cantidad MÍNIMA de habitaciones requerida.",
        },
        bathrooms: {
          type: ["integer", "null"],
          description: "Cantidad MÍNIMA de baños requerida.",
        },
        facilities: {
          type: ["array", "null"],
          items: { type: "string" },
          description:
            "Características que la propiedad debe tener TODAS a la vez.",
        },
        facilities_any: {
          type: ["array", "null"],
          items: { type: "string" },
          description:
            "Características de las que alcanza con que la propiedad tenga UNA.",
        },
        conversation_id: {
          type: ["string", "null"],
          description:
            "Identificador de la conversación; viaja como cid en los enlaces devueltos.",
        },
      },
      required: ["check_in", "check_out", "guests"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "show-property",
    description:
      "Devuelve el detalle de una propiedad por código, slug, id o enlace. No cotiza ni informa disponibilidad.",
    inputSchema: {
      type: "object",
      properties: {
        property: {
          type: "string",
          description: "Código (AC-003), slug, id o enlace de la propiedad.",
        },
        conversation_id: {
          type: ["string", "null"],
          description:
            "Identificador de la conversación; viaja como cid en el enlace devuelto.",
        },
      },
      required: ["property"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
];

/* ------------------------------------------------------------------ */
/* 032: reservas (servidor real 2.0.0) y una herramienta «nueva»        */
/* ------------------------------------------------------------------ */

const NULLABLE_STRING = { type: ["string", "null"] } as const;

/**
 * Las cuatro de reserva, con las MISMAS anotaciones que el real:
 * `start-booking` se declara de solo lectura pero NO idempotente (abre un
 * borrador nuevo cada vez), y `confirm-booking` es la única que escribe.
 * Se publican solo con el knob `bookingTools` (los guiones viejos de 016
 * siguen viendo las tres de siempre).
 */
export const MCP_MOCK_BOOKING_TOOLS: readonly McpMockTool[] = [
  {
    name: "start-booking",
    title: "Iniciar una reserva (todavía sin registrarla)",
    description:
      "Abre una reserva EN PREPARACIÓN para un alojamiento y unas fechas ya elegidas, y devuelve el draft_id. NO registra la reserva ni retiene las fechas. Devuelve summary.lines (el resumen con total y seña), terms.url y guest.missing_labels.",
    inputSchema: {
      type: "object",
      properties: {
        property: { type: "string", description: "Código (AC-003), slug o enlace de la ficha." },
        check_in: { type: "string", description: "Fecha de ingreso, AAAA-MM-DD." },
        check_out: { type: "string", description: "Fecha de salida, AAAA-MM-DD." },
        guests: { type: "integer", description: "Cantidad de huéspedes." },
        detail: { ...NULLABLE_STRING, description: "Comentario del interesado (opcional)." },
        conversation_id: { ...NULLABLE_STRING, description: "Identificador de la conversación." },
      },
      required: ["property", "check_in", "check_out", "guests"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "set-guest-details",
    title: "Cargar o corregir los datos del interesado",
    description:
      "Carga en la reserva en preparación los datos del interesado (todos opcionales, se acumulan). Seis obligatorios: fullname, email, pid, phone, city y state. Con terms_accepted: true registra la aceptación de los términos. NO registra la reserva.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "El identificador que devolvió start-booking." },
        fullname: { ...NULLABLE_STRING, description: "Nombre y apellido." },
        email: { ...NULLABLE_STRING, description: "Correo electrónico." },
        pid: { ...NULLABLE_STRING, description: "DNI, solo números." },
        phone: { ...NULLABLE_STRING, description: "Celular, solo números." },
        city: { ...NULLABLE_STRING, description: "Ciudad donde vive el interesado." },
        state: { ...NULLABLE_STRING, description: "Provincia donde vive el interesado." },
        detail: { ...NULLABLE_STRING, description: "Comentario opcional." },
        terms_accepted: { type: ["boolean", "null"], description: "true cuando el interesado YA aceptó los términos." },
      },
      required: ["draft_id"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "show-booking-draft",
    title: "Ver el estado de la reserva en preparación",
    description:
      "Devuelve el estado de la reserva en preparación sin modificarla: datos cargados, faltantes y el resumen (alojamiento, fechas, total y seña).",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "El identificador que devolvió start-booking." },
      },
      required: ["draft_id"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "confirm-booking",
    title: "Registrar la reserva y obtener el enlace de pago de la seña",
    description:
      "Registra la reserva y devuelve payment_url. ES LA ÚNICA QUE CREA ALGO. Exige los seis datos, la aceptación de los términos y confirmed: true (la conformidad explícita del interesado con el resumen). No reintentar después de un éxito.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "El identificador que devolvió start-booking." },
        confirmed: { type: "boolean", description: "La conformidad EXPLÍCITA del interesado con el resumen." },
      },
      required: ["draft_id", "confirmed"],
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
];

/** 032: la herramienta que «aparece» al reconectar (knob `extraTool`). */
export const MCP_MOCK_EXTRA_TOOL: McpMockTool = {
  name: "list-house-rules",
  title: "Normas de la casa",
  description: "Devuelve las normas de convivencia de los alojamientos (horarios de ingreso y egreso, mascotas, ruidos).",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

/** 032: manual de reservas que se suma a las `instructions` con `bookingTools`. */
export const MCP_MOCK_BOOKING_INSTRUCTIONS = [
  "## Cómo avanzar una reserva",
  "El orden es: check-availability → start-booking → set-guest-details (las veces que haga falta, hasta tener los seis datos Y la aceptación de los términos) → mostrarle el resumen al interesado y esperar su confirmación → confirm-booking.",
  "Seis obligatorios: nombre y apellido, correo, DNI, celular, ciudad y provincia. El celular suele poder tomarse del propio chat.",
  "Antes de registrar, mostrale el resumen (summary.lines) y esperá su conformidad. No reintentes confirm-booking después de un éxito.",
  "confirm-booking devuelve payment_url: es el enlace para pagar la seña. La reserva queda pendiente de seña y vence sola si no se paga.",
].join("\n");
