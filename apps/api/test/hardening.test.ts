import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { db, one } from "../src/db.js";
import { decrypt, encrypt, hash, needsRotation } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { resolveLocalTime } from "../src/domain.js";
import {
  deliverEmails,
  EMAIL_ATTEMPT_LIMIT,
  enqueueEmail,
  purgeExpired,
  rotateFieldKeys,
} from "../src/ops.js";
import { tx } from "../src/db.js";
import { workerTick, JOB_ATTEMPT_LIMIT } from "../src/payments.js";
import { provider } from "../src/providers/paypal.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Hardening tests require a dedicated _test database.");

const PASSWORD = "Synthetic-Hardening-2026";
let passwordHash = "";
let app: Awaited<ReturnType<typeof buildApp>>["app"];
type U = { id: string; token: string; csrf: string; email: string };
let users: U[] = [];
const request = (u: U, method: string, path: string, payload?: object) =>
  app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: "baepal=" + u.token,
      "x-csrf-token": u.csrf,
    },
    ...(method === "GET" || payload === undefined ? {} : { payload }),
  });
const data = async (u: U, method: string, path: string, payload?: object) => {
  const r = await request(u, method, path, payload ?? (method === "GET" ? undefined : {}));
  if (r.statusCode >= 400) throw Error(`${path}: ${r.statusCode} ${r.body}`);
  return r.json().data;
};
async function makeUser(opts: { interests?: string[]; gender?: string; role?: string } = {}) {
  const u = {
    id: randomUUID(),
    token: randomUUID(),
    csrf: randomUUID(),
    email: `${randomUUID()}@hardening.test.invalid`,
  };
  await db.query(
    "INSERT INTO users(id,email,password_hash,status,role,confirmed_at) VALUES($1,$2,$3,'active',$4,now())",
    [u.id, u.email, passwordHash, opts.role ?? "member"],
  );
  await db.query(
    "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1994-06-15',$2,$3)",
    [u.id, opts.gender ?? "Woman", ["Woman", "Man", "Nonbinary"]],
  );
  await db.query(
    "INSERT INTO profiles(user_id,display_name,interests,prompts,photos) VALUES($1,'Synthetic',$2,'[]',$3)",
    [u.id, opts.interests ?? [], ["/portraits/0.svg", "/portraits/1.svg"]],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(u.token), u.id, u.csrf],
  );
  users.push(u);
  return u;
}
async function matchedPlan(a: U, b: U, price = 3000) {
  const mid = randomUUID(),
    planId = randomUUID();
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, a.id, b.id],
  );
  await db.query(
    "INSERT INTO catalogue(id,title,activity,description,address,price_cents,duration_minutes,accessibility,policy) VALUES('art','Art','Art','d','a',$1,60,'x','y') ON CONFLICT DO NOTHING",
    [price],
  );
  await db.query("INSERT INTO date_plans(id,match_id,creator_id) VALUES($1,$2,$3)", [
    planId,
    mid,
    a.id,
  ]);
  const start = new Date(Date.now() + 86400000);
  for (const u of [a, b])
    await data(u, "PUT", `/date-plans/${planId}/private-preferences`, {
      budgetCents: 5000,
      activities: ["Art"],
      timeStart: start.toISOString(),
      timeEnd: new Date(start.getTime() + 4 * 3600000).toISOString(),
    });
  return { mid, planId, start };
}
async function confirmedPlan(a: U, b: U) {
  const { mid, planId, start } = await matchedPlan(a, b);
  const { version } = await data(a, "POST", `/date-plans/${planId}/proposals`, {
    optionId: "art",
    startsAt: start.toISOString(),
    expectedVersion: 0,
  });
  for (const u of [a, b])
    await data(u, "POST", `/date-plans/${planId}/accept`, { proposalVersion: version });
  const payments: string[] = [];
  for (const u of [a, b]) {
    const p = await data(u, "POST", "/purchases", { planId, proposalVersion: version });
    await data(u, "POST", "/payments/orders", { paymentId: p.paymentId });
    await data(u, "POST", `/payments/${p.paymentId}/capture`);
    payments.push(p.paymentId);
  }
  return { mid, planId, version, payments };
}

beforeAll(async () => {
  await migrate();
  passwordHash = await argon2.hash(PASSWORD);
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue,outbox CASCADE");
  await db.query("DELETE FROM auth_throttle");
  users = [];
  ({ app } = await buildApp());
});
afterEach(async () => {
  vi.restoreAllMocks();
  config.MEDIA_MODERATION = "auto";
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue,outbox CASCADE");
  await db.end();
});

describe("durable auth throttles (#1)", () => {
  it("locks an account after repeated failures, even across restarts", async () => {
    const u = await makeUser();
    const login = (password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: config.APP_ORIGIN },
        payload: { email: u.email, password },
      });
    for (let i = 0; i < 8; i++) expect((await login("wrong-password-x")).statusCode).toBe(401);
    await app.close();
    ({ app } = await buildApp());
    const locked = await login(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("TOO_MANY_ATTEMPTS");
    const stored = await db.query("SELECT key FROM auth_throttle");
    expect(JSON.stringify(stored.rows)).not.toContain(u.email);
  });
  it("lists sessions and needs the password to revoke the others", async () => {
    const u = await makeUser();
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,device) VALUES($1,$2,'x',now()+interval '1 hour','Firefox on Linux')",
      [hash("other-device"), u.id],
    );
    const list = await data(u, "GET", "/me/sessions");
    expect(list).toHaveLength(2);
    expect(list.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(hash(u.token));
    expect((await request(u, "POST", "/me/sessions/revoke-others", { password: "nope" })).statusCode).toBe(403);
    expect((await data(u, "POST", "/me/sessions/revoke-others", { password: PASSWORD })).revoked).toBe(1);
    expect(await data(u, "GET", "/me/sessions")).toHaveLength(1);
  });
});

describe("email outbox (#1, #12)", () => {
  it("retries with backoff, dead-letters after the limit and never stores codes after", async () => {
    const u = await makeUser();
    await tx((c) =>
      enqueueEmail(c, { userId: u.id, to: "person@example.com", template: "challenge_email", data: { code: "123456" } }),
    );
    const failing = vi.fn(async () => {
      throw Error("EMAIL_PROVIDER_503");
    });
    for (let i = 0; i < EMAIL_ATTEMPT_LIMIT; i++) {
      await db.query("UPDATE email_outbox SET available_at=now()");
      await deliverEmails(failing);
    }
    const row = await one(db, "SELECT * FROM email_outbox WHERE user_id=$1", [u.id]);
    expect(row.state).toBe("dead");
    expect(row.attempts).toBe(EMAIL_ATTEMPT_LIMIT - 1);
    expect(row.data_encrypted).toBeNull();
    expect(failing).toHaveBeenCalledTimes(EMAIL_ATTEMPT_LIMIT);
  });
  it("sends one generic update per hour and skips it once everything is read", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await db.query("UPDATE users SET email='reader@example.com' WHERE id=$1", [b.id]);
    const { mid } = await matchedPlan(a, b);
    await data(a, "POST", `/conversations/${mid}/messages`, { text: "meet-at-pier-nine", clientMessageId: randomUUID() });
    await data(a, "POST", `/conversations/${mid}/messages`, { text: "bring-the-blue-scarf", clientMessageId: randomUUID() });
    const queued = await db.query("SELECT * FROM email_outbox WHERE user_id=$1 AND template='update'", [b.id]);
    expect(queued.rowCount).toBe(1);
    const sent: any[] = [];
    await db.query("UPDATE email_outbox SET available_at=now()");
    await deliverEmails(async (m) => void sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("You have a new update on BaePal");
    expect(JSON.stringify(sent[0])).not.toMatch(/pier-nine|blue-scarf|Synthetic/);
    // Next hour's email is cancelled because the member already read everything.
    await db.query("UPDATE email_outbox SET dedupe_key='old' WHERE user_id=$1", [b.id]);
    await data(a, "POST", `/conversations/${mid}/messages`, { text: "third", clientMessageId: randomUUID() });
    await data(b, "POST", "/notifications/read", {});
    await db.query("UPDATE email_outbox SET available_at=now()");
    await deliverEmails(async (m) => void sent.push(m));
    expect(sent).toHaveLength(1);
    expect((await one(db, "SELECT state FROM email_outbox WHERE user_id=$1 AND dedupe_key<>'old'", [b.id])).state).toBe("cancelled");
  });
});

describe("retention and key rotation (#11)", () => {
  it("purges expired operational data but never financial records", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const { payments } = await confirmedPlan(a, b);
    await db.query("UPDATE notifications SET created_at=now()-interval '400 days'");
    await db.query("UPDATE payments SET created_at=now()-interval '4000 days'");
    const result = await purgeExpired();
    expect(result.notifications).toBeGreaterThan(0);
    expect((await db.query("SELECT 1 FROM payments WHERE id=ANY($1)", [payments])).rowCount).toBe(2);
    expect((await one(db, "SELECT count(*)::int AS n FROM audit_log WHERE action='retention.purge'")).n).toBe(1);
  });
  it("re-encrypts values written under a retired key", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const { planId } = await matchedPlan(a, b);
    const current = config.FIELD_ENCRYPTION_KEY;
    const retired = "ab".repeat(32);
    config.FIELD_ENCRYPTION_KEY = retired;
    const old = encrypt("4321");
    config.FIELD_ENCRYPTION_KEY = current;
    config.FIELD_ENCRYPTION_PREVIOUS_KEYS = retired;
    try {
      await db.query("UPDATE private_date_preferences SET budget_encrypted=$2 WHERE plan_id=$1 AND user_id=$3", [planId, old, a.id]);
      expect(decrypt(old)).toBe("4321");
      const counts = await rotateFieldKeys();
      expect(counts["private_date_preferences.budget_encrypted"]).toBe(1);
      const row = await one(db, "SELECT budget_encrypted FROM private_date_preferences WHERE plan_id=$1 AND user_id=$2", [planId, a.id]);
      expect(needsRotation(row.budget_encrypted)).toBe(false);
      config.FIELD_ENCRYPTION_PREVIOUS_KEYS = "";
      expect(decrypt(row.budget_encrypted)).toBe("4321");
    } finally {
      config.FIELD_ENCRYPTION_KEY = current;
      config.FIELD_ENCRYPTION_PREVIOUS_KEYS = "";
    }
  });
});

describe("time zones (#5)", () => {
  it("flags ambiguous and nonexistent Seattle wall times around DST", () => {
    const fallBack = resolveLocalTime("2026-11-01T01:30", "America/Los_Angeles");
    expect(fallBack.status).toBe("ambiguous");
    expect(fallBack.instants).toEqual(["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]);
    expect(resolveLocalTime("2026-03-08T02:30", "America/Los_Angeles").status).toBe("nonexistent");
    expect(resolveLocalTime("2026-07-04T19:00", "America/Los_Angeles")).toEqual({
      status: "ok",
      instants: ["2026-07-05T02:00:00.000Z"],
    });
  });
  it("rejects proposals outside opening hours and supports declining", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const { planId, start } = await matchedPlan(a, b);
    await db.query("UPDATE catalogue SET opens_minute=0,closes_minute=1");
    const closed = await request(a, "POST", `/date-plans/${planId}/proposals`, {
      optionId: "art",
      startsAt: start.toISOString(),
      expectedVersion: 0,
    });
    expect([409, 422]).toContain(closed.statusCode);
    await db.query("UPDATE catalogue SET opens_minute=0,closes_minute=1440");
    await data(a, "POST", `/date-plans/${planId}/proposals`, {
      optionId: "art",
      startsAt: start.toISOString(),
      expectedVersion: 0,
    });
    await data(b, "POST", `/date-plans/${planId}/decline`, { proposalVersion: 1 });
    const plan = await data(a, "GET", `/date-plans/${planId}`);
    expect(plan.status).toBe("collecting_preferences");
    expect(plan.declinedBy).toBe("partner");
    expect((await request(a, "POST", `/date-plans/${planId}/accept`, { proposalVersion: 1 })).statusCode).toBe(409);
  });
});

describe("discovery pagination (#3) and undo (#17)", () => {
  it("pages without duplicates and rejects tampered or stale cursors", async () => {
    const me = await makeUser({ interests: ["Art", "Coffee"] });
    for (const interests of [["Art", "Coffee"], ["Art"], [], ["Coffee"], ["Hiking"]])
      await makeUser({ interests });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await request(me, "GET", `/discover?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(r.statusCode).toBe(200);
      seen.push(...r.json().data.map((c: any) => c.user_id));
      cursor = r.json().nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const first = await request(me, "GET", "/discover?limit=2");
    const good = first.json().nextCursor as string;
    const tampered = good.replace(/^./, (c) => (c === "e" ? "f" : "e"));
    expect((await request(me, "GET", `/discover?limit=2&cursor=${encodeURIComponent(tampered)}`)).statusCode).toBe(409);
    await db.query("UPDATE profiles SET interests='{Books}' WHERE user_id=$1", [me.id]);
    const stale = await request(me, "GET", `/discover?limit=2&cursor=${encodeURIComponent(good)}`);
    expect(stale.json().error.code).toBe("CURSOR_STALE");
  });
  it("undoes only the latest pass", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await data(me, "POST", "/decisions", { targetId: other.id, action: "pass", clientMutationId: randomUUID() });
    expect((await data(me, "POST", "/decisions/undo")).targetId).toBe(other.id);
    expect((await request(me, "POST", "/decisions/undo", {})).statusCode).toBe(409);
    await data(me, "POST", "/decisions", { targetId: other.id, action: "like", clientMutationId: randomUUID() });
    expect((await request(me, "POST", "/decisions/undo", {})).statusCode).toBe(409);
  });
});

describe("payments and workers (#7, #8)", () => {
  it("bounds partial refunds and refunds only the remainder on cancellation", async () => {
    const admin = await makeUser({ role: "admin" });
    const [a, b] = [await makeUser(), await makeUser()];
    const { planId, version, payments } = await confirmedPlan(a, b);
    const refund = (amountCents: number) =>
      request(admin, "POST", `/admin/payments/${payments[0]}/refunds`, {
        amountCents,
        reason: "Synthetic goodwill",
        password: PASSWORD,
      });
    expect((await request(a, "POST", `/admin/payments/${payments[0]}/refunds`, { amountCents: 1, reason: "nope!", password: PASSWORD })).statusCode).toBe(403);
    expect((await refund(1000)).json().data.state).toBe("completed");
    expect((await refund(2500)).json().error.code).toBe("REFUND_EXCEEDS_CAPTURE");
    await data(a, "POST", `/date-plans/${planId}/cancel`, { expectedVersion: version });
    await workerTick();
    const rows = (await db.query("SELECT amount_cents,kind,state FROM refunds WHERE payment_id=$1 ORDER BY amount_cents", [payments[0]])).rows;
    expect(rows).toEqual([
      { amount_cents: 1000, kind: "partial", state: "completed" },
      { amount_cents: 2000, kind: "cancellation", state: "completed" },
    ]);
    expect((await one(db, "SELECT state FROM payments WHERE id=$1", [payments[0]])).state).toBe("refunded");
    expect((await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [planId])).financial_state).toBe("refunded");
  });
  it("dead-letters compensation that keeps failing and surfaces it in ops", async () => {
    const admin = await makeUser({ role: "admin" });
    const [a, b] = [await makeUser(), await makeUser()];
    const { planId, version } = await confirmedPlan(a, b);
    await data(a, "POST", `/date-plans/${planId}/cancel`, { expectedVersion: version });
    vi.spyOn(provider, "refundCapture").mockRejectedValue(Error("PROVIDER_DOWN"));
    await db.query("UPDATE outbox SET attempts=$1", [JOB_ATTEMPT_LIMIT - 1]);
    await workerTick();
    const job = await one(db, "SELECT state,last_error FROM outbox WHERE aggregate_id=$1", [planId]);
    expect(job.state).toBe("dead");
    expect((await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [planId])).financial_state).toBe("refund_failed");
    const ops = await data(admin, "GET", "/admin/ops");
    expect(ops.compensationJobs.dead).toBe(1);
    expect(ops.alerts.join(" ")).toMatch(/dead-lettered/);
    expect(JSON.stringify(ops)).not.toMatch(/@|CAP-|MOCK-/);
  });
});

describe("media moderation (#2)", () => {
  it("hides pending uploads from others until a moderator approves", async () => {
    config.MEDIA_MODERATION = "manual";
    const mod = await makeUser({ role: "moderator" });
    const [owner, viewer] = [await makeUser(), await makeUser()];
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#e88" } }).png().toBuffer();
    const up = await data(owner, "POST", "/me/photos", { base64: png.toString("base64") });
    expect(up.state).toBe("pending");
    await db.query("UPDATE profiles SET photos=array_append(photos,$2) WHERE user_id=$1", [owner.id, up.url]);
    expect((await request(viewer, "GET", up.url.replace("/api/v1", ""))).statusCode).toBe(404);
    const queue = await data(mod, "GET", "/admin/media");
    expect(queue.map((m: any) => m.id)).toContain(up.url.split("/").pop());
    expect((await request(owner, "GET", "/admin/media")).statusCode).toBe(403);
    await data(mod, "PATCH", `/admin/media/${up.url.split("/").pop()}`, { state: "approved", reason: "Looks fine" });
    expect((await request(viewer, "GET", up.url.replace("/api/v1", ""))).statusCode).toBe(200);
  });
});

describe("chat preferences and calendar (#18)", () => {
  it("shows read receipts only when both members opt in", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const { mid } = await matchedPlan(a, b);
    await data(a, "POST", `/conversations/${mid}/messages`, { text: "hello", clientMessageId: randomUUID() });
    await data(b, "PUT", "/me/settings", { readReceipts: true, typingIndicators: true, emailUpdates: true });
    expect((await data(b, "POST", `/conversations/${mid}/read`, { sequence: 1 })).stored).toBe(true);
    expect((await data(a, "GET", `/conversations/${mid}/read`)).partnerReadSequence).toBeNull();
    await data(a, "PUT", "/me/settings", { readReceipts: true, typingIndicators: true, emailUpdates: true });
    expect((await data(a, "GET", `/conversations/${mid}/read`)).partnerReadSequence).toBe(1);
    expect((await data(b, "POST", `/conversations/${mid}/read`, { sequence: 0 })).sequence).toBe(1);
  });
  it("exports a confirmed plan as ICS without the partner's name", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const { planId } = await confirmedPlan(a, b);
    const r = await request(a, "GET", `/date-plans/${planId}/calendar.ics`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/calendar/);
    expect(r.body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(r.body).not.toContain("Synthetic");
  });
});

describe("planning pass (#36)", () => {
  it("grants once from a verified capture and refunds within 24 hours", async () => {
    const u = await makeUser();
    const order = await data(u, "POST", "/planning-pass/order");
    expect((await data(u, "POST", "/planning-pass/order")).id).toBe(order.id);
    await data(u, "POST", `/planning-pass/${order.id}/capture`);
    expect((await data(u, "POST", `/planning-pass/${order.id}/capture`)).state).toBe("active");
    expect((await request(u, "POST", "/planning-pass/order", {})).json().error.code).toBe("ALREADY_ACTIVE");
    expect((await one(db, "SELECT count(*)::int AS n FROM entitlements WHERE user_id=$1", [u.id])).n).toBe(1);
    expect((await data(u, "POST", `/planning-pass/${order.id}/refund`)).state).toBe("refunded");
    expect((await request(u, "POST", `/planning-pass/${order.id}/refund`, {})).statusCode).toBe(409);
  });
});

describe("contracts and privacy (#11, #16)", () => {
  it("documents every registered route in OpenAPI", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    for (const path of ["/discover", "/me/sessions", "/date-plans/{id}/decline", "/admin/ops", "/planning-pass/{id}/capture"])
      expect(Object.keys(doc.paths)).toContain(path);
    expect(doc.paths["/date-plans/{id}/proposals"].post.requestBody).toBeTruthy();
    expect(doc.components.schemas.Error).toBeTruthy();
  });
  it("exports the new account data and deletes it with the account", async () => {
    const u = await makeUser();
    await data(u, "PUT", "/me/settings", { readReceipts: true, typingIndicators: false, emailUpdates: false });
    const exported = await data(u, "POST", "/me/export", { password: PASSWORD });
    expect(exported.settings[0]).toMatchObject({ read_receipts: true, typing_indicators: false });
    expect(exported.sessions).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain(hash(u.token));
    expect((await request(u, "DELETE", "/me", { password: PASSWORD })).statusCode).toBe(200);
    expect((await db.query("SELECT 1 FROM member_settings WHERE user_id=$1", [u.id])).rowCount).toBe(0);
  });
});

describe("targeted comments and optional filters (#17)", () => {
  it("shows a prompt comment in the likes inbox until that prompt changes", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await db.query(
      `UPDATE profiles SET prompts='[{"question":"Best Sunday","answer":"Ferry and dumplings"}]' WHERE user_id=$1`,
      [b.id],
    );
    expect(
      (
        await request(a, "POST", "/likes/comments", {
          targetId: b.id,
          kind: "prompt",
          position: 3,
          text: "Same!",
          clientMutationId: randomUUID(),
        })
      ).statusCode,
    ).toBe(422);
    await data(a, "POST", "/likes/comments", {
      targetId: b.id,
      kind: "prompt",
      position: 0,
      text: "Which ferry?",
      clientMutationId: randomUUID(),
    });
    let [card] = await data(b, "GET", "/likes");
    expect(card.user_id).toBe(a.id);
    expect(card.comment).toMatchObject({
      text: "Which ferry?",
      kind: "prompt",
      available: true,
      snapshot: { question: "Best Sunday", answer: "Ferry and dumplings" },
    });
    await db.query(
      `UPDATE profiles SET prompts='[{"question":"Best Sunday","answer":"Bookshops"}]' WHERE user_id=$1`,
      [b.id],
    );
    [card] = await data(b, "GET", "/likes");
    expect(card.comment).toMatchObject({ available: false, snapshot: null });
    // Liking back forms the match; the comment stays out of other members' views.
    const result = await data(b, "POST", "/decisions", {
      targetId: a.id,
      action: "like",
      clientMutationId: randomUUID(),
    });
    expect(result.match).toBeTruthy();
  });

  it("filters discovery by one declared interest and binds it to the cursor", async () => {
    const me = await makeUser({ interests: ["Art"] });
    await makeUser({ interests: ["Art"] });
    await makeUser({ interests: ["Hiking"] });
    const all = await request(me, "GET", "/discover?limit=1");
    expect(all.json().data).toHaveLength(1);
    const hikers = await data(me, "GET", "/discover?interest=Hiking");
    expect(hikers).toHaveLength(1);
    expect(hikers[0].interests).toContain("Hiking");
    const stale = await request(
      me,
      "GET",
      `/discover?interest=Hiking&cursor=${encodeURIComponent(all.json().nextCursor)}`,
    );
    expect(stale.statusCode).toBe(409);
  });
});

describe("contact hiding (#19)", () => {
  it("hides both people from each other without storing the email", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    expect(await data(a, "GET", "/discover")).toHaveLength(1);
    await data(a, "POST", "/me/hidden-contacts", { emails: [b.email.toUpperCase()] });
    expect(await data(a, "GET", "/discover")).toHaveLength(0);
    expect(await data(b, "GET", "/discover")).toHaveLength(0);
    const stored = await db.query("SELECT * FROM contact_hides WHERE user_id=$1", [a.id]);
    expect(JSON.stringify(stored.rows)).not.toContain(b.email.split("@")[0]);
    expect(
      (
        await request(b, "POST", "/decisions", {
          targetId: a.id,
          action: "like",
          clientMutationId: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
    const list = await data(a, "GET", "/me/hidden-contacts");
    expect(list.count).toBe(1);
    await data(a, "DELETE", `/me/hidden-contacts/${list.entries[0].id}`);
    expect(await data(a, "GET", "/discover")).toHaveLength(1);
  });
});
