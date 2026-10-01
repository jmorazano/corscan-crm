import http from "node:http";
import https from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { McpError, toMcpError } from "./errors";
import { checkEndpointSyntax, guardedLookup } from "./ssrf";

/**
 * Transporte JSON-RPC sobre HTTP del conector MCP (016, design §C.1).
 *
 * D11 — `node:https` es el PRIMER cliente HTTP crudo del repo (corrección
 * #35): `src/lib/google/calendar-client.ts:25-70` y `src/lib/meta/client.ts`
 * usan `fetch` + `AbortController`, y de ahí se toma la FORMA (timer propio +
 * `clearTimeout` en `finally`), no la mecánica. Se baja un nivel porque
 * `fetch` no puede (a) cortar la respuesta por tamaño sin bufferearla entera
 * ni (b) interponerse en la resolución DNS que consume el socket, que es lo
 * único que cierra la ventana de DNS rebinding. `request({ lookup, servername })`
 * resuelve las dos cosas y deja TLS y SNI intactos.
 *
 * Lo que este módulo NO hace, por contrato: no arma credenciales (las recibe
 * ya en `headers`), no loguea headers ni cuerpos, no sigue redirecciones y no
 * conoce nada de Vocero (ni Drizzle, ni sesión, ni dominio).
 */

/** `https.request` / `http.request`, inyectable en tests. */
export type McpRequestFn = (
  options: RequestOptions,
  callback: (res: IncomingMessage) => void
) => ClientRequest;

export type McpTransportOptions = {
  endpointUrl: string;
  /** El caller arma `Authorization`. Acá no se loguea NADA. */
  headers: Record<string, string>;
  /** Objeto JSON-RPC ya armado. */
  body: unknown;
  /** Deadline TOTAL: conexión + cuerpo. */
  timeoutMs: number;
  maxResponseBytes: number;
  /**
   * D4, segundo cinturón: `true` ⇒ excepción ANTES de cualquier I/O. Calcado
   * de `src/server/inbox/send.ts:72-77`. Si alguien olvida propagar el
   * booleano en una rama futura, el self-test truena en vez de llamar al PMS
   * real con la credencial real. NO lo "arregles": es un guardrail.
   */
  sandbox: boolean;
  request?: McpRequestFn;
};

export type McpTransportResult = {
  json: unknown;
  httpStatus: number;
  bytes: number;
  headers: Record<string, string>;
};

/** Semáforo de salida: tope de llamadas MCP en vuelo POR PROCESO (#20). */
const MAX_IN_FLIGHT = 8;

type Semaphore = { inFlight: number; queue: (() => void)[] };

const globalForMcp = globalThis as unknown as { __mcpSemaphore?: Semaphore };
const semaphore: Semaphore = (globalForMcp.__mcpSemaphore ??= {
  inFlight: 0,
  queue: [],
});

async function acquire(timeoutMs: number): Promise<() => void> {
  if (semaphore.inFlight < MAX_IN_FLIGHT) {
    semaphore.inFlight += 1;
    return release;
  }
  // Esperar acotado por el mismo deadline de la llamada: el webhook de
  // ingesta corre en este proceso y no puede quedarse colgado detrás de una
  // fila de sockets lentos.
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const idx = semaphore.queue.indexOf(grant);
      if (idx >= 0) semaphore.queue.splice(idx, 1);
      reject(new McpError("busy"));
    }, Math.max(1, timeoutMs));
    function grant(): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    }
    semaphore.queue.push(grant);
  });
  semaphore.inFlight += 1;
  return release;
}

function release(): void {
  semaphore.inFlight = Math.max(0, semaphore.inFlight - 1);
  const next = semaphore.queue.shift();
  if (next) next();
}

const ALLOWED_CONTENT_TYPES = ["application/json", "text/event-stream"];

export async function postJsonRpc(
  o: McpTransportOptions
): Promise<McpTransportResult> {
  // 1) Sandbox ANTES de cualquier I/O.
  if (o.sandbox) throw new McpError("sandbox_violation");

  // 2) Sintaxis, acá adentro y no solo en el caller: la fila que guarda la URL
  //    puede cambiar entre la validación y el uso (S-1).
  const url = checkedUrl(o.endpointUrl);
  const payload = Buffer.from(JSON.stringify(o.body ?? null), "utf8");
  const expectedId = extractId(o.body);

  const done = await acquire(o.timeoutMs);
  try {
    return await send(
      url,
      payload,
      {
        headers: o.headers,
        contentType: "application/json",
        accept: "application/json, text/event-stream",
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        timeoutMs: o.timeoutMs,
        maxResponseBytes: o.maxResponseBytes,
        ...(o.request ? { request: o.request } : {}),
      },
      jsonRpcReader(expectedId)
    );
  } finally {
    done();
  }
}

/* ------------------------------------------------------------------ */
/* 028: el mismo POST protegido para APIs de proveedor que no son MCP  */
/* ------------------------------------------------------------------ */

/**
 * MiniHotel habla XML por POST, con la credencial DENTRO del cuerpo. Pasa
 * por exactamente los mismos controles que `postJsonRpc` —fusible de
 * sandbox, sintaxis, semáforo, `guardedLookup` sobre la IP resuelta, sin
 * redirecciones, sin compresión, tope de bytes, deadline total— porque la
 * Constitución II (cat. 5, letras c y d) no distingue el protocolo: lo que
 * se protege es el socket.
 *
 * Igual que acá arriba: este módulo NO loguea el cuerpo (que lleva la
 * credencial) ni lo devuelve en ningún error.
 */
export type GuardedTextOptions = {
  endpointUrl: string;
  headers?: Record<string, string>;
  /** Cuerpo ya armado (p. ej. el XML). Nunca se loguea. */
  body: string;
  /** `Content-Type` del pedido, p. ej. `text/xml; charset=utf-8`. */
  contentType: string;
  accept: string;
  /** Tipos aceptados en la respuesta, sin parámetros y en minúsculas. */
  allowedContentTypes: readonly string[];
  timeoutMs: number;
  maxResponseBytes: number;
  /** D4: `true` ⇒ excepción ANTES de cualquier I/O. */
  sandbox: boolean;
  request?: McpRequestFn;
};

export type GuardedTextResult = {
  text: string;
  httpStatus: number;
  bytes: number;
  headers: Record<string, string>;
};

export async function postGuardedText(o: GuardedTextOptions): Promise<GuardedTextResult> {
  if (o.sandbox) throw new McpError("sandbox_violation");
  const url = checkedUrl(o.endpointUrl);
  const payload = Buffer.from(o.body, "utf8");

  const done = await acquire(o.timeoutMs);
  try {
    return await send(
      url,
      payload,
      {
        headers: o.headers ?? {},
        contentType: o.contentType,
        accept: o.accept,
        allowedContentTypes: o.allowedContentTypes,
        timeoutMs: o.timeoutMs,
        maxResponseBytes: o.maxResponseBytes,
        ...(o.request ? { request: o.request } : {}),
      },
      TEXT_READER
    );
  } finally {
    done();
  }
}

function checkedUrl(endpointUrl: string): URL {
  const check = checkEndpointSyntax(endpointUrl);
  if (!check.ok) {
    throw new McpError(check.reason === "bad_host" ? "blocked_host" : "invalid_url");
  }
  return check.url;
}

/* ------------------------------------------------------------------ */
/* Núcleo: un POST protegido y un lector intercambiable               */
/* ------------------------------------------------------------------ */

type SendSpec = {
  headers: Record<string, string>;
  contentType: string;
  accept: string;
  allowedContentTypes: readonly string[];
  timeoutMs: number;
  maxResponseBytes: number;
  request?: McpRequestFn;
};

type ReadContext = {
  status: number;
  bytes: number;
  headers: Record<string, string>;
  contentType: string;
};

type ResponseReader<T> = {
  /**
   * Con el buffer acumulado: o el resultado (y se corta el socket), o el
   * resto que hay que conservar. Opcional: sin él, se acumula todo.
   */
  onChunk?: (
    buffer: string,
    ctx: ReadContext
  ) => { done: true; value: T } | { done: false; rest: string };
  /** Cuerpo completo. Puede lanzar `McpError` (nunca con bytes del remoto). */
  onEnd: (buffer: string, ctx: ReadContext) => T;
};

function jsonRpcReader(expectedId: string | number | null): ResponseReader<McpTransportResult> {
  return {
    onChunk: (buffer, ctx) => {
      if (ctx.contentType !== "text/event-stream") return { done: false, rest: buffer };
      // #12: cortar con `destroy()` en cuanto llega el primer objeto
      // JSON-RPC con NUESTRO id. Un servidor que deja el stream abierto
      // después de responder retendría el socket todo el timeout.
      const hit = takeSseObject(buffer, expectedId);
      return hit.found
        ? {
            done: true,
            value: { json: hit.json, httpStatus: ctx.status, bytes: ctx.bytes, headers: ctx.headers },
          }
        : { done: false, rest: hit.rest };
    },
    onEnd: (buffer, ctx) => {
      if (ctx.contentType === "text/event-stream") {
        const hit = takeSseObject(buffer, expectedId, true);
        if (hit.found) {
          return { json: hit.json, httpStatus: ctx.status, bytes: ctx.bytes, headers: ctx.headers };
        }
        throw new McpError("bad_payload", { httpStatus: ctx.status });
      }
      try {
        return {
          json: JSON.parse(buffer) as unknown,
          httpStatus: ctx.status,
          bytes: ctx.bytes,
          headers: ctx.headers,
        };
      } catch {
        // Nunca el cuerpo en el error: son bytes de un tercero.
        throw new McpError("bad_payload", { httpStatus: ctx.status });
      }
    },
  };
}

const TEXT_READER: ResponseReader<GuardedTextResult> = {
  onEnd: (buffer, ctx) => ({
    text: buffer,
    httpStatus: ctx.status,
    bytes: ctx.bytes,
    headers: ctx.headers,
  }),
};

function send<T>(
  url: URL,
  payload: Buffer,
  spec: SendSpec,
  reader: ResponseReader<T>
): Promise<T> {
  const insecure = url.protocol === "http:";
  const requestFn: McpRequestFn =
    spec.request ?? (insecure ? (http.request as McpRequestFn) : (https.request as McpRequestFn));

  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port === "" ? (insecure ? 80 : 443) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: "POST",
    headers: {
      ...spec.headers,
      // Nuestros headers van DESPUÉS: el caller no puede pisarlos.
      "content-type": spec.contentType,
      accept: spec.accept,
      // #12: sin compresión. Con `content-encoding` el tope de bytes deja de
      // significar algo (512 KB de gzip son ~500 MB en memoria).
      "accept-encoding": "identity",
      "content-length": String(payload.byteLength),
    },
    // El control real de SSRF: ocurre dentro de la resolución que consume el
    // socket. `servername` mantiene SNI = hostname.
    lookup: guardedLookup(),
    servername: url.hostname,
    // #2: una sola conexión. Con Happy Eyeballs, Node resuelve y prueba
    // varias familias; acotarlo reduce la superficie del lookup.
    autoSelectFamily: false,
    // `rejectUnauthorized` JAMÁS se toca: el mock vive en http://localhost
    // bajo el gate de mocks, que es la única puerta.
  } as RequestOptions;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let req: ClientRequest | null = null;

    const timer = setTimeout(() => {
      finish(new McpError("timeout"));
    }, Math.max(1, spec.timeoutMs));

    function finish(err: McpError | null, value?: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        req?.destroy();
      } catch {
        // el socket ya estaba cerrado
      }
      if (err) reject(err);
      else resolve(value as T);
    }

    try {
      req = requestFn(options, (res) => {
        const status = res.statusCode ?? 0;
        const headers = flattenHeaders(res.headers);

        // 3xx sin seguirlo: un endpoint de API no redirige, y seguirlo
        // arrastraría la credencial a otro host.
        if (status >= 300 && status < 400) {
          finish(new McpError("unexpected_redirect", { httpStatus: status }));
          return;
        }
        const encoding = (headers["content-encoding"] ?? "").trim().toLowerCase();
        if (encoding !== "" && encoding !== "identity") {
          finish(new McpError("bad_content_type", { httpStatus: status }));
          return;
        }
        if (status === 401 || status === 403) {
          finish(new McpError("unauthorized", { httpStatus: status }));
          return;
        }
        if (status < 200 || status >= 300) {
          finish(new McpError("http_error", { httpStatus: status }));
          return;
        }
        const contentType = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!spec.allowedContentTypes.includes(contentType)) {
          finish(new McpError("bad_content_type", { httpStatus: status }));
          return;
        }
        // `content-length` solo como atajo: nunca como garantía.
        const declared = Number(headers["content-length"] ?? "");
        if (Number.isFinite(declared) && declared > spec.maxResponseBytes) {
          finish(new McpError("too_large", { httpStatus: status }));
          return;
        }

        const ctx: ReadContext = { status, bytes: 0, headers, contentType };
        // 028: decodificación INCREMENTAL. `buf.toString()` por pedazo parte
        // en dos un carácter multibyte que cae en el borde ("Habitación").
        const decoder = new StringDecoder("utf8");
        let buffer = "";

        res.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
          ctx.bytes += buf.byteLength;
          if (ctx.bytes > spec.maxResponseBytes) {
            finish(new McpError("too_large", { httpStatus: status }));
            return;
          }
          buffer += decoder.write(buf);
          if (!reader.onChunk) return;
          const step = reader.onChunk(buffer, ctx);
          if (step.done) {
            finish(null, step.value);
            return;
          }
          buffer = step.rest;
        });

        res.on("end", () => {
          if (settled) return;
          buffer += decoder.end();
          try {
            finish(null, reader.onEnd(buffer, ctx));
          } catch (err) {
            finish(toMcpError(err, "bad_payload"));
          }
        });

        res.on("error", (err) => finish(toMcpError(err)));
      });
    } catch (err) {
      finish(toMcpError(err));
      return;
    }

    req.on("error", (err) => finish(toMcpError(err)));
    if (typeof req.setTimeout === "function") {
      req.setTimeout(Math.max(1, spec.timeoutMs), () => finish(new McpError("timeout")));
    }
    req.end(payload);
  });
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

function flattenHeaders(raw: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? "") : String(value);
  }
  return out;
}

function extractId(body: unknown): string | number | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Parseo incremental de frames SSE (`event:` / `data:`), ~30 líneas y sin
 * dependencias. Devuelve el primer objeto JSON-RPC cuyo `id` coincide con el
 * de la request; con `flush` acepta también un frame sin línea en blanco
 * final (servidor que cierra el stream pegado al último dato).
 */
export function takeSseObject(
  buffer: string,
  expectedId: string | number | null,
  flush = false
): { found: true; json: unknown; rest: string } | { found: false; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const chunks = normalized.split("\n\n");
  const tail = flush ? "" : (chunks.pop() ?? "");
  if (flush && chunks.length === 0) return { found: false, rest: "" };
  for (const frame of chunks) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (expectedId === null) return { found: true, json, rest: tail };
    const id = extractId(json);
    if (id === expectedId) return { found: true, json, rest: tail };
  }
  return { found: false, rest: tail };
}
