import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { mutate } from "../src/store";
async function history() {
  const f = fixture();
  const actor = await f.login("Alex"),
    peer = await f.login("Jordan");
  await f.data("Alex", "POST", "/decisions", {
    targetId: peer.id,
    action: "like",
    clientMutationId: crypto.randomUUID(),
  });
  const result = await f.data("Jordan", "POST", "/decisions", {
    targetId: actor.id,
    action: "like",
    clientMutationId: crypto.randomUUID(),
  });
  const mid = result.match.id;
  await mutate("owner-one", f.env, (s) => {
    s.matches.find((m) => m.id === mid)!.lastSequence = 257;
    s.messages = Array.from({ length: 257 }, (_, i) => {
      const sequence = 257 - i;
      return {
        id: crypto.randomUUID(),
        match_id: mid,
        sequence,
        sender_id: sequence % 2 ? actor.id : peer.id,
        client_id: crypto.randomUUID(),
        text: "Synthetic message " + sequence,
        created_at: new Date().toISOString(),
      };
    });
    s.messages.push({
      id: crypto.randomUUID(),
      match_id: crypto.randomUUID(),
      sequence: 1,
      sender_id: peer.id,
      client_id: crypto.randomUUID(),
      text: "Foreign conversation",
      created_at: new Date().toISOString(),
    });
  });
  return { ...f, mid, actor, peer };
}
test("hosted history returns ascending first pages without skipping older messages or new catch-up", async () => {
  const f = await history();
  try {
    const path = `/conversations/${f.mid}/messages`;
    const first = await f.data("Alex", "GET", path);
    assert.equal(first.length, 100);
    assert.deepEqual(
      first.map((m: any) => m.sequence),
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    await mutate("owner-one", f.env, (s) => {
      s.matches.find((m) => m.id === f.mid)!.lastSequence = 258;
      s.messages.push({
        id: crypto.randomUUID(),
        match_id: f.mid,
        sequence: 258,
        sender_id: f.peer.id,
        client_id: crypto.randomUUID(),
        text: "Synthetic catch-up",
        created_at: new Date().toISOString(),
      });
    });
    const second = await f.data("Alex", "GET", path + "?after=100");
    const third = await f.data("Alex", "GET", path + "?after=200");
    assert.equal(second.length, 100);
    assert.equal(third.length, 58);
    const all = [...first, ...second, ...third];
    assert.deepEqual(
      all.map((m: any) => m.sequence),
      Array.from({ length: 258 }, (_, i) => i + 1),
    );
    assert.equal(new Set(all.map((m: any) => m.id)).size, 258);
    assert.equal(
      all.some((m: any) => m.text === "Foreign conversation"),
      false,
    );
    assert.deepEqual(await f.data("Alex", "GET", path + "?after=258"), []);
    assert.deepEqual(
      await f.data("Alex", "GET", path + "?after=9007199254740991"),
      [],
    );
  } finally {
    f.db.close();
  }
});

test("hosted message cursors reject malformed, repeated and unsafe values", async () => {
  const f = await history();
  try {
    for (const query of [
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
    ]) {
      const response = await f.request(
        "Alex",
        "GET",
        `/conversations/${f.mid}/messages?${query}`,
      );
      assert.equal(response.status, 400, query);
    }
    assert.deepEqual(
      await f.data(
        "Alex",
        "GET",
        `/conversations/${f.mid}/messages?after=2147483648`,
      ),
      [],
    );
  } finally {
    f.db.close();
  }
});
test("hosted later pages recheck outsider and revoked conversation access", async () => {
  const f = await history();
  try {
    const path = `/conversations/${f.mid}/messages`;
    await f.login("Sam");
    assert.equal(
      (await f.request("Sam", "GET", path + "?after=100")).status,
      404,
    );
    assert.equal((await f.data("Alex", "GET", path)).length, 100);
    await f.data("Jordan", "POST", "/blocks", { targetId: f.actor.id });
    const blocked = await f.request("Alex", "GET", path + "?after=100");
    assert.equal(blocked.status, 404);
    assert.equal(((await blocked.json()) as any).data, undefined);
  } finally {
    f.db.close();
  }
});
