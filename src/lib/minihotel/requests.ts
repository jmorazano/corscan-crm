/**
 * Pedidos XML a MiniHotel (028). PUROS: arman el cuerpo y nada más.
 *
 * La credencial viaja DENTRO del cuerpo (así lo exige la API: atributos de
 * `<Authentication>`). Consecuencia dura: estos strings jamás se loguean,
 * jamás se guardan en la bitácora y jamás vuelven en un error. Los arma el
 * cliente por pedido y los descarta (Constitución I).
 *
 * Solo existen los cuatro pedidos de LECTURA de la Fase 1: Immediate ARI,
 * Bulk ARI, `getRoomTypes` y `getRooms`. No hay builder de reservas, pagos
 * ni escritura: el conector no puede hacerlo ni por error (Constitución II,
 * categoría 5, letra f).
 */

export type MiniHotelAuth = {
  username: string;
  password: string;
  hotelId: string;
};

export type ContentOperation = "getRoomTypes" | "getRooms";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** Escapa un valor para un atributo o un texto XML. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function authentication(auth: MiniHotelAuth, extra: Record<string, string> = {}): string {
  const attrs = [
    `username="${escapeXml(auth.username)}"`,
    `password="${escapeXml(auth.password)}"`,
    ...Object.entries(extra).map(([k, v]) => `${k}="${escapeXml(v)}"`),
  ];
  return `<Authentication ${attrs.join(" ")} />`;
}

function count(n: number): string {
  return String(Math.max(0, Math.trunc(n)));
}

/**
 * *Immediate ARI*: disponibilidad y precio TOTAL de una estadía exacta, para
 * un solo `rateCode` y todos los regímenes. `to` es la fecha de SALIDA
 * (`ERR 108: Stay must be at least one night` confirma que el rango es
 * entrada→salida). Con `MinimumNights="YES"` el proveedor informa el mínimo.
 */
export function buildImmediateAriRequest(
  auth: MiniHotelAuth,
  q: {
    from: string;
    to: string;
    adults: number;
    children: number;
    babies: number;
    rateCode: string;
    /** Código de tipo de habitación; sin él, todos (`*ALL*`). */
    roomType?: string | null;
  }
): string {
  const roomType = q.roomType && q.roomType.trim() !== "" ? q.roomType.trim() : "*ALL*";
  return [
    XML_DECL,
    "<AvailRaterq>",
    authentication(auth, { MinimumNights: "YES" }),
    `<Hotel id="${escapeXml(auth.hotelId)}" />`,
    `<DateRange from="${escapeXml(q.from)}" to="${escapeXml(q.to)}" />`,
    `<Guests adults="${count(q.adults)}" child="${count(q.children)}" babies="${count(q.babies)}" />`,
    `<RoomTypes><RoomType id="${escapeXml(roomType)}" /></RoomTypes>`,
    `<Prices rateCode="${escapeXml(q.rateCode)}"><Price boardCode="*ALL*" /></Prices>`,
    "</AvailRaterq>",
  ].join("\n");
}

/**
 * *Bulk ARI* (`ResponseType="05"`): disponibilidad, precio base, mínimo de
 * noches y cierres DÍA POR DÍA de un período. Es lo que permite buscar
 * fechas alternativas con UN pedido en vez de probar fechas a ciegas.
 */
export function buildBulkAriRequest(
  auth: MiniHotelAuth,
  q: { from: string; to: string; rateCode: string }
): string {
  return [
    XML_DECL,
    "<AvailRaterq>",
    authentication(auth, { ResponseType: "05", MinimumNights: "YES" }),
    `<Hotel id="${escapeXml(auth.hotelId)}" />`,
    `<DateRange from="${escapeXml(q.from)}" to="${escapeXml(q.to)}" />`,
    `<Prices rateCode="${escapeXml(q.rateCode)}"></Prices>`,
    "</AvailRaterq>",
  ].join("\n");
}

/** `getRoomTypes` / `getRooms` de la API de contenido (sin número: todas). */
export function buildContentRequest(op: ContentOperation, auth: MiniHotelAuth): string {
  return [
    XML_DECL,
    "<Request>",
    `<Settings name="${op}">`,
    authentication(auth),
    `<Hotel id="${escapeXml(auth.hotelId)}" />`,
    op === "getRooms" ? "<room_number></room_number>" : null,
    "</Settings>",
    "</Request>",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
