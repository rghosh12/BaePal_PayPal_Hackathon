import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Chat history regressions require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let users: { id: string; cookie: string }[], mid: string;
async function page(cursor?: string, user = 0) {
  return app.inject({
    method: "GET",
    url:
      `/api/v1/conversations/${mid}/messages` +
      (cursor === undefined ? "" : "?" + cursor),
    headers: { cookie: users[user].cookie },
  });
}
beforeAll(async () => {
  await migrate();
  ({ app } = await buildApp());
  await app.ready();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  mid = randomUUID();
  for (let i = 0; i < 3; i++) {
    const id = randomUUID(),
      token = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [id, id + "@chat.test.invalid"],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'synthetic-csrf',now()+interval '1 hour')",
      [hash(token), id],
    );
    users.push({ id, cookie: "baepal=" + token });
  }
  await db.query(
    "INSERT INTO matches(id,low_id,high_id,last_sequence) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),257)",
    [mid, users[0].id, users[1].id],
  );
  const sequences = Array.from({ length: 257 }, (_, i) => 257 - i);
  await db.query(
    "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text) SELECT id,$1,sequence,sender_id,client_id,text FROM unnest($2::uuid[],$3::integer[],$4::uuid[],$5::uuid[],$6::text[]) AS source(id,sequence,sender_id,client_id,text)",
    [
      mid,
      sequences.map(() => randomUUID()),
      sequences,
      sequences.map((i) => users[i % 2].id),
      sequences.map(() => randomUUID()),
      sequences.map((i) => "Synthetic message " + i),
    ],
  );
});
afterAll(async () => {
  await app.close();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("ascending message history pages", () => {
  it("covers older pages, sequence boundaries and newly appended catch-up without gaps or duplicates", async () => {
    const first = await page();
    expect(first.statusCode).toBe(200);
    const a = first.json().data;
    expect(a.map((m: any) => m.sequence)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    await db.query(
      "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text) VALUES($1,$2,258,$3,$4,'Synthetic catch-up')",
      [randomUUID(), mid, users[1].id, randomUUID()],
    );
    const second = await page("after=100"),
      third = await page("after=200");
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(second.json().data).toHaveLength(100);
    expect(third.json().data).toHaveLength(58);
    const all = [...a, ...second.json().data, ...third.json().data];
    expect(all.map((m: any) => m.sequence)).toEqual(
      Array.from({ length: 258 }, (_, i) => i + 1),
    );
    expect(new Set(all.map((m: any) => m.id)).size).toBe(258);
    expect((await page("after=258")).json().data).toEqual([]);
  });
  it("accepts large safe cursors without an integer-column overflow", async () => {
    for (const cursor of ["2147483648", "9007199254740991"]) {
      const response = await page("after=" + cursor);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data).toEqual([]);
    }
  });
  it.each([
    "after=-1",
    "after=1.5",
    "after=9007199254740992",
    "after=NaN",
    "after=Infinity",
    "after=1e3",
    "after=",
    "after=%20",
    "after=1&after=2",
    "after=100000000000000000000",
  ])("rejects invalid cursor %s", async (cursor) => {
    expect((await page(cursor)).statusCode).toBe(400);
  });
  it("denies outsiders even with a previously known sequence", async () => {
    expect((await page("after=100", 2)).statusCode).toBe(404);
  });
  it.each(["blocked", "closed", "peer-deleted", "session-expired"])(
    "rechecks %s authorization between pages",
    async (reason) => {
      expect((await page()).statusCode).toBe(200);
      if (reason === "blocked")
        await db.query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)", [
          users[1].id,
          users[0].id,
        ]);
      if (reason === "closed")
        await db.query("UPDATE matches SET status='closed' WHERE id=$1", [mid]);
      if (reason === "peer-deleted")
        await db.query("UPDATE users SET status='deleted' WHERE id=$1", [
          users[1].id,
        ]);
      if (reason === "session-expired")
        await db.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [users[0].id],
        );
      const response = await page("after=100");
      expect(response.statusCode).toBe(
        reason === "session-expired" ? 401 : 404,
      );
      expect(response.json().data).toBeUndefined();
    },
  );
});
