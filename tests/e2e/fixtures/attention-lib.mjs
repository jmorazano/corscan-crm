export const BASE = "http://localhost:3000";
export async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const api = async (path, opts = {}) => {
    const r = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { cookie, origin: BASE, "content-type": "application/json", ...(opts.headers ?? {}) },
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  return { cookie, api };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
export function check(label, cond, extra) {
  if (cond) console.log(`  ✓ ${label}`);
  else { fails++; console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ""); }
}
export function done() { console.log(fails ? `\n${fails} FALLAS` : "\nTODO VERDE"); process.exitCode = fails ? 1 : 0; }
