// Local/staging demo helper: matches Alex & Jordan (if needed) and walks a
// date plan to "both accepted" through the real API, so the no-show hold and
// PayPal checkout can be shown immediately.
// Usage: node scripts/demo-date.mjs [optionId=coffee]
// Env: API (default http://127.0.0.1:4000), APP_ORIGIN (default http://localhost:3000)
import { randomUUID } from "node:crypto";
const API = process.env.API || "http://127.0.0.1:4000";
const ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const optionId = process.argv[2] || "coffee";

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
  const s = { name, cookie, csrf: data.csrf };
  s.id = (await call(s, "GET", "/me")).id;
  return s;
}
async function call(s, method, path, body) {
  const r = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: s.cookie,
      ...(s.csrf ? { "x-csrf-token": s.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw Error(`${s.name} ${method} ${path}: ${JSON.stringify(json)}`);
  return json.data;
}
const [alex, jordan] = await Promise.all([login("alex"), login("jordan")]);
let match = (await call(alex, "GET", "/matches")).find((m) =>
  JSON.stringify(m).includes(jordan.id),
);
if (!match) {
  for (const [a, b] of [
    [alex, jordan],
    [jordan, alex],
  ])
    await call(a, "POST", "/decisions", {
      targetId: b.id,
      action: "like",
      clientMutationId: randomUUID(),
    });
  match = (await call(alex, "GET", "/matches")).find((m) =>
    JSON.stringify(m).includes(jordan.id),
  );
}
const plan = await call(alex, "POST", "/date-plans", { matchId: match.id });
const start = new Date(Date.now() + 2 * 86400000);
start.setUTCHours(1, 0, 0, 0);
const end = new Date(start.getTime() + 6 * 3600000);
for (const [s, budget] of [
  [alex, 4000],
  [jordan, 3000],
])
  await call(s, "PUT", `/date-plans/${plan.id}/private-preferences`, {
    budgetCents: budget,
    activities: ["Coffee", "Art", "Books", "Music", "Food", "Hiking"],
    timeStart: start.toISOString(),
    timeEnd: end.toISOString(),
  });
await call(alex, "POST", `/date-plans/${plan.id}/proposals`, {
  optionId,
  startsAt: start.toISOString(),
  expectedVersion: 0,
});
for (const s of [alex, jordan])
  await call(s, "POST", `/date-plans/${plan.id}/accept`, { proposalVersion: 1 });
console.log(
  `Alex & Jordan both accepted "${optionId}". Open ${ORIGIN}/dates/${plan.id} as either member.`,
);
