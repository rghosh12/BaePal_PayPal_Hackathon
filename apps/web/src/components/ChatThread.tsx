"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, ShieldCheck, Sparkles } from "lucide-react";
import {
  chatDraft,
  chatScope,
  currentChatDraft,
  fetchMessageBatch,
  mergeMessages,
  messagePage,
  revokeChat,
  type ChatMessage,
} from "./chat-state";
type API = (
  path: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  csrfOverride?: string,
) => Promise<any>;
export default function ChatThread({
  actorId,
  conversationId,
  api,
  refreshToken,
  unavailable,
  transport,
  onUnavailable,
  suggestedDraft,
}: {
  actorId: string;
  conversationId: string;
  api: API;
  refreshToken: number;
  unavailable: boolean;
  transport: string;
  onUnavailable: (status: number, scope: string) => void;
  /** An AI/template draft the member chose to edit. Never auto-sent. */
  suggestedDraft?: { text: string; nonce: number } | null;
}) {
  const scope = chatScope(actorId, conversationId);
  const entry = useRef(chatDraft(scope)).current;
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [draft, setDraft] = useState(entry.draft),
    [loading, setLoading] = useState(!entry.revoked),
    [loaded, setLoaded] = useState(false),
    [more, setMore] = useState(false),
    [sending, setSending] = useState(false),
    [failed, setFailed] = useState(false),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(entry.revoked),
    [online, setOnline] = useState(
      typeof navigator === "undefined" || navigator.onLine,
    );
  const alive = useRef(false),
    cursor = useRef(0),
    fetching = useRef(false),
    queued = useRef(false),
    connection = useRef(online),
    request = useRef<AbortController | null>(null),
    sendRequest = useRef<AbortController | null>(null);
  const current = useCallback(
    (epoch: number) => alive.current && currentChatDraft(scope, entry, epoch),
    [scope, entry],
  );
  const deny = useCallback(
    (status: number) => {
      revokeChat(scope);
      request.current?.abort();
      sendRequest.current?.abort();
      setMessages([]);
      setDraft("");
      setMore(false);
      setDenied(true);
      setLoading(false);
      setSending(false);
      setError("");
      onUnavailable(status, scope);
    },
    [scope, onUnavailable],
  );
  useEffect(() => {
    if (!suggestedDraft || entry.revoked) return;
    entry.draft = suggestedDraft.text;
    setDraft(suggestedDraft.text);
  }, [suggestedDraft, entry]);
  const load = useCallback(async () => {
    if (!alive.current || entry.revoked || !connection.current) return;
    if (fetching.current) {
      queued.current = true;
      return;
    }
    fetching.current = true;
    setLoading(true);
    setError("");
    const epoch = entry.epoch,
      controller = new AbortController();
    request.current = controller;
    try {
      const identity = await api("/me", "GET", undefined, controller.signal);
      if (!current(epoch)) return;
      if (identity.id !== actorId) {
        deny(401);
        return;
      }
      await fetchMessageBatch(
        (after) =>
          api(
            `/conversations/${conversationId}/messages?after=${after}`,
            "GET",
            undefined,
            controller.signal,
          ),
        cursor.current,
        (page, next, hasMore) => {
          if (!current(epoch)) return;
          // The pagination cursor advances only through fetched pages, not send acknowledgements.
          cursor.current = next;
          setMessages((old) => mergeMessages(old, page));
          setMore(hasMore);
          setLoaded(true);
        },
        () => current(epoch),
      );
    } catch (e) {
      if (!current(epoch)) return;
      const status = (e as any).status;
      if ([401, 403, 404].includes(status)) deny(status);
      else if (!controller.signal.aborted)
        setError(
          "Could not refresh saved messages. Your draft is kept. Try refreshing again.",
        );
    } finally {
      fetching.current = false;
      if (current(epoch)) setLoading(false);
      if (queued.current) {
        queued.current = false;
        if (current(epoch) && connection.current) void load();
      }
    }
  }, [actorId, conversationId, entry, api, current, deny]);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 5000);
    const offline = () => {
      connection.current = false;
      setOnline(false);
      request.current?.abort();
      sendRequest.current?.abort();
    };
    const connected = () => {
      connection.current = true;
      setOnline(true);
      void load();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", connected);
    return () => {
      alive.current = false;
      request.current?.abort();
      sendRequest.current?.abort();
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connected);
    };
  }, [load]);
  useEffect(() => {
    if (unavailable && !entry.revoked) deny(404);
  }, [unavailable, entry, deny]);
  useEffect(() => {
    if (refreshToken) void load();
  }, [refreshToken, load]);
  async function send() {
    const text = draft.trim();
    if (!text || sending || entry.revoked || unavailable || !online || !loaded)
      return;
    const epoch = entry.epoch,
      controller = new AbortController();
    sendRequest.current = controller;
    const id =
      entry.retry?.text === text ? entry.retry.id : crypto.randomUUID();
    entry.retry = { text, id };
    setSending(true);
    setFailed(false);
    setError("");
    try {
      const identity = await api("/me", "GET", undefined, controller.signal);
      if (!current(epoch)) return;
      if (identity.id !== actorId) {
        deny(401);
        return;
      }
      if (typeof identity.csrf !== "string")
        throw Error("Session verification unavailable.");
      const saved = await api(
        `/conversations/${conversationId}/messages`,
        "POST",
        { text, clientMessageId: id },
        controller.signal,
        identity.csrf,
      );
      if (!current(epoch)) return;
      const row = messagePage([saved], 0);
      setMessages((old) => mergeMessages(old, row));
      entry.retry = null;
      if (entry.draft.trim() === text) {
        entry.draft = "";
        setDraft("");
      }
      void load();
    } catch (e) {
      if (!current(epoch)) return;
      const status = (e as any).status;
      if (
        [401, 403, 404].includes(status) &&
        !(status === 403 && (e as any).code === "CSRF_REQUIRED")
      )
        deny(status);
      else {
        setFailed(true);
        setError(
          "Message not confirmed saved. Your draft is kept. Retry sends the same request.",
        );
      }
    } finally {
      if (current(epoch)) setSending(false);
    }
  }
  const closed = denied || unavailable || entry.revoked;
  const status = closed
    ? "This conversation is unavailable. Messages and drafts have been cleared."
    : !online
      ? "Offline. Your draft is kept in this tab. Reconnect, then retry."
      : sending
        ? "Saving message…"
        : loading
          ? loaded
            ? "Refreshing saved messages…"
            : "Loading conversation…"
          : failed
            ? "Send failed. Retry your retained draft."
            : error
              ? "Refresh failed. Existing saved messages and your draft are kept."
              : more
                ? "More saved messages are available. Continue loading to catch up."
                : transport === "connecting"
                  ? "Connecting. Saved messages can still refresh."
                  : transport === "reconnecting"
                    ? "Reconnecting. You can refresh saved messages."
                    : "Saved messages are up to date.";
  return (
    <div className="chat-panel panel">
      <div className="chat-header">
        <ShieldCheck size={18} />
        <span>Mutual connection · messages are not end-to-end encrypted</span>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {!closed && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div
        className="messages"
        role="log"
        aria-label="Conversation messages"
        aria-busy={loading && !closed}
      >
        {!closed &&
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.sender_id === actorId ? "mine" : ""}`}
            >
              <p>{msg.text}</p>
              <span>
                {new Date(msg.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · saved
              </span>
            </div>
          ))}
        {!closed && loaded && !loading && !messages.length && (
          <div className="empty">
            <Sparkles />
            <h2>Start with a little curiosity.</h2>
            <p>What’s something you’re looking forward to this week?</p>
          </div>
        )}
      </div>
      {!closed && (
        <div>
          <button
            type="button"
            className="secondary"
            disabled={loading || !online}
            onClick={() => void load()}
          >
            {more ? "Continue loading messages" : "Refresh messages"}
          </button>
        </div>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="message-text">
          Your message
        </label>
        <input
          id="message-text"
          name="text"
          maxLength={2000}
          placeholder="A thoughtful hello…"
          required
          autoComplete="off"
          value={closed ? "" : draft}
          disabled={closed || sending}
          onChange={(event) => {
            entry.draft = event.target.value;
            setDraft(event.target.value);
            setFailed(false);
          }}
        />
        <button
          aria-label="Send message"
          disabled={closed || sending || !online || !loaded}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
