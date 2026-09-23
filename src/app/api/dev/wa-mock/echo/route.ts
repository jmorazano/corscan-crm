import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { deliverToWebhook } from "@/server/dev/wa-mock-inbound";
import { buildEchoPayload } from "@/server/dev/wa-mock-history";

export const dynamic = "force-dynamic";

const schema = z.object({
  phoneNumberId: z.string().min(1),
  to: z.string().min(5),
  text: z.string().min(1),
  waMessageId: z.string().optional(),
});

/** 017: simula un mensaje que el negocio mandó desde la app del celular. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const res = await deliverToWebhook(
    buildEchoPayload({ ...body.data, wabaId: creds?.wabaId ?? "WABA-MOCK" })
  );
  if (!res.ok) return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  return Response.json({ delivered: true });
}
