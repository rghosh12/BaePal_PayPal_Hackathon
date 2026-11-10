export type ChatMessage = {
  id: string;
  sequence: number;
  sender_id: string;
  text: string;
  created_at: string;
};
export type ChatDraft = {
  draft: string;
  retry: { text: string; id: string } | null;
  revoked: boolean;
  epoch: number;
};
const drafts = new Map<string, ChatDraft>();
let actor: string | null = null;
export const chatScope = (actorId: string, conversationId: string) =>
  `${actorId}:${conversationId}`;
export function activateChatActor(next: string | null) {
  if (actor === next) return;
  for (const entry of drafts.values()) {
    entry.epoch++;
    entry.revoked = true;
    entry.draft = "";
    entry.retry = null;
  }
  drafts.clear();
  actor = next;
}
export function chatDraft(scope: string) {
  let entry = drafts.get(scope);
  if (!entry) {
    entry = { draft: "", retry: null, revoked: false, epoch: 0 };
    drafts.set(scope, entry);
  } else {
    drafts.delete(scope);
    drafts.set(scope, entry);
  }
  while (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  return entry;
}
export function currentChatDraft(
  scope: string,
  entry: ChatDraft,
  epoch: number,
) {
  return drafts.get(scope) === entry && entry.epoch === epoch && !entry.revoked;
}
export function revokeChat(scope: string) {
  const entry = drafts.get(scope);
  if (entry) {
    entry.epoch++;
    entry.revoked = true;
    entry.draft = "";
    entry.retry = null;
  }
}
export function messagePage(raw: unknown, after: number): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length > 100)
    throw Error("Unsupported message page.");
  const ids = new Set<string>();
  let previous = after;
  for (const row of raw) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      ids.has(row.id) ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence <= previous ||
      typeof row.sender_id !== "string" ||
      typeof row.text !== "string" ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      throw Error("Unsupported message page.");
    ids.add(row.id);
    previous = row.sequence;
  }
  return raw.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    sender_id: row.sender_id,
    text: row.text,
    created_at: row.created_at,
  }));
}
export function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
) {
  const ids = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) ids.set(row.id, row);
  const sequences = new Map<number, ChatMessage>();
  for (const row of ids.values()) sequences.set(row.sequence, row);
  return [...sequences.values()].sort(
    (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
  );
}
export async function fetchMessageBatch(
  fetchPage: (after: number) => Promise<unknown>,
  after: number,
  accept: (page: ChatMessage[], cursor: number, more: boolean) => void,
  current: () => boolean,
  maxPages = 5,
) {
  let cursor = after,
    more = false;
  for (let count = 0; count < maxPages; count++) {
    const raw = await fetchPage(cursor);
    if (!current()) return;
    const page = messagePage(raw, cursor);
    if (page.length) cursor = page[page.length - 1].sequence;
    more = raw instanceof Array && raw.length === 100;
    accept(page, cursor, more);
    if (!more) break;
  }
  return { cursor, more };
}
