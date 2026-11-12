import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db, one } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Moderation tests require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"], reportId: string;
const MOD = 0,
  REPORTER = 1,
  SUBJECT = 2;
let users: { id: string; token: string; csrf: string }[];
function request(user: number, method: string, path: string, payload?: object) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: "baepal=" + users[user].token,
      "x-csrf-token": users[user].csrf,
    },
    payload,
  });
}
const moderate = (action: string, expectedVersion: number, user = MOD) =>
  request(user, "PATCH", `/admin/reports/${reportId}`, {
    action,
    reason: "Synthetic moderation reason",
    expectedVersion,
  });
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  for (const role of ["moderator", "member", "member"]) {
    const user = { id: randomUUID(), token: randomUUID(), csrf: randomUUID() };
    users.push(user);
    await db.query(
      "INSERT INTO users(id,email,password_hash,status,role) VALUES($1,$2,'synthetic-unused','active',$3)",
      [user.id, user.id + "@moderation.test.invalid", role],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(user.token), user.id, user.csrf],
    );
  }
  ({ app } = await buildApp());
  const filed = await request(REPORTER, "POST", "/reports", {
    subjectId: users[SUBJECT].id,
    category: "spam/scam",
    notes: "Synthetic gift card request",
  });
  reportId = filed.json().data.id;
});
afterEach(async () => {
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("moderator report review", () => {
  it("denies members and hides reporter identity from moderators", async () => {
    expect((await request(REPORTER, "GET", "/admin/reports")).statusCode).toBe(403);
    expect((await moderate("dismiss", 0, REPORTER)).statusCode).toBe(403);
    const queue = (await request(MOD, "GET", "/admin/reports")).json().data;
    expect(queue[0]).toMatchObject({
      id: reportId,
      notes: "Synthetic gift card request",
      subject_status: "active",
      version: 0,
    });
    expect(JSON.stringify(queue)).not.toContain(users[REPORTER].id);
  });
  it("suspends immediately, restores, and rejects stale versions", async () => {
    expect((await moderate("suspend", 0)).statusCode).toBe(200);
    expect((await request(SUBJECT, "GET", "/me")).statusCode).toBe(401);
    expect((await moderate("restore", 0)).statusCode).toBe(409);
    expect((await moderate("restore", 1)).statusCode).toBe(200);
    expect(
      (await one(db, "SELECT status FROM users WHERE id=$1", [users[SUBJECT].id]))
        .status,
    ).toBe("active");
    const audit = await db.query(
      "SELECT action FROM audit_log WHERE resource_id=$1 ORDER BY created_at",
      [reportId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "report.suspend",
      "report.restore",
    ]);
  });
  it("warns the subject privately and shows the reporter only neutral progress", async () => {
    expect((await moderate("warn", 0)).statusCode).toBe(200);
    const inbox = (await request(SUBJECT, "GET", "/notifications")).json().data;
    expect(inbox.items[0].category).toBe("account.warning");
    expect(JSON.stringify(inbox)).not.toMatch(/spam|gift card/);
    const mine = (await request(REPORTER, "GET", "/reports")).json().data;
    expect(mine).toEqual([
      expect.objectContaining({ id: reportId, progress: "closed" }),
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/warn|suspend/);
  });
  it("refuses to suspend staff accounts from the queue", async () => {
    const r = await request(REPORTER, "POST", "/reports", {
      subjectId: users[MOD].id,
      category: "other",
      notes: "",
    });
    reportId = r.json().data.id;
    expect((await moderate("suspend", 0)).statusCode).toBe(403);
  });
});
