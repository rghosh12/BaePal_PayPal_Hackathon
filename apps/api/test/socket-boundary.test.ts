import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { io as clientIO, type Socket } from "socket.io-client";
import { buildApp } from "../src/app.js";
import { db, one } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { migrate } from "../src/migrate.js";
import { config } from "../src/config.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Socket boundary tests require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"],
  io: Awaited<ReturnType<typeof buildApp>>["io"];
let mid: string, origin: string, cookie: string;
const clients: Socket[] = [];
async function connect() {
  const socket = clientIO(origin, {
    transports: ["polling"],
    upgrade: false,
    reconnection: false,
    forceNew: true,
    extraHeaders: { Origin: config.APP_ORIGIN, Cookie: cookie },
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Synthetic socket connection timeout")),
      2000,
    );
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", () => {
      clearTimeout(timeout);
      reject(Error("Synthetic socket could not connect"));
    });
  });
  return socket;
}
function acknowledge(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<any> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(2000)
      .emit(event, payload, (error: Error | null, response: unknown) =>
        error
          ? reject(Error("Socket acknowledgement timeout"))
          : resolve(response),
      ),
  );
}
async function messageCount(count: number) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE match_id=$1",
          [mid],
        )
      ).n === count
    )
      return;
    await pause(5);
  }
  throw Error("Synthetic socket persistence timeout");
}
const payload = () => ({
  conversationId: mid,
  text: "Synthetic boundary message",
  clientMessageId: randomUUID(),
});
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  const users = [randomUUID(), randomUUID()],
    token = randomUUID();
  mid = randomUUID();
  for (const user of users)
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [user, user + "@socket.test.invalid"],
    );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'synthetic-csrf',now()+interval '1 hour')",
    [hash(token), users[0]],
  );
  cookie = "baepal=" + token;
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, ...users],
  );
  ({ app, io } = await buildApp());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  origin = address;
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("Socket.IO input and optional acknowledgement boundary", () => {
  it.each(["conversation.subscribe", "message.send"])(
    "registered %s handler safely ignores a non-function acknowledgement",
    async (event) => {
      const client = await connect(),
        server = io.sockets.sockets.get(client.id!)!;
      const handler = server.listeners(event)[0] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      // Await the real registered handler to contain the old rejected promise;
      // these arguments are the same extra event data a wire client can provide.
      await expect(
        handler(
          event === "conversation.subscribe" ? mid : payload(),
          "not-a-function",
        ),
      ).resolves.toBeUndefined();
    },
  );
  it("keeps live wire events safe with malformed callback positions and valid no-ack sends", async () => {
    const client = await connect();
    const first = payload(),
      second = payload();
    client.emit("conversation.subscribe", mid, { not: "a callback" });
    client.emit("message.send", first, "not-a-function");
    client.emit("message.send", second);
    await messageCount(2);
    expect(await acknowledge(client, "conversation.subscribe", mid)).toEqual({
      ok: true,
    });
    const retry = await acknowledge(client, "message.send", first);
    expect(Object.keys(retry)).toEqual(["data"]);
    expect(retry.data.text).toBe(first.text);
    expect(retry.data.client_id).toBe(first.clientMessageId);
    await messageCount(2);
    // Invalid unacknowledged frames must not crash listeners or persist content.
    client.emit("conversation.subscribe", ["bad-id"], false);
    client.emit("message.send", null, 0);
    client.emit("message.send", { text: 123 }, []);
    expect(await acknowledge(client, "conversation.subscribe", mid)).toEqual({
      ok: true,
    });
    expect(client.connected).toBe(true);
    await messageCount(2);
  });
  it("returns the existing generic acknowledgement errors for malformed event shapes", async () => {
    const client = await connect();
    for (const mid of [null, {}, [], false, 123, "not-a-uuid"]) {
      expect(await acknowledge(client, "conversation.subscribe", mid)).toEqual({
        error: "Conversation unavailable",
      });
    }
    for (const body of [
      null,
      [],
      "message",
      123,
      {},
      { ...payload(), text: " " },
      { ...payload(), text: "x".repeat(2001) },
      { ...payload(), conversationId: "bad" },
      { ...payload(), clientMessageId: "bad" },
    ]) {
      expect(await acknowledge(client, "message.send", body)).toEqual({
        error: "Message could not be sent",
      });
    }
    expect((await one(db, "SELECT count(*)::int AS n FROM messages")).n).toBe(
      0,
    );
    const sent = await acknowledge(client, "message.send", payload());
    expect(sent.data.text).toBe("Synthetic boundary message");
    expect(Object.keys(sent)).toEqual(["data"]);
  });
  it("does not reject either listener if acknowledgement delivery itself throws", async () => {
    const client = await connect(),
      server = io.sockets.sockets.get(client.id!)!;
    const broken = () => {
      throw Error("Synthetic acknowledgement delivery failure");
    };
    for (const event of ["conversation.subscribe", "message.send"]) {
      const handler = server.listeners(event)[0] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await expect(
        handler(event === "conversation.subscribe" ? mid : payload(), broken),
      ).resolves.toBeUndefined();
      await expect(handler(null, broken)).resolves.toBeUndefined();
    }
    await messageCount(1);
    expect(await acknowledge(client, "conversation.subscribe", mid)).toEqual({
      ok: true,
    });
  });
});
