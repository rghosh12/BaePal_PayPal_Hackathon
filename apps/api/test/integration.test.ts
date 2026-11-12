import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { decide, sendMessage } from "../src/domain.js";
import { workerTick, recordOrder } from "../src/payments.js";
import { ageOn, keyed } from "../src/crypto.js";
import { config } from "../src/config.js";
import { provider } from "../src/providers/paypal.js";
import { readFile } from "node:fs/promises";
import { io as clientIO, type Socket } from "socket.io-client";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error(
    "Integration tests require a dedicated database ending in _test.",
  );
const origin = "http://localhost:3000";
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let a: string, b: string, c: string;
let accounts: Record<string, { cookie: string; csrf: string }> = {};
const password = "A-test-password-2026!";
async function req(
  user: string | null,
  method: string,
  url: string,
  payload?: any,
  extra: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + url,
    headers: {
      origin,
      ...(user
        ? { cookie: accounts[user].cookie, "x-csrf-token": accounts[user].csrf }
        : {}),
      ...extra,
    },
    payload,
  });
}
async function data(user: string, method: string, url: string, payload?: any) {
  const r = await req(user, method, url, payload);
  if (r.statusCode >= 400)
    throw Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
  return r.json().data;
}
async function createUser(name: string) {
  const uid = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,password_hash,status,confirmed_at) VALUES($1,$2,$3,'active',now())",
    [uid, `${name}@test.invalid`, await argon2.hash(password)],
  );
  await db.query(
    'INSERT INTO profiles(user_id,display_name,bio,photos,prompts) VALUES($1,$2,\'Hello\',ARRAY[\'/portraits/0.svg\',\'/portraits/1.svg\'],\'[{"question":"Date","answer":"Art"},{"question":"Fun","answer":"Coffee"}]\')',
    [uid, name],
  );
  await db.query(
    "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1995-05-03','Nonbinary',ARRAY['Nonbinary'])",
    [uid],
  );
  const login = await req(null, "POST", "/auth/login", {
    email: `${name}@test.invalid`,
    password,
  });
  expect(login.statusCode).toBe(200);
  accounts[uid] = {
    cookie: String(login.headers["set-cookie"]).split(";")[0],
    csrf: login.json().data.csrf,
  };
  return uid;
}
async function match() {
  await decide(a, b, "like", randomUUID());
  const result = await decide(b, a, "like", randomUUID());
  return result.match.id as string;
}
async function plan() {
  const m = await match();
  const p = await data(a, "POST", "/date-plans", { matchId: m });
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  for (const [u, budget] of [
    [a, 5000],
    [b, 4000],
  ] as const)
    await data(u, "PUT", `/date-plans/${p.id}/private-preferences`, {
      budgetCents: budget,
      activities: ["Art", "Coffee"],
      timeStart: start,
      timeEnd: end,
    });
  await data(a, "POST", `/date-plans/${p.id}/proposals`, {
    optionId: "art",
    startsAt: start,
    expectedVersion: 0,
  });
  return { id: p.id, m, start, end };
}
async function accepted() {
  const p = await plan();
  for (const u of [a, b])
    await data(u, "POST", `/date-plans/${p.id}/accept`, { proposalVersion: 1 });
  return p;
}
beforeAll(async () => {
  await migrate();
}, 30000);
beforeEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  ({ app } = await buildApp());
  await app.ready();
  await db.query("TRUNCATE users,catalogue CASCADE");
  accounts = {};
  [a, b, c] = await Promise.all(["alpha", "beta", "gamma"].map(createUser));
  await db.query(
    "INSERT INTO catalogue VALUES('art','Art night','Art','Fictional gallery','Demo Seattle',3000,60,'Demo step-free','Full refund before date'),('coffee','Coffee','Coffee','Fictional café','Demo Seattle',1200,60,'Demo step-free','Full refund before date')",
  );
}, 30000);
afterAll(async () => {
  await app.close();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("real PostgreSQL access and consent invariants", () => {
  it("keeps integration routes private, permission-gated and compatible with configured gateways", async () => {
    const previous = config.BAEPAL_INTEGRATIONS_JSON;
    try {
      config.BAEPAL_INTEGRATIONS_JSON = JSON.stringify({
        version: 1,
        providers: {
          astropods: {
            enabled: true,
            protocol: "baepal-gateway-v1",
            baseUrl: "https://gateway.example.com",
            auth: "bearer",
            token: "fixture-secret-only",
            operations: ["plan", "explain"],
          },
        },
      });
      expect((await req(null, "GET", "/integrations/status")).statusCode).toBe(
        401,
      );
      const status = await data(a, "GET", "/integrations/status");
      expect(status.providers[0].state).toBe("configured_unverified");
      expect(JSON.stringify(status)).not.toContain("fixture-secret");
      const payload = {
        operation: "explain",
        allowExternalProcessing: true,
        input: { interests: ["arts"], sharedInterests: ["arts"] },
      };
      expect(
        (
          await req(a, "POST", "/integrations/preview", {
            ...payload,
            allowExternalProcessing: false,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await req(a, "POST", "/integrations/preview", payload, {
            "x-csrf-token": "invalid",
          })
        ).statusCode,
      ).toBe(403);
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, init) => {
          const body = JSON.parse(init!.body as string);
          expect(JSON.stringify(body)).not.toContain("budget");
          if (body.operation === "plan")
            return Response.json({
              version: 1,
              data: {
                suggestions: [
                  { id: "art", reason: "An eligible art activity." },
                ],
              },
            });
          return Response.json({
            version: 1,
            data: { summary: "A shared art interest." },
          });
        });
      expect(
        (await data(a, "POST", "/integrations/preview", payload)).data.summary,
      ).toBe("A shared art interest.");
      const p = await plan();
      expect(
        (
          await req(c, "POST", `/date-plans/${p.id}/suggestions`, {
            useExternalProvider: true,
            allowExternalProcessing: true,
          })
        ).statusCode,
      ).toBe(404);
      const ranked = await data(a, "POST", `/date-plans/${p.id}/suggestions`, {
        useExternalProvider: true,
        allowExternalProcessing: true,
      });
      expect(ranked.options[0].price_cents).toBe(3000);
      expect(ranked.evidence.mode).toBe("gateway");
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      config.BAEPAL_INTEGRATIONS_JSON = previous;
    }
  });

  it("rejects anonymous reads, missing CSRF and wrong origins", async () => {
    expect((await req(null, "GET", "/discover")).statusCode).toBe(401);
    expect(
      (await req(a, "POST", "/me/pause", {}, { "x-csrf-token": "" }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await req(
          a,
          "POST",
          "/me/pause",
          {},
          { origin: "https://evil.invalid" },
        )
      ).statusCode,
    ).toBe(403);
  });
  it("creates exactly one match during simultaneous reciprocal likes and retries", async () => {
    const x = randomUUID(),
      y = randomUUID();
    await Promise.all([decide(a, b, "like", x), decide(b, a, "like", y)]);
    await Promise.all([decide(a, b, "like", x), decide(b, a, "like", y)]);
    expect((await one(db, "SELECT count(*)::int AS n FROM matches")).n).toBe(1);
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM notifications")).n,
    ).toBe(2);
  });
  it("persists one retry-safe message and denies outsiders", async () => {
    const m = await match(),
      client = randomUUID();
    await Promise.all([
      sendMessage(a, m, "hello", client),
      sendMessage(a, m, "hello", client),
    ]);
    expect((await data(b, "GET", `/conversations/${m}/messages`)).length).toBe(
      1,
    );
    expect(
      (await req(c, "GET", `/conversations/${m}/messages`)).statusCode,
    ).toBe(404);
    expect(
      (
        await req(c, "POST", `/conversations/${m}/messages`, {
          text: "intrusion",
          clientMessageId: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
  });
  it("withholds partner budget and denies plan ID guessing", async () => {
    const p = await plan();
    const view = await data(a, "GET", `/date-plans/${p.id}`);
    expect(view.ownPreferences.budgetCents).toBe(5000);
    expect(JSON.stringify(view)).not.toContain("4000");
    expect((await req(c, "GET", `/date-plans/${p.id}`)).statusCode).toBe(404);
    const stored = await one(
      db,
      "SELECT budget_encrypted FROM private_date_preferences WHERE plan_id=$1 AND user_id=$2",
      [p.id, a],
    );
    expect(stored.budget_encrypted).not.toContain("5000");
  });
  it("redacts private planning windows and unknown snapshot fields from proposals and financial responses", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    const view = await data(a, "GET", `/date-plans/${p.id}`);
    expect(view.proposal.snapshot).not.toHaveProperty("earliestStart");
    expect(view.proposal.snapshot).not.toHaveProperty("latestEnd");
    const stored = await one(
      db,
      "SELECT snapshot FROM proposals WHERE plan_id=$1",
      [p.id],
    );
    expect(stored.snapshot).not.toHaveProperty("earliestStart");
    expect(stored.snapshot).not.toHaveProperty("latestEnd");
    // Existing rows can predate response contracts. Never pass unknown JSON through.
    const extra = {
      earliestStart: p.start,
      latestEnd: p.end,
      provider_payload: { secret: "private-financial-fixture" },
    };
    await db.query(
      "UPDATE proposals SET snapshot=snapshot || $2::jsonb WHERE plan_id=$1",
      [p.id, JSON.stringify(extra)],
    );
    await db.query(
      "UPDATE purchases SET snapshot=snapshot || $2::jsonb WHERE id=$1",
      [purchase.purchaseId, JSON.stringify(extra)],
    );
    const responses = [
      await data(a, "GET", `/date-plans/${p.id}`),
      await data(a, "GET", `/purchases/${purchase.purchaseId}`),
      await data(a, "GET", `/payments/${purchase.paymentId}`),
      await data(a, "GET", "/payments"),
    ];
    for (const value of responses) {
      const text = JSON.stringify(value);
      expect(text).not.toContain("earliestStart");
      expect(text).not.toContain("latestEnd");
      expect(text).not.toContain("private-financial-fixture");
    }
    const receipt = await data(a, "GET", `/payments/${purchase.paymentId}`);
    expect(receipt.snapshot.title).toBe("Art night");
    expect(receipt.amount_cents).toBe(3000);
    expect(receipt).not.toHaveProperty("buyer_id");
    expect(
      (await req(b, "GET", `/payments/${purchase.paymentId}`)).statusCode,
    ).toBe(404);
    expect(
      (await req(b, "GET", `/purchases/${purchase.purchaseId}`)).statusCode,
    ).toBe(404);
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    const captured = await data(
      a,
      "POST",
      `/payments/${purchase.paymentId}/capture`,
      {},
    );
    expect(captured.order_id).toBeTruthy();
    expect(captured.capture_id).toBeTruthy();
    expect(JSON.stringify(captured)).not.toContain("private-financial-fixture");
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    await workerTick();
    const refunded = await data(a, "GET", `/payments/${purchase.paymentId}`);
    expect(refunded.refunds[0].provider_id).toBeTruthy();
    expect(refunded.refunds[0].state).toBe("completed");
    await db.query(
      "UPDATE payments SET state='private-invalid-fixture' WHERE id=$1",
      [purchase.paymentId],
    );
    const malformed = await req(a, "GET", `/payments/${purchase.paymentId}`);
    expect(malformed.statusCode).toBe(500);
    expect(malformed.body).not.toContain("private-invalid-fixture");
  });
  it("invalidates both acceptances on revision and rejects stale consent", async () => {
    const p = await accepted();
    await data(a, "POST", `/date-plans/${p.id}/proposals`, {
      optionId: "coffee",
      startsAt: p.start,
      expectedVersion: 1,
    });
    const view = await data(b, "GET", `/date-plans/${p.id}`);
    expect(view.acceptanceCount).toBe(0);
    expect(view.version).toBe(2);
    expect(
      (
        await req(b, "POST", `/date-plans/${p.id}/accept`, {
          proposalVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await req(a, "POST", "/purchases", { planId: p.id, proposalVersion: 1 }))
        .statusCode,
    ).toBe(409);
  });
  it("filters out experiences outside either budget with neutral no-overlap results", async () => {
    const p = await plan();
    await data(b, "PUT", `/date-plans/${p.id}/private-preferences`, {
      budgetCents: 500,
      activities: ["Art"],
      timeStart: p.start,
      timeEnd: p.end,
    });
    const result = await data(a, "POST", `/date-plans/${p.id}/suggestions`, {});
    expect(result.options).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("500");
  });
  it("requires both independent captures, replays operations and refunds cancellation", async () => {
    const p = await accepted();
    const purchases = [];
    for (const u of [a, b]) {
      const purchase = await data(u, "POST", "/purchases", {
        planId: p.id,
        proposalVersion: 1,
        amountCents: 1,
        currency: "EUR",
      });
      purchases.push(purchase);
      const order = await data(u, "POST", "/payments/orders", {
        paymentId: purchase.paymentId,
      });
      const repeat = await data(u, "POST", "/payments/orders", {
        paymentId: purchase.paymentId,
      });
      expect(order.orderId).toBe(repeat.orderId);
      const capture = await data(
        u,
        "POST",
        `/payments/${purchase.paymentId}/capture`,
        {},
      );
      expect(capture.amount_cents).toBe(3000);
      expect(capture.state).toBe("completed");
      await data(u, "POST", `/payments/${purchase.paymentId}/capture`, {});
      if (u === a)
        expect((await data(a, "GET", `/date-plans/${p.id}`)).status).toBe(
          "payment_pending",
        );
    }
    expect((await data(a, "GET", `/date-plans/${p.id}`)).status).toBe(
      "confirmed",
    );
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM financial_events WHERE type='capture.completed'",
        )
      ).n,
    ).toBe(2);
    expect(
      (await req(c, "GET", `/payments/${purchases[0].paymentId}`)).statusCode,
    ).toBe(404);
    expect(
      (await req(b, "POST", `/payments/${purchases[0].paymentId}/capture`, {}))
        .statusCode,
    ).toBe(404);
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    await workerTick();
    expect(
      (await data(a, "GET", `/payments/${purchases[0].paymentId}`)).refunds[0]
        .state,
    ).toBe("completed");
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refunded",
    );
    await workerTick();
    expect((await one(db, "SELECT count(*)::int AS n FROM refunds")).n).toBe(2);
  });
  it("keeps completed refunds and processed jobs terminal across simultaneous cancellation retries", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    await data(a, "POST", `/payments/${purchase.paymentId}/capture`, {});
    const refunds = vi.spyOn(provider, "refundCapture");
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    await workerTick();
    const original = await data(a, "GET", `/payments/${purchase.paymentId}`);
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refunded",
    );
    await Promise.all(
      [a, b, a].map((u) =>
        data(u, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 }),
      ),
    );
    await workerTick();
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refunded",
    );
    expect(await data(a, "GET", `/payments/${purchase.paymentId}`)).toEqual(
      original,
    );
    expect(
      (await one(db, "SELECT state FROM outbox WHERE aggregate_id=$1", [p.id]))
        .state,
    ).toBe("processed");
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM financial_events WHERE type='refund.completed'",
        )
      ).n,
    ).toBe(1);
    expect(refunds).toHaveBeenCalledTimes(1);
  });
  it("preserves pending refund evidence and its scheduled reconciliation on cancellation replay", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    await data(a, "POST", `/payments/${purchase.paymentId}/capture`, {});
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    vi.spyOn(provider, "refundCapture").mockResolvedValue({
      id: "pending-replay-refund",
      status: "PENDING",
    });
    await workerTick();
    const job = await one(
      db,
      "SELECT state,attempts,available_at FROM outbox WHERE aggregate_id=$1",
      [p.id],
    );
    await data(b, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refund_pending",
    );
    expect(
      await one(
        db,
        "SELECT state,attempts,available_at FROM outbox WHERE aggregate_id=$1",
        [p.id],
      ),
    ).toEqual(job);
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).refunds[0]
        .state,
    ).toBe("pending");
  });
  it("retains expired plan status when a stale cancel request arrives", async () => {
    const p = await accepted();
    await db.query(
      "UPDATE date_plans SET expires_at=now()-interval '1 second' WHERE id=$1",
      [p.id],
    );
    await workerTick();
    expect((await data(a, "GET", `/date-plans/${p.id}`)).status).toBe(
      "expired",
    );
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    expect((await data(a, "GET", `/date-plans/${p.id}`)).status).toBe(
      "expired",
    );
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "unpaid",
    );
  });
  it("reopens compensation for authoritative late capture but not replayed capture evidence", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    const order = await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    await workerTick();
    expect(
      (await one(db, "SELECT state FROM outbox WHERE aggregate_id=$1", [p.id]))
        .state,
    ).toBe("processed");
    // Simulate delayed provider completion observed through authoritative reconciliation.
    const evidence = await provider.captureOrder(order.orderId, randomUUID());
    await recordOrder(purchase.paymentId, evidence);
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "reconciliation_pending",
    );
    expect(
      (await one(db, "SELECT state FROM outbox WHERE aggregate_id=$1", [p.id]))
        .state,
    ).toBe("pending");
    await workerTick();
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).state,
    ).toBe("refunded");
    await recordOrder(purchase.paymentId, evidence);
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    await workerTick();
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refunded",
    );
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM refunds WHERE payment_id=$1",
          [purchase.paymentId],
        )
      ).n,
    ).toBe(1);
  });
  it("expires and compensates both payers when the second capture completes after consent expiry", async () => {
    const p = await accepted();
    const purchases = [];
    for (const u of [a, b]) {
      const purchase = await data(u, "POST", "/purchases", {
        planId: p.id,
        proposalVersion: 1,
      });
      purchases.push(purchase);
      await data(u, "POST", "/payments/orders", {
        paymentId: purchase.paymentId,
      });
    }
    await data(a, "POST", `/payments/${purchases[0].paymentId}/capture`, {});
    const capture = provider.captureOrder.bind(provider);
    vi.spyOn(provider, "captureOrder").mockImplementation(async (...args) => {
      const evidence = await capture(...args);
      // Consent was valid when the provider call began, then expired in flight.
      await db.query(
        "UPDATE date_plans SET expires_at=now()-interval '1 second' WHERE id=$1",
        [p.id],
      );
      return evidence;
    });
    await data(b, "POST", `/payments/${purchases[1].paymentId}/capture`, {});
    const view = await data(a, "GET", `/date-plans/${p.id}`);
    expect(view.status).toBe("expired");
    expect(view.financialState).toBe("reconciliation_pending");
    await workerTick();
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refunded",
    );
    for (const [index, u] of [a, b].entries())
      expect(
        (await data(u, "GET", `/payments/${purchases[index].paymentId}`)).state,
      ).toBe("refunded");
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM refunds WHERE state='completed'",
        )
      ).n,
    ).toBe(2);
  });
  it("blocks chat immediately while retaining the payer’s private receipt", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    await data(a, "POST", `/payments/${purchase.paymentId}/capture`, {});
    await data(b, "POST", "/blocks", { targetId: a });
    expect(
      (await req(a, "GET", `/conversations/${p.m}/messages`)).statusCode,
    ).toBe(404);
    expect(
      (
        await req(a, "POST", `/conversations/${p.m}/messages`, {
          text: "blocked",
          clientMessageId: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await req(a, "GET", `/payments/${purchase.paymentId}`)).statusCode,
    ).toBe(200);
    await workerTick();
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).state,
    ).toBe("refunded");
  });
  it("rejects unsigned webhooks and member moderator access", async () => {
    expect(
      (
        await req(null, "POST", "/webhooks/paypal", {
          id: "forged",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await req(a, "GET", "/admin/reports")).statusCode).toBe(403);
  });
  it("enforces reciprocal preferences, pause and age eligibility", async () => {
    await db.query("UPDATE profile_private SET age_max=20 WHERE user_id=$1", [
      b,
    ]);
    expect(
      (await data(a, "GET", "/discover")).some((p: any) => p.user_id === b),
    ).toBe(false);
    expect(
      (
        await req(a, "POST", "/decisions", {
          targetId: b,
          action: "like",
          clientMutationId: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
    await data(c, "POST", "/me/pause", {});
    expect(
      (await data(a, "GET", "/discover")).some((p: any) => p.user_id === c),
    ).toBe(false);
  });
  it("bounds OTP attempts and rejects an exhausted challenge", async () => {
    await db.query(
      "UPDATE users SET status='pending_email',confirmed_at=NULL WHERE id=$1",
      [a],
    );
    const cid = randomUUID();
    await db.query(
      "INSERT INTO challenges(id,user_id,purpose,code_hash,expires_at) VALUES($1,$2,'email',$3,now()+interval '10 minutes')",
      [cid, a, keyed(`${cid}:123456`)],
    );
    for (let i = 0; i < 5; i++)
      expect(
        (
          await req(a, "POST", "/auth/email/confirm", {
            challengeId: cid,
            code: "000000",
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (
        await req(a, "POST", "/auth/email/confirm", {
          challengeId: cid,
          code: "123456",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await one(db, "SELECT attempts FROM challenges WHERE id=$1", [cid]))
        .attempts,
    ).toBe(5);
  });
  it("saves and resumes onboarding drafts and rejects underage activation", async () => {
    const email = "new-adult@test.invalid";
    const r = await req(null, "POST", "/auth/signup", {
      email,
      password,
      adult: true,
      terms: true,
    });
    expect(r.statusCode).toBe(200);
    const signup = r.json().data;
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { cookie },
    });
    const uid = me.json().data.id;
    accounts[uid] = { cookie, csrf: signup.csrf };
    expect((await req(uid, "GET", "/discover")).statusCode).toBe(403);
    const mail = JSON.parse(
      await readFile(
        new URL(
          `../../../.data/mail/${signup.challengeId}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await data(uid, "POST", "/auth/email/confirm", {
      challengeId: signup.challengeId,
      code: mail.code,
    });
    const draft = {
      expectedVersion: 1,
      displayName: "New adult",
      birthDate: "",
      gender: "Nonbinary",
      genders: ["Nonbinary"],
      ageMin: 18,
      ageMax: 99,
      city: "Seattle",
      intention: "Long-term relationship",
      bio: "",
      interests: [],
      photos: [],
      prompts: [
        { question: "First date", answer: "" },
        { question: "Together", answer: "" },
      ],
      publish: false,
    };
    await data(uid, "PATCH", "/me/profile", draft);
    const resumed = await data(uid, "GET", "/me");
    expect(resumed.status).toBe("onboarding");
    expect(resumed.profile.display_name).toBe("New adult");
    expect(
      (
        await req(uid, "PATCH", "/me/profile", {
          ...draft,
          expectedVersion: 2,
          birthDate: "2015-01-01",
          publish: true,
        })
      ).statusCode,
    ).toBe(422);
    expect((await data(uid, "GET", "/me")).profile.display_name).toBe("");
    await data(uid, "PATCH", "/me/profile", {
      ...draft,
      expectedVersion: 2,
      birthDate: "1995-01-01",
      photos: ["/portraits/0.svg", "/portraits/1.svg"],
      prompts: [
        { question: "First date", answer: "Coffee" },
        { question: "Together", answer: "Art" },
      ],
      publish: true,
    });
    expect((await data(uid, "GET", "/me")).status).toBe("active");
  });
  it("never treats approval or pending capture as completed payment", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    vi.spyOn(provider, "captureOrder").mockResolvedValue({
      id: "pending",
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ id: "cap-pending", status: "PENDING" }] } },
      ],
    });
    const result = await data(
      a,
      "POST",
      `/payments/${purchase.paymentId}/capture`,
      {},
    );
    expect(result.state).toBe("pending");
    expect((await data(a, "GET", `/date-plans/${p.id}`)).status).toBe(
      "accepted",
    );
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM financial_events")).n,
    ).toBe(0);
  });
  it("reconciles provider success after a capture timeout without a second charge", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    const capture = vi
      .spyOn(provider, "captureOrder")
      .mockRejectedValue(new Error("network timeout after success"));
    expect(
      (await req(a, "POST", `/payments/${purchase.paymentId}/capture`, {}))
        .statusCode,
    ).toBe(503);
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).state,
    ).toBe("unknown");
    vi.spyOn(provider, "getOrder").mockResolvedValue({
      id: "recovered",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [{ id: "reconciled-capture", status: "COMPLETED" }],
          },
        },
      ],
    });
    await workerTick();
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).state,
    ).toBe("completed");
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it("retains refund-pending until provider evidence confirms completion", async () => {
    const p = await accepted();
    const purchase = await data(a, "POST", "/purchases", {
      planId: p.id,
      proposalVersion: 1,
    });
    await data(a, "POST", "/payments/orders", {
      paymentId: purchase.paymentId,
    });
    await data(a, "POST", `/payments/${purchase.paymentId}/capture`, {});
    await data(a, "POST", `/date-plans/${p.id}/cancel`, { expectedVersion: 1 });
    vi.spyOn(provider, "refundCapture").mockResolvedValue({
      id: "pending-refund",
      status: "PENDING",
    });
    await workerTick();
    expect(
      (await data(a, "GET", `/payments/${purchase.paymentId}`)).refunds[0]
        .state,
    ).toBe("pending");
    expect((await data(a, "GET", `/date-plans/${p.id}`)).financialState).toBe(
      "refund_pending",
    );
  });
  it("uses calendar age boundaries including the day before an eighteenth birthday", () => {
    expect(ageOn("2008-11-10", new Date("2026-11-09T23:59:59Z"))).toBe(17);
    expect(ageOn("2008-11-10", new Date("2026-11-10T00:00:00Z"))).toBe(18);
    expect(ageOn("2000-02-30")).toBe(-1);
  });
  it("exports only own messages and revokes access on deletion", async () => {
    const m = await match();
    await sendMessage(a, m, "my message", randomUUID());
    await sendMessage(b, m, "partner secret message", randomUUID());
    const result = await data(a, "POST", "/me/export", { password });
    expect(JSON.stringify(result)).not.toContain("partner secret message");
    await data(a, "DELETE", "/me", { password });
    expect((await req(a, "GET", "/me")).statusCode).toBe(401);
    expect(
      (await req(b, "GET", `/conversations/${m}/messages`)).statusCode,
    ).toBe(404);
  });
  it("exports the requester's own plans and budget but never the partner's", async () => {
    const p = await plan();
    const result = await data(a, "POST", "/me/export", { password });
    expect(result.datePreferences).toEqual([
      expect.objectContaining({ plan_id: p.id, budgetCents: 5000 }),
    ]);
    expect(result.datePlans.map((d: any) => d.id)).toEqual([p.id]);
    expect(result.decisions).toEqual([{ target_id: b, action: "like" }]);
    expect(JSON.stringify(result)).not.toMatch(/budget_encrypted|4000|csrf/);
    await data(a, "DELETE", "/me", { password });
    for (const sql of [
      "SELECT 1 FROM decisions WHERE actor_id=$1 OR target_id=$1",
      "SELECT 1 FROM notifications WHERE user_id=$1",
      "SELECT 1 FROM private_date_preferences WHERE user_id=$1",
    ])
      expect((await db.query(sql, [a])).rowCount).toBe(0);
  });
  it("authorizes live socket subscriptions and revokes blocked and logged-out sessions", async () => {
    const mid = await match();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const clients: Socket[] = [];
    async function connect(user: string) {
      const socket = clientIO(address, {
        transports: user === b ? ["polling"] : ["websocket"],
        upgrade: false,
        extraHeaders:
          user === b
            ? {
                Referer: origin + "/chats",
                "Sec-Fetch-Site": "same-origin",
                Cookie: accounts[user].cookie,
              }
            : { Origin: origin, Cookie: accounts[user].cookie },
        reconnection: false,
      });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      return socket;
    }
    const ack = (socket: Socket, event: string, payload: unknown) =>
      new Promise<any>((resolve, reject) =>
        socket
          .timeout(3000)
          .emit(event, payload, (error: Error, result: any) =>
            error ? reject(error) : resolve(result),
          ),
      );
    try {
      const sa = await connect(a),
        sb = await connect(b),
        sc = await connect(c);
      expect((await ack(sa, "conversation.subscribe", mid)).ok).toBe(true);
      expect((await ack(sb, "conversation.subscribe", mid)).ok).toBe(true);
      expect((await ack(sc, "conversation.subscribe", mid)).error).toBeTruthy();
      expect(
        (
          await ack(sc, "message.send", {
            conversationId: mid,
            text: "forbidden",
            clientMessageId: randomUUID(),
          })
        ).error,
      ).toBeTruthy();
      const received = new Promise<any>((resolve) =>
        sb.once("message.created", resolve),
      );
      const sent = await ack(sa, "message.send", {
        conversationId: mid,
        text: "live persisted message",
        clientMessageId: randomUUID(),
      });
      expect(sent.data.text).toBe("live persisted message");
      expect((await received).id).toBe(sent.data.id);
      const revoked = new Promise((resolve) =>
        sb.once("access.revoked", resolve),
      );
      await data(a, "POST", "/blocks", { targetId: b });
      await revoked;
      expect((await ack(sb, "conversation.subscribe", mid)).error).toBeTruthy();
      const disconnected = new Promise((resolve) =>
        sa.once("disconnect", resolve),
      );
      await data(a, "POST", "/auth/logout", {});
      await disconnected;
      expect(sa.connected).toBe(false);
    } finally {
      for (const socket of clients) socket.disconnect();
    }
  });
});
