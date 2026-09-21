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
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: true;
    idempotentHint: true;
    openWorldHint: false;
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
