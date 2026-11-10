import { readFile, writeFile } from "node:fs/promises";
const item = [];
function request(name, method, path, body, status, checks = [], headers = {}) {
  item.push({
    name,
    protocolProfileBehavior: { disableCookies: true },
    request: {
      method,
      header: Object.entries({
        Origin: "{{app_origin}}",
        "Content-Type": "application/json",
        Cookie: "{{session_cookie}}",
        "x-csrf-token": "{{csrf}}",
        ...headers,
      }).map(([key, value]) => ({ key, value })),
      url: "{{base_url}}/api/v1" + path,
      ...(body
        ? {
            body: {
              mode: "raw",
              raw: JSON.stringify(body),
              options: { raw: { language: "json" } },
            },
          }
        : {}),
    },
    event: [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            `pm.test("HTTP ${status}", () => pm.response.to.have.status(${status}));`,
            ...checks,
          ],
        },
      },
    ],
  });
}
const save = (key, path) =>
  `pm.environment.set("${key}", pm.response.json().data.${path});`;
function login(name, email, expected) {
  request(
    name,
    "POST",
    "/auth/login",
    { email, password: "{{password}}" },
    200,
    [
      save("csrf", "csrf"),
      'pm.environment.set("session_cookie", pm.response.headers.get("set-cookie").split(";")[0]);',
    ],
  );
  request(name + " identity binding", "GET", "/me", null, 200, [
    `pm.test("Expected fictional actor", () => pm.expect(pm.response.json().data.id).to.equal(pm.environment.get("${expected}")));`,
  ]);
}
request(
  "Anonymous receipt denied",
  "GET",
  "/payments/{{foreign_payment_id}}",
  null,
  401,
  [],
  { Cookie: "", "x-csrf-token": "" },
);
login("Login fictional actor", "{{actor_email}}", "actor_id");
request(
  "Private budget is owner-only",
  "GET",
  "/date-plans/{{plan_id}}",
  null,
  200,
  [
    'pm.test("Own budget available", () => pm.expect(pm.response.json().data.ownPreferences.budgetCents).to.equal(5297));',
    'pm.test("Partner budget redacted", () => pm.expect(pm.response.text()).not.to.include("4891"));',
  ],
);
request(
  "Guessed conversation denied",
  "GET",
  "/conversations/{{foreign_match_id}}/messages",
  null,
  404,
);
request(
  "Foreign payment receipt denied",
  "GET",
  "/payments/{{foreign_payment_id}}",
  null,
  404,
);
request(
  "Foreign purchase denied",
  "GET",
  "/purchases/{{foreign_purchase_id}}",
  null,
  404,
);
request(
  "Missing CSRF mutation denied",
  "POST",
  "/purchases",
  { planId: "{{plan_id}}", proposalVersion: 1 },
  403,
  [],
  { "x-csrf-token": "invalid" },
);
request(
  "Foreign origin mutation denied",
  "POST",
  "/purchases",
  { planId: "{{plan_id}}", proposalVersion: 1 },
  403,
  [],
  { Origin: "https://example.invalid" },
);
const purchase = {
  planId: "{{plan_id}}",
  proposalVersion: 1,
  amountCents: 1,
  currency: "EUR",
};
request(
  "Create immutable catalogue purchase despite client amount tampering",
  "POST",
  "/purchases",
  purchase,
  200,
  [save("purchase_id", "purchaseId"), save("payment_id", "paymentId")],
);
request(
  "Purchase replay preserves identity",
  "POST",
  "/purchases",
  purchase,
  200,
  [
    'pm.test("Same purchase", () => pm.expect(pm.response.json().data.purchaseId).to.equal(pm.environment.get("purchase_id")));',
    'pm.test("Same payment", () => pm.expect(pm.response.json().data.paymentId).to.equal(pm.environment.get("payment_id")));',
  ],
);
request(
  "Server price and currency remain authoritative",
  "GET",
  "/purchases/{{purchase_id}}",
  null,
  200,
  [
    'pm.test("Catalogue amount", () => pm.expect(pm.response.json().data.amount_cents).to.equal(3000));',
    'pm.test("Catalogue currency", () => pm.expect(pm.response.json().data.currency).to.equal("USD"));',
  ],
);
request(
  "Create mock order",
  "POST",
  "/payments/orders",
  { paymentId: "{{payment_id}}" },
  200,
  [
    save("order_id", "orderId"),
    'pm.test("Explicit mock mode", () => pm.expect(pm.response.json().data.mode).to.equal("mock"));',
  ],
);
request(
  "Order replay preserves provider operation",
  "POST",
  "/payments/orders",
  { paymentId: "{{payment_id}}" },
  200,
  [
    'pm.test("Same order", () => pm.expect(pm.response.json().data.orderId).to.equal(pm.environment.get("order_id")));',
  ],
);
request(
  "Capture actor mock payment",
  "POST",
  "/payments/{{payment_id}}/capture",
  {},
  200,
  [
    save("capture_id", "capture_id"),
    'pm.test("Capture complete", () => pm.expect(pm.response.json().data.state).to.equal("completed"));',
  ],
);
request(
  "Capture replay does not create another capture",
  "POST",
  "/payments/{{payment_id}}/capture",
  {},
  200,
  [
    'pm.test("Same capture", () => pm.expect(pm.response.json().data.capture_id).to.equal(pm.environment.get("capture_id")));',
  ],
);
request(
  "First payer cannot confirm the plan",
  "GET",
  "/date-plans/{{plan_id}}",
  null,
  200,
  [
    'pm.test("Still payment pending", () => pm.expect(pm.response.json().data.status).to.equal("payment_pending"));',
  ],
);
login("Login fictional peer", "{{peer_email}}", "peer_id");
request(
  "Peer cannot capture actor payment",
  "POST",
  "/payments/{{payment_id}}/capture",
  {},
  404,
);
request(
  "Peer order",
  "POST",
  "/payments/orders",
  { paymentId: "{{foreign_payment_id}}" },
  200,
);
request(
  "Peer capture",
  "POST",
  "/payments/{{foreign_payment_id}}/capture",
  {},
  200,
  [
    'pm.test("Peer captured independently", () => pm.expect(pm.response.json().data.state).to.equal("completed"));',
  ],
);
request(
  "Both payers confirm the same plan",
  "GET",
  "/date-plans/{{plan_id}}",
  null,
  200,
  [
    'pm.test("Confirmed after both payments", () => pm.expect(pm.response.json().data.status).to.equal("confirmed"));',
  ],
);
login("Return to fictional actor", "{{actor_email}}", "actor_id");
request(
  "Unsigned webhook rejected",
  "POST",
  "/webhooks/paypal",
  {
    id: "synthetic-unsigned-event",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {},
  },
  403,
  [
    'pm.test("Signature error", () => pm.expect(pm.response.json().error.code).to.equal("INVALID_SIGNATURE"));',
  ],
);
request(
  "Cancel paid plan",
  "POST",
  "/date-plans/{{plan_id}}/cancel",
  { expectedVersion: 1 },
  200,
);
request(
  "Wait for verified refund",
  "GET",
  "/payments/{{payment_id}}",
  null,
  200,
  [
    "const receipt=pm.response.json().data;",
    'const attempts=Number(pm.environment.get("refund_poll_count") || 0)+1;',
    'pm.environment.set("refund_poll_count", attempts);',
    'if (receipt.state !== "refunded" && attempts < 30) { setTimeout(() => pm.execution.setNextRequest("Wait for verified refund"), 100); } else {',
    'pm.test("Refund receipt verified complete", () => pm.expect(receipt.state).to.equal("refunded"));',
    'pm.test("Full refund amount", () => pm.expect(receipt.refunds[0].amount_cents).to.equal(3000));',
    'pm.test("Refund completed", () => pm.expect(receipt.refunds[0].state).to.equal("completed"));',
    "}",
  ],
);
request(
  "Wait for both refunds to settle the plan",
  "GET",
  "/date-plans/{{plan_id}}",
  null,
  200,
  [
    "const plan=pm.response.json().data;",
    'const attempts=Number(pm.environment.get("plan_refund_poll_count") || 0)+1;',
    'pm.environment.set("plan_refund_poll_count", attempts);',
    'if (plan.financialState !== "refunded" && attempts < 30) { setTimeout(() => pm.execution.setNextRequest("Wait for both refunds to settle the plan"), 100); } else {',
    'pm.test("Both refunds reconciled", () => pm.expect(plan.financialState).to.equal("refunded"));',
    "}",
  ],
);
request(
  "Cancel replay preserves refunded terminal state",
  "POST",
  "/date-plans/{{plan_id}}/cancel",
  { expectedVersion: 1 },
  200,
);
request(
  "Refunded plan remains refunded",
  "GET",
  "/date-plans/{{plan_id}}",
  null,
  200,
  [
    'pm.test("Cancelled plan", () => pm.expect(pm.response.json().data.status).to.equal("cancelled"));',
    'pm.test("Refunded financial state", () => pm.expect(pm.response.json().data.financialState).to.equal("refunded"));',
  ],
);
request(
  "Block revokes chat access",
  "POST",
  "/blocks",
  { targetId: "{{peer_id}}" },
  200,
);
request(
  "Blocked conversation unavailable",
  "GET",
  "/conversations/{{match_id}}/messages",
  null,
  404,
);
request(
  "Owner retains receipt after blocking",
  "GET",
  "/payments/{{payment_id}}",
  null,
  200,
  [
    'pm.test("Refunded receipt retained", () => pm.expect(pm.response.json().data.state).to.equal("refunded"));',
  ],
);
login("Peer retains own refund after blocking", "{{peer_email}}", "peer_id");
request(
  "Peer refund is verified independently",
  "GET",
  "/payments/{{foreign_payment_id}}",
  null,
  200,
  [
    'pm.test("Peer receipt refunded", () => pm.expect(pm.response.json().data.state).to.equal("refunded"));',
    'pm.test("Peer refund complete", () => pm.expect(pm.response.json().data.refunds[0].state).to.equal("completed"));',
    'pm.test("Peer refund amount", () => pm.expect(pm.response.json().data.refunds[0].amount_cents).to.equal(3000));',
  ],
);
const collection = {
  info: {
    name: "BaePal synthetic core/payment regression",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description:
      "Actual Newman execution against an isolated loopback original API and randomly scoped PostgreSQL schema. Fictional data and mock provider only; no Sandbox claim. Run pnpm test:postman:core.",
  },
  item,
};
const environment = {
  name: "BaePal isolated core fixture",
  _postman_variable_scope: "environment",
  values: [
    "base_url",
    "app_origin",
    "actor_email",
    "actor_id",
    "peer_email",
    "password",
    "plan_id",
    "match_id",
    "peer_id",
    "foreign_payment_id",
    "foreign_purchase_id",
    "foreign_match_id",
    "session_cookie",
    "csrf",
  ].map((key) => ({ key, value: "", enabled: true })),
};
for (const [name, value] of [
  ["core.postman_collection.json", collection],
  ["core-local.postman_environment.json", environment],
]) {
  const path = new URL("../postman/" + name, import.meta.url),
    contents = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== contents)
      throw Error("Regenerate " + name);
  } else await writeFile(path, contents);
}

const sandboxItems = [];
function sandboxRequest(name, method, path, body, checks, approval) {
  const events = [];
  if (name !== "Verify original API Sandbox mode")
    events.push({
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          'if (pm.environment.get("sandbox_verified") !== "true") pm.execution.skipRequest();',
          ...(approval
            ? [
                `if (pm.environment.get("${approval}") !== "true") pm.execution.skipRequest();`,
              ]
            : []),
        ],
      },
    });
  if (name === "Verify original API Sandbox mode")
    events.push({
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: ['pm.environment.set("sandbox_verified", "false");'],
      },
    });
  events.push({
    listen: "test",
    script: { type: "text/javascript", exec: checks },
  });
  sandboxItems.push({
    name,
    protocolProfileBehavior: { disableCookies: true },
    request: {
      method,
      header: Object.entries({
        Origin: "{{app_origin}}",
        "Content-Type": "application/json",
        Cookie: "{{session_cookie}}",
        "x-csrf-token": "{{csrf}}",
      }).map(([key, value]) => ({ key, value })),
      url: "{{base_url}}/api/v1" + path,
      ...(body
        ? {
            body: {
              mode: "raw",
              raw: body,
              options: { raw: { language: "json" } },
            },
          }
        : {}),
    },
    event: events,
  });
}
sandboxRequest("Verify original API Sandbox mode", "GET", "/config", null, [
  'const verified=pm.response.code===200 && pm.response.json().data.paymentMode==="sandbox";',
  'pm.environment.set("sandbox_verified", verified ? "true" : "false");',
  'pm.test("Actual BaePal API uses Sandbox", () => pm.expect(verified).to.equal(true));',
]);
sandboxRequest(
  "Sign in with your own Sandbox app account",
  "POST",
  "/auth/login",
  '{"email":"{{email}}","password":"{{password}}"}',
  [
    'pm.test("Authenticated", () => pm.response.to.have.status(200));',
    'pm.environment.set("csrf", pm.response.json().data.csrf);',
    'pm.environment.set("session_cookie", pm.response.headers.get("set-cookie").split(";")[0]);',
  ],
);
sandboxRequest(
  "Create your already accepted Sandbox purchase",
  "POST",
  "/purchases",
  '{"planId":"{{plan_id}}","proposalVersion":{{proposal_version}}}',
  [
    'pm.test("Purchase created", () => pm.response.to.have.status(200));',
    'pm.environment.set("purchase_id", pm.response.json().data.purchaseId);',
    'pm.environment.set("payment_id", pm.response.json().data.paymentId);',
  ],
);
sandboxRequest(
  "Create order then manually approve with Sandbox buyer",
  "POST",
  "/payments/orders",
  '{"paymentId":"{{payment_id}}"}',
  [
    'pm.test("Order created", () => pm.response.to.have.status(200));',
    'pm.test("Actual Sandbox order", () => pm.expect(pm.response.json().data.mode).to.equal("sandbox"));',
    'pm.environment.set("order_id", pm.response.json().data.orderId);',
    'pm.environment.set("approval_url", pm.response.json().data.approvalUrl);',
    'pm.environment.set("buyer_approval_confirmed", "false");',
  ],
);
sandboxRequest(
  "Capture only after explicit manual buyer approval",
  "POST",
  "/payments/{{payment_id}}/capture",
  "{}",
  [
    'pm.environment.set("buyer_approval_confirmed", "false");',
    'pm.test("Capture response recorded", () => pm.expect([200,503]).to.include(pm.response.code));',
    'if(pm.response.code===200) pm.test("Provider outcome retained", () => pm.expect(["completed","pending","unknown","capture_pending"]).to.include(pm.response.json().data.state));',
  ],
  "buyer_approval_confirmed",
);
sandboxRequest(
  "Read your Sandbox receipt and immutable USD amount",
  "GET",
  "/payments/{{payment_id}}",
  null,
  [
    'pm.test("Owner receipt", () => pm.response.to.have.status(200));',
    'pm.test("Expected immutable amount", () => pm.expect(pm.response.json().data.amount_cents).to.equal(Number(pm.environment.get("expected_amount_cents"))));',
    'pm.test("USD", () => pm.expect(pm.response.json().data.currency).to.equal("USD"));',
  ],
);
sandboxRequest(
  "Reject unsigned Sandbox webhook",
  "POST",
  "/webhooks/paypal",
  '{"id":"synthetic-unsigned-sandbox-check","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{}}',
  [
    'pm.test("Unsigned webhook denied", () => pm.response.to.have.status(403));',
    'pm.test("Signature failure", () => pm.expect(pm.response.json().error.code).to.equal("INVALID_SIGNATURE"));',
  ],
);
sandboxRequest(
  "Cancel only after explicit manual cancellation approval",
  "POST",
  "/date-plans/{{plan_id}}/cancel",
  '{"expectedVersion":{{proposal_version}}}',
  [
    'pm.environment.set("cancel_approved", "false");',
    'pm.test("Cancellation accepted", () => pm.response.to.have.status(200));',
  ],
  "cancel_approved",
);
sandboxRequest(
  "Verify actual completed refund after reconciliation",
  "GET",
  "/payments/{{payment_id}}",
  null,
  [
    'pm.test("Owner receipt", () => pm.response.to.have.status(200));',
    'pm.test("Provider refund completion observed", () => pm.expect(pm.response.json().data.state).to.equal("refunded"));',
    'pm.test("Refund evidence complete", () => pm.expect(pm.response.json().data.refunds[0].state).to.equal("completed"));',
  ],
);
const sandboxCollection = {
  info: {
    name: "BaePal manual Sandbox evidence (not executed)",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description:
      "MANUAL ONLY. No Sandbox evidence has been recorded. Requires an original BaePal API configured for Sandbox, your own accepted plan, explicit enablement, manual buyer approval before capture and separate approval before cancellation. Never run this against the hosted mock Site. Read postman/README.md.",
  },
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          'const enabled=pm.environment.get("sandbox_execution_enabled")==="true";',
          'const base=pm.environment.get("base_url") || "";',
          "if (!enabled || !/^https:\\/\\//.test(base) || /example\\.(com|invalid|test)/.test(base)) pm.execution.skipRequest();",
        ],
      },
    },
  ],
  item: sandboxItems,
};
const sandboxEnvironment = {
  name: "BaePal manual Sandbox placeholders (disabled)",
  _postman_variable_scope: "environment",
  values: [
    ...[
      "base_url",
      "app_origin",
      "email",
      "password",
      "plan_id",
      "proposal_version",
      "expected_amount_cents",
      "payment_id",
      "purchase_id",
      "session_cookie",
      "csrf",
      "approval_url",
      "order_id",
    ].map((key) => ({ key, value: "", enabled: true })),
    ...[
      "sandbox_execution_enabled",
      "sandbox_verified",
      "buyer_approval_confirmed",
      "cancel_approved",
    ].map((key) => ({ key, value: "false", enabled: true })),
  ],
};
for (const [name, value] of [
  ["sandbox-manual.postman_collection.json", sandboxCollection],
  ["sandbox.postman_environment.json", sandboxEnvironment],
]) {
  const path = new URL("../postman/" + name, import.meta.url),
    contents = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== contents)
      throw Error("Regenerate " + name);
  } else await writeFile(path, contents);
}
