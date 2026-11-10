import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
test("integration readiness is authenticated and redacted; previews require CSRF and explicit permission", async () => {
  const f = fixture();
  try {
    assert.equal(
      (await f.request(null, "GET", "/integrations/status")).status,
      401,
    );
    await f.login("Alex");
    f.env.BAEPAL_INTEGRATIONS_JSON = JSON.stringify({
      version: 1,
      providers: {
        astropods: {
          enabled: true,
          protocol: "baepal-gateway-v1",
          baseUrl: "https://gateway.example.com",
          auth: "bearer",
          token: "fixture-secret-only",
          operations: ["explain"],
        },
      },
    });
    const status = await f.data("Alex", "GET", "/integrations/status");
    assert.equal(status.providers[0].state, "configured_unverified");
    assert.equal(JSON.stringify(status).includes("fixture-secret"), false);
    assert.equal(JSON.stringify(status).includes("gateway.example"), false);
    const payload = {
      operation: "explain",
      allowExternalProcessing: true,
      input: { interests: ["arts"], sharedInterests: ["arts"] },
    };
    assert.equal(
      (
        await f.request(
          "Alex",
          "POST",
          "/integrations/preview",
          payload,
          "owner-one",
          { "x-csrf-token": "invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("Alex", "POST", "/integrations/preview", {
          ...payload,
          allowExternalProcessing: false,
        })
      ).status,
      400,
    );
    f.env.BAEPAL_INTEGRATIONS_JSON = undefined;
    const disabled = await f.request(
      "Alex",
      "POST",
      "/integrations/preview",
      payload,
    );
    assert.equal(disabled.status, 503);
    assert.equal(
      ((await disabled.json()) as any).error.code,
      "INTEGRATION_DISABLED",
    );
  } finally {
    f.db.close();
  }
});
test("authorized preview passes only selected broad interests; failures remain sanitized", async () => {
  const f = fixture();
  const previous = globalThis.fetch;
  try {
    await f.login("Alex");
    f.env.BAEPAL_INTEGRATIONS_JSON = JSON.stringify({
      version: 1,
      providers: {
        astropods: {
          enabled: true,
          protocol: "baepal-gateway-v1",
          baseUrl: "https://gateway.example.com",
          auth: "bearer",
          token: "fixture-secret-only",
          operations: ["explain"],
        },
      },
    });
    const payload = {
      operation: "explain",
      allowExternalProcessing: true,
      input: { interests: ["arts"], sharedInterests: ["arts"] },
    };
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(init!.body as string).input, payload.input);
      return Response.json({
        version: 1,
        data: { summary: "Shared art interest." },
      });
    };
    const value = await f.data(
      "Alex",
      "POST",
      "/integrations/preview",
      payload,
    );
    assert.equal(value.data.summary, "Shared art interest.");
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response("fixture-secret-only", { status: 500 });
    const failed = await f.request(
      "Alex",
      "POST",
      "/integrations/preview",
      payload,
    );
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes("fixture-secret-only"), false);
  } finally {
    globalThis.fetch = previous;
    f.db.close();
  }
});
