import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIntegrationHub,
  integrationStatus,
  validatePreview,
  rankCatalogue,
} from "../index.mjs";
const entry = {
  enabled: true,
  protocol: "baepal-gateway-v1",
  baseUrl: "https://gateway.example.com/baepal",
  auth: "bearer",
  token: "fixture-token-only",
  operations: ["explain", "plan"],
  timeoutMs: 100,
};
const raw = (changes) =>
  JSON.stringify({
    version: 1,
    providers: { astropods: { ...entry, ...changes } },
  });
const input = { interests: ["arts"], sharedInterests: ["arts"] };
const permission = { allowExternalProcessing: true };
const response = (data) => Response.json({ version: 1, data });
test("disabled, malformed and partial configuration are distinct; status never serializes settings", () => {
  assert.equal(integrationStatus().providers[0].state, "disabled");
  assert.equal(integrationStatus("{").configurationValid, false);
  assert.equal(
    integrationStatus(raw({ token: "" })).providers[0].state,
    "invalid",
  );
  assert.equal(
    integrationStatus(raw({ enabled: false, token: "" })).providers[0].state,
    "disabled",
  );
  const status = JSON.stringify(integrationStatus(raw()));
  assert.match(status, /configured_unverified/);
  for (const value of [entry.baseUrl, entry.token, "Authorization"])
    assert.equal(status.includes(value), false);
});
test("configuration rejects insecure destinations, embedded credentials, fragments and unsupported operations", () => {
  for (const baseUrl of [
    "http://gateway.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://api.internal",
    "https://user:pass@gateway.example.com",
    "https://gateway.example.com?token=foo",
    "https://gateway.example.com/#key",
    "https://gateway.example.com:8443",
  ])
    assert.equal(
      integrationStatus(raw({ baseUrl })).providers[0].state,
      "invalid",
      baseUrl,
    );
  assert.equal(
    integrationStatus(raw({ operations: ["charge"] })).providers[0].state,
    "invalid",
  );
  assert.equal(
    integrationStatus(
      JSON.stringify({ version: 1, providers: { unknown: entry } }),
    ).configurationValid,
    false,
  );
});
test("preview requires explicit one-time permission and rejects unknown fields and raw history", () => {
  for (const value of [
    { operation: "explain", input },
    { operation: "charge", input, ...permission },
    {
      operation: "explain",
      input: { ...input, receipts: ["secret"] },
      ...permission,
    },
    {
      operation: "explain",
      input,
      url: "https://evil.example.com",
      ...permission,
    },
  ])
    assert.throws(() => validatePreview(value), { code: "INTEGRATION_INPUT" });
  assert.equal(
    validatePreview({ operation: "explain", input, ...permission }).provider,
    "astropods",
  );
});
test("disabled and unconsented requests never call the network", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({ summary: "A shared interest." });
  };
  await assert.rejects(
    createIntegrationHub(undefined, { fetchImpl }).invoke(
      "astropods",
      "explain",
      input,
      permission,
    ),
    { code: "INTEGRATION_DISABLED" },
  );
  await assert.rejects(
    createIntegrationHub(raw(), { fetchImpl }).invoke(
      "astropods",
      "explain",
      input,
      {},
    ),
    { code: "INTEGRATION_INPUT" },
  );
  assert.equal(calls, 0);
});
test("gateway transport uses configured auth and path, normalized envelope, no automatic retries or identity", async () => {
  let calls = 0;
  const result = await createIntegrationHub(raw(), {
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url.href, entry.baseUrl + "/explain");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer " + entry.token);
      const body = JSON.parse(init.body);
      assert.equal(body.version, 1);
      assert.deepEqual(body.input, input);
      assert.deepEqual(Object.keys(body).sort(), [
        "input",
        "operation",
        "requestId",
        "version",
      ]);
      return response({ summary: "Art is a shared interest." });
    },
  }).invoke("astropods", "explain", input, permission);
  assert.equal(calls, 1);
  assert.equal(result.data.summary, "Art is a shared interest.");
  assert.equal(result.evidence.verifiedNativeProvider, false);
  assert.equal(JSON.stringify(result.evidence).includes(entry.token), false);
});
test("upstream failures never disclose body, endpoint or token and never retry", async () => {
  for (const status of [401, 429, 500, 302]) {
    let calls = 0;
    const hub = createIntegrationHub(raw(), {
      fetchImpl: async () => {
        calls++;
        return new Response(entry.token + entry.baseUrl, { status });
      },
    });
    await assert.rejects(
      hub.invoke("astropods", "explain", input, permission),
      (e) => {
        assert.equal(e.message.includes(entry.token), false);
        assert.equal(e.message.includes(entry.baseUrl), false);
        return (
          e.code ===
          (status === 429 ? "INTEGRATION_RATE_LIMIT" : "INTEGRATION_UPSTREAM")
        );
      },
    );
    assert.equal(calls, 1);
  }
});
test("timeout bounds request and response consumption; responses must match contract and size", async () => {
  await assert.rejects(
    createIntegrationHub(raw(), {
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(Error("private diagnostic")),
          ),
        ),
    }).invoke("astropods", "explain", input, permission),
    { code: "INTEGRATION_TIMEOUT" },
  );
  for (const res of [
    response({ summary: "valid", unexpected: "private" }),
    Response.json({ data: { summary: "missing version" } }),
    new Response("<html>secret</html>"),
    response({ summary: "x".repeat(70000) }),
  ])
    await assert.rejects(
      createIntegrationHub(raw(), { fetchImpl: async () => res }).invoke(
        "astropods",
        "explain",
        input,
        permission,
      ),
      { code: "INTEGRATION_RESPONSE" },
    );
});
test("model cannot add unavailable options, repeat IDs or change immutable catalogue prices", async () => {
  const options = [
    {
      id: "art",
      title: "Fictional art",
      activity: "Art",
      price_cents: 3000,
      privateBudget: 9000,
    },
  ];
  const previous = globalThis.fetch;
  try {
    for (const suggestions of [
      [{ id: "unknown", reason: "Invented" }],
      [
        { id: "art", reason: "One" },
        { id: "art", reason: "Two" },
      ],
    ]) {
      globalThis.fetch = async () => response({ suggestions });
      await assert.rejects(rankCatalogue(raw(), options, permission), {
        code: "INTEGRATION_RESPONSE",
      });
    }
    globalThis.fetch = async (_url, init) => {
      const text = init.body;
      assert.equal(text.includes("privateBudget"), false);
      assert.equal(text.includes("9000"), false);
      return response({
        suggestions: [{ id: "art", reason: "An art option." }],
      });
    };
    const result = await rankCatalogue(raw(), options, permission);
    assert.equal(result.options[0].price_cents, 3000);
  } finally {
    globalThis.fetch = previous;
  }
});
test("provider results cannot carry unsafe outbound URLs or unrequested search candidates", async () => {
  const productConfig = JSON.stringify({
    version: 1,
    providers: { channel3: { ...entry, operations: ["products"] } },
  });
  await assert.rejects(
    createIntegrationHub(productConfig, {
      fetchImpl: async () =>
        response({
          items: [{ id: "one", title: "Example", url: "javascript:alert(1)" }],
        }),
    }).invoke("channel3", "products", { interests: ["arts"] }, permission),
    { code: "INTEGRATION_RESPONSE" },
  );
  const searchConfig = JSON.stringify({
    version: 1,
    providers: { elastic: { ...entry, operations: ["search"] } },
  });
  await assert.rejects(
    createIntegrationHub(searchConfig, {
      fetchImpl: async () =>
        response({ candidates: [{ id: crypto.randomUUID(), score: 1 }] }),
    }).invoke(
      "elastic",
      "search",
      { vector: [0.2], candidateIds: [] },
      permission,
    ),
    { code: "INTEGRATION_RESPONSE" },
  );
});
