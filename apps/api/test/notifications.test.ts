import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db, tx } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { notify } from "../src/notifications.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Notification tests require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"], mid: string;
let users: { id: string; token: string; csrf: string }[];
function request(user: number, method: string, path: string, payload?: object) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: "baepal=" + users[user].token,
      "x-csrf-token": users[user].csrf,
    },
    payload,
  });
}
const inbox = async (user: number) =>
  (await request(user, "GET", "/notifications")).json().data;
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  mid = randomUUID();
  for (let n = 0; n < 3; n++) {
    const user = { id: randomUUID(), token: randomUUID(), csrf: randomUUID() };
    users.push(user);
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [user.id, user.id + "@notify.test.invalid"],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(user.token), user.id, user.csrf],
    );
  }
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, users[0].id, users[1].id],
  );
  ({ app } = await buildApp());
});
afterEach(async () => {
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("in-app notification inbox", () => {
  it("notifies only the recipient once per message, with a generic title", async () => {
    const body = {
      text: "Private budget is $40 and my email is a@b.test",
      clientMessageId: randomUUID(),
    };
    expect(
      (await request(0, "POST", `/conversations/${mid}/messages`, body)).statusCode,
    ).toBe(200);
    expect(
      (await request(0, "POST", `/conversations/${mid}/messages`, body)).statusCode,
    ).toBe(200);
    const recipient = await inbox(1);
    expect(recipient.unread).toBe(1);
    expect(recipient.items[0]).toMatchObject({
      category: "message.received",
      title: "You have a new message.",
      matchId: mid,
      read: false,
    });
    expect(JSON.stringify(recipient)).not.toMatch(/budget|\$40|a@b\.test/);
    expect((await inbox(0)).items).toHaveLength(0);
    expect((await inbox(2)).items).toHaveLength(0);
  });
  it("deduplicates replayed domain events", async () => {
    for (let n = 0; n < 3; n++)
      await tx((c) =>
        notify(c, [users[0].id, users[1].id], `proposal:x:1`, "date.proposed", mid),
      );
    expect((await inbox(0)).items).toHaveLength(1);
    expect((await inbox(1)).items).toHaveLength(1);
  });
  it("lets only the owner mark notifications read", async () => {
    await tx((c) => notify(c, [users[1].id], "match:x", "match.created", mid));
    const [item] = (await inbox(1)).items;
    const foreign = await request(2, "POST", "/notifications/read", { ids: [item.id] });
    expect(foreign.json().data.marked).toBe(0);
    expect((await inbox(1)).unread).toBe(1);
    const own = await request(1, "POST", "/notifications/read", {});
    expect(own.json().data.marked).toBe(1);
    expect((await inbox(1)).unread).toBe(0);
  });
  it("hides dating events once the match closes but keeps payment receipts", async () => {
    await tx(async (c) => {
      await notify(c, [users[1].id], "message:x", "message.received", mid);
      await notify(c, [users[1].id], "refund:x", "refund.completed", mid);
    });
    await db.query("UPDATE matches SET status='closed' WHERE id=$1", [mid]);
    const items = (await inbox(1)).items;
    expect(items.map((n: any) => n.category)).toEqual(["refund.completed"]);
    expect(items[0].matchId).toBeNull();
  });
});
