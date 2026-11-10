import { writeFile, readFile } from "node:fs/promises";
const item = [];
function request(
  name,
  method,
  path,
  body,
  status,
  assertions = [],
  overrides = {},
) {
  item.push({
    name,
    request: {
      method,
      header: [
        { key: "Origin", value: overrides.origin || "http://localhost:4173" },
        { key: "Content-Type", value: "application/json" },
        { key: "Cookie", value: "{{session_cookie}}" },
        { key: "x-csrf-token", value: overrides.csrf || "{{csrf}}" },
        { key: "x-baepal-test-owner", value: overrides.owner || "{{owner}}" },
      ],
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
            ...assertions,
          ],
        },
      },
    ],
  });
}
const importBody = {
  datasetId: "weekend-reader",
  idempotencyKey: "{{import_key}}",
  consentVersion: 1,
};
request(
  "Login as fictional Alex",
  "POST",
  "/auth/login",
  { email: "alex@demo.baepal.invalid" },
  200,
  [
    'pm.environment.set("csrf", pm.response.json().data.csrf);',
    'pm.environment.set("session_cookie", pm.response.headers.get("set-cookie").split(";")[0]);',
  ],
);
request("Missing CSRF rejected", "POST", "/taste/consents", {}, 403, [], {
  csrf: "invalid",
});
request("Foreign origin rejected", "POST", "/taste/consents", {}, 403, [], {
  origin: "https://example.invalid",
});
request(
  "Real history remains unavailable",
  "GET",
  "/taste/capabilities",
  null,
  200,
  [
    'pm.test("No PayPal history capability", () => pm.expect(pm.response.json().data.realHistoryEnabled).to.equal(false));',
  ],
);
request("Separate purposes default off", "GET", "/taste/profile", null, 200, [
  'pm.test("All purposes off", () => pm.expect(Object.values(pm.response.json().data.consent.purposes)).to.deep.equal([false,false,false,false]));',
]);
request(
  "Import requires consent",
  "POST",
  "/taste/demo-imports",
  importBody,
  409,
);
request(
  "Consent only to matching",
  "POST",
  "/taste/consents",
  {
    expectedVersion: 0,
    purposes: {
      matching: true,
      publicTags: false,
      hostedAI: false,
      commercial: false,
    },
    families: ["categories", "brands", "rhythms"],
  },
  200,
  ['pm.environment.set("consent_id", pm.response.json().data.id);'],
);
request("Synthetic import", "POST", "/taste/demo-imports", importBody, 200, [
  'pm.environment.set("import_id", pm.response.json().data.id);',
  'pm.test("Synthetic source", () => pm.expect(pm.response.json().data.sourceType).to.equal("synthetic"));',
]);
request(
  "Import replay keeps same job",
  "POST",
  "/taste/demo-imports",
  importBody,
  200,
  [
    'pm.test("Same import identity", () => pm.expect(pm.response.json().data.id).to.equal(pm.environment.get("import_id")));',
  ],
);
request(
  "Conflicting replay rejected",
  "POST",
  "/taste/demo-imports",
  { ...importBody, datasetId: "outdoor-explorer" },
  409,
);
request("Evidence available for review", "GET", "/taste/evidence", null, 200, [
  'pm.test("Has synthetic records", () => pm.expect(pm.response.json().data.total).to.be.above(0));',
  'pm.environment.set("evidence_version", pm.response.json().data.evidenceVersion);',
]);
request(
  "Another workspace cannot read import",
  "GET",
  "/taste/imports/{{import_id}}",
  null,
  404,
  [],
  { owner: "{{other_owner}}" },
);
request(
  "Publish reviewed summary",
  "POST",
  "/taste/rebuild",
  { consentVersion: 1, expectedEvidenceVersion: "{{evidence_version}}" },
  200,
  [
    'pm.test("Feature active", () => pm.expect(pm.response.json().data.featureActive).to.equal(true));',
  ],
);
request("Real history sync blocked", "POST", "/taste/paypal-sync", {}, 403);
request(
  "Delete source consent",
  "DELETE",
  "/taste/consents/{{consent_id}}",
  null,
  200,
);
request("Revocation clears evidence", "GET", "/taste/evidence", null, 200, [
  'pm.test("No records remain", () => pm.expect(pm.response.json().data.total).to.equal(0));',
]);
request("Revocation clears feature", "GET", "/taste/profile", null, 200, [
  'pm.test("No active feature", () => pm.expect(pm.response.json().data.featureActive).to.equal(false));',
  'pm.test("No shared tags", () => pm.expect(pm.response.json().data.sharedTags).to.deep.equal([]));',
]);
request(
  "Stale import after revocation rejected",
  "POST",
  "/taste/demo-imports",
  importBody,
  409,
);
// Postman raw numeric interpolation must remain numeric for the Zod contract.
item.find((x) => x.name === "Publish reviewed summary").request.body.raw =
  '{"consentVersion":1,"expectedEvidenceVersion":{{evidence_version}}}';
const collection = {
  info: {
    name: "BaePal synthetic taste regression",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description:
      "Isolated loopback Worker harness only. Fictional data; no PayPal history or payment evidence. Run pnpm test:postman. Never target the deployed Site with test-owner headers.",
  },
  item,
};
const environment = {
  name: "BaePal isolated local harness",
  values: [
    ["base_url", "http://127.0.0.1:4173"],
    ["owner", "replace-with-unique-run-owner"],
    ["other_owner", "replace-with-another-run-owner"],
    ["import_key", "replace-with-uuid"],
    ["session_cookie", ""],
    ["csrf", ""],
  ].map(([key, value]) => ({ key, value, enabled: true })),
  _postman_variable_scope: "environment",
};
for (const [name, value] of [
  ["taste.postman_collection.json", collection],
  ["local.postman_environment.json", environment],
]) {
  const path = new URL("../postman/" + name, import.meta.url);
  const contents = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== contents)
      throw Error("Regenerate " + name);
  } else await writeFile(path, contents);
}
