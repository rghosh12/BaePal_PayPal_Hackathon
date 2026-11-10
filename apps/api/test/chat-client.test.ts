import { beforeEach, describe, expect, it } from "vitest";
import {
  activateChatActor,
  chatDraft,
  chatScope,
  currentChatDraft,
  fetchMessageBatch,
  mergeMessages,
  messagePage,
  revokeChat,
  type ChatMessage,
} from "../../web/src/components/chat-state.js";
const row = (sequence: number): ChatMessage => ({
  id: "message-" + sequence,
  sequence,
  sender_id: "actor-a",
  text: "Synthetic message " + sequence,
  created_at: "2026-11-10T12:00:00.000Z",
});
beforeEach(() => {
  activateChatActor(null);
  activateChatActor("actor-a");
});
describe("chat paging and in-memory scope guards", () => {
  it("loads more than 100 messages and catches up without dropping or duplicating earlier pages", async () => {
    const saved = Array.from({ length: 235 }, (_, i) => row(i + 1));
    let rows: ChatMessage[] = [],
      cursor = 0;
    const load = () =>
      fetchMessageBatch(
        async (after) => saved.filter((r) => r.sequence > after).slice(0, 100),
        cursor,
        (page, next) => {
          rows = mergeMessages(rows, page);
          cursor = next;
        },
        () => true,
      );
    await load();
    expect(rows).toHaveLength(235);
    expect(cursor).toBe(235);
    saved.push(row(236));
    rows = mergeMessages(rows, [row(236)]);
    await load();
    expect(rows).toHaveLength(236);
    expect(rows.map((r) => r.sequence)).toEqual(saved.map((r) => r.sequence));
    await load();
    expect(rows).toHaveLength(236);
  });
  it("bounds a batch then resumes at its fetched cursor rather than a far-ahead send acknowledgement", async () => {
    const saved = Array.from({ length: 235 }, (_, i) => row(i + 1));
    let rows = [row(235)],
      cursor = 0;
    const collect = (page: ChatMessage[], next: number) => {
      rows = mergeMessages(rows, page);
      cursor = next;
    };
    const fetch = async (after: number) =>
      saved.filter((r) => r.sequence > after).slice(0, 100);
    const first = await fetchMessageBatch(
      fetch,
      cursor,
      collect,
      () => true,
      2,
    );
    expect(first).toEqual({ cursor: 200, more: true });
    expect(rows).toHaveLength(201);
    await fetchMessageBatch(fetch, cursor, collect, () => true, 2);
    expect(rows).toHaveLength(235);
    expect(cursor).toBe(235);
  });
  it("ignores a page resolving after access revocation", async () => {
    const scope = chatScope("actor-a", "conversation-a"),
      entry = chatDraft(scope),
      epoch = entry.epoch;
    let release!: (rows: ChatMessage[]) => void;
    const gate = new Promise<ChatMessage[]>((resolve) => {
      release = resolve;
    });
    const accepted: ChatMessage[] = [];
    const load = fetchMessageBatch(
      () => gate,
      0,
      (page) => accepted.push(...page),
      () => currentChatDraft(scope, entry, epoch),
    );
    revokeChat(scope);
    release([row(1)]);
    await load;
    expect(accepted).toEqual([]);
  });
  it("keeps drafts and uncertain-send keys scoped to actor and conversation across navigation", () => {
    const first = chatDraft(chatScope("actor-a", "conversation-a"));
    first.draft = "Retained draft";
    first.retry = { text: "Retained draft", id: "stable-request" };
    const other = chatDraft(chatScope("actor-a", "conversation-b"));
    expect(other.draft).toBe("");
    expect(other.retry).toBeNull();
    expect(chatDraft(chatScope("actor-a", "conversation-a"))).toBe(first);
    expect(first.retry?.id).toBe("stable-request");
    activateChatActor("actor-b");
    expect(chatDraft(chatScope("actor-b", "conversation-a")).draft).toBe("");
    expect(
      currentChatDraft(chatScope("actor-a", "conversation-a"), first, 0),
    ).toBe(false);
  });
  it("clears draft/retry memory and invalidates old requests on logout or revocation", () => {
    const scope = chatScope("actor-a", "conversation-a"),
      entry = chatDraft(scope),
      epoch = entry.epoch;
    entry.draft = "private fixture";
    entry.retry = { text: entry.draft, id: "request" };
    revokeChat(scope);
    expect(entry.draft).toBe("");
    expect(entry.retry).toBeNull();
    expect(currentChatDraft(scope, entry, epoch)).toBe(false);
    activateChatActor(null);
    activateChatActor("actor-a");
    expect(chatDraft(scope).revoked).toBe(false);
    expect(chatDraft(scope).draft).toBe("");
  });
  it("bounds retained draft scopes and invalidates an evicted entry", () => {
    const first = chatDraft(chatScope("actor-a", "first"));
    for (let i = 0; i < 20; i++)
      chatDraft(chatScope("actor-a", "conversation-" + i));
    expect(currentChatDraft(chatScope("actor-a", "first"), first, 0)).toBe(
      false,
    );
  });
  it("rejects malformed, unsorted, duplicated or non-advancing pages", () => {
    for (const page of [
      null,
      [row(1), row(1)],
      [row(2), row(1)],
      [{ ...row(1), sequence: "1" }],
      Array.from({ length: 101 }, (_, i) => row(i + 1)),
    ])
      expect(() => messagePage(page, 0)).toThrow("Unsupported message page");
    expect(() => messagePage([row(1)], 1)).toThrow("Unsupported message page");
  });
});
