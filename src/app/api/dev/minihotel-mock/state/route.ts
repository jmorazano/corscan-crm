import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import {
  DEFAULT_MINIHOTEL_KNOBS,
  miniHotelMockState,
  resetMiniHotelMock,
} from "../state";

export const dynamic = "force-dynamic";

/** Perillas del simulador de MiniHotel (028). Solo bajo el gate de mocks. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const knobsSchema = z
  .object({
    ipNotAuthorized: z.boolean().optional(),
    nextUnauthorized: z.boolean().optional(),
    failNext: z.boolean().optional(),
    garbageNext: z.boolean().optional(),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    soldOut: z
      .object({ from: z.string().regex(ISO), to: z.string().regex(ISO) })
      .nullable()
      .optional(),
    expectUser: z.string().max(128).nullable().optional(),
    clearCalls: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const blocked = mockGuard();
  if (blocked) return blocked;
  const state = miniHotelMockState();
  return Response.json({ knobs: state.knobs, calls: state.calls });
}

export async function POST(req: Request) {
  const blocked = mockGuard();
  if (blocked) return blocked;
  const parsed = knobsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "perillas inválidas" }, { status: 422 });
  const state = miniHotelMockState();
  const { clearCalls, ...knobs } = parsed.data;
  Object.assign(state.knobs, knobs);
  if (clearCalls) state.calls = [];
  return Response.json({ knobs: state.knobs, calls: state.calls });
}

export async function DELETE() {
  const blocked = mockGuard();
  if (blocked) return blocked;
  resetMiniHotelMock();
  return Response.json({ knobs: { ...DEFAULT_MINIHOTEL_KNOBS }, calls: [] });
}
