import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { config } from "../src/config.js";
import { sendMessage } from "../src/domain.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error(
    "Sender admission regressions require a dedicated _test database.",
  );
const INSERT_GATE = 84732011;
let users: string[], matches: string[];
async function seed(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    client: randomUUID(),
    sequence: i + 1,
    text: "Synthetic seed " + i,
  }));
  for (const row of rows)
    await db.query(
      "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text) VALUES($1,$2,$3,$4,$5,$6)",
      [row.id, matches[0], row.sequence, users[0], row.client, row.text],
    );
  await db.query("UPDATE matches SET last_sequence=$2 WHERE id=$1", [
    matches[0],
    count,
  ]);
  return rows;
}
async function waitForBlocked(count: number) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const row = await one(
      db,
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
    );
    if (row.n >= count) return;
    await pause(5);
  }
  throw Error("Synthetic concurrency gate was not reached.");
}
async function simultaneous(sends: () => Promise<any>[]) {
  const blocker = await db.connect();
  await blocker.query("SELECT pg_advisory_lock($1)", [INSERT_GATE]);
  const result = Promise.allSettled(sends());
  try {
    await waitForBlocked(2);
  } finally {
    await blocker.query("SELECT pg_advisory_unlock($1)", [INSERT_GATE]);
    blocker.release();
  }
  return result;
}
beforeAll(async () => {
  await migrate();
  // A test-only insertion barrier ensures both old transactions have read the
  // sender's count/key before either insert commits, without production hooks.
  await db.query(
    `CREATE OR REPLACE FUNCTION test_message_insert_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${INSERT_GATE}); RETURN NEW; END $$`,
  );
  await db.query("DROP TRIGGER IF EXISTS test_message_insert_gate ON messages");
  await db.query(
    "CREATE TRIGGER test_message_insert_gate BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION test_message_insert_gate()",
  );
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [randomUUID(), randomUUID(), randomUUID()];
  matches = [randomUUID(), randomUUID()];
  for (const id of users)
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [id, id + "@admission.test.invalid"],
    );
  for (let i = 0; i < 2; i++)
    await db.query(
      "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
      [matches[i], users[0], users[i + 1]],
    );
});
afterAll(async () => {
  await db.query("DROP TRIGGER IF EXISTS test_message_insert_gate ON messages");
  await db.query("DROP FUNCTION IF EXISTS test_message_insert_gate()");
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("sender-wide chat admission", () => {
  it("admits at most one of two cross-conversation sends when the sender already has 29 recent messages", async () => {
    await seed(29);
    const result = await simultaneous(() =>
      matches.map((mid) =>
        sendMessage(
          users[0],
          mid,
          "Synthetic concurrent message",
          randomUUID(),
        ),
      ),
    );
    const saved = result.filter((r) => r.status === "fulfilled"),
      rejected = result.filter((r) => r.status === "rejected");
    expect(saved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      status: 429,
      code: "MESSAGE_RATE_LIMIT",
    });
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1",
          [users[0]],
        )
      ).n,
    ).toBe(30);
  });
  it("returns a domain conflict instead of a raw unique-key failure for the same retry ID across conversations", async () => {
    const key = randomUUID();
    const result = await simultaneous(() =>
      matches.map((mid) =>
        sendMessage(users[0], mid, "Synthetic shared retry", key),
      ),
    );
    const saved = result.filter((r) => r.status === "fulfilled"),
      rejected = result.filter((r) => r.status === "rejected");
    expect(saved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1",
          [users[0]],
        )
      ).n,
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT last_sequence FROM matches ORDER BY last_sequence",
        )
      ).rows.map((m) => m.last_sequence),
    ).toEqual([0, 1]);
  });
  it("timestamps a queued send at actual insertion rather than before its lock wait", async () => {
    const locker = await db.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [
      matches[0],
    ]);
    const pending = sendMessage(
      users[0],
      matches[0],
      "Synthetic queued message",
      randomUUID(),
    );
    let beforeRelease: Date;
    try {
      await waitForBlocked(1);
      beforeRelease = (await locker.query("SELECT clock_timestamp() AS time"))
        .rows[0].time;
    } finally {
      await locker.query("COMMIT");
      locker.release();
    }
    const saved = await pending;
    expect(new Date(saved.created_at).getTime()).toBeGreaterThanOrEqual(
      beforeRelease!.getTime(),
    );
  });
  it("allows an exact retry at the quota but rejects new messages and later unauthorized retries", async () => {
    const rows = await seed(30),
      replay = rows[0];
    const saved = await sendMessage(
      users[0],
      matches[0],
      replay.text,
      replay.client,
    );
    expect(saved.id).toBe(replay.id);
    await expect(
      sendMessage(users[0], matches[1], "Synthetic over limit", randomUUID()),
    ).rejects.toMatchObject({ status: 429, code: "MESSAGE_RATE_LIMIT" });
    await db.query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)", [
      users[1],
      users[0],
    ]);
    await expect(
      sendMessage(users[0], matches[0], replay.text, replay.client),
    ).rejects.toMatchObject({ status: 404, code: "UNAVAILABLE" });
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1",
          [users[0]],
        )
      ).n,
    ).toBe(30);
  });
  it.each(["blocked", "deleted", "suspended"])(
    "rechecks %s authorization after waiting for sender admission, including an exact retry",
    async (reason) => {
      const [replay] = await seed(1),
        locker = await db.connect();
      const key = `message-sender:${users[0]}`;
      await locker.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
        key,
      ]);
      const pending = sendMessage(
        users[0],
        matches[0],
        replay.text,
        replay.client,
      ).then(
        (value) => ({ value, error: undefined }),
        (error) => ({ error, value: undefined }),
      );
      try {
        await waitForBlocked(1);
        if (reason === "blocked")
          await db.query(
            "INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)",
            [users[1], users[0]],
          );
        else
          await db.query("UPDATE users SET status=$2 WHERE id=$1", [
            users[0],
            reason,
          ]);
      } finally {
        await locker.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [key],
        );
        locker.release();
      }
      expect((await pending).error).toMatchObject({
        status: 404,
        code: "UNAVAILABLE",
      });
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1",
            [users[0]],
          )
        ).n,
      ).toBe(1);
    },
  );
});
