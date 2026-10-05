import { z } from "zod";
import { withOwner } from "@/lib/api";
import { MAX_MODERATION_WORDS, parseWordList } from "@/lib/instagram/comments";
import { validationError } from "@/server/instagram/api-errors";
import { saveModerationWords } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

const input = z.object({ words: z.union([z.string(), z.array(z.string())]) });

/** 030 (US2): palabras que ocultan un comentario. Vacío = sin moderación. */
export const PUT = withOwner(async (session, req: Request) => {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  const words = parseWordList(parsed.data.words, MAX_MODERATION_WORDS);
  await saveModerationWords(session.organizationId, words);
  return Response.json({ words });
});
