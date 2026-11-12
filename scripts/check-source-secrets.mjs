import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Deliberately bounded signatures. This is a source hygiene gate, not a claim
// to identify every possible credential or replace provider-side rotation.
const signatures = [
  [
    "private key",
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/],
];
const detect = (text) =>
  signatures.filter(([, rule]) => rule.test(text)).map(([kind]) => kind);
const excluded = (path) =>
  /(^|\/)(?:node_modules|\.data|\.secrets)(?:\/|$)/.test(path) ||
  (/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".example")) ||
  /(^|\/)\.dev\.vars/.test(path) ||
  /^integrations\/.*\.local\.json$/.test(path) ||
  /^(?:vendor\/proprietary|recordings\/private|submission\/private)\//.test(
    path,
  ) ||
  /\.(?:pem|key)$/.test(path);

if (process.argv.includes("--self-test")) {
  const samples = [
    "-----BEGIN " + "PRIVATE KEY-----",
    "gh" + "p_" + "A".repeat(36),
    "github_" + "pat_" + "a".repeat(70),
    "AK" + "IA" + "A".repeat(16),
    "xox" + "b-" + "a".repeat(30),
  ];
  for (const sample of samples) assert.equal(detect(sample).length, 1);
  assert.deepEqual(detect("PAYPAL_CLIENT_SECRET=\nDemo-Only-2026!\n"), []);
  for (const path of [
    ".env",
    "apps/api/.env.local",
    ".dev.vars",
    "integrations/demo.local.json",
    "vendor/proprietary/license.txt",
    "test.key",
  ])
    assert.equal(excluded(path), true, path);
  for (const path of [
    ".env.example",
    "docs/INTEGRATIONS.md",
    "integrations/config.example.json",
  ])
    assert.equal(excluded(path), false, path);
  console.log("Source secret scanner regression checks passed.");
} else {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const failures = [];
  for (const path of files) {
    if (excluded(path)) failures.push(`${path}: excluded private/runtime path`);
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    for (const kind of detect(bytes.toString("utf8")))
      failures.push(`${path}: ${kind}`);
  }
  if (failures.length) {
    // Report file/type only. Never echo matched credential material.
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Source secret signatures and private-path checks passed (${files.length} tracked files).`,
    );
}
