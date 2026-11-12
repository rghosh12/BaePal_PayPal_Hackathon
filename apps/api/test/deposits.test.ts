import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { provider } from "../src/providers/paypal.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Deposit tests require a dedicated _test database.");
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
const data = async (user: number, method: string, path: string, payload?: object) => {
  const r = await request(user, method, path, payload);
  if (r.statusCode >= 400) throw Error(`${path}: ${r.statusCode} ${r.body}`);
  return r.json().data;
};
const hold = async (user: number) => {
  await data(user, "POST", `/date-plans/${planId}/deposit`);
  return data(user, "POST", `/date-plans/${planId}/deposit/authorize`);
};
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  for (let n = 0; n < 3; n++) {
    const user = { id: randomUUID(), token: randomUUID(), csrf: randomUUID() };
    users.push(user);
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [user.id, user.id + "@deposit.test.invalid"],
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
  await db.query(
    "INSERT INTO catalogue(id,title,activity,description,address,price_cents,duration_minutes,accessibility,policy) VALUES('coffee','Coffee','Coffee','d','a',1200,60,'x','y')",
  );
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id,status,version,expires_at) VALUES($1,$2,$3,'accepted',1,now()+interval '1 day')",
    [planId, mid, users[0].id],
  );
  await db.query(
    "INSERT INTO proposals(plan_id,version,catalogue_id,starts_at,snapshot) VALUES($1,1,'coffee',now()+interval '2 days','{}')",
    [planId],
  );
  ({ app } = await buildApp());
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("no-show deposit", () => {
  it("releases both holds when both members check in", async () => {
    const voids = vi.spyOn(provider, "voidAuthorization");
    await hold(0);
    const both = await hold(1);
    expect(both.partner.state).toBe("authorized");
    await data(0, "POST", `/date-plans/${planId}/check-in`);
    const done = await data(1, "POST", `/date-plans/${planId}/check-in`);
    expect(done.you.state).toBe("voided");
    expect(done.partner.state).toBe("voided");
    expect(voids).toHaveBeenCalledTimes(2);
  });
  it("captures the absent member's hold and pays out the one who showed up", async () => {
    const capture = vi.spyOn(provider, "captureAuthorization");
    const payout = vi.spyOn(provider, "createPayout");
    await hold(0);
    await hold(1);
    await data(0, "POST", `/date-plans/${planId}/check-in`);
    const claimed = await data(0, "POST", `/date-plans/${planId}/no-show`);
    expect(claimed.you.state).toBe("voided");
    expect(claimed.partner.state).toBe("captured");
    expect(claimed.payout).toMatchObject({ toYou: true, amountCents: 1000 });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(payout).toHaveBeenCalledTimes(1);
    const absent = await data(1, "GET", `/date-plans/${planId}/deposit`);
    expect(absent.payout).toMatchObject({ toYou: false, batchId: null });
    expect(JSON.stringify(absent)).not.toContain(claimed.you.authorizationId);
    expect(JSON.stringify(claimed)).not.toContain(absent.you.authorizationId);
    const replay = await request(0, "POST", `/date-plans/${planId}/no-show`);
    expect(replay.statusCode).toBe(409);
    expect(payout).toHaveBeenCalledTimes(1);
  });
  it("refuses claims without check-in, from non-members and before both accept", async () => {
    await hold(0);
    await hold(1);
    expect((await request(0, "POST", `/date-plans/${planId}/no-show`)).statusCode).toBe(409);
    expect((await request(2, "POST", `/date-plans/${planId}/deposit`)).statusCode).toBe(404);
    await db.query("UPDATE date_plans SET status='proposed' WHERE id=$1", [planId]);
    expect((await request(0, "POST", `/date-plans/${planId}/check-in`)).statusCode).toBe(409);
  });
  it("releases holds when the plan is cancelled", async () => {
    const voids = vi.spyOn(provider, "voidAuthorization");
    await hold(0);
    await data(0, "POST", `/date-plans/${planId}/cancel`, { expectedVersion: 1 });
    expect(voids).toHaveBeenCalledTimes(1);
    const row = await db.query("SELECT state FROM date_deposits WHERE plan_id=$1", [planId]);
    expect(row.rows[0].state).toBe("voided");
  });
});
