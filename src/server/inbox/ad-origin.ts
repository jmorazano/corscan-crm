import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { ConversationOrigin } from "@/lib/conversation-origin";
import {
  WA_AD_TAG,
  decideAdOrigin,
  whatsAppAdOrigin,
  type WhatsAppReferral,
} from "@/lib/whatsapp-ad-origin";
import { publish } from "@/server/events/bus";

/**
 * Origen de una conversación de WhatsApp que llegó por un anuncio
 * Click-to-WhatsApp (035). Mismo destino que el de Instagram (030,
 * `src/server/instagram/origin.ts`): `conversation.ig_origin` (contexto del
 * agente + lo que ve el equipo) y una etiqueta de la conversación
 * (filtrable en la Bandeja), con el aviso SSE para que la Bandeja se
 * refresque.
 *
 * Solo lo llama la ingesta de entrantes EN VIVO (`ingestInboundMessage`):
 * el historial y los ecos de coexistence (017) tienen su propio camino y
 * nunca marcan origen.
 */

/** Suma la etiqueta sin duplicarla (misma expresión que 030). */
function addTag(tag: string) {
  return sql`(select array(select distinct unnest(${schema.conversation.tags} || array[${tag}]::text[])))`;
}

/**
 * Última atribución: un anuncio nuevo reemplaza el origen; el mismo clic
 * reentregado por Meta o un clic más viejo que llega tarde no cambian nada.
 * Devuelve el origen aplicado, o `null` si no hizo nada.
 */
export async function applyWhatsAppAdOrigin(input: {
  organizationId: string;
  conversation: { id: string; isTest: boolean; igOrigin: ConversationOrigin | null };
  referral: WhatsAppReferral;
  at: Date;
}): Promise<ConversationOrigin | null> {
  const { organizationId, conversation } = input;
  // El sandbox (Laboratorio, Entrenador) no tiene anuncios: nunca se marca.
  if (conversation.isTest) return null;

  const origin = whatsAppAdOrigin(input.referral, input.at);
  if (decideAdOrigin(conversation.igOrigin ?? null, origin) !== "apply") return null;

  await getDb()
    .update(schema.conversation)
    .set({ igOrigin: origin, tags: addTag(WA_AD_TAG), updatedAt: new Date() })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversation.id),
        eq(schema.conversation.isTest, false)
      )
    );
  publish(organizationId, {
    type: "conversations.updated",
    data: { conversationIds: [conversation.id] },
  });
  return origin;
}
