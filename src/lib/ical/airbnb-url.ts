/**
 * Validación del enlace `.ics` que carga el PROPIETARIO (051). Como la URL
 * no la fija el super admin, la allowlist FIJA de hosts del proveedor es la
 * defensa principal (constitución 1.16.0, cat. 7 (c)); el anti-SSRF sobre la
 * IP resuelta corre igual en cada lectura (transporte de 016).
 *
 * Forma de Airbnb: `https://www.airbnb.<tld>/calendar/ical/<id>.ics?t=<llave>`
 * (Calendario → Disponibilidad → Conectar con otro sitio web → Paso 1).
 */

/** `airbnb.com`, `airbnb.com.ar`, `airbnb.ae`, `airbnb.co.uk`… con o sin `www.`. */
export const AIRBNB_HOST_RE = /^(?:www\.)?airbnb\.(?:[a-z]{2,3}|(?:com|co)\.[a-z]{2})$/;
const ICAL_PATH_RE = /^\/calendar\/ical\/(\d{3,25})\.ics$/;
/** Ruta del ical-mock del self-test (solo con el gate de mocks). */
const MOCK_PATH_RE = /^\/api\/dev\/ical-mock\/calendar\/ical\/(\d{3,25})\.ics$/;
const MAX_URL_LENGTH = 600;

export type IcalUrlError =
  | "empty"
  | "too_long"
  | "malformed"
  | "not_https"
  | "credentials"
  | "port"
  | "host"
  | "path";

export type IcalUrlCheck =
  | {
      ok: true;
      url: string;
      listingId: string;
      host: string;
      /** Últimos 4 de la llave `t=` (o null si no trae). */
      tokenLast4: string | null;
    }
  | { ok: false; code: IcalUrlError };

export function checkAirbnbIcalUrl(
  raw: unknown,
  options: { mockOrigin?: string | null } = {}
): IcalUrlCheck {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, code: "empty" };
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) return { ok: false, code: "too_long" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (url.username || url.password) return { ok: false, code: "credentials" };

  const mock = options.mockOrigin ? safeOrigin(options.mockOrigin) : null;
  if (mock && url.origin === mock) {
    const m = MOCK_PATH_RE.exec(url.pathname);
    if (!m) return { ok: false, code: "path" };
    return ok(url, m[1]!);
  }

  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  if (url.port) return { ok: false, code: "port" };
  const host = url.hostname.toLowerCase();
  if (!AIRBNB_HOST_RE.test(host)) return { ok: false, code: "host" };
  const m = ICAL_PATH_RE.exec(url.pathname);
  if (!m) return { ok: false, code: "path" };
  return ok(url, m[1]!);
}

function ok(url: URL, listingId: string): IcalUrlCheck {
  url.hash = "";
  const token = url.searchParams.get("t") ?? url.searchParams.get("s");
  const clean = token ? token.replace(/[^A-Za-z0-9]/g, "") : "";
  return {
    ok: true,
    url: url.toString(),
    listingId,
    host: url.hostname.toLowerCase(),
    tokenLast4: clean.length >= 4 ? clean.slice(-4) : null,
  };
}

function safeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Texto en criollo para la UI. */
export function icalUrlErrorText(code: IcalUrlError): string {
  switch (code) {
    case "empty":
      return "Pegá el enlace del calendario.";
    case "host":
    case "path":
      return "Ese enlace no es el calendario de una publicación de Airbnb: copialo de Calendario → Disponibilidad → Conectar con otro sitio web → Paso 1.";
    case "not_https":
      return "El enlace tiene que empezar con https://.";
    default:
      return "El enlace no es válido: copialo de nuevo del Paso 1 de Airbnb.";
  }
}
