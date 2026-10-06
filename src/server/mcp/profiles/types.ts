/**
 * Contrato del PERFIL de un proveedor MCP (016, §C.3 del diseño).
 *
 * Ningún servidor MCP publica `outputSchema` (hallazgo §5): la salida es un
 * JSON opaco dentro de `content[0].text`. El perfil es el módulo que sabe
 * leer ESE proveedor: qué herramientas se pueden invocar, a qué dominios se
 * puede enlazar, cómo se condensa la respuesta y cómo se traduce un error a
 * un texto que el modelo pueda usar para corregirse solo.
 *
 * Todas las funciones del perfil son PURAS: reciben datos y devuelven datos,
 * sin I/O ni base de datos. Es lo que las hace testeables como
 * `src/server/calendar/slots.ts`, y lo que permite que un segundo PMS sea un
 * archivo nuevo y cero cambios en el pipeline.
 */

/**
 * 022: hosts extra permitidos para los enlaces de ESTA empresa. Los aporta
 * el runtime desde `integration.endpointHost`; el perfil los une a los
 * suyos. Sin esto, un segundo negocio del mismo PMS —con su propio
 * dominio— pierde TODOS los enlaces: el agente describe las propiedades y
 * no puede pasar dónde se reserva.
 */
export type LinkHostOptions = { linkHosts?: readonly string[] };

/**
 * 028: configuración NO secreta del proveedor (`mcp_integration.provider_config`),
 * tal como está en la fila. Cada perfil la valida e interpreta a su manera
 * (MiniHotel: código de hotel, tarifa, enlace del motor, mostrar precios);
 * los perfiles MCP la ignoran.
 */
export type ProviderConfig = Record<string, unknown> | null;

/** Opciones que el runtime le pasa a TODAS las funciones del perfil. */
export type ProfileOptions = LinkHostOptions & {
  providerConfig?: ProviderConfig;
  /**
   * 028: el catálogo guardado. Si la lectura nueva viene incompleta (el hotel
   * respondió los tipos pero no las habitaciones), el perfil conserva la
   * última completa en vez de degradarla.
   */
  previousCatalog?: StayCatalog | null;
};

/** Claves del enum `mcp_integration.profile`: son las de `PROFILES`. */
export type McpProfileKey = "generic" | "altos_de_calamuchita" | "minihotel";

/** Acciones-herramienta que un perfil puede habilitar (FR-008). */
export type McpAgentActionKind = "search_stays" | "show_stay";

/**
 * Búsqueda de alojamientos. Los tres campos "obligatorios" son OPCIONALES
 * en el tipo a propósito (corrección #43): si faltan, `validate` devuelve un
 * texto educativo que le dice al modelo qué preguntarle al cliente, SIN
 * gastar una llamada al MCP ni un handoff.
 */
export type SearchStaysAction = {
  action: "search_stays";
  /** "YYYY-MM-DD" — entrada. */
  check_in?: string;
  /** "YYYY-MM-DD" — salida (posterior a `check_in`). */
  check_out?: string;
  guests?: number;
  property_type?: string;
  city?: string;
  bedrooms?: number;
  bathrooms?: number;
  /** Todas obligatorias (AND). */
  facilities?: string[];
  /** Al menos una (OR). */
  facilities_any?: string[];
  /** 028 (hoteles): el precio depende de la ocupación, no solo del total. */
  adults?: number;
  children?: number;
  babies?: number;
  /** 028: código de un tipo de habitación puntual. */
  room_type?: string;
  /** 028: comparar hasta 3 rangos en una sola consulta. */
  ranges?: Array<{ check_in?: string; check_out?: string }>;
};

/** Detalle de UNA propiedad por código, slug o enlace. */
export type ShowStayAction = {
  action: "show_stay";
  property: string;
};

export type McpAgentAction = SearchStaysAction | ShowStayAction;

/**
 * Catálogo condensado del proveedor, prefetcheado al system prompt
 * (`list-search-options`). Se guarda en `mcp_integration.catalog`.
 *
 * NADA de esto se hard-codea: los tipos reales (Cabaña, Casa, Casa con
 * viñedo, Departamento, Suite de Montaña) y las localidades (Potrero de
 * Garay, San Clemente) salen de acá, y cambian sin avisar (hallazgo §12).
 */
export type StayCatalog = {
  propertyTypes: string[];
  cities: string[];
  /** Solo los NOMBRES; son 82 y no van completos al prompt (hallazgo §8). */
  facilities: string[];
  /** Ventana de fechas con datos publicados (hallazgo §7). */
  window: { from: string; to: string } | null;
  /** Código ISO; "ARS" en el proveedor actual. Jamás se convierte. */
  currency: string;
  /** Tope de huéspedes que declara el servidor (`invalid_guests.max`). */
  maxGuests: number | null;
  /** Base del buscador del sitio, ya validada contra `linkHosts`. */
  searchBase: string | null;
  /**
   * 028 (hoteles): tipos de habitación con su capacidad y los atributos que
   * tienen TODAS sus habitaciones (el huésped reserva un tipo, no una
   * habitación puntual). Ausente en los perfiles de alquiler temporario.
   */
  roomTypes?: StayRoomType[];
  /**
   * 028: hotel cuyas HABITACIONES (capacidad, atributos y asignación) están
   * en `roomTypes`. Ausente si el catálogo se armó solo con los tipos.
   */
  roomsHotelId?: string;
};

export type StayRoomType = {
  code: string;
  /** Ya saneado. */
  name: string;
  /** El MÍNIMO entre las habitaciones del tipo: lo que se puede garantizar. */
  maxAdults: number | null;
  maxChildren: number | null;
  maxBabies: number | null;
  /** Comunes a todas las habitaciones del tipo, saneados. */
  attributes: string[];
};

/** Estado de la integración, tal como lo lee el prompt. */
export type McpIntegrationStatus = "connected" | "reconnect_required" | "disabled";

/** Entrada de `renderSection`: todo lo que la sección del prompt necesita. */
export type SectionInput = {
  catalog: StayCatalog | null;
  /** Instante del turno. */
  now: Date;
  status: McpIntegrationStatus;
  /** false = la empresa apagó las herramientas (solo informa el estado). */
  agentToolsEnabled: boolean;
  /**
   * Zona horaria de la empresa (corrección #45). Sin esto, en UTC y después
   * de las 21 hs de Córdoba, "mañana" da un día de más — justo el prime
   * time de WhatsApp para cabañas.
   */
  timezone?: string | null;
  /** `instructions` CRUDAS del `initialize`: `renderSection` las sanea. */
  instructions?: string | null;
  /** Corrección #5: viene en `false` por defecto; lo tilda un humano. */
  useServerInstructions?: boolean;
  /** Valla con nonce del turno (corrección #6) para encerrarlas. */
  fence?: { open: string; close: string } | null;
  /**
   * Argumentos de la última búsqueda de ESTA conversación (corrección #46):
   * sin esto, "¿y con pileta?" vuelve a preguntar las fechas que el cliente
   * ya dio.
   */
  lastSearch?: Record<string, unknown> | null;
  /** 028: configuración no secreta del proveedor (ver `ProviderConfig`). */
  providerConfig?: ProviderConfig;
};

/** `validate` OK: herramienta y argumentos listos para el transporte. */
export type ValidatedCall = {
  ok: true;
  /** Nombre de la herramienta MCP, siempre de `allowedTools` (FR-007). */
  tool: string;
  args: Record<string, unknown>;
  /** Avisos a concatenar al `toolText` (p. ej. características ignoradas). */
  notes?: string[];
};

/** `validate` rechaza: texto educativo, sin gastar una llamada al MCP. */
export type RejectedCall = { ok: false; toolText: string };

export type ValidateResult = ValidatedCall | RejectedCall;

/**
 * Resultado del render del perfil:
 * - `toolText`: lo que ve el MODELO en la vuelta siguiente, prefijado con
 *   `[HERRAMIENTA]`. Condensado (hallazgo §8: 19 KB crudos son inaceptables).
 * - `clientSummary`: lo que se ENVÍA TAL CUAL a un cliente real si el modelo
 *   se cuelga. Plantilla propia + números + enumerados + `safeName` +
 *   `safeLink`, nunca texto libre del proveedor (corrección #4). `null`
 *   cuando no hay nada seguro que decir.
 */
export type RenderResult = {
  toolText: string;
  clientSummary: string | null;
  /**
   * 031: la consulta NO llegó (transporte, guardrails o excepción). El
   * pipeline lo deja en el hilo («El sistema de reservas no respondió…»).
   * Un rechazo del proveedor (`tool_error`) no cuenta: es material del modelo.
   */
  failure?: McpTransportErrorCode;
};

/** Códigos de fallo del transporte/guardrails (§F.6), NO del proveedor. */
export type McpTransportErrorCode =
  | "unauthorized"
  | "timeout"
  | "too_large"
  | "http_error"
  | "bad_payload"
  | "blocked_host"
  | "unexpected_redirect"
  | "internal_error"
  | "not_allowed"
  | "rate_limited";

export type McpProfile = {
  key: McpProfileKey;
  /**
   * 028: cómo se habla con el proveedor. `mcp` (default) = JSON-RPC de 016;
   * `minihotel` = API XML propia, por `src/lib/minihotel/`. Lo despacha
   * `src/server/mcp/providers.ts`; ningún otro archivo mira este campo.
   */
  transport?: "mcp" | "minihotel";
  /** Nombre visible en la tarjeta de Integraciones. */
  name: string;
  description: string;
  /**
   * ÚNICAS herramientas que el conector puede invocar (FR-007). La
   * allowlist vive acá, NO en lo que el servidor declare: que el tercero
   * anuncie `readOnlyHint` es texto suyo, no una garantía nuestra.
   */
  allowedTools: readonly string[];
  /** Herramientas que el servidor DEBE exponer para validar el handshake. */
  requiredTools: readonly string[];
  /** Herramienta cuyo resultado se prefetchea al prompt (null = sin prefetch). */
  catalogTool: string | null;
  /** Hosts a los que se permite enlazar desde una respuesta (FR-010). */
  linkHosts: readonly string[];
  /** Acciones que el perfil habilita ([] = el agente no recibe herramientas). */
  agentActions: readonly McpAgentActionKind[];
  /**
   * 021: el negocio NO escribe importes por WhatsApp (los valores se ven al
   * entrar a la ficha). Es una regla comercial del proveedor, no del CRM,
   * por eso vive en el perfil: el próximo PMS decide la suya. Con `true`, el
   * pipeline pasa el texto saliente por `stripPrices`.
   */
  hidePricesInReply?: boolean;
  /**
   * 028: la misma decisión, pero POR EMPRESA (un hotel informa precios por
   * WhatsApp y otro no). Si existe, el pipeline oculta importes cuando
   * `hidePricesInReply` o esto dan `true`.
   */
  hidePrices?(providerConfig: ProviderConfig): boolean;
  /**
   * 028: las líneas del menú de acciones del prompt para este perfil. Sin
   * esto, el prompt usa las de 016 (`search_stays` con `guests` y `show_stay`).
   */
  actionMenu?: readonly string[];

  /**
   * 022: dominios a los que se puede enlazar, ADEMÁS de `linkHosts`.
   *
   * El mismo PMS atiende a varios negocios, cada uno con su propio sitio: el
   * perfil no puede traer cableados los dominios de todos. El host del
   * `endpoint_url` de la integración es tan confiable como la allowlist del
   * perfil, porque según 016 lo fija ÚNICAMENTE el super admin — así que se
   * suma a ella. Sigue siendo una allowlist cerrada.
   */
  parseCatalog(raw: unknown, opts?: ProfileOptions): StayCatalog | null;
  renderSection(input: SectionInput): string | null;
  /**
   * `opts.conversationId` viaja como `cid=` en `search_url` y en cada
   * `properties[].url` (hallazgo §11): le da al proveedor la atribución del
   * lead. Es nuestro `cv_…` opaco — jamás teléfono ni nombre.
   */
  validate(
    action: McpAgentAction,
    catalog: StayCatalog | null,
    now: Date,
    opts?: { conversationId?: string | null; timezone?: string | null } & ProfileOptions
  ): ValidateResult;
  render(
    action: McpAgentAction,
    payload: unknown,
    catalog: StayCatalog | null,
    opts?: ProfileOptions
  ): RenderResult;
  /** Texto para un fallo del transporte o de los guardrails (§F.6). */
  renderTransportError?(code: McpTransportErrorCode): string;
  /** Fixtures deterministas del Laboratorio: `is_test` JAMÁS toca la red. */
  sandbox(action: McpAgentAction): unknown;
};
