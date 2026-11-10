import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { activeMatch, decide } from "../src/domain.js";
import { config } from "../src/config.js";

if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Visibility regressions require a dedicated test database.");
let a: string, b: string, mutation: string;
beforeAll(migrate);
beforeEach(async () => {
  await db.query("TRUNCATE users CASCADE");
  [a, b, mutation] = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of [a, b]) {
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused-hash','active')",
      [id, id + "@test.invalid"],
    );
    await db.query("INSERT INTO profiles(user_id) VALUES($1)", [id]);
    await db.query(
      "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1995-05-03','Nonbinary',ARRAY['Nonbinary'])",
      [id],
    );
  }
});
afterAll(async () => {
  await db.query("TRUNCATE users CASCADE");
  await db.end();
});
async function matched() {
  await decide(a, b, "like", mutation);
  return (await decide(b, a, "like", randomUUID())).match!.id;
}
async function deniedReplay() {
  await expect(decide(a, b, "like", mutation)).rejects.toMatchObject({
    status: 404,
    code: "UNAVAILABLE",
  });
  expect((await one(db, "SELECT count(*)::int AS n FROM decisions")).n).toBe(2);
  expect(
    (await one(db, "SELECT count(*)::int AS n FROM notifications")).n,
  ).toBe(2);
}
describe("stale decision replay visibility", () => {
  it("preserves a benign retry after the reciprocal like creates an active match", async () => {
    const id = await matched();
    expect((await decide(a, b, "like", mutation)).match!.id).toBe(id);
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM notifications")).n,
    ).toBe(2);
  });
  it("does not return the closed match ID for a stale mutation replay", async () => {
    const id = await matched();
    await db.query("UPDATE matches SET status='closed' WHERE id=$1", [id]);
    await deniedReplay();
  });
  it("rejects replay after blocking even if the match row has not been closed", async () => {
    await matched();
    await db.query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)", [
      b,
      a,
    ]);
    await deniedReplay();
  });
  it("rejects paused discovery replay while retaining existing chat access", async () => {
    const id = await matched();
    await db.query("UPDATE users SET status='paused' WHERE id=$1", [b]);
    await deniedReplay();
    expect((await activeMatch(db, id, a)).id).toBe(id);
  });
  it("rechecks reciprocal hard preferences after a cached card decision", async () => {
    await matched();
    await db.query(
      "UPDATE profile_private SET genders=ARRAY['Woman'] WHERE user_id=$1",
      [b],
    );
    await deniedReplay();
  });
  it("retains payload conflict semantics before checking current visibility", async () => {
    const id = await matched();
    await db.query("UPDATE matches SET status='closed' WHERE id=$1", [id]);
    await expect(decide(a, b, "pass", mutation)).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  it("rejects an unmatched cached pass replay after the target is suspended", async () => {
    await decide(a, b, "pass", mutation);
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [b]);
    await expect(decide(a, b, "pass", mutation)).rejects.toMatchObject({
      status: 404,
      code: "UNAVAILABLE",
    });
    expect((await one(db, "SELECT count(*)::int AS n FROM decisions")).n).toBe(
      1,
    );
  });
});
