import { googleApiGuard } from "@/server/dev/google-mock-api";
import { getGoogleMockState } from "@/server/dev/google-mock-state";
import {
  appendMockRow,
  forbidden,
  metaOf,
  notFound,
  parseRange,
} from "@/server/dev/google-mock-sheets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function lookup(id: string) {
  const sheet = getGoogleMockState().spreadsheets.get(id);
  if (!sheet) return { error: notFound() };
  if (!sheet.granted) return { error: forbidden() };
  return { sheet };
}

/** 034: GET metadatos (`/{id}`) o valores (`/{id}/values/{range}`). */
export async function GET(req: Request, ctx: Params) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const [id = "", kind, ...rest] = (await ctx.params).path.map((p) => decodeURIComponent(p));
  const found = lookup(id);
  if (found.error) return found.error;
  const sheet = found.sheet;
  if (!kind) return Response.json(metaOf(sheet));
  if (kind !== "values") return notFound();
  const { tab, fromRow, toRow } = parseRange(rest.join("/"));
  const rows = sheet.tabs[tab];
  if (!rows) {
    return Response.json(
      { error: { code: 400, message: `Unable to parse range: ${tab}`, status: "INVALID_ARGUMENT" } },
      { status: 400 }
    );
  }
  const slice = fromRow ? rows.slice(fromRow - 1, toRow ?? undefined) : rows;
  return Response.json({ range: rest.join("/"), majorDimension: "ROWS", values: slice });
}

/** 034: POST `/{id}/values/{range}:append`. */
export async function POST(req: Request, ctx: Params) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const [id = "", kind, ...rest] = (await ctx.params).path.map((p) => decodeURIComponent(p));
  const found = lookup(id);
  if (found.error) return found.error;
  const raw = rest.join("/");
  if (kind !== "values" || !raw.endsWith(":append")) return notFound();
  const { tab } = parseRange(raw.slice(0, -":append".length));
  if (!(tab in found.sheet.tabs)) {
    return Response.json(
      { error: { code: 400, message: `Unable to parse range: ${tab}`, status: "INVALID_ARGUMENT" } },
      { status: 400 }
    );
  }
  const state = getGoogleMockState();
  if (state.failNextAppend) {
    state.failNextAppend = false;
    return Response.json({ error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { values?: string[][] };
  const updatedRange = appendMockRow(found.sheet, tab, body.values ?? []);
  return Response.json({ spreadsheetId: id, updates: { updatedRange, updatedRows: 1 } });
}
