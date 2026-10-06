import { apiError, withAuth } from "@/lib/api";
import {
  OUTBOUND_CAPTION_MAX,
  OUTBOUND_MAX_BYTES,
  validateOutboundFile,
} from "@/lib/outbound-media";
import { getConversation } from "@/server/inbox/queries";
import { channelOf, sendMedia } from "@/server/inbox/send-media";
import { SEND_ERROR_STATUS, SendError } from "@/server/inbox/send-error";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Holgura del multipart (boundary, encabezados, epígrafe) sobre el tope. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Adjunto del equipo a un cliente (026): multipart `file` (+ `caption`
 * opcional). Lo puede mandar cualquier miembro — enviar es operar. El tipo
 * lo decide la firma binaria contra la matriz del canal; el Entrenador
 * tiene su propia ruta (`/image`, `/audio`).
 *
 * 201 `{ messageId, captionError }`. Si el proveedor rechaza el archivo
 * DESPUÉS de guardarlo, el error trae `messageId`: el mensaje quedó en el
 * hilo como «No entregado» con Reintentar.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  // El Entrenador tiene su propio clip (imagen/audio para el agente).
  if (row.conversation.kind === "trainer") {
    return apiError(
      409,
      "not_channel",
      "La conversación con tu agente no manda archivos a clientes: usá su propio clip para imágenes y audios"
    );
  }
  if (row.conversation.isTest) {
    return apiError(
      403,
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }
  const channel = channelOf(row.conversation.kind);
  if (!channel) {
    return apiError(
      409,
      "not_channel",
      "Esta conversación no admite adjuntos para clientes"
    );
  }

  // Corte temprano ANTES de leer el cuerpo: `formData()` lo materializa
  // entero en memoria.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > OUTBOUND_MAX_BYTES + MULTIPART_OVERHEAD) {
    return apiError(413, "too_large", "El archivo supera el máximo de 25 MB");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid", "Se esperaba multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo");
  if (file.size === 0) return apiError(422, "empty", "El archivo está vacío");
  if (file.size > OUTBOUND_MAX_BYTES) {
    return apiError(413, "too_large", "El archivo supera el máximo de 25 MB");
  }
  const captionRaw = form.get("caption");
  const caption =
    typeof captionRaw === "string" && captionRaw.trim()
      ? captionRaw.trim().slice(0, OUTBOUND_CAPTION_MAX)
      : null;

  // 027: nota de voz grabada en la Bandeja (duración del grabador).
  const voice = form.get("voice") === "1";
  const durationRaw = Number(form.get("durationMs"));
  const durationMs =
    voice && Number.isInteger(durationRaw) && durationRaw > 0 && durationRaw <= 10 * 60 * 1000
      ? durationRaw
      : null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = validateOutboundFile(bytes, file.name, channel);
  if (!valid.ok) return apiError(valid.status, valid.code, valid.error);
  if (voice && valid.kind !== "audio") {
    return apiError(422, "invalid", "Una nota de voz tiene que ser un audio");
  }

  try {
    const result = await sendMedia({
      organizationId: session.organizationId,
      conversationId: id,
      sentByUserId: session.userId,
      file: {
        bytes,
        kind: valid.kind,
        mime: valid.mime,
        fileName: valid.fileName,
        voice,
        durationMs,
      },
      caption,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(
        SEND_ERROR_STATUS[err.code],
        err.code,
        err.message,
        err.messageId ? { messageId: err.messageId } : undefined
      );
    }
    throw err;
  }
});
