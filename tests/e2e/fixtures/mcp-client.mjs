#!/usr/bin/env node
/**
 * Cliente MCP de prueba (040, tasks T018). Sin dependencias: hace lo mismo
 * que un conector personalizado de Claude — descubrimiento, registro
 * dinámico, autorización con PKCE (el consentimiento se completa en un
 * navegador), canje, JSON-RPC, renovación y revocación — y verifica las
 * respuestas.
 *
 *   node tests/e2e/fixtures/mcp-client.mjs <comando> [--base URL] [--state FILE]
 *
 * Comandos:
 *   connect [--reuse-code]  registro + URL de autorización (la imprime y la
 *                    deja en <state>.url) + espera el código en un loopback +
 *                    canje → guarda tokens en --state. Con --reuse-code además
 *                    reusa el código y verifica que eso cierra la conexión.
 *   read             US4/US5: conversaciones, mensajes, contactos, pipeline y
 *                    actividad del agente (sembrar antes con seed-assistant.mjs)
 *   tools [--expect FILE.json]   initialize + tools/list + llama todas las
 *                    herramientas del MVP; con --expect compara cifras
 *   call NAME [JSON] llama una herramienta con esos argumentos
 *   refresh          renueva y guarda; prueba que el refresh viejo ya no sirve
 *                    y que reusarlo CIERRA la conexión
 *   unhappy          caminos infelices que no necesitan navegador
 *   ratelimit        61 tools/call seguidas → la última es «demasiadas»
 *   revoke           RFC 7009 con el refresh guardado
 *
 * Sale con código ≠ 0 ante cualquier diferencia.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = flag("base", "http://localhost:3000").replace(/\/+$/, "");
const STATE = flag("state", ".mcp-client-state.json");
const RESOURCE = `${BASE}/api/mcp`;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
}

async function form(url, fields) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, body: await json(res), headers: res.headers };
}

let rpcId = 1;
async function rpc(token, method, params) {
  const isNotification = method.startsWith("notifications/");
  const res = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(isNotification ? {} : { id: rpcId++ }),
      method,
      ...(params ? { params } : {}),
    }),
  });
  return { status: res.status, body: res.status === 202 ? null : await json(res), headers: res.headers };
}

async function callTool(token, name, toolArgs = {}) {
  const r = await rpc(token, "tools/call", { name, arguments: toolArgs });
  const result = r.body?.result;
  return { status: r.status, result, data: result?.structuredContent, text: result?.content?.[0]?.text };
}

// ------------------------------------------------------------------ connect

async function discover() {
  const unauth = await fetch(RESOURCE, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const www = unauth.headers.get("www-authenticate") ?? "";
  check("401 sin token", unauth.status === 401, unauth.status);
  const m = /resource_metadata="([^"]+)"/.exec(www);
  check("WWW-Authenticate con resource_metadata", Boolean(m), www);
  const prm = await json(await fetch(m ? m[1] : `${BASE}/.well-known/oauth-protected-resource/api/mcp`));
  check("metadatos del recurso", prm.resource === RESOURCE, prm);
  const as = await json(await fetch(`${prm.authorization_servers?.[0] ?? BASE}/.well-known/oauth-authorization-server`));
  check("metadatos del servidor de autorización", as.code_challenge_methods_supported?.includes("S256"), as);
  return as;
}

async function connect() {
  console.log("connect");
  const as = await discover();
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const reg = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Cliente de prueba E2E", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  });
  const client = await json(reg);
  check("registro 201", reg.status === 201, client);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const url = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: RESOURCE,
  })) url.searchParams.set(k, v);
  writeFileSync(`${STATE}.url`, url.toString());
  console.log(`AUTHORIZE_URL ${url.toString()}`);
  const received = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Number(flag("timeout", "600")) * 1000);
    server.on("request", (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<p>Listo, podés cerrar esta pestaña.</p>");
      clearTimeout(timer);
      resolve(Object.fromEntries(u.searchParams));
    });
  });
  server.close();
  if (!received || received.error) {
    check("consentimiento aceptado", false, received ?? "timeout");
    saveState({ ...loadState(), lastError: received ?? "timeout" });
    return;
  }
  check("state devuelto igual", received.state === state, received);
  const tok = await form(as.token_endpoint, {
    grant_type: "authorization_code",
    code: received.code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  check("canje 200", tok.status === 200 && tok.body.access_token?.startsWith("vat_"), tok.body);
  check("no-store en el token", (tok.headers.get("cache-control") ?? "").includes("no-store"));
  saveState({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    access_token: tok.body.access_token,
    refresh_token: tok.body.refresh_token,
  });
  if (args.includes("--reuse-code")) {
    const again = await form(as.token_endpoint, {
      grant_type: "authorization_code",
      code: received.code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
    });
    check("código reusado → invalid_grant", again.status === 400 && again.body.error === "invalid_grant", again.body);
    const after = await rpc(tok.body.access_token, "ping");
    check("reusar el código cierra la conexión emitida con él", after.status === 401, after.status);
  }
}

// -------------------------------------------------------------------- tools

async function tools() {
  const s = loadState();
  console.log("tools");
  const init = await rpc(s.access_token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  check("initialize", init.body?.result?.serverInfo?.name === "vocero-crm", init.body);
  check("instrucciones en castellano", /solo lectura/i.test(init.body?.result?.instructions ?? ""));
  const note = await rpc(s.access_token, "notifications/initialized");
  check("notificación → 202", note.status === 202, note.status);
  const list = await rpc(s.access_token, "tools/list");
  const names = (list.body?.result?.tools ?? []).map((t) => t.name);
  check("tools/list", names.includes("get_campaign") && names.includes("list_workspaces"), names);

  const ws = await callTool(s.access_token, "list_workspaces");
  check("list_workspaces", Array.isArray(ws.data?.workspaces), ws.text);
  console.log(`    empresas: ${JSON.stringify(ws.data?.workspaces?.map((w) => [w.name, w.active, w.inactive_reason]))}`);
  const active = ws.data?.workspaces?.find((w) => w.active);
  const out = { workspaces: ws.data?.workspaces };
  if (!active) {
    check("hay una empresa activa", false);
  } else {
    const wsArg = { workspace: active.id };
    for (const period of ["last_30_days", "last_12_weeks", "last_12_months", "this_week", "last_month"]) {
      const r = await callTool(s.access_token, "get_message_metrics", { ...wsArg, period });
      check(`get_message_metrics ${period}`, r.result && !r.result.isError && typeof r.data?.received?.total === "number", r.text);
      out[`metrics_${period}`] = r.data;
    }
    const custom = await callTool(s.access_token, "get_message_metrics", { ...wsArg, from: "2026-10-01", to: "2026-10-15" });
    check("rango propio", custom.data?.period?.from === "2026-10-01", custom.text);
    const badRange = await callTool(s.access_token, "get_message_metrics", { ...wsArg, from: "2026-10-15", to: "2026-10-01" });
    check("rango al revés → isError", badRange.result?.isError === true && /anterior/.test(badRange.text), badRange.text);
    const badArg = await callTool(s.access_token, "get_message_metrics", { ...wsArg, period: "ayer" });
    check("argumento inválido → isError", badArg.result?.isError === true && /period/.test(badArg.text), badArg.text);
    const origins = await callTool(s.access_token, "get_conversation_origins", wsArg);
    check("get_conversation_origins", Array.isArray(origins.data?.origins), origins.text);
    out.origins = origins.data;
    const campaigns = await callTool(s.access_token, "list_campaigns", wsArg);
    check("list_campaigns", Array.isArray(campaigns.data?.campaigns), campaigns.text);
    out.campaigns = campaigns.data;
    const first = campaigns.data?.campaigns?.find((c) => c.status !== "draft") ?? campaigns.data?.campaigns?.[0];
    if (first) {
      const detail = await callTool(s.access_token, "get_campaign", { ...wsArg, campaign_id: first.id, recipients: "all", limit: 5 });
      check("get_campaign", typeof detail.data?.counts?.reached === "number", detail.text);
      check("get_campaign == list (mismas cifras)", JSON.stringify(detail.data?.counts?.sent) === JSON.stringify(first.counts.sent));
      out.campaign = detail.data;
    }
    const missing = await callTool(s.access_token, "get_campaign", { ...wsArg, campaign_id: "cmp_noexiste" });
    check("campaña inexistente → isError", missing.result?.isError === true, missing.text);
    const unknown = await callTool(s.access_token, "get_message_metrics", { workspace: "org_otra_empresa" });
    check("empresa no autorizada → isError", unknown.result?.isError === true && /No tengo acceso/.test(unknown.text), unknown.text);
    for (const inactive of ws.data.workspaces.filter((w) => !w.active)) {
      const r = await callTool(s.access_token, "get_message_metrics", { workspace: inactive.id });
      check(`empresa inactiva (${inactive.inactive_reason}) → isError`, r.result?.isError === true, r.text);
    }
  }
  const unknownTool = await rpc(s.access_token, "tools/call", { name: "send_message", arguments: {} });
  check("herramienta inexistente → error JSON-RPC", unknownTool.body?.error?.code === -32602, unknownTool.body);
  writeFileSync(`${STATE}.tools.json`, JSON.stringify(out, null, 2));

  const expectFile = flag("expect", null);
  if (expectFile && active) {
    const expected = JSON.parse(readFileSync(expectFile, "utf8"));
    for (const [path, value] of Object.entries(expected)) {
      const got = path.split(".").reduce((o, k) => (o == null ? o : o[k]), out);
      check(`cifra ${path} = ${JSON.stringify(value)}`, JSON.stringify(got) === JSON.stringify(value), got);
    }
  }
}

async function call() {
  const s = loadState();
  const name = args[1];
  const toolArgs = args[2] && !args[2].startsWith("--") ? JSON.parse(args[2]) : {};
  const r = await callTool(s.access_token, name, toolArgs);
  console.log(JSON.stringify(r.result ?? r, null, 2));
}

// ------------------------------------------------------------------ refresh

async function refresh() {
  console.log("refresh");
  const s = loadState();
  const tokenUrl = `${BASE}/api/oauth/token`;
  const r1 = await form(tokenUrl, { grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: s.client_id });
  check("renovación 200", r1.status === 200 && r1.body.refresh_token !== s.refresh_token, r1.body);
  const ok = await rpc(r1.body.access_token, "ping");
  check("el access nuevo sirve", ok.status === 200, ok.status);
  saveState({ ...s, access_token: r1.body.access_token, refresh_token: r1.body.refresh_token, old_refresh: s.refresh_token });
  if (args.includes("--reuse")) {
    const reuse = await form(tokenUrl, { grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: s.client_id });
    check("reusar el refresh viejo → invalid_grant", reuse.status === 400 && reuse.body.error === "invalid_grant", reuse.body);
    const dead = await rpc(r1.body.access_token, "ping");
    check("y la conexión quedó cerrada", dead.status === 401, dead.status);
  }
}

// ------------------------------------------------------------------ unhappy

async function unhappy() {
  console.log("unhappy");
  const get = await fetch(RESOURCE);
  check("GET /api/mcp → 405", get.status === 405 && get.headers.get("allow") === "POST", get.status);
  const badToken = await rpc("vat_" + "x".repeat(43), "ping");
  check("token inventado → 401", badToken.status === 401 && /error="invalid_token"/.test(badToken.headers.get("www-authenticate") ?? ""), badToken.status);
  const regBad = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://evil.example.com/cb"] }),
  });
  const regBadBody = await json(regBad);
  check("registro con retorno ajeno → invalid_redirect_uri", regBad.status === 400 && regBadBody.error === "invalid_redirect_uri", regBadBody);
  const regConf = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:9/cb"], token_endpoint_auth_method: "client_secret_basic" }),
  });
  check("cliente confidencial → 400", regConf.status === 400);
  const page = await fetch(`${BASE}/oauth/authorize?client_id=acl_noexiste&redirect_uri=https%3A%2F%2Fevil.example.com%2Fcb&response_type=code`, { redirect: "manual" });
  const html = await page.text();
  check("authorize con cliente desconocido → página de error, sin redirigir", page.status === 200 && html.includes("No se puede conectar"), page.status);
  const s = loadState();
  if (s.client_id) {
    const wrongRedirect = await fetch(
      `${BASE}/oauth/authorize?client_id=${s.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&response_type=code`,
      { redirect: "manual" }
    );
    const h2 = await wrongRedirect.text();
    check("retorno no registrado → error sin redirigir", wrongRedirect.status === 200 && h2.includes("No se puede conectar"), wrongRedirect.status);
    const noPkce = await fetch(
      `${BASE}/oauth/authorize?client_id=${s.client_id}&redirect_uri=${encodeURIComponent(s.redirect_uri)}&response_type=code&state=zz`,
      { redirect: "manual" }
    );
    const loc = noPkce.headers.get("location") ?? "";
    check("sin PKCE → vuelve al cliente con error", noPkce.status >= 300 && noPkce.status < 400 && loc.includes("error=invalid_request") && loc.includes("state=zz"), [noPkce.status, loc]);
  }
  const tokBad = await form(`${BASE}/api/oauth/token`, { grant_type: "password", username: "a", password: "b" });
  check("grant_type no soportado", tokBad.body.error === "unsupported_grant_type", tokBad.body);
  const tokClient = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: "vrt_x", client_id: "acl_noexiste" });
  check("cliente desconocido en token → 401 invalid_client", tokClient.status === 401 && tokClient.body.error === "invalid_client", tokClient.body);
  const consentCsrf = await fetch(`${BASE}/api/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example.com" },
    body: "{}",
  });
  check("POST del consentimiento sin sesión/origen → rechazado", consentCsrf.status === 401 || consentCsrf.status === 403, consentCsrf.status);
}

async function ratelimit() {
  console.log("ratelimit");
  const s = loadState();
  let last;
  for (let i = 0; i < 61; i++) last = await callTool(s.access_token, "list_workspaces");
  check("la llamada 61 en un minuto → «demasiadas consultas»", last.result?.isError === true && /Demasiadas/.test(last.text), last.text);
}

async function revoke() {
  console.log("revoke");
  const s = loadState();
  const r = await form(`${BASE}/api/oauth/revoke`, { token: s.refresh_token, client_id: s.client_id });
  check("revoke 200", r.status === 200);
  const dead = await rpc(s.access_token, "ping");
  check("después de revocar → 401", dead.status === 401, dead.status);
}

async function status() {
  const s = loadState();
  const r = await rpc(s.access_token, "ping");
  console.log(`STATUS ${r.status}`);
  const expected = flag("expect-status", null);
  if (expected) check(`ping → ${expected}`, String(r.status) === expected, r.status);
}

// --------------------------------------------------------- US4 / US5 (§E–F)
// Requiere `node tests/e2e/fixtures/seed-assistant.mjs` antes.

async function readTools() {
  console.log("read");
  const s = loadState();
  const t = (name, a) => callTool(s.access_token, name, { workspace: "principal", ...a });

  const tagged = await t("search_conversations", { tags: ["e2e-040"] });
  const inj = tagged.data?.conversations?.[0];
  check("search_conversations por etiqueta → el chat sembrado", tagged.data?.total_matching === 1 && inj?.id === "cv_a40_inj", tagged.text);
  check("trae etapa, IA pausada y atención humana", inj?.stage === "Interesado" && inj?.ai?.enabled === false && inj?.ai?.handoff === true, inj);
  check("aviso de contenido de terceros", typeof tagged.data?.aviso_contenido_de_terceros === "string");
  const human = await t("search_conversations", { handoff: true, ai_paused: true });
  check("filtro atención humana + IA pausada", human.data?.conversations?.some((c) => c.id === "cv_a40_inj"), human.text);
  const byStage = await t("search_conversations", { stage: "interesado" });
  check("filtro por etapa (sin mayúsculas)", byStage.data?.conversations?.some((c) => c.id === "cv_a40_inj"), byStage.text);
  const badStage = await t("search_conversations", { stage: "Inexistente" });
  check("etapa inexistente → isError con la lista", badStage.result?.isError === true && /Etapas:/.test(badStage.text), badStage.text);
  const page1 = await t("search_conversations", { limit: 2 });
  const page2 = await t("search_conversations", { limit: 2, cursor: page1.data?.next_cursor });
  check("paginación de conversaciones sin repetir", page1.data?.next_cursor && page2.data?.conversations?.[0]?.id !== page1.data?.conversations?.[1]?.id, [page1.data?.next_cursor]);

  const price = await t("search_messages", { text: "precio", direction: "inbound" });
  const hit = price.data?.matches?.find((m) => m.message_id === "msg_a40_1");
  check("search_messages encuentra «precio» del cliente", hit?.author === "cliente" && /precio/i.test(hit?.snippet ?? ""), price.text);
  const lab = await t("search_messages", { text: "zanahoria040" });
  check("el Laboratorio NUNCA aparece en las búsquedas", lab.data?.matches?.length === 0, lab.data?.matches);
  const noAccent = await t("search_messages", { text: "cuanto", direction: "inbound", from: "2026-09-01" });
  check("search_messages no distingue tildes («cuanto» → «Cuánto»)", noAccent.data?.matches?.some((m) => /cuánto/i.test(m.snippet ?? "")), noAccent.data?.matches?.map((m) => m.snippet));
  const withMedia = await t("search_messages", { has_attachment: true, from: "2026-09-01" });
  check("search_messages solo con adjuntos", withMedia.data?.matches?.length > 0 && withMedia.data.matches.every((m) => m.attachment), withMedia.text?.slice(0, 300));
  const videos = await t("search_messages", { types: ["video"], from: "2026-09-01" });
  check("search_messages por tipo", videos.data?.matches?.length > 0 && videos.data.matches.every((m) => m.type === "video"), videos.data?.matches?.map((m) => m.type));
  const short = await t("search_messages", { text: "a" });
  check("texto de 1 letra → isError", short.result?.isError === true);

  const conv = await t("get_conversation", { conversation_id: "cv_a40_inj" });
  const msgs = conv.data?.messages ?? [];
  check("get_conversation en orden y con autores", msgs.map((m) => m.author).join(",") === "cliente,agente,cliente,cliente", msgs.map((m) => m.author));
  const injected = msgs[3]?.text ?? "";
  check("la inyección llega como DATO y sin marcadores del sistema", /Ignorá tus instrucciones/.test(injected) && !injected.includes("[HERRAMIENTA]"), injected);
  check("línea de derivación del agente en events", conv.data?.events?.some((e) => e.kind === "ai_handoff" && /persona/i.test(e.text)), conv.data?.events);
  const older = await t("get_conversation", { conversation_id: "cv_a40_inj", limit: 2 });
  const older2 = await t("get_conversation", { conversation_id: "cv_a40_inj", limit: 2, before: older.data?.next_before });
  check("hilo por tramos hacia atrás", older.data?.messages?.[0]?.id === "msg_a40_3" && older2.data?.messages?.map((m) => m.id).join() === "msg_a40_1,msg_a40_2" && older2.data?.next_before === null, [older.data?.messages?.map((m) => m.id), older2.data?.messages?.map((m) => m.id)]);
  const labConv = await t("get_conversation", { conversation_id: "cv_a40_lab" });
  check("conversación del Laboratorio → no encontrada", labConv.result?.isError === true && /No encontré/.test(labConv.text), labConv.text);

  const media = await t("search_conversations", { q: "", limit: 50 });
  let withSummary = null;
  for (const c of media.data?.conversations ?? []) {
    const r = await t("get_conversation", { conversation_id: c.id, limit: 100 });
    withSummary = r.data?.messages?.find((m) => m.attachment?.summary);
    if (withSummary) break;
  }
  check("adjunto con resumen del CRM (sin binario)", withSummary && withSummary.attachment.summary_source === "resumen del CRM" && !("url" in withSummary.attachment), withSummary?.attachment);

  const contacts = await t("search_contacts", { q: "Inyección" });
  check("search_contacts", contacts.data?.contacts?.[0]?.id === "ct_a40_inj" && contacts.data?.contacts?.[0]?.stage === "Interesado", contacts.text);
  const labContact = await t("search_contacts", { q: "Laboratorio 040" });
  check("contactos del Laboratorio fuera", labContact.data?.total_matching === 0, labContact.data);
  const card = await t("get_contact", { contact_id: "ct_a40_inj" });
  check("get_contact con conversaciones", card.data?.contact?.tags?.includes("e2e-040") && card.data?.conversations?.length === 1, card.text);
  const labCard = await t("get_contact", { contact_id: "ct_a40_lab" });
  check("ficha del Laboratorio → no encontrada", labCard.result?.isError === true);

  const pipe = await t("get_pipeline", {});
  const interesado = pipe.data?.stages?.find((x) => x.name === "Interesado");
  check("get_pipeline con etapas y cantidades", interesado && interesado.leads >= 1 && pipe.data.stages.some((x) => x.kind === "lost"), pipe.data?.stages);
  const stageLeads = await t("get_pipeline", { stage: "Interesado" });
  check("leads de la etapa", stageLeads.data?.leads?.some((l) => l.contact.id === "ct_a40_inj" && l.conversation_id === "cv_a40_inj"), stageLeads.text);

  const act = await t("get_agent_activity", { period: "today", list: true });
  check("get_agent_activity cuenta derivaciones", (act.data?.counts?.ai_handoff ?? 0) >= 1, act.data?.counts);
  check("y lista el evento con su texto", act.data?.events?.some((e) => e.conversation_id === "cv_a40_inj" && e.kind === "ai_handoff" && e.text), act.data?.events?.slice(0, 2));
}

const COMMANDS = { connect, read: readTools, tools, call, refresh, unhappy, ratelimit, revoke, status };

async function main() {
  const fn = COMMANDS[command];
  if (!fn) {
    console.log("Comandos: connect [--reuse-code] | tools | read | call | refresh [--reuse] | unhappy | ratelimit | revoke | status");
    process.exit(2);
  }
  await fn();
  console.log(failures === 0 ? "OK" : `FALLAS: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
