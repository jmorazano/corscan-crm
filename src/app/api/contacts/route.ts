import { desc, count, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { normalizeToWaId } from "@/lib/phone";
import { parseTagMode, parseTagsParam, sanitizeTags } from "@/lib/tags";
import { tagsWhere } from "@/server/tags";
import { serializeContact } from "@/server/contacts";
import { parseLimit, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const includeArchived = url.searchParams.get("archived") === "true";
  // 006: filtro multi-etiqueta `tags=a,b&mode=any|all`; `tag=` (004) sigue
  // aceptado como alias.
  const tags = parseTagsParam(
    url.searchParams.get("tags"),
    url.searchParams.get("tag")
  );
  const mode = parseTagMode(url.searchParams.get("mode"));
  // 006: paginación por página (`page`, `limit`) persistida en la URL.
  const page = parsePage(url.searchParams.get("page"));
  const limit = parseLimit(url.searchParams.get("limit"));

  // Todos los filtros van al WHERE (004): filtrar en JS después del limit
  // devolvía una vista truncada engañosa tras un import grande.
  const where = scoped(
    schema.contact.organizationId,
    session.organizationId,
    q
      ? or(
          ilike(schema.contact.name, `%${q}%`),
          ilike(schema.contact.phone, `%${q}%`)
        )
      : undefined,
    includeArchived ? undefined : isNull(schema.contact.archivedAt),
    tagsWhere(schema.contact.tags, tags, mode)
  );

  const db = getDb();
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(schema.contact)
      .where(where)
      .orderBy(desc(schema.contact.updatedAt), desc(schema.contact.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(schema.contact).where(where),
  ]);
  const total = totalRows[0]?.total ?? rows.length;

  return Response.json({
    contacts: rows.map(serializeContact),
    total,
    page,
    pageSize: limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(80)).max(30).optional(),
  consent: z.boolean().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  // 004: el teléfono se guarda SIEMPRE como wa_id (research D3) para que la
  // respuesta del cliente por webhook caiga en el MISMO contacto.
  const normalized = normalizeToWaId(body.data.phone);
  if (!normalized.ok) {
    return apiError(
      422,
      "invalid_phone",
      "Teléfono inválido: usá dígitos con código de país (ej. +54 9 351 688 2234)"
    );
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId: session.organizationId,
      name: body.data.name,
      phone: normalized.waId,
      notes: body.data.notes ?? null,
      tags: sanitizeTags(body.data.tags),
      ...(body.data.consent
        ? { consentSource: "manual" as const, consentAt: new Date() }
        : {}),
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning();
  if (!inserted[0]) {
    return apiError(409, "duplicate", "Ya existe un contacto con ese teléfono");
  }
  return Response.json(
    { contact: serializeContact(inserted[0]) },
    { status: 201 }
  );
});
