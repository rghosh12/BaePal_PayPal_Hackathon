import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleAPI } from "../src/api";
import type { Env } from "../src/types";
const origin = "https://baepal.test";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE prototype_workspaces(id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,updated_at TEXT NOT NULL)",
  );
  const env: Env = {
    FIELD_ENCRYPTION_KEY: "ab".repeat(32),
    DB: {
      prepare(sql) {
        let values: unknown[] = [];
        const statement = {
          bind(...args: unknown[]) {
            values = args;
            return statement;
          },
          async first<T>() {
            return (db.prepare(sql).get(...(values as any[])) ||
              null) as T | null;
          },
          async all<T>() {
            return {
              results: db.prepare(sql).all(...(values as any[])) as T[],
            };
          },
          async run() {
            const result = db.prepare(sql).run(...(values as any[]));
            return { meta: { changes: Number(result.changes) } };
          },
        };
        return statement;
      },
    },
  };
  const sessions: Record<string, { cookie: string; csrf: string }> = {};
  async function request(
    actor: string | null,
    method: string,
    path: string,
    body?: unknown,
    owner = "owner-one",
    headers: Record<string, string> = {},
  ) {
    return handleAPI(
      new Request(origin + "/api/v1" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": owner,
          Origin: origin,
          "Content-Type": "application/json",
          ...(actor ? sessions[actor] : {}),
          ...(actor ? { "x-csrf-token": sessions[actor].csrf } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }
  async function data(
    actor: string | null,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const r = await request(actor, method, path, body);
    const response = (await r.json()) as any;
    assert.equal(r.status, 200, JSON.stringify(response));
    return response.data;
  }
  async function login(name: string) {
    const r = await request(null, "POST", "/auth/login", {
      email: name.toLowerCase() + "@demo.baepal.invalid",
    });
    const value = (await r.json()) as any;
    sessions[name] = {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      csrf: value.data.csrf,
    };
    return data(name, "GET", "/me");
  }
  return { db, env, request, data, login, sessions };
}
test("persistent hosted two-person journey, private budgets, independent capture and refund", async () => {
  const f = fixture();
  try {
    const a = await f.login("Alex"),
      b = await f.login("Jordan");
    assert.equal(
      (
        await f.request("Alex", "POST", "/me/pause", {}, "owner-one", {
          "x-csrf-token": "",
        })
      ).status,
      403,
    );
    await Promise.all([
      f.data("Alex", "POST", "/decisions", {
        targetId: b.id,
        action: "like",
        clientMutationId: crypto.randomUUID(),
      }),
      f.data("Jordan", "POST", "/decisions", {
        targetId: a.id,
        action: "like",
        clientMutationId: crypto.randomUUID(),
      }),
    ]);
    const matches = await f.data("Alex", "GET", "/matches");
    assert.equal(matches.length, 1);
    const mid = matches[0].id;
    const cid = crypto.randomUUID();
    await Promise.all([
      f.data("Alex", "POST", `/conversations/${mid}/messages`, {
        text: "Hello from the hosted prototype",
        clientMessageId: cid,
      }),
      f.data("Alex", "POST", `/conversations/${mid}/messages`, {
        text: "Hello from the hosted prototype",
        clientMessageId: cid,
      }),
    ]);
    assert.equal(
      (await f.data("Jordan", "GET", `/conversations/${mid}/messages`)).length,
      1,
    );
    const p = await f.data("Alex", "POST", "/date-plans", { matchId: mid });
    const start = new Date(Date.now() + 86400000).toISOString(),
      end = new Date(Date.now() + 97200000).toISOString();
    for (const [name, budget] of [
      ["Alex", 4000],
      ["Jordan", 5000],
    ] as const)
      await f.data(name, "PUT", `/date-plans/${p.id}/private-preferences`, {
        budgetCents: budget,
        activities: ["Art"],
        timeStart: start,
        timeEnd: end,
      });
    const view = await f.data("Alex", "GET", `/date-plans/${p.id}`);
    assert.equal(view.ownPreferences.budgetCents, 4000);
    assert.equal(JSON.stringify(view).includes("5000"), false);
    await f.login("Sam");
    assert.equal(
      (await f.request("Sam", "GET", `/date-plans/${p.id}`)).status,
      404,
    );
    const opts = await f.data(
      "Alex",
      "POST",
      `/date-plans/${p.id}/suggestions`,
      {},
    );
    assert.equal(opts.options[0].price_cents, 3000);
    await f.data("Alex", "POST", `/date-plans/${p.id}/proposals`, {
      optionId: "art",
      startsAt: start,
      expectedVersion: 0,
    });
    for (const name of ["Alex", "Jordan"])
      await f.data(name, "POST", `/date-plans/${p.id}/accept`, {
        proposalVersion: 1,
      });
    let first;
    for (const name of ["Alex", "Jordan"]) {
      const buy = await f.data(name, "POST", "/purchases", {
        planId: p.id,
        proposalVersion: 1,
        amountCents: 1,
      });
      if (!first) first = buy;
      await f.data(name, "POST", "/payments/orders", {
        paymentId: buy.paymentId,
      });
      const paid = await f.data(
        name,
        "POST",
        `/payments/${buy.paymentId}/capture`,
        {},
      );
      assert.equal(paid.amount_cents, 3000);
      if (name === "Alex")
        assert.equal(
          (await f.data("Alex", "GET", `/date-plans/${p.id}`)).status,
          "payment_pending",
        );
    }
    assert.equal(
      (await f.data("Alex", "GET", `/date-plans/${p.id}`)).status,
      "confirmed",
    );
    await f.data("Alex", "POST", `/date-plans/${p.id}/cancel`, {
      expectedVersion: 1,
    });
    assert.equal(
      (await f.data("Alex", "GET", `/payments/${first.paymentId}`)).refunds[0]
        .state,
      "completed",
    );
    assert.equal(
      (await f.request("Jordan", "GET", `/payments/${first.paymentId}`)).status,
      404,
    );
    await f.data("Jordan", "POST", "/blocks", { targetId: a.id });
    assert.equal(
      (await f.request("Alex", "GET", `/conversations/${mid}/messages`)).status,
      404,
    );
    assert.equal(
      (await f.data("Alex", "GET", `/payments/${first.paymentId}`)).state,
      "refunded",
    );
    const stored = f.db
      .prepare("SELECT state FROM prototype_workspaces")
      .get() as any;
    assert.ok(stored.state.startsWith("v1:"));
    assert.equal(stored.state.includes("Alex"), false);
  } finally {
    f.db.close();
  }
});
test("platform identity, per-owner isolation and anonymous/origin rejection", async () => {
  const f = fixture();
  try {
    await f.login("Alex");
    const a = await f.data("Alex", "GET", "/me");
    assert.equal(
      (await f.request("Alex", "GET", "/me", undefined, "owner-two")).status,
      200,
    );
    await f.data("Alex", "PATCH", "/me/profile", {
      expectedVersion: 1,
      displayName: "A private name",
      bio: "Only owner one",
      birthDate: "1995-01-01",
      gender: "Nonbinary",
      genders: ["Woman", "Man", "Nonbinary"],
      ageMin: 18,
      ageMax: 99,
      city: "Seattle",
      intention: "Long-term relationship",
      interests: ["Art"],
      prompts: [
        { question: "One", answer: "One" },
        { question: "Two", answer: "Two" },
      ],
      photos: ["/portraits/0.svg", "/portraits/1.svg"],
      publish: true,
    });
    const other = await f.request("Alex", "GET", "/me", undefined, "owner-two");
    assert.equal(
      ((await other.json()) as any).data.profile.display_name,
      "Alex",
    );
    assert.notEqual(
      (await f.data("Alex", "GET", "/me")).profile.display_name,
      a.profile.display_name,
    );
    assert.equal(
      (await handleAPI(new Request(origin + "/api/v1/me"), f.env)).status,
      401,
    );
    assert.equal(
      (
        await f.request("Alex", "POST", "/me/pause", {}, "owner-one", {
          Origin: "https://evil.test",
        })
      ).status,
      403,
    );
  } finally {
    f.db.close();
  }
});
