import { mockGuard } from "@/lib/dev-guard";
import { parseXml } from "@/lib/minihotel";
import { toLocalParts } from "@/lib/time";
import { ariError, handleAri, handleContent, type MockReply } from "../engine";
import { miniHotelMockState, recordMiniHotelCall, type MiniHotelMockCall } from "../state";

export const dynamic = "force-dynamic";

/**
 * Simulador de MiniHotel (028) para el self-test: la API ARI en `…/gds` y la
 * de contenido en `…/agents/ws/settings/rooms/RoomsMain.asmx/{op}`, igual que
 * el proveedor, para que la regla de `contentUrlFor` apunte acá sola.
 * 404 incondicional en producción (`mockGuard`), como todos los mocks.
 */

function reply(r: MockReply): Response {
  return new Response(r.body, { status: r.status, headers: { "content-type": r.contentType } });
}

function html(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function todayLocal(): string {
  const p = toLocalParts("America/Argentina/Cordoba", new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function record(op: MiniHotelMockCall["op"], meta: Record<string, unknown>): void {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  recordMiniHotelCall({
    at: new Date().toISOString(),
    op,
    user: str(meta.user),
    hotel: str(meta.hotel),
    from: str(meta.from),
    to: str(meta.to),
    adults: num(meta.adults),
    children: num(meta.children),
    babies: num(meta.babies),
    rateCode: str(meta.rateCode),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const blocked = mockGuard();
  if (blocked) return blocked;

  const { path } = await ctx.params;
  const last = path[path.length - 1] ?? "";
  const isAri = last.toLowerCase() === "gds";
  const contentOp = last === "getRoomTypes" || last === "getRooms" ? last : null;
  if (!isAri && !contentOp) return new Response("not found", { status: 404 });

  const knobs = miniHotelMockState().knobs;

  // Igual que el sandbox real (verificado 1-oct-2026): sin XML, 500 de ASP.NET.
  if (!/xml/i.test(req.headers.get("content-type") ?? "")) {
    return html(
      500,
      "<!DOCTYPE html><html><head><title>A potentially dangerous Request.Form value was detected from the client</title></head><body></body></html>"
    );
  }
  if (knobs.delayMs > 0) await new Promise((r) => setTimeout(r, Math.min(knobs.delayMs, 60_000)));
  if (knobs.failNext) {
    knobs.failNext = false;
    record("unknown", {});
    return html(500, "<!DOCTYPE html><html><body>Service Unavailable</body></html>");
  }
  if (knobs.garbageNext) {
    knobs.garbageNext = false;
    record("unknown", {});
    return html(200, "<!DOCTYPE html><html><body>Runtime Error</body></html>");
  }

  let doc;
  try {
    doc = parseXml(await req.text());
  } catch {
    return reply(ariError("001", "Invalid XML"));
  }

  if (knobs.ipNotAuthorized) {
    record(isAri ? "immediate" : contentOp!, {});
    return isAri
      ? reply(ariError("A01", "IP address is not authorized"))
      : reply({
          status: 200,
          contentType: "text/xml; charset=utf-8",
          body: '<Response><Errors><Error code="401" description="IP address is not authorized" /></Errors></Response>',
        });
  }
  if (knobs.nextUnauthorized) {
    knobs.nextUnauthorized = false;
    record(isAri ? "immediate" : contentOp!, {});
    return isAri
      ? reply(ariError("863", "Wrong User Code (Gds Central)"))
      : reply({
          status: 200,
          contentType: "text/xml; charset=utf-8",
          body: '<Response><Errors><Error code="012" description="Wrong user name or password" /></Errors></Response>',
        });
  }

  if (isAri) {
    const r = handleAri(doc, knobs, todayLocal());
    record(r.op, r.meta);
    return reply(r.reply);
  }
  const r = handleContent(doc, contentOp!, knobs);
  record(contentOp!, r.meta);
  return reply(r.reply);
}
