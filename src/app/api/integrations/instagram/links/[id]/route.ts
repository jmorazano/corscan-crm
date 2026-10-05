import { z } from "zod";
import { withOwner } from "@/lib/api";
import { ENTRY_LINK_INSTRUCTION_MAX } from "@/lib/instagram/entry-links";
import { instagramConfigErrorResponse, validationError } from "@/server/instagram/api-errors";
import { deleteEntryLink, updateEntryLink } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const input = z.object({
  label: z.string().trim().min(1, "Poné un nombre").max(60),
  instruction: z
    .string()
    .trim()
    .max(ENTRY_LINK_INSTRUCTION_MAX)
    .nullable()
    .optional()
    .transform((s) => s || null),
});

/** 030: renombrar un link o cambiar su instrucción (el slug no cambia: ya se compartió). */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  try {
    await updateEntryLink(session.organizationId, id, parsed.data);
    return Response.json({ ok: true });
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});

export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  await deleteEntryLink(session.organizationId, id);
  return Response.json({ ok: true });
});
