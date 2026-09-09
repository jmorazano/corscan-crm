import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseTagMode, parseTagsParam } from "@/lib/tags";
import { decodeCursor, parseLimit } from "@/lib/pagination";
import { listConversationsPage } from "@/server/inbox/queries";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError } from "@/server/inbox/send";
import { isWindowOpen } from "@/server/inbox/window";
import { getContactById, reconcileContactWaId } from "@/server/contacts";
import {
  QuotaError,
  releaseQuota,
  reserveQuota,
} from "@/server/campaigns/quota";
import {
  sendTemplateCore,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  // 006: filtros (etiquetas, búsqueda, no leídas) y paginación por cursor,
  // todo resuelto en SQL (contrato tags-api.md).
  const page = await listConversationsPage(session.organizationId, {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    tags: parseTagsParam(
      url.searchParams.get("tags"),
      url.searchParams.get("tag")
    ),
    mode: parseTagMode(url.searchParams.get("mode")),
    q: url.searchParams.get("q") ?? undefined,
    unreadOnly: url.searchParams.get("filter") === "unread",
    limit: parseLimit(url.searchParams.get("limit")),
    cursor: decodeCursor(url.searchParams.get("cursor")),
    contactId: url.searchParams.get("contactId") ?? undefined,
  });
  return Response.json(page);
});

const startSchema = z.object({
  contactId: z.string().min(1),
  templateId: z.string().min(1),
  variable: z.string().trim().max(500).optional(),
  /** 009: un valor por binding free_text (plantillas con bindings). */
  freeTexts: z.array(z.string().trim().max(500)).max(5).optional(),
});

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Inicia una conversación con plantilla hacia un contacto sin conversación
 * previa (004, US2 — contrato campaigns-api.md). Idempotente a nivel
 * conversación (getOrCreate) Y mensaje (dedup por misma plantilla en 24h).
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, startSchema);
  if (!body.ok) return body.response;
  const organizationId = session.organizationId;

  const contact = await getContactById(organizationId, body.data.contactId);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  if (contact.isTest) {
    return apiError(
      403,
      "sandbox_violation",
      "Contacto de prueba del Laboratorio: el envío real está prohibido"
    );
  }
  if (contact.optedOutAt) {
    return apiError(
      409,
      "opted_out",
      "El contacto pidió no recibir más mensajes (dado de baja)"
    );
  }

  const db = getDb();
  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, body.data.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) return apiError(404, "not_found", "Plantilla no encontrada");
  if (template.status !== "approved") {
    return apiError(
      422,
      "template_not_approved",
      "Solo se pueden enviar plantillas aprobadas"
    );
  }

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return apiError(409, "not_connected", "Sin número conectado");

  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id
  );

  // Dedup de reintento (FR-009): la MISMA plantilla ya salió en las últimas
  // 24h por esta conversación → devolver lo existente, sin re-enviar.
  const recent = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversation.id),
        eq(schema.message.direction, "out"),
        eq(schema.message.templateId, template.id),
        gt(schema.message.createdAt, new Date(Date.now() - DEDUP_WINDOW_MS))
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  if (recent[0]) {
    return Response.json(
      { conversationId: conversation.id, messageId: recent[0].id, deduped: true },
      { status: 200 }
    );
  }

  let reservationId: string | null = null;
  try {
    if (!isWindowOpen(conversation.lastInboundAt)) {
      ({ reservationId } = await reserveQuota(organizationId, contact.id));
    }
    const result = await sendTemplateCore({
      organizationId,
      template,
      creds,
      conversation,
      contact,
      variable: body.data.variable,
      freeTexts: body.data.freeTexts,
    });
    const reconciliation = await reconcileContactWaId(
      organizationId,
      contact,
      result.waId
    );
    return Response.json(
      {
        conversationId: conversation.id,
        messageId: result.messageId,
        ...(reconciliation === "conflict" ? { waIdConflict: true } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    if (reservationId) await releaseQuota(reservationId);
    if (err instanceof QuotaError) {
      return apiError(429, "quota_exceeded", err.message, {
        retryInSeconds: err.retryInSeconds,
      });
    }
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    if (err instanceof SendError) {
      const status =
        err.code === "opted_out" ? 409 : err.code === "sandbox_violation" ? 403 : 502;
      return apiError(status, err.code, err.message);
    }
    throw err;
  }
});
