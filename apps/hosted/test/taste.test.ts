import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import {
  emptyTaste,
  saveConsent,
  importDemo,
  rebuildTaste,
  preview,
  exclusionReasons,
  compareTaste,
  AuthorizedPayPalHistoryProvider,
  correctEvidence,
} from "../src/taste";
import { seed, load } from "../src/store";
const purposes = {
  matching: true,
  publicTags: false,
  hostedAI: false,
  commercial: false,
};
function prepared(dataset = "weekend-reader") {
  const t = emptyTaste(crypto.randomUUID());
  saveConsent(t, {
    expectedVersion: 0,
    purposes,
    families: ["categories", "brands", "rhythms"],
  });
  importDemo(t, {
    datasetId: dataset,
    idempotencyKey: crypto.randomUUID(),
    consentVersion: 1,
  });
  return t;
}
async function enable(
  f: ReturnType<typeof fixture>,
  actor: string,
  publicTags = false,
) {
  return f.data(actor, "POST", "/taste/consents", {
    expectedVersion: 0,
    purposes: { ...purposes, publicTags },
    families: ["categories", "brands", "rhythms"],
  });
}
test("all purposes start off; PayPal login/payment cannot unlock any history mode", async () => {
  const f = fixture();
  try {
    await f.login("Alex");
    const caps = await f.data("Alex", "GET", "/taste/capabilities");
    assert.equal(caps.realHistoryEnabled, false);
    assert.equal(
      caps.sources.find((s: any) => s.type === "paypal-history").status,
      "blocked",
    );
    const profile = await f.data("Alex", "GET", "/taste/profile");
    assert.deepEqual(Object.values(profile.consent.purposes), [
      false,
      false,
      false,
      false,
    ]);
    assert.equal(
      (await f.request("Alex", "POST", "/taste/paypal-sync", {})).status,
      403,
    );
    assert.equal(
      (await f.request("Alex", "POST", "/taste/exports", {})).status,
      403,
    );
    assert.equal(
      (
        await f.request("Alex", "POST", "/taste/demo-imports", {
          datasetId: "paypal-history",
          idempotencyKey: crypto.randomUUID(),
          consentVersion: 0,
        })
      ).status,
      400,
    );
    assert.throws(
      () => new AuthorizedPayPalHistoryProvider().load("", "actor", "", 1),
      /unavailable/,
    );
  } finally {
    f.db.close();
  }
});
test("requires matching consent and deduplicates the same import identity and source-event keys", async () => {
  const f = fixture();
  try {
    await f.login("Alex");
    const body = {
      datasetId: "weekend-reader",
      idempotencyKey: crypto.randomUUID(),
      consentVersion: 0,
    };
    assert.equal(
      (await f.request("Alex", "POST", "/taste/demo-imports", body)).status,
      409,
    );
    await enable(f, "Alex");
    body.consentVersion = 1;
    const first = await f.data("Alex", "POST", "/taste/demo-imports", body),
      again = await f.data("Alex", "POST", "/taste/demo-imports", body);
    assert.equal(first.id, again.id);
    assert.equal(first.deduplicated, 1);
    assert.equal(first.status, "partial");
    const evidence = await f.data("Alex", "GET", "/taste/evidence");
    assert.equal(evidence.records.length, first.stored);
    assert.equal(
      new Set(evidence.records.map((r: any) => r.sourceRecordKey)).size,
      evidence.records.length,
    );
    assert.equal(
      (
        await f.request("Alex", "POST", "/taste/demo-imports", {
          ...body,
          datasetId: "outdoor-explorer",
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.request("Alex", "GET", "/taste/evidence?limit=101")).status,
      400,
    );
  } finally {
    f.db.close();
  }
});
test("sensitive, unknown, gift, business, shared, transfer, fee, refund and reversed sales are excluded", () => {
  const t = prepared();
  for (const r of t.evidence) {
    const reasons = exclusionReasons(r, t.evidence);
    if (
      r.sensitive ||
      r.kind !== "purchase" ||
      r.classification !== "personal" ||
      !r.category ||
      r.currency !== "USD" ||
      r.sourceRecordKey.endsWith(":0:sale")
    )
      assert.ok(reasons.length, JSON.stringify(r));
  }
  const sensitive = t.evidence.find((r) => r.sensitive)!;
  assert.throws(
    () =>
      correctEvidence(t, sensitive.id, {
        expectedVersion: 1,
        consentVersion: 1,
        category: "coffee",
      }),
    /Sensitive/,
  );
  assert.ok(preview(t).evidenceBased);
  assert.ok(preview(t).spanDays >= 30);
});
test("unknown timezone contributes no invented daypart and no item-level descriptors are invented", () => {
  const t = prepared();
  t.evidence = t.evidence.map((r) => ({
    ...r,
    sourceTimezone: null,
    timePrecision: "unknown",
  }));
  const p = preview(t);
  assert.deepEqual(p.rhythms, {});
  assert.equal("itemDescriptors" in t.evidence[0], false);
  assert.ok(p.usableCount >= 20);
});
test("amount scale and a huge monetary outlier do not change features or pair rank", () => {
  const t = prepared(),
    peer = prepared("outdoor-explorer");
  rebuildTaste(t, {
    consentVersion: 1,
    expectedEvidenceVersion: t.evidenceVersion,
  });
  rebuildTaste(peer, {
    consentVersion: 1,
    expectedEvidenceVersion: peer.evidenceVersion,
  });
  const users = seed().users,
    before = compareTaste(users[0], users[1], t, peer).score;
  for (const r of t.evidence) r.amountMinor *= 10;
  t.evidence[3].amountMinor = 10000000000;
  rebuildTaste(t, {
    consentVersion: 1,
    expectedEvidenceVersion: t.evidenceVersion,
  });
  const after = compareTaste(users[0], users[1], t, peer).score;
  assert.ok(Math.abs(before - after) < 1e-10);
});
test("low purchase coverage and disabled/unsupported families use labeled declared cold start", () => {
  const t = prepared();
  t.evidence = t.evidence.slice(0, 10);
  t.evidenceVersion++;
  rebuildTaste(t, {
    consentVersion: 1,
    expectedEvidenceVersion: t.evidenceVersion,
  });
  const users = seed().users;
  const pair = compareTaste(users[0], users[1], t);
  assert.equal(pair.public.basis, "Self-declared interests");
  assert.equal(pair.public.evidenceGrade, "insufficient");
  assert.equal(pair.public.commonGround.length, 0);
});
test("merchant exclusion changes subsequent discovery order without exposing receipts or ranking scores", async () => {
  const f = fixture();
  try {
    await f.login("Alex");
    await enable(f, "Alex");
    await f.data("Alex", "POST", "/taste/demo-imports", {
      datasetId: "weekend-reader",
      idempotencyKey: crypto.randomUUID(),
      consentVersion: 1,
    });
    let evidence = await f.data("Alex", "GET", "/taste/evidence");
    await f.data("Alex", "POST", "/taste/rebuild", {
      consentVersion: 1,
      expectedEvidenceVersion: evidence.evidenceVersion,
    });
    const before = await f.data("Alex", "GET", "/discover");
    assert.equal(before[0].display_name, "Sam");
    assert.equal("score" in before[0].taste, false);
    assert.equal(JSON.stringify(before).includes("Demo Harbor Books"), false);
    const books = evidence.records.find(
      (r: any) =>
        r.merchantCanonical === "harbor-books" &&
        r.kind === "purchase" &&
        !r.exclusionReasons.length,
    );
    await f.data("Alex", "PATCH", `/taste/evidence/${books.id}`, {
      expectedVersion: books.version,
      consentVersion: 1,
      excludeMerchant: true,
    });
    const draft = await f.data("Alex", "GET", "/taste/profile");
    assert.equal(draft.featureActive, false);
    assert.equal(draft.requiresRebuild, true);
    assert.ok(draft.preview.usableCount >= 20);
    evidence = await f.data("Alex", "GET", "/taste/evidence");
    await f.data("Alex", "POST", "/taste/rebuild", {
      consentVersion: 1,
      expectedEvidenceVersion: evidence.evidenceVersion,
    });
    const after = await f.data("Alex", "GET", "/discover");
    assert.equal(after[0].display_name, "Jordan");
    assert.notEqual(before[0].user_id, after[0].user_id);
    assert.equal(
      (
        await f.request("Alex", "PATCH", `/taste/evidence/${books.id}`, {
          expectedVersion: books.version,
          consentVersion: 1,
          excluded: false,
        })
      ).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("private evidence/imports are actor scoped and stay hidden from ordinary discover/me DTOs", async () => {
  const f = fixture();
  try {
    await f.login("Alex");
    await f.login("Jordan");
    await enable(f, "Alex");
    const job = await f.data("Alex", "POST", "/taste/demo-imports", {
      datasetId: "weekend-reader",
      idempotencyKey: crypto.randomUUID(),
      consentVersion: 1,
    });
    const records = await f.data("Alex", "GET", "/taste/evidence");
    assert.equal(
      (await f.data("Jordan", "GET", "/taste/evidence")).records.length,
      0,
    );
    assert.equal(
      (await f.request("Jordan", "GET", `/taste/imports/${job.id}`)).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "Jordan",
          "PATCH",
          `/taste/evidence/${records.records[0].id}`,
          { expectedVersion: 1, consentVersion: 0, excluded: true },
        )
      ).status,
      409,
    );
    const own = await f.data("Alex", "GET", "/me");
    assert.equal("taste" in own, false);
    assert.equal(
      JSON.stringify(await f.data("Jordan", "GET", "/discover")).includes(
        "sourceRecordKey",
      ),
      false,
    );
    assert.equal(
      (
        await f.request(
          "Alex",
          "POST",
          "/taste/rebuild",
          { consentVersion: 1, expectedEvidenceVersion: 1 },
          "owner-one",
          { "x-csrf-token": "" },
        )
      ).status,
      403,
    );
  } finally {
    f.db.close();
  }
});
test("mutual explanations require both tag consents, never share raw purchases, and disappear on revocation/block", async () => {
  const f = fixture();
  try {
    const alex = await f.login("Alex"),
      jordan = await f.login("Jordan");
    for (const name of ["Alex", "Jordan"]) {
      await enable(f, name, true);
      await f.data(name, "POST", "/taste/demo-imports", {
        datasetId: "weekend-reader",
        idempotencyKey: crypto.randomUUID(),
        consentVersion: 1,
      });
      const ev = await f.data(name, "GET", "/taste/evidence");
      const p = await f.data(name, "POST", "/taste/rebuild", {
        consentVersion: 1,
        expectedEvidenceVersion: ev.evidenceVersion,
      });
      await f.data(name, "PATCH", "/taste/profile/sharing", {
        consentVersion: 1,
        featureVersion: p.feature.version,
        tags: ["coffee", "books"],
      });
    }
    await f.data("Alex", "POST", "/decisions", {
      targetId: jordan.id,
      action: "like",
      clientMutationId: crypto.randomUUID(),
    });
    await f.data("Jordan", "POST", "/decisions", {
      targetId: alex.id,
      action: "like",
      clientMutationId: crypto.randomUUID(),
    });
    const mid = (await f.data("Alex", "GET", "/matches"))[0].id;
    const why = await f.data("Alex", "GET", `/matches/${mid}/explanation`);
    assert.deepEqual(why.commonGround, ["Independent cafés", "Books"]);
    for (const forbidden of [
      "merchantRaw",
      "Demo Harbor",
      "sourceRecordKey",
      "amountMinor",
    ])
      assert.equal(JSON.stringify(why).includes(forbidden), false);
    await f.login("Sam");
    assert.equal(
      (await f.request("Sam", "GET", `/matches/${mid}/explanation`)).status,
      404,
    );
    await f.data("Jordan", "DELETE", `/taste/consents/${jordan.id}`, {});
    assert.deepEqual(
      (await f.data("Alex", "GET", `/matches/${mid}/explanation`)).commonGround,
      [],
    );
    await f.data("Jordan", "POST", "/blocks", { targetId: alex.id });
    assert.equal(
      (await f.request("Alex", "GET", `/matches/${mid}/explanation`)).status,
      404,
    );
  } finally {
    f.db.close();
  }
});
test("revocation removes raw/derived state and stale rebuild/import attempts cannot restore it", async () => {
  const f = fixture();
  try {
    const alex = await f.login("Alex");
    await enable(f, "Alex");
    const body = {
      datasetId: "weekend-reader",
      idempotencyKey: crypto.randomUUID(),
      consentVersion: 1,
    };
    await f.data("Alex", "POST", "/taste/demo-imports", body);
    const evidence = await f.data("Alex", "GET", "/taste/evidence");
    const rebuild = {
      consentVersion: 1,
      expectedEvidenceVersion: evidence.evidenceVersion,
    };
    await Promise.all([
      f.request("Alex", "DELETE", `/taste/consents/${alex.id}`, {}),
      f.request("Alex", "POST", "/taste/rebuild", rebuild),
    ]);
    const view = await f.data("Alex", "GET", "/taste/profile");
    assert.equal(view.feature, null);
    assert.equal(view.preview.usableCount, 0);
    assert.equal(
      (await f.data("Alex", "GET", "/taste/evidence")).records.length,
      0,
    );
    assert.equal(
      (await f.request("Alex", "POST", "/taste/demo-imports", body)).status,
      409,
    );
    const state = (await load("owner-one", f.env)).state;
    assert.deepEqual(state.taste![alex.id].imports, []);
    assert.deepEqual(state.taste![alex.id].corrections, []);
    assert.equal(
      JSON.stringify(state.taste![alex.id]).includes("Demo Harbor Books"),
      false,
    );
  } finally {
    f.db.close();
  }
});
test("single supported feature family never reports strong evidence and stale features are ignored", () => {
  const t = prepared(),
    peer = prepared();
  saveConsent(t, { expectedVersion: 1, purposes, families: ["categories"] });
  saveConsent(peer, { expectedVersion: 1, purposes, families: ["categories"] });
  rebuildTaste(t, {
    consentVersion: 2,
    expectedEvidenceVersion: t.evidenceVersion,
  });
  rebuildTaste(peer, {
    consentVersion: 2,
    expectedEvidenceVersion: peer.evidenceVersion,
  });
  const users = seed().users;
  assert.equal(
    compareTaste(users[0], users[1], t, peer).public.evidenceGrade,
    "insufficient",
  );
  t.feature!.expiresAt = "2000-01-01T00:00:00Z";
  assert.equal(
    compareTaste(users[0], users[1], t).public.basis,
    "Self-declared interests",
  );
});

test("removing one large-amount event does not reverse a stable category profile", () => {
  const taste = prepared();
  const users = seed().users;
  const rank = () =>
    users
      .slice(1)
      .map((u) => ({
        name: u.display_name,
        score: compareTaste(users[0], u, taste).score,
        id: u.id,
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0].name;
  const event = {
    ...taste.evidence.find(
      (r) =>
        r.kind === "purchase" && !exclusionReasons(r, taste.evidence).length,
    )!,
    id: crypto.randomUUID(),
    sourceRecordKey: "synthetic-outlier:sale",
    transactionKey: "synthetic-outlier",
    merchantCanonical: "trail-outfitters",
    merchantRaw: "Demo Trail Outfitters",
    category: "outdoors" as const,
    amountMinor: 10000000000,
  };
  taste.evidence.push(event);
  taste.evidenceVersion++;
  rebuildTaste(taste, {
    consentVersion: 1,
    expectedEvidenceVersion: taste.evidenceVersion,
  });
  const before = rank();
  event.excluded = true;
  event.version++;
  taste.evidenceVersion++;
  rebuildTaste(taste, {
    consentVersion: 1,
    expectedEvidenceVersion: taste.evidenceVersion,
  });
  assert.equal(rank(), before);
  assert.equal(before, "Sam");
});
test("minimum evidence requires both twenty purchases and thirty calendar days of coverage", () => {
  const t = prepared();
  const useful = t.evidence
    .filter((r) => exclusionReasons(r, t.evidence).length === 0)
    .slice(0, 20);
  const base = Date.now() - 86400000;
  t.evidence = useful.map((r, i) => ({
    ...r,
    occurredAtUTC: new Date(base - i * 86400000).toISOString(),
  }));
  assert.equal(preview(t).evidenceBased, false);
  t.evidence[19].occurredAtUTC = new Date(base - 30 * 86400000).toISOString();
  assert.equal(preview(t).evidenceBased, true);
  t.evidence.pop();
  assert.equal(preview(t).evidenceBased, false);
});
