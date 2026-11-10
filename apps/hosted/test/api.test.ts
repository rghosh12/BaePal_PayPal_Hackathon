import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAPI } from "../src/api";
import { fixture } from "./helpers";
const origin = "https://baepal.test";

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
    const oldFetch = globalThis.fetch;
    try {
      f.env.BAEPAL_INTEGRATIONS_JSON = JSON.stringify({
        version: 1,
        providers: {
          astropods: {
            enabled: true,
            protocol: "baepal-gateway-v1",
            baseUrl: "https://gateway.example.com",
            auth: "bearer",
            token: "fixture-secret-only",
            operations: ["plan"],
          },
        },
      });
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        const input = JSON.parse(init!.body as string).input;
        assert.deepEqual(Object.keys(input.options[0]).sort(), [
          "activity",
          "id",
          "priceCents",
          "title",
        ]);
        assert.equal(JSON.stringify(input).includes("5000"), false);
        return Response.json({
          version: 1,
          data: {
            suggestions: [{ id: "art", reason: "An eligible art option." }],
          },
        });
      };
      const external = await f.data(
        "Alex",
        "POST",
        `/date-plans/${p.id}/suggestions`,
        { useExternalProvider: true, allowExternalProcessing: true },
      );
      assert.equal(external.options[0].price_cents, 3000);
      assert.equal(external.evidence.mode, "gateway");
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = oldFetch;
    }

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
