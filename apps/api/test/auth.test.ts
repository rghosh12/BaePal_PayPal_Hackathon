import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import argon2 from "argon2";
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Auth regressions require a dedicated database ending in _test.");
const origin = "http://localhost:3000";
const oldPassword = "Synthetic-old-password-2026!";
const newPassword = "Synthetic-new-password-2026!";
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let uid: string, email: string, originalHash: string;
const captured: string[] = [];
const mailPath = (id: string) =>
  new URL(`../../../.data/mail/${id}.json`, import.meta.url);
function request(
  path: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1" + path,
    headers: { origin, ...headers },
    payload,
  });
}
async function resetChallenge() {
  expect((await request("/auth/password/request", { email })).statusCode).toBe(
    200,
  );
  const challenge = await one(
    db,
    "SELECT id FROM challenges WHERE user_id=$1 AND purpose='reset' ORDER BY created_at DESC LIMIT 1",
    [uid],
  );
  captured.push(challenge.id);
  const capture = JSON.parse(await readFile(mailPath(challenge.id), "utf8"));
  return {
    challengeId: challenge.id,
    token: capture.code,
    password: newPassword,
  };
}
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  if (app) await app.close();
  ({ app } = await buildApp());
  await app.ready();
  await db.query("TRUNCATE users CASCADE");
  uid = randomUUID();
  email = `auth-${uid}@test.invalid`;
  originalHash = await argon2.hash(oldPassword);
  await db.query(
    "INSERT INTO users(id,email,password_hash,status,confirmed_at) VALUES($1,$2,$3,'active',now())",
    [uid, email, originalHash],
  );
});
afterAll(async () => {
  if (app) await app.close();
  await db.query("TRUNCATE users CASCADE");
  await db.end();
  for (const id of captured) await rm(mailPath(id), { force: true });
});
describe("serialized auth challenge lifecycle", () => {
  for (const purpose of ["reset", "email"] as const)
    it(`serializes concurrent first ${purpose} challenge requests using the stable account`, async () => {
      let headers: Record<string, string> = {};
      if (purpose === "email") {
        await db.query(
          "UPDATE users SET status='pending_email',confirmed_at=NULL WHERE id=$1",
          [uid],
        );
        const login = await request("/auth/login", {
          email,
          password: oldPassword,
        });
        expect(login.statusCode).toBe(200);
        headers = {
          cookie: String(login.headers["set-cookie"]).split(";")[0],
          "x-csrf-token": login.json().data.csrf,
        };
      }
      // Hold INSERTs until both requests are blocked in PostgreSQL. Before the fix
      // both pass the empty-history check; after it the second waits on the user.
      const key = randomInt(100000000, 2000000000);
      const gate = await db.connect();
      await gate.query("SELECT pg_advisory_lock($1)", [key]);
      await db.query(
        `CREATE FUNCTION auth_test_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`,
      );
      await db.query(
        "CREATE TRIGGER auth_test_gate BEFORE INSERT ON challenges FOR EACH ROW EXECUTE FUNCTION auth_test_gate()",
      );
      const pending = [0, 1].map(() =>
        request(
          purpose === "reset"
            ? "/auth/password/request"
            : "/auth/email/request",
          purpose === "reset" ? { email } : {},
          headers,
        ),
      );
      let responses: Awaited<ReturnType<typeof request>>[] = [];
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const blocked = await one(
            db,
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
          );
          if (blocked.n >= 2) break;
          if (Date.now() > deadline)
            throw Error(
              "Concurrent auth requests did not reach the database gate.",
            );
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await gate.query("SELECT pg_advisory_unlock($1)", [key]);
        gate.release();
        responses = await Promise.all(pending);
        await db.query("DROP TRIGGER auth_test_gate ON challenges");
        await db.query("DROP FUNCTION auth_test_gate()");
        for (const row of (
          await db.query("SELECT id FROM challenges WHERE user_id=$1", [uid])
        ).rows)
          captured.push(row.id);
      }
      expect(responses.map((r) => r.statusCode).sort()).toEqual(
        purpose === "reset" ? [200, 200] : [200, 429],
      );
      const active = await one(
        db,
        "SELECT count(*)::int AS n FROM challenges WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
        [uid, purpose],
      );
      expect(active.n).toBe(1);
    });
  for (const status of ["suspended", "deleted"])
    it(`rejects outstanding reset links after the account becomes ${status}`, async () => {
      const payload = await resetChallenge();
      await db.query("UPDATE users SET status=$2 WHERE id=$1", [uid, status]);
      const result = await request("/auth/password/reset", payload);
      expect(result.statusCode).toBe(422);
      expect(result.json().error.code).toBe("INVALID_TOKEN");
      const user = await one(
        db,
        "SELECT password_hash,status FROM users WHERE id=$1",
        [uid],
      );
      expect(user.password_hash).toBe(originalHash);
      expect(user.status).toBe(status);
      expect(
        (
          await one(db, "SELECT consumed_at FROM challenges WHERE id=$1", [
            payload.challengeId,
          ])
        ).consumed_at,
      ).toBeNull();
    });
  it("does not consume or confirm a code when account eligibility changes during confirmation", async () => {
    await db.query(
      "UPDATE users SET status='pending_email',confirmed_at=NULL WHERE id=$1",
      [uid],
    );
    const login = await request("/auth/login", {
      email,
      password: oldPassword,
    });
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": login.json().data.csrf,
    };
    const issued = await request("/auth/email/request", {}, headers);
    expect(issued.statusCode).toBe(200);
    const challengeId = issued.json().data.challengeId;
    captured.push(challengeId);
    const capture = JSON.parse(await readFile(mailPath(challengeId), "utf8"));
    const statusChange = await db.connect();
    await statusChange.query("BEGIN");
    await statusChange.query(
      "UPDATE users SET status='suspended' WHERE id=$1",
      [uid],
    );
    const pending = request(
      "/auth/email/confirm",
      { challengeId, code: capture.code },
      headers,
    );
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const blocked = await one(
          db,
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
        );
        if (blocked.n >= 1) break;
        if (Date.now() > deadline)
          throw Error("Confirmation did not reach the account status lock.");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await statusChange.query("COMMIT");
      statusChange.release();
    }
    const result = await pending;
    expect(result.statusCode).toBe(422);
    expect(result.json().error.code).toBe("INVALID_CODE");
    expect(
      (await one(db, "SELECT status FROM users WHERE id=$1", [uid])).status,
    ).toBe("suspended");
    expect(
      (
        await one(db, "SELECT consumed_at FROM challenges WHERE id=$1", [
          challengeId,
        ])
      ).consumed_at,
    ).toBeNull();
  });
  it("resets an eligible account once, revokes existing sessions and leaves expired/replayed links invalid", async () => {
    const login = await request("/auth/login", {
      email,
      password: oldPassword,
    });
    expect(login.statusCode).toBe(200);
    const payload = await resetChallenge();
    const reset = await request("/auth/password/reset", payload);
    expect(reset.statusCode).toBe(200);
    expect(
      await argon2.verify(
        (await one(db, "SELECT password_hash FROM users WHERE id=$1", [uid]))
          .password_hash,
        newPassword,
      ),
    ).toBe(true);
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM sessions WHERE user_id=$1",
          [uid],
        )
      ).n,
    ).toBe(0);
    expect((await request("/auth/password/reset", payload)).statusCode).toBe(
      422,
    );
    await db.query(
      "UPDATE challenges SET created_at=now()-interval '1 minute' WHERE user_id=$1",
      [uid],
    );
    const expired = await resetChallenge();
    await db.query(
      "UPDATE challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.challengeId],
    );
    expect((await request("/auth/password/reset", expired)).statusCode).toBe(
      422,
    );
  });
  it("does not reveal missing or ineligible reset accounts through request responses", async () => {
    const missing = await request("/auth/password/request", {
      email: "missing-auth@test.invalid",
    });
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [uid]);
    const suspended = await request("/auth/password/request", { email });
    expect(missing.statusCode).toBe(200);
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toEqual(missing.json());
    expect((await one(db, "SELECT count(*)::int AS n FROM challenges")).n).toBe(
      0,
    );
  });
});
