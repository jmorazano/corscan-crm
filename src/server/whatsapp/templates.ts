import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  getCredentialsListByWabaId,
  markReconnectRequired,
} from "@/server/whatsapp/credentials";
import { callGraphSend, SendError } from "@/server/inbox/send";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";
import { releaseQuota, reserveQuota } from "@/server/campaigns/quota";
import type { WebhookValue } from "@/server/inbox/webhook";

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "meta_error"
    | "meta_unavailable"
    | "in_use";

  constructor(code: TemplateError["code"], message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const TEMPLATE_ERROR_STATUS: Record<TemplateError["code"], number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  meta_error: 422,
  meta_unavailable: 503,
  in_use: 409,
};

export function templateErrorStatus(err: TemplateError): number {
  return TEMPLATE_ERROR_STATUS[err.code];
}

export {
  countVariables,
  renderBody,
  validateBodyVariables,
} from "@/lib/template-body";
import { countVariables, renderBody, validateBodyVariables } from "@/lib/template-body";

type TemplateRow = typeof schema.template.$inferSelect;

export function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    rejectionReason: t.rejectionReason,
  };
}

/** Crea la plantilla y la manda a aprobación de Meta (FR-050). */
export async function createTemplate(
  organizationId: string,
  input: { name: string; language: string; category: string; body: string }
): Promise<TemplateRow> {
  const variableError = validateBodyVariables(input.body);
  if (variableError) throw new TemplateError("invalid", variableError);

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de crear plantillas");
  }

  const name = input.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  const hasVariable = countVariables(input.body) === 1;
  let waTemplateId: string | null = null;
  try {
    const res = await graphRequest<{ id?: string; status?: string }>(
      `${creds.wabaId}/message_templates`,
      {
        method: "POST",
        token: creds.token,
        body: {
          name,
          language: input.language,
          category: input.category,
          components: [
            {
              type: "BODY",
              text: input.body,
              ...(hasVariable
                ? { example: { body_text: [["ejemplo"]] } }
                : {}),
            },
          ],
        },
      }
    );
    waTemplateId = res.id ?? null;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      if (err.status === 0 || err.status >= 500) {
        throw new TemplateError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new TemplateError("meta_error", err.message);
    }
    throw err;
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.template)
    .values({
      id: newId("template"),
      organizationId,
      name,
      language: input.language,
      category: input.category,
      body: input.body,
      status: "pending",
      waTemplateId,
    })
    .onConflictDoUpdate({
      target: [
        schema.template.organizationId,
        schema.template.name,
        schema.template.language,
      ],
      set: {
        category: input.category,
        body: input.body,
        status: "pending",
        rejectionReason: null,
        waTemplateId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted[0]!;
}

/**
 * Borra la plantilla en Meta y localmente. En Meta, `name` sin `hsm_id`
 * borraría TODOS los idiomas de ese nombre: con el id remoto conocido se
 * acota al idioma de esta fila. Una plantilla que Meta ya no tiene se da
 * por borrada allá y se limpia acá igual (no queda huérfana en el CRM).
 * Con campañas ACTIVAS (borrador, en curso o pausada) el borrado se
 * rechaza con 409 antes de tocar Meta; las terminadas conservan el nombre
 * de la plantilla como historial (FK `set null` + snapshot `template_name`).
 */
export async function deleteTemplate(
  organizationId: string,
  templateId: string
): Promise<TemplateRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, templateId)
      )
    )
    .limit(1);
  const template = rows[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");

  const campaigns = await db
    .select({ n: count() })
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        and(
          eq(schema.campaign.templateId, templateId),
          inArray(schema.campaign.status, ["draft", "running", "paused"])
        )
      )
    );
  const inUse = Number(campaigns[0]?.n ?? 0);
  if (inUse > 0) {
    throw new TemplateError(
      "in_use",
      `La plantilla la usan ${inUse} campaña(s) activa(s) (borrador, en curso o pausada); cancelalas o terminalas antes de borrarla`
    );
  }

  const creds = await getCredentialsByOrg(organizationId);
  if (creds) {
    const params = new URLSearchParams({ name: template.name });
    if (template.waTemplateId) params.set("hsm_id", template.waTemplateId);
    try {
      await graphRequest(`${creds.wabaId}/message_templates?${params}`, {
        method: "DELETE",
        token: creds.token,
      });
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      if (err.status === 0 || err.status >= 500) {
        throw new TemplateError("meta_unavailable", "Meta no está disponible ahora");
      }
      if (!isTemplateMissingError(err)) {
        // Meta responde `(#100) Invalid parameter` (no 404) cuando el hsm_id
        // ya no existe — p. ej. plantilla borrada desde el Business Manager o
        // WABA migrada a otro portfolio. Se confirma con un GET por nombre.
        const gone = await isGoneInMeta(creds, template).catch(() => false);
        if (!gone) {
          console.warn(
            `[templates] DELETE ${template.name} falló en Meta: status=${err.status} code=${err.code} type=${err.type} ${err.message}`
          );
          throw new TemplateError("meta_error", err.message);
        }
      }
      // 404 / "no existe" / no aparece en el listado: ya no está en Meta → se
      // limpia localmente igual.
    }
  }

  await db
    .delete(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, templateId)
      )
    );
  return template;
}

/** Meta responde 404, o 400 con "does not exist"/"not found", si ya no está. */
/**
 * ¿La plantilla ya no existe en la WABA? Verdadero si el listado por nombre no
 * trae ni su id remoto ni una entrada con el mismo nombre+idioma.
 */
async function isGoneInMeta(
  creds: { wabaId: string; token: string },
  template: { name: string; language: string; waTemplateId: string | null }
): Promise<boolean> {
  const params = new URLSearchParams({
    name: template.name,
    fields: "id,name,language",
    limit: "50",
  });
  const res = await graphRequest<{
    data?: { id?: string; name?: string; language?: string }[];
  }>(`${creds.wabaId}/message_templates?${params}`, { token: creds.token });
  return !(res.data ?? []).some(
    (t) =>
      (template.waTemplateId && t.id === template.waTemplateId) ||
      (t.name === template.name && t.language === template.language)
  );
}

function isTemplateMissingError(err: MetaApiError): boolean {
  if (err.status === 404) return true;
  return /does not exist|not exist|not found|no existe/i.test(err.message);
}

function mapMetaStatus(
  status: string | undefined
): TemplateRow["status"] | null {
  const s = (status ?? "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION") {
    return "pending";
  }
  return null;
}

/**
 * Sincroniza estados desde Graph (`GET {waba}/message_templates`). Cubre el
 * modo agencia: los webhooks de plantillas NO siguen el override de callback,
 * así que el pull es la vía universal (DV-VC-04/DV-VC-15).
 */
export async function syncTemplates(organizationId: string): Promise<number> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }

  let data: {
    data?: { id?: string; name?: string; language?: string; status?: string; quality_score?: unknown; rejected_reason?: string }[];
  };
  try {
    data = await graphRequest(`${creds.wabaId}/message_templates`, {
      token: creds.token,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      throw new TemplateError("meta_unavailable", "No se pudo consultar Meta");
    }
    throw err;
  }

  const db = getDb();
  const local = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));

  let updated = 0;
  for (const remote of data.data ?? []) {
    const status = mapMetaStatus(remote.status);
    if (!status) continue;
    const match = local.find(
      (t) =>
        (remote.id && t.waTemplateId === remote.id) ||
        (t.name === remote.name && t.language === remote.language)
    );
    if (!match || match.status === status) continue;
    await db
      .update(schema.template)
      .set({
        status,
        rejectionReason: remote.rejected_reason ?? null,
        waTemplateId: match.waTemplateId ?? remote.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.template.id, match.id));
    updated += 1;
  }
  return updated;
}

/**
 * Evento webhook `message_template_status_update` (modo directo, FR-050).
 *
 * Multi-tenant (US2): una WABA puede estar conectada por VARIAS organizaciones
 * (waba_id no es único en meta_credentials), así que el evento se aplica en
 * cada una de ellas — jamás en "una cualquiera". En Meta, (waba, name,
 * language) identifica UNA plantilla, así que las filas homónimas de esas
 * orgs refieren al mismo template remoto. El id del evento desambigua además
 * el caso de plantilla recreada: una fila local que apunta a OTRO
 * wa_template_id no se pisa (el evento no es suyo).
 */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  if (!wabaId) return;
  const credsList = await getCredentialsListByWabaId(wabaId);
  if (credsList.length === 0) return;

  const status = mapMetaStatus(value.event);
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!status || !name || !language) return;
  const waTemplateId =
    value.message_template_id != null ? String(value.message_template_id) : null;

  const db = getDb();
  for (const creds of credsList) {
    await db
      .update(schema.template)
      .set({
        status,
        rejectionReason: status === "rejected" ? (value.reason ?? null) : null,
        // Backfill del id remoto cuando el evento lo trae (solo alcanza filas
        // con id nulo o igual — ver el WHERE).
        ...(waTemplateId ? { waTemplateId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.template.organizationId, creds.organizationId),
          eq(schema.template.name, name),
          eq(schema.template.language, language),
          waTemplateId
            ? or(
                isNull(schema.template.waTemplateId),
                eq(schema.template.waTemplateId, waTemplateId)
              )
            : undefined
        )
      );
  }
}

export type SendTemplateResult = {
  messageId: string;
  waMessageId: string;
  /** contacts[0].wa_id de la respuesta de Graph (reconciliación D3). */
  waId: string | null;
};

/**
 * Núcleo del envío de plantillas (004): recibe plantilla, credenciales y
 * las filas de conversación/contacto YA resueltas — el runner de campañas
 * las tiene precargadas y no paga N descifrados. Los guards viven ACÁ
 * (defensa en profundidad): todo camino de envío pasa por este embudo.
 */
export async function sendTemplateCore(input: {
  organizationId: string;
  template: TemplateRow;
  creds: NonNullable<Awaited<ReturnType<typeof getCredentialsByOrg>>>;
  conversation: typeof schema.conversation.$inferSelect;
  contact: typeof schema.contact.$inferSelect;
  variable?: string;
}): Promise<SendTemplateResult> {
  const db = getDb();
  const { template, creds, conversation, contact } = input;

  if (template.status !== "approved") {
    throw new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas");
  }
  const needsVariable = countVariables(template.body) === 1;
  if (needsVariable && !input.variable?.trim()) {
    throw new TemplateError("invalid", "La plantilla requiere el valor de {{1}}");
  }
  if (conversation.isTest || contact.isTest) {
    // Aserción dura del sandbox (FR-031 + 004): también a nivel CONTACTO —
    // un contacto del Laboratorio jamás recibe un envío real, tenga la
    // conversación que tenga.
    throw new SendError(
      "sandbox_violation",
      "Contacto/conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }
  if (contact.optedOutAt && !isWindowOpen(conversation.lastInboundAt)) {
    // FR-010/FR-012: el dado de baja no recibe envíos INICIADOS por la
    // empresa; responderle dentro de la ventana de servicio sigue permitido.
    throw new SendError(
      "opted_out",
      "El contacto pidió no recibir más mensajes (dado de baja)"
    );
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta el número");
  }

  const { waMessageId, waId } = await callGraphSend(creds, {
    messaging_product: "whatsapp",
    to: normalizeRecipient(contact.phone),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(needsVariable
        ? {
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: input.variable!.trim() }],
              },
            ],
          }
        : {}),
    },
  });

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: conversation.id,
      waMessageId,
      direction: "out",
      type: "template",
      templateId: template.id,
      text: renderBody(template.body, input.variable?.trim()),
      status: "pending",
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: conversation.id,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id, waMessageId, waId };
}

/** Resuelve plantilla + conversación + credenciales para el núcleo. */
export async function resolveTemplateSend(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
}): Promise<{
  template: TemplateRow;
  conversation: typeof schema.conversation.$inferSelect;
  contact: typeof schema.contact.$inferSelect;
  creds: NonNullable<Awaited<ReturnType<typeof getCredentialsByOrg>>>;
}> {
  const db = getDb();

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TemplateError("not_found", "Conversación no encontrada");

  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) throw new TemplateError("not_connected", "Sin número conectado");

  return { template, conversation: row.conversation, contact: row.contact, creds };
}

/**
 * Envía una plantilla APROBADA a una conversación existente (ventana
 * cerrada, FR-051). Con la ventana cerrada el envío es "iniciado por la
 * empresa": consume cupo (FR-015, con reserva y compensación) — dentro de
 * ventana no. Lanza QuotaError con el cupo agotado.
 */
export async function sendTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variable?: string;
}): Promise<{ messageId: string }> {
  const resolved = await resolveTemplateSend(input);

  const windowOpen = isWindowOpen(resolved.conversation.lastInboundAt);
  // El guard de baja va ANTES de la reserva de cupo: al operador hay que
  // decirle el motivo real (409 opted_out), no un 429 accidental.
  if (resolved.contact.optedOutAt && !windowOpen) {
    throw new SendError(
      "opted_out",
      "El contacto pidió no recibir más mensajes (dado de baja)"
    );
  }
  let reservationId: string | null = null;
  if (!windowOpen) {
    ({ reservationId } = await reserveQuota(
      input.organizationId,
      resolved.contact.id
    ));
  }

  try {
    const result = await sendTemplateCore({
      organizationId: input.organizationId,
      template: resolved.template,
      creds: resolved.creds,
      conversation: resolved.conversation,
      contact: resolved.contact,
      variable: input.variable,
    });
    return { messageId: result.messageId };
  } catch (err) {
    if (reservationId) await releaseQuota(reservationId);
    throw err;
  }
}
