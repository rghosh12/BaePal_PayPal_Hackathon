import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Agent tests require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"], planId: string;
let users: { id: string; token: string; csrf: string }[];
function request(user: number, method: string, path: string, payload: object = {}) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: "baepal=" + users[user].token,
      "x-csrf-token": users[user].csrf,
    },
    ...(method === "GET" ? {} : { payload }),
  });
}
async function prefs(user: number, budgetCents: number) {
  const start = new Date(Date.now() + 86400000),
    end = new Date(start.getTime() + 4 * 3600000);
  const r = await request(user, "PUT", `/date-plans/${planId}/private-preferences`, {
    budgetCents,
    activities: ["Coffee", "Art"],
    timeStart: start.toISOString(),
    timeEnd: end.toISOString(),
  });
  expect(r.statusCode).toBe(200);
}
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  for (let n = 0; n < 2; n++) {
    const user = { id: randomUUID(), token: randomUUID(), csrf: randomUUID() };
    users.push(user);
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [user.id, user.id + "@agent.test.invalid"],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(user.token), user.id, user.csrf],
    );
  }
  const mid = randomUUID();
  planId = randomUUID();
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, users[0].id, users[1].id],
  );
  for (const [id, activity, price] of [
    ["coffee", "Coffee", 1200],
    ["art", "Art", 3000],
  ] as const)
    await db.query(
      "INSERT INTO catalogue(id,title,activity,description,address,price_cents,duration_minutes,accessibility,policy) VALUES($1,$1,$2,'d','a',$3,60,'x','y')",
      [id, activity, price],
    );
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id) VALUES($1,$2,$3)",
    [planId, mid, users[0].id],
  );
  ({ app } = await buildApp());
});
afterEach(async () => {
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("AI date agent", () => {
  it("books only within both private budgets and leaves the partner's consent open", async () => {
    await prefs(0, 5000);
    await prefs(1, 2000);
    const r = await request(0, "POST", `/date-plans/${planId}/agent-book`);
    expect(r.statusCode).toBe(200);
    const result = r.json().data;
    expect(result.option.id).toBe("coffee");
    expect(JSON.stringify(result)).not.toMatch(/5000|2000|budget_encrypted/);
    const plan = (await request(1, "GET", `/date-plans/${planId}`)).json().data;
    expect(plan.status).toBe("proposed");
    expect(plan.acceptanceCount).toBe(1);
    expect(plan.acceptedByYou).toBe(false);
    expect(new Date(plan.proposal.starts_at).getTime()).toBeGreaterThan(Date.now());
  });
  it("refuses neutrally when nothing fits both budgets", async () => {
    await prefs(0, 5000);
    await prefs(1, 500);
    const r = await request(0, "POST", `/date-plans/${planId}/agent-book`);
    expect(r.statusCode).toBe(409);
    expect(r.body).not.toMatch(/500\b/);
  });
});
