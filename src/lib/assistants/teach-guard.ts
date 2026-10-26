import type { TrainerChangeType } from "@/server/ai/trainer-actions";
import { SYSTEM_MARKERS } from "@/server/mcp/markers";
import { findUnknownContactData } from "@/lib/privacy-guard";
import { foldAccents } from "./format";

/**
 * GUARDAS DE LA ENSEÑANZA DESDE CLAUDE (041, research D3). PURO.
 *
 * Claude lee mensajes que escribieron clientes; uno de ellos puede estar
 * armado para que Claude «le enseñe» al agente un enlace, un alias o un
 * teléfono del atacante, que después el agente repetiría a otros clientes.
 * Estas guardas corren en el CRM ANTES de aplicar y no dependen de que el
 * cliente MCP haya pedido confirmación (puede estar en «permitir siempre»).
 *
 * La regla: lo que el negocio NO cargó antes (enlaces, teléfonos, correos,
 * alias o CBU) no entra desde Claude; se agrega desde el CRM. Los importes
 * pasan: enseñar precios es uno de los usos principales.
 */

export type KnownEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export type TeachGuardContext = {
  /** Perfil + conocimiento actual de la empresa (lo que el agente ya sabe). */
  corpus: string;
  /** Hosts conocidos: los del corpus, el del CRM y los de sus integraciones. */
  allowedHosts: readonly string[];
  knownEntries: readonly KnownEntry[];
};

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/** Textos que el cambio escribiría (los de un borrado no escriben nada). */
export function changeTexts(change: TrainerChangeType): string[] {
  switch (change.op) {
    case "kb_add":
    case "kb_update":
      return [change.question, change.answer, change.content].filter(
        (t): t is string => typeof t === "string" && t.length > 0
      );
    case "profile_set":
      return change.value ? [change.value] : [];
    case "profile_append":
      return [change.text];
    case "kb_delete":
      return [];
  }
}

/**
 * TLD comunes para reconocer dominios SIN esquema ni `www.` («pagos-x.xyz/p»):
 * WhatsApp los vuelve clicables igual. Lista cerrada a propósito: con
 * cualquier TLD, «Gracias.Saludos» o «check-in.desde» serían dominios.
 */
const BARE_TLDS = [
  "com", "net", "org", "ar", "io", "co", "xyz", "app", "link", "ly", "me", "info",
  "online", "site", "store", "shop", "top", "cl", "uy", "py", "bo", "pe", "mx", "es",
  "us", "ai", "dev", "page", "biz", "click", "live", "club", "tk", "gl", "gg", "to",
  "cc", "ws", "website", "space", "tech", "cloud", "pro", "br", "lat", "travel",
];
const SCHEME_URL_RE = /\b(?:https?:\/\/|www\.)([^\s<>"'«»/?#]+)/gi;
const BARE_DOMAIN_RE = new RegExp(
  String.raw`(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${BARE_TLDS.join("|")}))(?![\w-])`,
  "gi"
);
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function normalizeHost(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/:\d+$/, "")
    .replace(/[.,;:!?)\]}»]+$/, "");
}

/** Hosts de los enlaces de un texto: con esquema, con `www.` o dominios sueltos. */
export function extractHosts(text: string): string[] {
  const out = new Set<string>();
  const withoutEmails = text.replace(EMAIL_RE, (m) => " ".repeat(m.length));
  for (const m of withoutEmails.matchAll(SCHEME_URL_RE)) {
    const host = normalizeHost(m[1] ?? "");
    if (host.includes(".")) out.add(host);
  }
  const withoutUrls = withoutEmails.replace(/\b(?:https?:\/\/|www\.)\S+/gi, (m) => " ".repeat(m.length));
  for (const m of withoutUrls.matchAll(BARE_DOMAIN_RE)) {
    out.add(normalizeHost(m[1] ?? ""));
  }
  return [...out].filter(Boolean);
}

/** Igual o subdominio de un host conocido («reservas.altos.com» ⊂ «altos.com»). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = normalizeHost(host);
  return allowed.some((a) => {
    const base = normalizeHost(a);
    return base.length > 0 && (h === base || h.endsWith(`.${base}`));
  });
}

/** Alias y CBU/CVU nombrados («alias pagos.rapidos», «CBU: 0000…»). */
const PAYMENT_RE = /\b(alias|cbu|cvu)\b\s*(?:es|:|=|->)?\s*(?:el\s+|la\s+)?([a-z0-9][a-z0-9.\-]{4,29})/gi;

export function extractPaymentIds(text: string): string[] {
  const out: string[] = [];
  for (const m of foldAccents(text).matchAll(PAYMENT_RE)) {
    const id = (m[2] ?? "").replace(/[.\-]+$/, "");
    if (id.length >= 5) out.push(id.toLowerCase());
  }
  return out;
}

/** Datos que pueden ser de un contacto: teléfonos (≥ 8 dígitos), correos y `@usuario`. */
export function extractContactKeys(text: string): { phones: string[]; emails: string[]; handles: string[] } {
  const emails = [...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  const noEmails = text.replace(EMAIL_RE, " ");
  const phones = [...noEmails.matchAll(/\+?\d[\d\s().-]{6,}\d/g)]
    .map((m) => m[0].replace(/\D/g, ""))
    .filter((d) => d.length >= 8);
  const handles = [...noEmails.matchAll(/(?<![\w.])@([a-z0-9._]{2,30})/gi)].map((m) =>
    (m[1] ?? "").replace(/\.+$/, "").toLowerCase()
  );
  return { phones, emails, handles };
}

function fold(text: string): string {
  return foldAccents(text).toLowerCase();
}

/**
 * `[ADJUNTO]`, `[COMPROBANTE_PLANILLA]`, `[IMAGEN_ENTRENADOR]` y los que
 * vengan: en MAYÚSCULAS, como los escribe el sistema («[ver abajo]» no es uno).
 * Los marcadores con nombre (`SYSTEM_MARKERS`) se buscan sin mayúsculas ni tildes.
 */
const MARKER_TOKEN_RE = /\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ_]{2,}\]/;
const FOLDED_MARKERS = SYSTEM_MARKERS.map(fold);

export function hasInternalMarker(text: string): boolean {
  if (MARKER_TOKEN_RE.test(text)) return true;
  const t = fold(text);
  return FOLDED_MARKERS.some((m) => t.includes(m));
}

/** Para comparar entradas: sin tildes, sin mayúsculas, espacios colapsados, sin puntuación final. */
export function normalizeKbText(text: string | null | undefined): string {
  return fold(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\s.!?¡¿]+$/g, "")
    .replace(/^[\s¡¿]+/, "")
    .trim();
}

function duplicateOf(change: TrainerChangeType, entries: readonly KnownEntry[]): KnownEntry | null {
  if (change.op !== "kb_add") return null;
  if (change.kind === "qa") {
    const q = normalizeKbText(change.question);
    if (!q) return null;
    return entries.find((e) => e.kind === "qa" && normalizeKbText(e.question) === q) ?? null;
  }
  const c = normalizeKbText(change.content);
  if (!c) return null;
  return entries.find((e) => e.kind === "block" && normalizeKbText(e.content) === c) ?? null;
}

/** Una sola guarda por cambio, en orden de gravedad; el primer motivo gana. */
export function checkTeachChange(change: TrainerChangeType, ctx: TeachGuardContext): GuardVerdict {
  const texts = changeTexts(change);
  const lowerCorpus = fold(ctx.corpus);

  for (const text of texts) {
    if (hasInternalMarker(text)) {
      return { ok: false, reason: "Tiene un marcador interno del sistema: no se puede enseñar ese texto." };
    }
  }
  for (const text of texts) {
    for (const host of extractHosts(text)) {
      if (!hostAllowed(host, ctx.allowedHosts)) {
        return {
          ok: false,
          reason: `Enlace nuevo (${host}): si es del negocio, agregalo desde el CRM (Agente → Conocimiento) y después Claude ya lo puede usar.`,
        };
      }
    }
  }
  for (const text of texts) {
    const unknown = findUnknownContactData(text, ctx.corpus);
    if (unknown.length > 0) {
      return {
        ok: false,
        reason: `Teléfono o correo que el agente no conoce (${unknown[0]}): si es del negocio, agregalo desde el CRM.`,
      };
    }
    for (const id of extractPaymentIds(text)) {
      if (!lowerCorpus.includes(id)) {
        return {
          ok: false,
          reason: `Dato de pago nuevo (${id}): los alias y CBU se cargan desde el CRM, nunca desde Claude.`,
        };
      }
    }
  }
  const dup = duplicateOf(change, ctx.knownEntries);
  if (dup) {
    return {
      ok: false,
      reason:
        dup.kind === "qa"
          ? `Ya existe una P/R con esa pregunta (${dup.id}): corregila con edit_agent.`
          : `Ya existe ese bloque (${dup.id}).`,
    };
  }
  return { ok: true };
}
