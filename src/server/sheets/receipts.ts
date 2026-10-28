import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { advanceLeadStage } from "@/server/inbox/lead-stage";
import { getEnv } from "@/lib/env";
import { extractPaymentReceipt } from "@/lib/ai/receipt";
import {
  appendRow,
  createSpreadsheet,
  getSpreadsheet,
  getValues,
  SheetsApiError,
} from "@/lib/google/sheets-client";
import {
  buildReceiptRow,
  DEFAULT_RECEIPT_HEADERS,
  DEFAULT_RECEIPTS_SHEET_TITLE,
  looksLikeReceipt,
  modelHeaders,
  normalizeHeaders,
  receiptDedupKey,
  sheetRange,
  type ReceiptContext,
  type ReceiptOutcome,
} from "@/lib/sheets";
import { toLocalParts } from "@/lib/time";
import { getAiConfig } from "@/server/ai/credentials";
import { renderKb } from "@/server/ai/prompts";
import {
  getSheetsIntegrationRow,
  sheetsErrorCode,
  updateReceiptsTarget,
  withSheetsToken,
  type SheetsErrorCode,
} from "@/server/sheets/integration";

/**
 * Comprobantes de transferencia → planilla de conciliación (034, US2).
 *
 * Reglas que gobiernan el módulo:
 * - Los datos bancarios leídos NUNCA vuelven al historial que ve el agente:
 *   el llamador (`media.ts`) recibe solo el RESULTADO (`recorded`,
 *   `duplicate`, `failed`) y le suma al aviso del adjunto una frase fija.
 * - El mismo mensaje jamás genera dos filas: la fila de `payment_receipt` se
 *   RESERVA (unique por `message_id`) antes de tocar Google.
 * - Nada de acá lanza hacia la ingesta: un fallo queda «fallido» con un
 *   código propio y el propietario lo reintenta. Jamás se loguea un valor.
 */

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";
/** Hasta qué columna se leen los encabezados (30 columnas). */
const HEADER_CELLS = "A1:AD1";

type ReceiptRow = typeof schema.paymentReceipt.$inferSelect;

type ReceiptMedia = { bytes: Buffer; mimeType: string; fileName?: string | null };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDate(at: Date, withTime: boolean): string {
  const p = toLocalParts(DEFAULT_TIMEZONE, at);
  const date = `${pad(p.day)}/${pad(p.month)}/${p.year}`;
  return withTime ? `${date} ${pad(p.hour)}:${pad(p.minute)}` : date;
}

/* ============================================================
 * Gancho de la ingesta (media.ts)
 * ============================================================ */

/**
 * Si la empresa anota comprobantes y el adjunto parece uno, lo lee completo
 * y agrega la fila. Devuelve el resultado para el aviso del adjunto, o
 * `null` si no correspondía anotar nada (no es comprobante, integración
 * apagada). Nunca lanza.
 */
export async function recordReceiptFromMedia(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  summary: string | null;
  media: ReceiptMedia;
}): Promise<ReceiptOutcome | null> {
  try {
    if (!looksLikeReceipt(input.summary)) return null;
    const integration = await getSheetsIntegrationRow(input.organizationId);
    if (
      !integration ||
      !integration.receiptsEnabled ||
      !integration.receiptsSpreadsheetId ||
      !integration.receiptsSheetTitle
    ) {
      return null;
    }

    const conv = await loadConversation(input.organizationId, input.conversationId);
    if (!conv) return null;

    // Reserva-primero: el unique de `message_id` decide quién anota.
    const reserved = await getDb()
      .insert(schema.paymentReceipt)
      .values({
        id: newId("paymentReceipt"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        contactId: conv.contactId,
        status: "pending",
        spreadsheetId: integration.receiptsSpreadsheetId,
        sheetTitle: integration.receiptsSheetTitle,
      })
      .onConflictDoNothing({ target: schema.paymentReceipt.messageId })
      .returning();
    const receipt = reserved[0];
    if (!receipt) {
      // Reproceso del mismo mensaje: se informa lo que ya pasó, sin escribir.
      const existing = await getReceiptByMessage(input.organizationId, input.messageId);
      if (!existing || existing.status === "pending") return null;
      return existing.status;
    }

    const outcome = await runReceipt(receipt, input.media);
    // 044: un comprobante anotado es un pago: el lead pasa a cliente.
    if (outcome === "recorded") {
      await advanceLeadStage(input.organizationId, conv.contactId, { role: "won" });
    }
    return outcome;
  } catch (err) {
    console.error(
      "[planillas] fallo inesperado anotando un comprobante:",
      err instanceof Error ? err.name : "error"
    );
    return "failed";
  }
}

/**
 * Lectura + dedup + escritura de una fila YA reservada. Lo usan la ingesta
 * y el reintento. Deja la fila en su estado final y lo devuelve.
 */
async function runReceipt(receipt: ReceiptRow, media: ReceiptMedia): Promise<ReceiptOutcome | null> {
  const orgId = receipt.organizationId;
  const spreadsheetId = receipt.spreadsheetId;
  const sheetTitle = receipt.sheetTitle;
  if (!spreadsheetId || !sheetTitle) return fail(receipt, "not_found");

  let headers: string[];
  try {
    const firstRow = await withSheetsToken(orgId, (t) =>
      getValues(t, spreadsheetId, sheetRange(sheetTitle, HEADER_CELLS))
    );
    headers = normalizeHeaders(firstRow[0]);
  } catch (err) {
    return fail(receipt, sheetsErrorCode(err));
  }
  if (headers.length === 0) return fail(receipt, "no_headers");

  const config = await getAiConfig(orgId);
  if (!config) return fail(receipt, "no_ai");

  const kb = await getDb()
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, orgId))
    .orderBy(asc(schema.kbEntry.createdAt));

  const extracted = await extractPaymentReceipt(config, {
    media,
    columns: modelHeaders(headers),
    knowledge: kb.length ? renderKb(kb) : "",
    today: localDate(new Date(), false),
  });
  if (!extracted.ok) {
    // `detail` puede traer la salida cruda del modelo (datos bancarios): no se loguea.
    console.warn(`[planillas] lectura de comprobante falló (${extracted.error})`);
    return fail(receipt, extracted.error === "not_configured" ? "no_ai" : "extraction");
  }
  if (!extracted.data.is_receipt) {
    // No era un comprobante: no queda registro (AC2.4).
    await getDb().delete(schema.paymentReceipt).where(eq(schema.paymentReceipt.id, receipt.id));
    return null;
  }

  const dedupKey = receiptDedupKey(orgId, stringOrNull(extracted.data.operation_id), extracted.data.amount ?? null);
  if (dedupKey) {
    const dup = await getDb()
      .select({ id: schema.paymentReceipt.id })
      .from(schema.paymentReceipt)
      .where(
        scoped(
          schema.paymentReceipt.organizationId,
          orgId,
          and(
            eq(schema.paymentReceipt.dedupKey, dedupKey),
            eq(schema.paymentReceipt.status, "recorded"),
            ne(schema.paymentReceipt.id, receipt.id)
          )
        )
      )
      .limit(1);
    if (dup[0]) {
      await patch(receipt.id, { status: "duplicate", dedupKey, error: null });
      return "duplicate";
    }
  }

  const conv = await loadConversation(orgId, receipt.conversationId);
  const message = await getDb()
    .select({ createdAt: schema.message.createdAt, waTimestamp: schema.message.waTimestamp })
    .from(schema.message)
    .where(eq(schema.message.id, receipt.messageId))
    .limit(1);
  const ctx: ReceiptContext = {
    receivedAt: localDate(message[0]?.waTimestamp ?? message[0]?.createdAt ?? new Date(), true),
    contactName: conv?.contactName ?? "",
    phone: conv?.phone ?? "",
    conversationUrl: `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/inbox?c=${receipt.conversationId}`,
  };
  const row = buildReceiptRow(headers, extracted.data.values, ctx);
  const enc = encryptSecret(JSON.stringify(row));
  await patch(receipt.id, {
    dedupKey,
    valuesCipher: enc.cipher,
    valuesIv: enc.iv,
    valuesTag: enc.tag,
  });
  return appendStored(receipt.id, orgId, spreadsheetId, sheetTitle, row);
}

/** Escribe la fila ya armada; en éxito borra los valores cifrados. */
async function appendStored(
  receiptId: string,
  orgId: string,
  spreadsheetId: string,
  sheetTitle: string,
  row: string[]
): Promise<ReceiptOutcome> {
  try {
    const res = await withSheetsToken(orgId, (t) => appendRow(t, spreadsheetId, sheetTitle, row));
    await patch(receiptId, {
      status: "recorded",
      updatedRange: res.updatedRange,
      error: null,
      valuesCipher: null,
      valuesIv: null,
      valuesTag: null,
    });
    return "recorded";
  } catch (err) {
    const code = sheetsErrorCode(err);
    await patch(receiptId, { status: "failed", error: code });
    return "failed";
  }
}

async function fail(receipt: ReceiptRow, code: SheetsErrorCode): Promise<ReceiptOutcome> {
  await patch(receipt.id, { status: "failed", error: code });
  return "failed";
}

async function patch(
  id: string,
  set: Partial<typeof schema.paymentReceipt.$inferInsert>
): Promise<void> {
  await getDb()
    .update(schema.paymentReceipt)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(schema.paymentReceipt.id, id));
}

function stringOrNull(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

async function getReceiptByMessage(orgId: string, messageId: string): Promise<ReceiptRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.paymentReceipt)
    .where(scoped(schema.paymentReceipt.organizationId, orgId, eq(schema.paymentReceipt.messageId, messageId)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadConversation(
  orgId: string,
  conversationId: string
): Promise<{ contactId: string; contactName: string; phone: string } | null> {
  const rows = await getDb()
    .select({
      contactId: schema.contact.id,
      name: schema.contact.name,
      phone: schema.contact.phone,
      channel: schema.contact.channel,
      contactPhone: schema.contact.contactPhone,
      igUsername: schema.contact.igUsername,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(schema.conversation.organizationId, orgId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const phone =
    r.channel === "instagram"
      ? r.contactPhone
        ? `+${r.contactPhone}`
        : r.igUsername
          ? `@${r.igUsername} (Instagram)`
          : "Instagram"
      : `+${r.phone}`;
  return { contactId: r.contactId, contactName: r.name, phone };
}

/* ============================================================
 * Reintento (propietario)
 * ============================================================ */

export type RetryResult =
  | { ok: true; status: ReceiptOutcome | "not_receipt" }
  | { ok: false; error: "not_found" | "not_failed" | "no_media" };

export async function retryReceipt(orgId: string, receiptId: string): Promise<RetryResult> {
  const rows = await getDb()
    .select()
    .from(schema.paymentReceipt)
    .where(scoped(schema.paymentReceipt.organizationId, orgId, eq(schema.paymentReceipt.id, receiptId)))
    .limit(1);
  const receipt = rows[0];
  if (!receipt) return { ok: false, error: "not_found" };
  // Un «pendiente» de más de 5 minutos quedó colgado (reinicio del proceso).
  const stuck = receipt.status === "pending" && Date.now() - receipt.updatedAt.getTime() > 5 * 60_000;
  if (receipt.status !== "failed" && !stuck) return { ok: false, error: "not_failed" };

  await patch(receipt.id, { attempts: receipt.attempts + 1 });

  // Ya se había leído: solo falta escribir la misma fila.
  if (receipt.valuesCipher && receipt.valuesIv && receipt.valuesTag && receipt.spreadsheetId && receipt.sheetTitle) {
    const row = JSON.parse(
      decryptSecret({ cipher: receipt.valuesCipher, iv: receipt.valuesIv, tag: receipt.valuesTag })
    ) as string[];
    const status = await appendStored(receipt.id, orgId, receipt.spreadsheetId, receipt.sheetTitle, row);
    if (status === "recorded" && receipt.contactId) await advanceLeadStage(orgId, receipt.contactId, { role: "won" });
    return { ok: true, status };
  }

  // No se llegó a leer: se vuelve a leer el archivo guardado, contra el
  // destino ACTUAL (el propietario pudo haberlo corregido).
  const media = await getDb()
    .select({ data: schema.messageMedia.data, mimeType: schema.messageMedia.mimeType, fileName: schema.messageMedia.fileName })
    .from(schema.messageMedia)
    .where(scoped(schema.messageMedia.organizationId, orgId, eq(schema.messageMedia.messageId, receipt.messageId)))
    .limit(1);
  if (!media[0]) return { ok: false, error: "no_media" };
  const integration = await getSheetsIntegrationRow(orgId);
  const target = {
    spreadsheetId: integration?.receiptsSpreadsheetId ?? receipt.spreadsheetId,
    sheetTitle: integration?.receiptsSheetTitle ?? receipt.sheetTitle,
  };
  await patch(receipt.id, target);
  const status = await runReceipt(
    { ...receipt, ...target },
    { bytes: media[0].data, mimeType: media[0].mimeType, fileName: media[0].fileName }
  );
  if (status === "recorded" && receipt.contactId) await advanceLeadStage(orgId, receipt.contactId, { role: "won" });
  return { ok: true, status: status ?? "not_receipt" };
}

/* ============================================================
 * Registro para la UI
 * ============================================================ */

export type ReceiptLogItem = {
  id: string;
  status: ReceiptRow["status"];
  error: string | null;
  contactName: string | null;
  conversationId: string;
  updatedRange: string | null;
  spreadsheetId: string | null;
  createdAt: string;
};

export async function listReceipts(orgId: string, limit = 50): Promise<ReceiptLogItem[]> {
  const rows = await getDb()
    .select({
      id: schema.paymentReceipt.id,
      status: schema.paymentReceipt.status,
      error: schema.paymentReceipt.error,
      contactName: schema.contact.name,
      conversationId: schema.paymentReceipt.conversationId,
      updatedRange: schema.paymentReceipt.updatedRange,
      spreadsheetId: schema.paymentReceipt.spreadsheetId,
      createdAt: schema.paymentReceipt.createdAt,
    })
    .from(schema.paymentReceipt)
    .leftJoin(schema.contact, eq(schema.contact.id, schema.paymentReceipt.contactId))
    .where(scoped(schema.paymentReceipt.organizationId, orgId))
    .orderBy(desc(schema.paymentReceipt.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/* ============================================================
 * Destino (propietario)
 * ============================================================ */

export type TargetResult =
  | { ok: true; spreadsheetId: string; spreadsheetName: string; sheetTitle: string; headers: string[]; wroteHeaders: boolean }
  | { ok: false; error: SheetsErrorCode | "sheet_not_found" };

/** Crea una planilla nueva con las columnas sugeridas y la deja como destino. */
export async function createReceiptsSpreadsheet(orgId: string, orgName: string): Promise<TargetResult> {
  try {
    const info = await withSheetsToken(orgId, (t) =>
      createSpreadsheet(t, {
        title: `Comprobantes — ${orgName}`.slice(0, 100),
        sheetTitle: DEFAULT_RECEIPTS_SHEET_TITLE,
        headers: DEFAULT_RECEIPT_HEADERS,
      })
    );
    const sheetTitle = info.sheets[0]?.title ?? DEFAULT_RECEIPTS_SHEET_TITLE;
    await updateReceiptsTarget(orgId, {
      enabled: true,
      spreadsheetId: info.spreadsheetId,
      spreadsheetName: info.title,
      sheetTitle,
    });
    return {
      ok: true,
      spreadsheetId: info.spreadsheetId,
      spreadsheetName: info.title,
      sheetTitle,
      headers: [...DEFAULT_RECEIPT_HEADERS],
      wroteHeaders: true,
    };
  } catch (err) {
    return { ok: false, error: sheetsErrorCode(err) };
  }
}

/**
 * Usa una planilla existente (elegida con el selector). La pestaña tiene que
 * tener encabezados en la fila 1; si está COMPLETAMENTE vacía, se escriben
 * los sugeridos (nunca se pisa una hoja con datos).
 */
export async function setReceiptsTarget(
  orgId: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<TargetResult> {
  try {
    const info = await withSheetsToken(orgId, (t) => getSpreadsheet(t, spreadsheetId));
    const sheet = info.sheets.find((s) => s.title === sheetTitle);
    if (!sheet) return { ok: false, error: "sheet_not_found" };
    const top = await withSheetsToken(orgId, (t) =>
      getValues(t, spreadsheetId, sheetRange(sheetTitle, "A1:AD5"))
    );
    let headers = normalizeHeaders(top[0]);
    let wroteHeaders = false;
    if (headers.length === 0) {
      const empty = top.every((r) => r.every((c) => c.trim() === ""));
      if (!empty) return { ok: false, error: "no_headers" };
      await withSheetsToken(orgId, (t) => appendRow(t, spreadsheetId, sheetTitle, DEFAULT_RECEIPT_HEADERS));
      headers = [...DEFAULT_RECEIPT_HEADERS];
      wroteHeaders = true;
    }
    await updateReceiptsTarget(orgId, {
      enabled: true,
      spreadsheetId,
      spreadsheetName: info.title,
      sheetTitle,
    });
    return { ok: true, spreadsheetId, spreadsheetName: info.title, sheetTitle, headers, wroteHeaders };
  } catch (err) {
    if (err instanceof SheetsApiError || err instanceof Error) {
      return { ok: false, error: sheetsErrorCode(err) };
    }
    return { ok: false, error: "provider_error" };
  }
}

/** Encabezados actuales del destino (para mostrarlos en la página). */
export async function readReceiptHeaders(orgId: string): Promise<string[] | { error: SheetsErrorCode }> {
  const integration = await getSheetsIntegrationRow(orgId);
  if (!integration?.receiptsSpreadsheetId || !integration.receiptsSheetTitle) return [];
  const id = integration.receiptsSpreadsheetId;
  const title = integration.receiptsSheetTitle;
  try {
    const rows = await withSheetsToken(orgId, (t) => getValues(t, id, sheetRange(title, HEADER_CELLS), 8000));
    return normalizeHeaders(rows[0]);
  } catch (err) {
    return { error: sheetsErrorCode(err) };
  }
}
