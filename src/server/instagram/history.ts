import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  getInstagramConversationMessages,
  InstagramApiError,
  listInstagramConversations,
} from "@/lib/instagram/client";
import {
  customerOf,
  INSTAGRAM_HISTORY_DAYS,
  INSTAGRAM_HISTORY_MAX_CONVERSATIONS,
  INSTAGRAM_HISTORY_STALE_MS,
  mapInstagramHistoryMessage,
  parseMetaTime,
} from "@/lib/instagram/history";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { insertRows } from "@/server/inbox/history";
import { getOrCreateInstagramContact } from "@/server/instagram/ingest";
import {
  ensureInstagramToken,
  getInstagramIntegration,
} from "@/server/instagram/integration";

/**
 * Importación del historial de Instagram Direct (023). A diferencia del
 * celular de WhatsApp (017), acá no hay un volcado que Meta empuje por
 * webhook: se RECORRE la Conversations API (conversaciones más recientes
 * primero, hasta 60 días) y de cada una se leen los mensajes que Meta deja
 * leer — los 20 más recientes.
 *
 * Mismas reglas que 017: `created_at` = fecha original, dedup por `mid`,
 * marcas de la conversación con `greatest`, y NADA de no leídos, leads,
 * BAJA, push ni turno del agente. Corre en segundo plano y nunca lanza.
 */

export type InstagramHistoryResult =
  | { started: true }
  | { started: false; reason: "not_connected" | "reconnect_required" | "running" };

/**
 * Marca la importación como `running` si no hay otra en curso (o la que hay
 * quedó colgada) y la lanza en segundo plano.
 */
export async function startInstagramHistoryImport(
  organizationId: string,
  opts: { days?: number; now?: Date } = {}
): Promise<InstagramHistoryResult> {
  const now = opts.now ?? new Date();
  const integration = await getInstagramIntegration(organizationId);
  if (!integration) return { started: false, reason: "not_connected" };
  if (integration.status !== "connected") return { started: false, reason: "reconnect_required" };

  // Toma atómica: solo una importación a la vez por empresa.
  const claimed = await getDb()
    .update(schema.instagramIntegration)
    .set({
      historyStatus: "running",
      historyStartedAt: now,
      historyFinishedAt: null,
      historyError: null,
      historyThreads: 0,
      historyMessages: 0,
      updatedAt: now,
    })
    .where(
      scoped(
        schema.instagramIntegration.organizationId,
        organizationId,
        or(
          sql`${schema.instagramIntegration.historyStatus} <> 'running'`,
          isNull(schema.instagramIntegration.historyStartedAt),
          lt(
            schema.instagramIntegration.historyStartedAt,
            new Date(now.getTime() - INSTAGRAM_HISTORY_STALE_MS)
          )
        )
      )
    )
    .returning({ id: schema.instagramIntegration.id });
  if (claimed.length === 0) return { started: false, reason: "running" };

  void runImport(organizationId, opts.days ?? INSTAGRAM_HISTORY_DAYS);
  return { started: true };
}

async function runImport(organizationId: string, days: number): Promise<void> {
  const db = getDb();
  let threads = 0;
  let messages = 0;
  const touched: string[] = [];
  const saveProgress = () =>
    db
      .update(schema.instagramIntegration)
      .set({ historyThreads: threads, historyMessages: messages, updatedAt: new Date() })
      .where(scoped(schema.instagramIntegration.organizationId, organizationId));

  try {
    let integration = await getInstagramIntegration(organizationId);
    if (!integration) throw new Error("La cuenta de Instagram se desconectó");
    integration = await ensureInstagramToken(integration);
    if (integration.status !== "connected") {
      throw new Error("La conexión con Instagram venció: reconectá la cuenta");
    }
    const now = new Date();
    const oldest = now.getTime() - days * 86_400_000;

    let after: string | null = null;
    let seen = 0;
    pages: do {
      const page = await listInstagramConversations(integration.token, { after, limit: 25 });
      for (const conv of page.conversations) {
        if (++seen > INSTAGRAM_HISTORY_MAX_CONVERSATIONS) break pages;
        const updated = parseMetaTime(conv.updatedTime);
        // Vienen de la más reciente a la más vieja: la primera fuera de la
        // ventana corta todo el recorrido.
        if (updated && updated.getTime() < oldest) break pages;

        const customer = customerOf(conv.participants, integration);
        if (!customer) continue;

        let raw;
        try {
          raw = await getInstagramConversationMessages(integration.token, conv.id);
        } catch (err) {
          console.warn(
            `[instagram] historial: no se pudo leer una conversación:`,
            err instanceof Error ? err.message : err
          );
          continue;
        }
        const rows = raw
          .map((m) => mapInstagramHistoryMessage(m, { customerId: customer.id, days, now }))
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => a.at.getTime() - b.at.getTime());
        if (rows.length === 0) continue;

        const contact = await getOrCreateInstagramContact(integration, customer.id, {
          username: customer.username,
        });
        const conversation = await getOrCreateConversation(organizationId, contact.id, "instagram");
        const { inserted } = await insertRows(organizationId, conversation.id, rows, "history");
        if (inserted.length > 0) {
          threads += 1;
          messages += inserted.length;
          touched.push(conversation.id);
          await saveProgress();
        }
      }
      after = page.next;
    } while (after);

    // El resumen muestra el TOTAL importado (una reimportación que no trae
    // nada nuevo no debe decir «0 mensajes»).
    const totals = await instagramHistoryTotals(organizationId);
    await db
      .update(schema.instagramIntegration)
      .set({
        historyStatus: "done",
        historyFinishedAt: new Date(),
        historyThreads: totals.threads,
        historyMessages: totals.messages,
        updatedAt: new Date(),
      })
      .where(scoped(schema.instagramIntegration.organizationId, organizationId));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.warn(`[instagram] historial de ${organizationId} falló: ${raw}`);
    const message =
      err instanceof InstagramApiError
        ? err.isUnavailable
          ? "Instagram no respondió; probá de nuevo en un rato"
          : err.isAuthError
            ? "La conexión con Instagram venció: reconectá la cuenta"
            : `Instagram rechazó el pedido (${raw})`
        : raw;
    const totals = await instagramHistoryTotals(organizationId).catch(() => ({ threads, messages }));
    await db
      .update(schema.instagramIntegration)
      .set({
        historyStatus: "failed",
        historyFinishedAt: new Date(),
        historyThreads: totals.threads,
        historyMessages: totals.messages,
        historyError: message.slice(0, 300),
        updatedAt: new Date(),
      })
      .where(scoped(schema.instagramIntegration.organizationId, organizationId))
      .catch(() => {});
  } finally {
    if (touched.length > 0) {
      publish(organizationId, {
        type: "conversations.updated",
        data: { conversationIds: touched },
      });
    }
  }
}

/** Total del historial de Instagram guardado para la empresa. */
async function instagramHistoryTotals(
  organizationId: string
): Promise<{ threads: number; messages: number }> {
  const rows = await getDb()
    .select({
      messages: sql<number>`count(*)`,
      threads: sql<number>`count(distinct ${schema.message.conversationId})`,
    })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.source, "history"),
        eq(schema.conversation.kind, "instagram")
      )
    );
  return {
    threads: Number(rows[0]?.threads ?? 0),
    messages: Number(rows[0]?.messages ?? 0),
  };
}

/**
 * Cuentas conectadas que nunca importaron su historial (p. ej. conectadas
 * antes de que existiera esta función): el ticker las dispara una vez.
 */
export async function startPendingInstagramHistoryImports(): Promise<number> {
  const rows = await getDb()
    .select({ organizationId: schema.instagramIntegration.organizationId })
    .from(schema.instagramIntegration)
    .where(
      and(
        eq(schema.instagramIntegration.status, "connected"),
        eq(schema.instagramIntegration.historyStatus, "idle")
      )
    );
  let started = 0;
  for (const r of rows) {
    const res = await startInstagramHistoryImport(r.organizationId);
    if (res.started) started++;
  }
  return started;
}
