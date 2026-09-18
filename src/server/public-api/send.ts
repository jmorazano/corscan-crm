import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { normalizeToWaId } from "@/lib/phone";
import { requestHash } from "@/lib/idempotency";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError } from "@/server/inbox/send";
import { reconcileContactWaId } from "@/server/contacts";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  sendTemplateCore,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";
import {
  QuotaError,
  releaseQuota,
  reserveQuota,
} from "@/server/campaigns/quota";
import { findTemplateByName, resolveApiParams } from "@/server/public-api/templates";

/**
 * Envío por la API pública (014, FR-004/FR-005/FR-007). Orquesta lo que ya
 * existe — normalización, upsert de contacto/conversación, cupo, embudo
 * único de plantillas, reconciliación — y agrega la idempotencia
 * reserva-primero (research D2). Devuelve SIEMPRE una respuesta HTTP
 * tipada; jamás lanza por errores de dominio.
 */

export type SendInput = {
  to: string;
  name?: string;
  template: string;
  language?: string;
  params: Record<string, string>;
};

export type ApiResponse = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

function fail(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): ApiResponse {
  return { status, body: { error: { code, message, ...(extra ?? {}) } } };
}

const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 409,
  not_connected: 409,
  reconnect_required: 409,
  window_closed: 409,
  opted_out: 409,
  meta_error: 422,
  meta_unavailable: 503,
};

/**
 * Contacto por wa_id (014, research D3): nuevo → con nombre y
 * consentimiento `api`; existente → consentimiento set-si-null y el nombre
 * solo si era el placeholder (teléfono). Jamás pisa lo que editó el
 * operador. Reactiva si estaba archivado (como la ingesta).
 */
async function upsertApiContact(
  organizationId: string,
  waId: string,
  name: string | undefined
): Promise<{ contact: typeof schema.contact.$inferSelect; created: boolean }> {
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: waId,
      name: name?.trim() || waId,
      consentSource: "api",
      consentAt: now,
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], created: true };

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, organizationId, eq(schema.contact.phone, waId))
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("contacto no encontrado tras upsert");

  const patch: Partial<typeof schema.contact.$inferInsert> = {};
  if (existing.archivedAt) patch.archivedAt = null;
  if (!existing.consentSource) {
    patch.consentSource = "api";
    patch.consentAt = now;
  }
  const trimmed = name?.trim();
  if (trimmed && (!existing.name.trim() || existing.name === existing.phone)) {
    patch.name = trimmed;
  }
  if (Object.keys(patch).length > 0) {
    const updated = await db
      .update(schema.contact)
      .set({ ...patch, updatedAt: now })
      .where(eq(schema.contact.id, existing.id))
      .returning();
    return { contact: updated[0] ?? { ...existing, ...patch }, created: false };
  }
  return { contact: existing, created: false };
}

type IdempotencyClaim =
  | { kind: "fresh"; reservationId: string }
  | { kind: "replay"; response: ApiResponse }
  | { kind: "in_progress" }
  | { kind: "mismatch" };

/** Reserva la clave ANTES de enviar; conflicto → replay / en curso / distinto. */
async function claimIdempotency(input: {
  organizationId: string;
  apiKeyId: string;
  idempotencyKey: string;
  hash: string;
}): Promise<IdempotencyClaim> {
  const db = getDb();
  const reservationId = newId("apiRequest");
  const inserted = await db
    .insert(schema.apiRequest)
    .values({
      id: reservationId,
      organizationId: input.organizationId,
      apiKeyId: input.apiKeyId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.hash,
    })
    .onConflictDoNothing({
      target: [schema.apiRequest.organizationId, schema.apiRequest.idempotencyKey],
    })
    .returning({ id: schema.apiRequest.id });
  if (inserted[0]) return { kind: "fresh", reservationId };

  const rows = await db
    .select()
    .from(schema.apiRequest)
    .where(
      scoped(
        schema.apiRequest.organizationId,
        input.organizationId,
        eq(schema.apiRequest.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return { kind: "in_progress" }; // carrera: se borró entre medio
  if (existing.requestHash !== input.hash) return { kind: "mismatch" };
  if (existing.statusCode === 0 || !existing.responseBody) return { kind: "in_progress" };
  return {
    kind: "replay",
    response: {
      status: existing.statusCode,
      body: existing.responseBody,
      headers: { "Idempotent-Replayed": "true" },
    },
  };
}

async function releaseIdempotency(reservationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.apiRequest)
    .where(and(eq(schema.apiRequest.id, reservationId), eq(schema.apiRequest.statusCode, 0)));
}

async function completeIdempotency(
  reservationId: string,
  response: ApiResponse,
  messageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.apiRequest)
    .set({ statusCode: response.status, responseBody: response.body, messageId })
    .where(and(eq(schema.apiRequest.id, reservationId), isNull(schema.apiRequest.messageId)));
}

export async function sendViaApi(input: {
  organizationId: string;
  apiKey: { id: string; name: string };
  body: SendInput;
  idempotencyKey: string | null;
}): Promise<ApiResponse> {
  // 1) Validaciones puras ANTES de reservar nada (ni idempotencia ni cupo).
  const normalized = normalizeToWaId(input.body.to);
  if (!normalized.ok) {
    return fail(
      422,
      "invalid_phone",
      "Teléfono inválido: usá dígitos con código de país (ej. +54 9 351 688 2234)",
      { reason: normalized.reason }
    );
  }
  const lookup = await findTemplateByName(
    input.organizationId,
    input.body.template,
    input.body.language
  );
  if (!lookup.ok) {
    return fail(lookup.code === "template_not_found" ? 404 : 422, lookup.code, lookup.message, lookup.extra);
  }
  const template = lookup.template;
  if (template.status !== "approved") {
    return fail(
      422,
      "template_not_approved",
      `La plantilla «${template.name}» no está aprobada por Meta (estado: ${template.status})`,
      { status: template.status }
    );
  }
  const params = resolveApiParams(template, input.body.params);
  if (!params.ok) return fail(422, params.code, params.message, params.extra);

  // 2) Idempotencia: reserva-primero.
  let reservationId: string | null = null;
  if (input.idempotencyKey) {
    const claim = await claimIdempotency({
      organizationId: input.organizationId,
      apiKeyId: input.apiKey.id,
      idempotencyKey: input.idempotencyKey,
      hash: requestHash(input.body),
    });
    if (claim.kind === "replay") return claim.response;
    if (claim.kind === "mismatch") {
      return fail(
        422,
        "idempotency_mismatch",
        "Ya se usó esa Idempotency-Key con otro cuerpo: usá una clave nueva por cada envío distinto"
      );
    }
    if (claim.kind === "in_progress") {
      return fail(
        409,
        "idempotency_in_progress",
        "Un envío con esa Idempotency-Key está en curso: reintentá en unos segundos"
      );
    }
    reservationId = claim.reservationId;
  }

  try {
    const response = await performSend({
      organizationId: input.organizationId,
      apiKey: input.apiKey,
      waId: normalized.waId,
      name: input.body.name,
      template,
      params,
    });
    if (reservationId) {
      if (response.status < 300 && typeof response.body.message === "object") {
        const messageId = String((response.body.message as { id: string }).id);
        await completeIdempotency(reservationId, response, messageId);
      } else {
        await releaseIdempotency(reservationId);
      }
    }
    return response;
  } catch (err) {
    if (reservationId) await releaseIdempotency(reservationId).catch(() => undefined);
    throw err;
  }
}

async function performSend(input: {
  organizationId: string;
  apiKey: { id: string; name: string };
  waId: string;
  name: string | undefined;
  template: typeof schema.template.$inferSelect;
  params: { freeTexts?: string[]; variable?: string };
}): Promise<ApiResponse> {
  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) {
    return fail(409, "not_connected", "La empresa no tiene un número de WhatsApp conectado");
  }
  if (creds.status === "reconnect_required") {
    return fail(
      409,
      "reconnect_required",
      "El token de WhatsApp de la empresa expiró: hay que reconectar el número desde Ajustes"
    );
  }

  const { contact, created } = await upsertApiContact(
    input.organizationId,
    input.waId,
    input.name
  );
  if (contact.isTest) {
    // Sandbox del Laboratorio inalcanzable por API (FR-014).
    return fail(
      409,
      "sandbox_contact",
      "Ese teléfono pertenece a un contacto de prueba del Laboratorio: no se le envía nada real"
    );
  }
  const conversation = await getOrCreateConversation(input.organizationId, contact.id);
  const windowOpen = isWindowOpen(conversation.lastInboundAt);

  // Baja ANTES del cupo: el motivo real, no un 429 accidental.
  if (contact.optedOutAt && !windowOpen) {
    return fail(
      409,
      "opted_out",
      "El contacto pidió no recibir más mensajes (dado de baja); solo se le puede responder si vuelve a escribir"
    );
  }

  let reservationId: string | null = null;
  if (!windowOpen) {
    try {
      ({ reservationId } = await reserveQuota(input.organizationId, contact.id));
    } catch (err) {
      if (err instanceof QuotaError) {
        return fail(429, "quota_exceeded", err.message, {
          retryInSeconds: err.retryInSeconds,
        });
      }
      throw err;
    }
  }

  try {
    const result = await sendTemplateCore({
      organizationId: input.organizationId,
      template: input.template,
      creds,
      conversation,
      contact,
      variable: input.params.variable,
      freeTexts: input.params.freeTexts,
      via: { apiKeyId: input.apiKey.id, label: input.apiKey.name },
    });
    await reconcileContactWaId(input.organizationId, contact, result.waId);
    return {
      status: 201,
      body: {
        message: {
          id: result.messageId,
          status: "pending",
          template: input.template.name,
        },
        contact: { id: contact.id, phone: contact.phone, created },
        conversation: {
          id: conversation.id,
          url: `${getEnv().APP_BASE_URL}/inbox?c=${conversation.id}`,
        },
      },
    };
  } catch (err) {
    if (reservationId) await releaseQuota(reservationId);
    if (err instanceof QuotaError) {
      return fail(429, "quota_exceeded", err.message, { retryInSeconds: err.retryInSeconds });
    }
    if (err instanceof TemplateError) {
      return fail(templateErrorStatus(err), err.code, err.message, err.extra);
    }
    if (err instanceof SendError) {
      const code = err.code === "sandbox_violation" ? "sandbox_contact" : err.code;
      return fail(SEND_ERROR_STATUS[err.code], code, err.message);
    }
    throw err;
  }
}
