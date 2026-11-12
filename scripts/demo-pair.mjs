// Local/staging demo helper: two seeded fictional members like each other
// through the real API (same auth, CSRF and matching rules as the UI).
// Usage: node scripts/demo-pair.mjs [alex] [jordan]
// Env: API (default http://127.0.0.1:4000), APP_ORIGIN (default http://localhost:3000)
import { randomUUID } from "node:crypto";
const API = process.env.API || "http://127.0.0.1:4000";
const ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const [a = "alex", b = "jordan"] = process.argv.slice(2);

async function login(name) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      email: `${name}@demo.baepal.invalid`,
      password: "Demo-Only-2026!",
    }),
  });
  if (!r.ok) throw Error(`Login failed for ${name}: ${await r.text()}`);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const { data } = await r.json();
  const me = await (
    await fetch(`${API}/api/v1/me`, { headers: { Cookie: cookie } })
  ).json();
  return { name, cookie, csrf: data.csrf, id: me.data.id };
}
async function like(from, to) {
  const r = await fetch(`${API}/api/v1/decisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: from.cookie,
      "x-csrf-token": from.csrf,
    },
    body: JSON.stringify({
      targetId: to.id,
      action: "like",
      clientMutationId: randomUUID(),
    }),
  });
  const body = await r.json();
  if (!r.ok) throw Error(`${from.name} → ${to.name}: ${JSON.stringify(body)}`);
  return body.data;
}
const [x, y] = await Promise.all([login(a), login(b)]);
await like(x, y);
const result = await like(y, x);
console.log(
  result.match
    ? `Matched ${a} and ${b}. Open http://localhost:3000/chats as either member.`
    : `Likes saved; no new match (they may already be matched, blocked, or ineligible).`,
);
