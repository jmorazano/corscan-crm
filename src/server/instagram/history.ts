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

    // Diagnóstico para el log (sin datos personales: solo conteos y forma).
    const diag = {
      pages: 0,
      listed: 0,
      outOfWindow: 0,
      noCustomer: 0,
      participantShapes: [] as string[],
      readErrors: 0,
      rawMessages: 0,
      withDate: 0,
      withFrom: 0,
      withText: 0,
      rows: 0,
      /** Antigüedad (días) de la conversación que cortó por ventana. */
      outOfWindowDays: null as number | null,
    };

    let after: string | null = null;
    let seen = 0;
    pages: do {
      const page = await listInstagramConversations(integration.token, { after, limit: 25 });
      diag.pages += 1;
      diag.listed += page.conversations.length;
      for (const conv of page.conversations) {
        if (++seen > INSTAGRAM_HISTORY_MAX_CONVERSATIONS) break pages;
        const updated = parseMetaTime(conv.updatedTime);
        // Vienen de la más reciente a la más vieja: la primera fuera de la
        // ventana corta todo el recorrido.
        if (updated && updated.getTime() < oldest) {
          diag.outOfWindow += 1;
          diag.outOfWindowDays = Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
          break pages;
        }

        const customer = customerOf(conv.participants, integration);
        if (!customer) {
          diag.noCustomer += 1;
          if (diag.participantShapes.length < 3) {
            diag.participantShapes.push(
              `${conv.participants.length} part.; cuenta_por_id=${conv.participants.some((p) => p.id === integration.igUserId)}; cuenta_por_usuario=${conv.participants.some((p) => !!integration.username && p.username?.toLowerCase() === integration.username.toLowerCase())}; con_usuario=${conv.participants.filter((p) => p.username).length}`
            );
          }
          continue;
        }

        let raw;
        try {
          raw = await getInstagramConversationMessages(integration.token, conv.id);
        } catch (err) {
          diag.readErrors += 1;
          console.warn(
            `[instagram] historial: no se pudo leer una conversación:`,
            err instanceof Error ? err.message : err
          );
          continue;
        }
        diag.rawMessages += raw.length;
        diag.withDate += raw.filter((m) => m.createdTime).length;
        diag.withFrom += raw.filter((m) => m.from).length;
        diag.withText += raw.filter((m) => m.text).length;
        const rows = raw
          .map((m) => mapInstagramHistoryMessage(m, { customerId: customer.id, days, now }))
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => a.at.getTime() - b.at.getTime());
        diag.rows += rows.length;
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

    console.log(
      `[instagram] historial de ${organizationId}: páginas=${diag.pages} listadas=${diag.listed} ` +
        `fuera_de_ventana=${diag.outOfWindow}${diag.outOfWindowDays !== null ? ` (${diag.outOfWindowDays} días)` : ""} sin_cliente=${diag.noCustomer} errores_lectura=${diag.readErrors} ` +
        `mensajes_crudos=${diag.rawMessages} con_fecha=${diag.withDate} con_from=${diag.withFrom} ` +
        `con_texto=${diag.withText} filas=${diag.rows} importados=${messages}` +
        (diag.participantShapes.length ? ` | participantes: ${diag.participantShapes.join(" / ")}` : "")
    );

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
        // Con cero importado, `history_error` lleva una NOTA que explica por
        // qué (no es un error): la UI la muestra bajo el resumen.
        historyError: totals.messages === 0 ? emptyImportNote(diag, days) : null,
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

/**
 * Por qué una importación terminó en cero, en castellano (sin datos
 * personales). La causa típica antes del App Review: con acceso estándar
 * Instagram devuelve solo algunas conversaciones.
 */
export function emptyImportNote(
  diag: { listed: number; outOfWindow: number; outOfWindowDays: number | null; noCustomer: number; rows: number },
  days: number
): string {
  if (diag.listed === 0) {
    return "Instagram no devolvió conversaciones. Mientras Meta no apruebe el acceso avanzado de la app, solo entrega algunas.";
  }
  const listed = diag.listed === 1 ? "1 conversación" : `${diag.listed} conversaciones`;
  if (diag.outOfWindow > 0 && diag.rows === 0 && diag.noCustomer === 0) {
    return `Instagram devolvió ${listed}, sin actividad en los últimos ${days} días${diag.outOfWindowDays !== null ? ` (la más reciente, hace ${diag.outOfWindowDays} días)` : ""}. Mientras Meta no apruebe el acceso avanzado de la app, solo entrega algunas conversaciones.`;
  }
  return `Instagram devolvió ${listed}, pero ninguna con mensajes para importar.`;
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
