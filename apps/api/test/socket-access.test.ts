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
import { io as connectClient, type Socket } from "socket.io-client";
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { hash } from "../src/crypto.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Socket authorization tests require a dedicated _test database.");
type Session = { user: string; token: string; cookie: string; csrf: string };
let app: Awaited<ReturnType<typeof buildApp>>["app"],
  server: Awaited<ReturnType<typeof buildApp>>["io"];
let address: string, mid: string, users: string[], sessions: Session[];
const clients: Socket[] = [];
const pending = new Set<() => void>();
function next(socket: Socket, event: string) {
  let cancel!: () => void;
  const promise = new Promise<any>((resolve, reject) => {
    const done = (value: any) => {
      clearTimeout(timer);
      socket.off(event, done);
      pending.delete(cancel);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, done);
      pending.delete(cancel);
      reject(Error("Timed out waiting for " + event));
    }, 4000);
    cancel = () => {
      clearTimeout(timer);
      socket.off(event, done);
      reject(Error("Socket test closed."));
    };
    pending.add(cancel);
    socket.once(event, done);
  });
  // Cleanup must not create an unhandled rejection after an earlier assertion fails.
  void promise.catch(() => {});
  return promise;
}
async function newSession(user: string): Promise<Session> {
  const token = randomUUID(),
    csrf = randomUUID();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), user, csrf],
  );
  return { user, token, cookie: "baepal=" + token, csrf };
}
async function connect(session: Session) {
  const socket = connectClient(address, {
    transports: ["websocket"],
    upgrade: false,
    forceNew: true,
    autoConnect: false,
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Origin: config.APP_ORIGIN, Cookie: session.cookie },
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(Error("Socket did not connect.")),
      4000,
    );
    const connected = () => finish();
    const failed = (error: Error) => finish(error);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.off("connect", connected);
      socket.off("connect_error", failed);
      if (error) {
        socket.disconnect();
        reject(error);
      } else resolve();
    };
    socket.once("connect", connected);
    socket.once("connect_error", failed);
    socket.connect();
  });
  return socket;
}
const ack = (socket: Socket, event: string, payload: unknown) =>
  new Promise<any>((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(event, payload, (error: Error, result: any) =>
        error ? reject(error) : resolve(result),
      ),
  );
const send = (socket: Socket, text: string, client = randomUUID()) =>
  ack(socket, "message.send", {
    conversationId: mid,
    text,
    clientMessageId: client,
  });
const room = () =>
  server.sockets.adapter.rooms.get("match:" + mid) || new Set<string>();
async function subscribe(socket: Socket) {
  expect((await ack(socket, "conversation.subscribe", mid)).ok).toBe(true);
  expect(room().has(socket.id!)).toBe(true);
}
async function rest(
  session: Session,
  method: string,
  path: string,
  payload?: any,
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    payload,
  });
}
beforeAll(async () => {
  await migrate();
  ({ app, io: server } = await buildApp());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [randomUUID(), randomUUID(), randomUUID()];
  sessions = [];
  mid = randomUUID();
  for (const user of users) {
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [user, user + "@socket.test.invalid"],
    );
    sessions.push(await newSession(user));
  }
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, users[0], users[1]],
  );
});
afterEach(() => {
  for (const cancel of pending) cancel();
  pending.clear();
  server.disconnectSockets(true);
  for (const socket of clients) socket.disconnect();
  clients.length = 0;
});
afterAll(async () => {
  await app.close();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("established multi-socket session authorization", () => {
  it.each(["expired", "revoked"])(
    "excludes an established %s recipient session while an independent session receives persisted messages",
    async (state) => {
      const sender = await connect(sessions[0]),
        bad = await connect(sessions[1]),
        goodSession = await newSession(users[1]),
        good = await connect(goodSession);
      for (const socket of [sender, bad, good]) await subscribe(socket);
      const leaked: any[] = [];
      bad.on("message.created", (message) => leaked.push(message));
      if (state === "expired")
        await db.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
          [hash(sessions[1].token)],
        );
      else
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(sessions[1].token),
        ]);
      const revoked = next(bad, "access.revoked"),
        delivered = next(good, "message.created");
      const sent = await send(sender, "Synthetic authorized recipient only");
      expect(sent.data.sequence).toBe(1);
      expect((await delivered).id).toBe(sent.data.id);
      expect((await revoked).id).toBe(mid);
      expect(leaked).toEqual([]);
      expect(bad.connected).toBe(true);
      expect(room().has(bad.id!)).toBe(false);
      expect(room().has(good.id!)).toBe(true);
      expect(
        (await ack(bad, "conversation.subscribe", mid)).error,
      ).toBeTruthy();
      expect(
        (await send(bad, "Synthetic forbidden sender")).error,
      ).toBeTruthy();
      expect(
        (await rest(sessions[1], "GET", `/conversations/${mid}/messages`))
          .statusCode,
      ).toBe(401);
      const visible = await rest(
        goodSession,
        "GET",
        `/conversations/${mid}/messages`,
      );
      expect(visible.statusCode).toBe(200);
      expect(visible.json().data.map((m: any) => m.id)).toEqual([sent.data.id]);
      await expect(connect(sessions[1])).rejects.toThrow("Session unavailable");
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int AS n FROM messages WHERE match_id=$1",
            [mid],
          )
        ).n,
      ).toBe(1);
    },
  );
  it("logout disconnects every tab sharing a session without revoking an independent same-user session", async () => {
    const sender = await connect(sessions[0]),
      tabA = await connect(sessions[1]),
      tabB = await connect(sessions[1]),
      independentSession = await newSession(users[1]),
      independent = await connect(independentSession);
    for (const socket of [sender, tabA, tabB, independent])
      await subscribe(socket);
    const oldIds = [tabA.id!, tabB.id!],
      disconnected = Promise.all([
        next(tabA, "disconnect"),
        next(tabB, "disconnect"),
      ]);
    void disconnected.catch(() => {});
    expect(
      (await rest(sessions[1], "POST", "/auth/logout", {})).statusCode,
    ).toBe(200);
    await disconnected;
    expect(tabA.connected).toBe(false);
    expect(tabB.connected).toBe(false);
    expect(independent.connected).toBe(true);
    for (const id of oldIds) expect(room().has(id)).toBe(false);
    expect(room().has(independent.id!)).toBe(true);
    const received = next(independent, "message.created"),
      sent = await send(sender, "Synthetic independent session remains live");
    expect((await received).id).toBe(sent.data.id);
    await expect(connect(sessions[1])).rejects.toThrow("Session unavailable");
    expect(
      (await rest(independentSession, "GET", `/conversations/${mid}/messages`))
        .statusCode,
    ).toBe(200);
  });
  it("blocks all participant tabs and denies an outsider room membership, REST catch-up and resubscription", async () => {
    const participantSockets = [
      await connect(sessions[0]),
      await connect(sessions[0]),
      await connect(sessions[1]),
      await connect(sessions[1]),
    ];
    for (const socket of participantSockets) await subscribe(socket);
    const outsider = await connect(sessions[2]);
    expect(
      (await ack(outsider, "conversation.subscribe", mid)).error,
    ).toBeTruthy();
    expect(room().has(outsider.id!)).toBe(false);
    const revocations = Promise.all(
      participantSockets.map((socket) => next(socket, "access.revoked")),
    );
    void revocations.catch(() => {});
    expect(
      (await rest(sessions[0], "POST", "/blocks", { targetId: users[1] }))
        .statusCode,
    ).toBe(200);
    for (const event of await revocations) expect(event.id).toBe(mid);
    expect(room().size).toBe(0);
    for (const socket of participantSockets)
      expect(
        (await ack(socket, "conversation.subscribe", mid)).error,
      ).toBeTruthy();
    for (const socket of [
      participantSockets[0],
      participantSockets[2],
      outsider,
    ])
      expect(
        (await send(socket, "Synthetic denied after block")).error,
      ).toBeTruthy();
    for (const session of sessions)
      expect(
        (await rest(session, "GET", `/conversations/${mid}/messages?after=0`))
          .statusCode,
      ).toBe(404);
    const reconnected = await connect(sessions[1]);
    expect(
      (await ack(reconnected, "conversation.subscribe", mid)).error,
    ).toBeTruthy();
    expect(room().has(reconnected.id!)).toBe(false);
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE match_id=$1",
          [mid],
        )
      ).n,
    ).toBe(0);
  });
  it("recovers messages persisted while disconnected using sequence catch-up, then receives the live tail without gaps", async () => {
    const sender = await connect(sessions[0]),
      peer = await connect(sessions[1]);
    await subscribe(sender);
    await subscribe(peer);
    const firstEvent = next(peer, "message.created"),
      first = await send(sender, "Synthetic before disconnect");
    expect((await firstEvent).id).toBe(first.data.id);
    peer.disconnect();
    const saved = [first.data];
    for (let n = 2; n <= 4; n++) {
      const client = randomUUID(),
        sent = await send(sender, "Synthetic offline message " + n, client);
      saved.push(sent.data);
      if (n === 3)
        expect(
          (await send(sender, "Synthetic offline message " + n, client)).data
            .id,
        ).toBe(sent.data.id);
    }
    const reconnected = await connect(sessions[1]);
    await subscribe(reconnected);
    const missed = await rest(
      sessions[1],
      "GET",
      `/conversations/${mid}/messages?after=1`,
    );
    expect(missed.statusCode).toBe(200);
    expect(missed.json().data.map((m: any) => m.id)).toEqual(
      saved.slice(1).map((m) => m.id),
    );
    const live = next(reconnected, "message.created"),
      last = await send(sender, "Synthetic live tail");
    expect((await live).id).toBe(last.data.id);
    const history = [first.data, ...missed.json().data, last.data];
    expect(history.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(history.map((m) => m.id)).size).toBe(5);
    const tail = await rest(
      sessions[1],
      "GET",
      `/conversations/${mid}/messages?after=4`,
    );
    expect(tail.json().data.map((m: any) => m.id)).toEqual([last.data.id]);
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM messages WHERE match_id=$1",
          [mid],
        )
      ).n,
    ).toBe(5);
  });
});
