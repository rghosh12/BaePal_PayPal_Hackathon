import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { io as clientIO, type Socket } from "socket.io-client";
import { buildApp } from "../src/app.js";
import { db, one } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { sendMessage } from "../src/domain.js";
import { readFile } from "node:fs/promises";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Chat event regressions require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"],
  io: Awaited<ReturnType<typeof buildApp>>["io"],
  origin: string,
  mid: string;
let users: { id: string; token: string; csrf: string }[];
const clients: Socket[] = [];
function sendBody() {
  return { text: "Synthetic durable message", clientMessageId: randomUUID() };
}
async function request(
  user: number,
  method: string,
  path: string,
  payload?: Record<string, unknown>,
) {
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
async function socket(user = 0) {
  const client = clientIO(origin, {
    transports: ["polling"],
    upgrade: false,
    reconnection: false,
    forceNew: true,
    extraHeaders: {
      Origin: config.APP_ORIGIN,
      Cookie: "baepal=" + users[user].token,
    },
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Synthetic socket connection timeout")),
      2000,
    );
    client.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("connect_error", () => {
      clearTimeout(timer);
      reject(Error("Synthetic connection failed"));
    });
  });
  return client;
}
function ack(client: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) =>
    client
      .timeout(2000)
      .emit(event, payload, (error: Error | null, result: unknown) =>
        error
          ? reject(Error("Synthetic acknowledgement timeout"))
          : resolve(result),
      ),
  );
}
async function waitForAdmission() {
  const limit = Date.now() + 2500;
  while (Date.now() < limit) {
    if (
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
        )
      ).n > 0
    )
      return;
    await pause(5);
  }
  throw Error("Synthetic admission gate timeout");
}
async function changeSession(user: number, reason: string) {
  if (reason === "expired")
    await db.query(
      "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
      [hash(users[user].token)],
    );
  else
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(users[user].token),
    ]);
}
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
      [user.id, user.id + "@event.test.invalid"],
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
  ({ app, io } = await buildApp());
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.disconnect();
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("durable chat events and queued session authorization", () => {
  it.each(["expired", "revoked"])(
    "rejects REST send after session is %s during admission wait",
    async (reason) => {
      const locker = await db.connect(),
        key = `message-sender:${users[0].id}`;
      await locker.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
        key,
      ]);
      const pending = request(
        0,
        "POST",
        `/conversations/${mid}/messages`,
        sendBody(),
      );
      try {
        await waitForAdmission();
        await changeSession(0, reason);
      } finally {
        await locker.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [key],
        );
        locker.release();
      }
      const response = await pending;
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("SESSION_EXPIRED");
      expect((await one(db, "SELECT count(*)::int AS n FROM messages")).n).toBe(
        0,
      );
      expect(
        (await one(db, "SELECT count(*)::int AS n FROM chat_message_events")).n,
      ).toBe(0);
    },
  );
  it.each(["expired", "revoked"])(
    "rejects Socket send after session is %s during admission wait",
    async (reason) => {
      const client = await socket(),
        locker = await db.connect(),
        key = `message-sender:${users[0].id}`;
      await locker.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
        key,
      ]);
      const pending = ack(client, "message.send", {
        ...sendBody(),
        conversationId: mid,
      });
      try {
        await waitForAdmission();
        await changeSession(0, reason);
      } finally {
        await locker.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [key],
        );
        locker.release();
      }
      expect(await pending).toEqual({ error: "Message could not be sent" });
      expect((await one(db, "SELECT count(*)::int AS n FROM messages")).n).toBe(
        0,
      );
      expect(
        (await one(db, "SELECT count(*)::int AS n FROM chat_message_events")).n,
      ).toBe(0);
    },
  );
  it.each(["expired", "revoked"])(
    "removes queued subscription when session becomes %s before join acknowledgement",
    async (reason) => {
      const client = await socket(),
        server = io.sockets.sockets.get(client.id!)!;
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
          enter = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const join = server.join.bind(server);
      vi.spyOn(server, "join").mockImplementation(async (room) => {
        await join(room);
        enter();
        await gate;
      });
      const pending = ack(client, "conversation.subscribe", mid);
      try {
        await entered;
        await changeSession(0, reason);
      } finally {
        release();
      }
      expect(await pending).toEqual({ error: "Conversation unavailable" });
      expect(server.rooms.has(`match:${mid}`)).toBe(false);
    },
  );
  it("persists exactly one metadata-only versioned event for an exact message retry", async () => {
    const body = sendBody(),
      first = await request(0, "POST", `/conversations/${mid}/messages`, body);
    expect(first.statusCode).toBe(200);
    const before = await request(0, "GET", `/conversations/${mid}/events`);
    expect(before.statusCode).toBe(200);
    const event = before.json().data[0];
    expect(Object.keys(event).sort()).toEqual([
      "aggregateId",
      "eventId",
      "payload",
      "schemaVersion",
      "timestamp",
      "type",
    ]);
    expect(event).toMatchObject({
      schemaVersion: 1,
      aggregateId: mid,
      timestamp: first.json().data.created_at,
      type: "message.created",
      payload: { messageId: first.json().data.id, sequence: 1 },
    });
    expect(event.eventId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(event)).not.toContain(body.text);
    const again = await request(
      0,
      "POST",
      `/conversations/${mid}/messages`,
      body,
    );
    expect(again.json().data.id).toBe(first.json().data.id);
    expect(
      (await request(0, "GET", `/conversations/${mid}/events`)).json().data,
    ).toEqual([event]);
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM chat_message_events")).n,
    ).toBe(1);
    const columns = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_message_events'",
      )
    ).rows.map((r) => r.column_name);
    expect(columns.sort()).toEqual([
      "conversation_id",
      "event_id",
      "event_type",
      "message_id",
      "occurred_at",
      "schema_version",
      "sequence",
    ]);
  });
  it("rolls message, sequence and event back together if metadata persistence fails", async () => {
    await db.query(
      "CREATE FUNCTION test_fail_chat_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic metadata failure'; END $$",
    );
    await db.query(
      "CREATE TRIGGER test_fail_chat_event BEFORE INSERT ON chat_message_events FOR EACH ROW EXECUTE FUNCTION test_fail_chat_event()",
    );
    try {
      const response = await request(
        0,
        "POST",
        `/conversations/${mid}/messages`,
        sendBody(),
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("synthetic metadata failure");
      expect((await one(db, "SELECT count(*)::int AS n FROM messages")).n).toBe(
        0,
      );
      expect(
        (await one(db, "SELECT count(*)::int AS n FROM chat_message_events")).n,
      ).toBe(0);
      expect(
        (await one(db, "SELECT last_sequence FROM matches WHERE id=$1", [mid]))
          .last_sequence,
      ).toBe(0);
    } finally {
      await db.query(
        "DROP TRIGGER test_fail_chat_event ON chat_message_events",
      );
      await db.query("DROP FUNCTION test_fail_chat_event()");
    }
    const retry = await request(
      0,
      "POST",
      `/conversations/${mid}/messages`,
      sendBody(),
    );
    expect(retry.json().data.sequence).toBe(1);
  });
  it("replays persisted events after app restart when the live publication step never ran", async () => {
    const saved = await sendMessage(
      users[0].id,
      mid,
      "Synthetic offline persistence",
      randomUUID(),
    );
    const before = (
      await request(1, "GET", `/conversations/${mid}/events`)
    ).json().data;
    expect(before[0].payload.messageId).toBe(saved.id);
    await app.close();
    ({ app, io } = await buildApp());
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
    expect(
      (await request(1, "GET", `/conversations/${mid}/events`)).json().data,
    ).toEqual(before);
    expect(
      (await request(1, "GET", `/conversations/${mid}/messages`)).json().data[0]
        .id,
    ).toBe(saved.id);
  });
  it("backfills preexisting history without copied text or changing event identity on repeat", async () => {
    const schema = "chat_backfill_" + randomUUID().replaceAll("-", ""),
      c = await db.connect();
    try {
      await c.query("CREATE SCHEMA " + schema);
      await c.query("SET search_path TO " + schema);
      await c.query(
        await readFile(
          new URL("../../../db/migrations/001_initial.sql", import.meta.url),
          "utf8",
        ),
      );
      const a = randomUUID(),
        b = randomUUID(),
        match = randomUUID(),
        message = randomUUID();
      for (const id of [a, b])
        await c.query(
          "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic','active')",
          [id, id + "@backfill.test.invalid"],
        );
      await c.query(
        "INSERT INTO matches(id,low_id,high_id,last_sequence) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid),1)",
        [match, a, b],
      );
      await c.query(
        "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text) VALUES($1,$2,1,$3,$4,'Synthetic historical text')",
        [message, match, a, randomUUID()],
      );
      const migration = await readFile(
        new URL(
          "../../../db/migrations/005_durable_chat_events.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await c.query(migration);
      const first = (await c.query("SELECT * FROM chat_message_events"))
        .rows[0];
      expect(first.message_id).toBe(message);
      expect(first.conversation_id).toBe(match);
      expect(first.sequence).toBe(1);
      expect(JSON.stringify(first)).not.toContain("Synthetic historical text");
      await c.query(
        migration.slice(migration.indexOf("INSERT INTO chat_message_events")),
      );
      expect((await c.query("SELECT * FROM chat_message_events")).rows).toEqual(
        [first],
      );
    } finally {
      await c.query("RESET search_path");
      await c.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      c.release();
    }
  });
  it("pages durable envelopes past100 and rechecks replay permissions", async () => {
    for (let n = 1; n <= 205; n++) {
      const id = randomUUID();
      await db.query(
        "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text) VALUES($1,$2,$3,$4,$5,'Synthetic paged history')",
        [id, mid, n, users[0].id, randomUUID()],
      );
      await db.query(
        "INSERT INTO chat_message_events(event_id,message_id,conversation_id,sequence,occurred_at) SELECT $1,id,match_id,sequence,created_at FROM messages WHERE id=$2",
        [randomUUID(), id],
      );
    }
    const first = (
        await request(0, "GET", `/conversations/${mid}/events`)
      ).json().data,
      second = (
        await request(0, "GET", `/conversations/${mid}/events?after=100`)
      ).json().data,
      third = (
        await request(0, "GET", `/conversations/${mid}/events?after=200`)
      ).json().data;
    expect([first.length, second.length, third.length]).toEqual([100, 100, 5]);
    expect(
      [...first, ...second, ...third].map((e) => e.payload.sequence),
    ).toEqual(Array.from({ length: 205 }, (_, i) => i + 1));
    expect(
      (
        await request(
          0,
          "GET",
          `/conversations/${mid}/events?after=9007199254740991`,
        )
      ).json().data,
    ).toEqual([]);
    for (const cursor of ["-1", "1.5", "9007199254740992", "1&after=2", ""])
      expect(
        (
          await request(
            0,
            "GET",
            `/conversations/${mid}/events?after=${cursor}`,
          )
        ).statusCode,
      ).toBe(400);
    expect(
      (await request(2, "GET", `/conversations/${mid}/events`)).statusCode,
    ).toBe(404);
    await db.query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)", [
      users[1].id,
      users[0].id,
    ]);
    expect(
      (await request(0, "GET", `/conversations/${mid}/events?after=100`))
        .statusCode,
    ).toBe(404);
    expect(
      (await request(1, "GET", `/conversations/${mid}/events?after=100`))
        .statusCode,
    ).toBe(404);
  });
  it("emits the same durable typed envelope alongside the unchanged legacy event", async () => {
    const peer = await socket(1);
    expect(await ack(peer, "conversation.subscribe", mid)).toEqual({
      ok: true,
    });
    const event = new Promise<any>((resolve) =>
        peer.once("chat.event", resolve),
      ),
      legacy = new Promise<any>((resolve) =>
        peer.once("message.created", resolve),
      );
    const sent = await request(
      0,
      "POST",
      `/conversations/${mid}/messages`,
      sendBody(),
    );
    const envelope = await event,
      old = await legacy;
    expect(old.id).toBe(sent.json().data.id);
    expect(old.text).toBe(sent.json().data.text);
    expect(envelope).toEqual(
      (await request(1, "GET", `/conversations/${mid}/events`)).json().data[0],
    );
    expect(envelope.payload).toEqual({
      messageId: old.id,
      sequence: old.sequence,
    });
  });
  it.each(["expired", "revoked"])(
    "does not deliver either event stream to a %s recipient",
    async (reason) => {
      const peer = await socket(1);
      expect(await ack(peer, "conversation.subscribe", mid)).toEqual({
        ok: true,
      });
      const received: unknown[] = [];
      peer.on("chat.event", (e) => received.push(e));
      peer.on("message.created", (e) => received.push(e));
      const revoked = new Promise<void>((resolve) =>
        peer.once("access.revoked", () => resolve()),
      );
      await changeSession(1, reason);
      expect(
        (await request(0, "POST", `/conversations/${mid}/messages`, sendBody()))
          .statusCode,
      ).toBe(200);
      await revoked;
      expect(received).toEqual([]);
      expect(io.sockets.sockets.get(peer.id!)!.rooms.has(`match:${mid}`)).toBe(
        false,
      );
      expect(
        (await request(1, "GET", `/conversations/${mid}/events`)).statusCode,
      ).toBe(401);
    },
  );
});
