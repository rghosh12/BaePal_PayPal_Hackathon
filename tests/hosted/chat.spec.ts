import { test, expect, type APIRequestContext } from "@playwright/test";
import fixture from "../../apps/hosted/scripts/chat-fixture.json";
const ownerHeaders = { "x-baepal-test-owner": fixture.owner };
const endpoint = `/api/v1/conversations/${fixture.matchId}/messages`;
async function allMessages(request: APIRequestContext) {
  const messages: Record<string, any>[] = [];
  let after = 0;
  for (let page = 0; page < 10; page++) {
    const response = await request.get(endpoint + "?after=" + after, {
      headers: ownerHeaders,
    });
    expect(response.ok()).toBe(true);
    const rows = (await response.json()).data;
    expect(Array.isArray(rows)).toBe(true);
    messages.push(...rows);
    if (rows.length < 100) return messages;
    const next = rows.at(-1).sequence;
    expect(next).toBeGreaterThan(after);
    after = next;
  }
  throw Error("Fictional chat pagination did not finish.");
}
test("long chat catches up, retries a persisted send after lost ack, then clears on partner block", async ({
  browser,
}) => {
  const alex = await browser.newContext({ extraHTTPHeaders: ownerHeaders });
  const jordan = await browser.newContext({ extraHTTPHeaders: ownerHeaders });
  try {
    const page = await alex.newPage();
    await page.goto("/auth/login");
    await page.getByRole("button", { name: "Continue as Alex" }).click();
    await page.goto(`/chats/${fixture.matchId}`);
    const log = page.getByRole("log", { name: "Conversation messages" });
    const rows = log.locator(".message p");
    const expected = Array.from(
      { length: fixture.count },
      (_, index) => fixture.prefix + String(index + 1).padStart(3, "0"),
    );
    await expect(rows).toHaveCount(fixture.count);
    expect(await rows.allTextContents()).toEqual(expected);

    const peerPage = await jordan.newPage();
    await peerPage.goto("/auth/login");
    await peerPage.getByRole("button", { name: "Continue as Jordan" }).click();
    const peerResponse = await jordan.request.get("/api/v1/me", {
      headers: ownerHeaders,
    });
    expect(peerResponse.ok()).toBe(true);
    const peer = (await peerResponse.json()).data;
    const origin = new URL(page.url()).origin;
    const peerHeaders = { ...ownerHeaders, origin, "x-csrf-token": peer.csrf };
    const pollText = "CI fictional partner update after the initial history.";
    const added = await jordan.request.post(endpoint, {
      headers: peerHeaders,
      data: { text: pollText, clientMessageId: crypto.randomUUID() },
    });
    expect(added.ok()).toBe(true);
    await expect(log.getByText(pollText, { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(rows).toHaveCount(fixture.count + 1);
    expect(await rows.allTextContents()).toEqual([...expected, pollText]);

    const posts: Record<string, any>[] = [];
    let releaseLost!: () => void;
    const lostAck = new Promise<void>((resolve) => {
      releaseLost = resolve;
    });
    let persistedId = "";
    await page.route("**/api/v1/conversations/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      posts.push(route.request().postDataJSON());
      if (posts.length !== 1) {
        await route.continue();
        return;
      }
      // Deliver to the actual harness and consume the committed response, then
      // lose only the browser acknowledgement. This is not a mocked persistence.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      persistedId = (await response.json()).data.id;
      await route.abort("failed");
      releaseLost();
    });
    const lostText =
      "CI fictional message with a deliberately lost acknowledgement.";
    const composer = page.getByRole("textbox", { name: "Your message" });
    const send = page.getByRole("button", { name: "Send message" });
    await composer.fill(lostText);
    await send.click();
    await lostAck;
    await expect(send).toBeEnabled();
    await expect(composer).toHaveValue(lostText);
    await send.click();
    await expect(composer).toHaveValue("");
    await expect(log.getByText(lostText, { exact: true })).toHaveCount(1);
    await expect(rows).toHaveCount(fixture.count + 2);
    expect(posts).toHaveLength(2);
    expect(posts[0].clientMessageId).toBeTruthy();
    expect(posts[1].clientMessageId).toBe(posts[0].clientMessageId);
    const stored = await allMessages(alex.request);
    expect(stored).toHaveLength(fixture.count + 2);
    expect(new Set(stored.map((message) => message.id)).size).toBe(
      stored.length,
    );
    expect(stored.map((message) => message.sequence)).toEqual(
      Array.from({ length: fixture.count + 2 }, (_, index) => index + 1),
    );
    const retried = stored.filter((message) => message.text === lostText);
    expect(retried).toHaveLength(1);
    expect(retried[0].id).toBe(persistedId);
    expect(retried[0].client_id).toBe(posts[0].clientMessageId);

    const actorResponse = await alex.request.get("/api/v1/me", {
      headers: ownerHeaders,
    });
    const actor = (await actorResponse.json()).data;
    const blocked = await jordan.request.post("/api/v1/blocks", {
      headers: peerHeaders,
      data: { targetId: actor.id },
    });
    expect(blocked.ok()).toBe(true);
    await expect(rows).toHaveCount(0, { timeout: 15000 });
    await expect(composer).toBeDisabled();
    await expect(send).toBeDisabled();
    const revoked = await alex.request.get(endpoint, { headers: ownerHeaders });
    expect(revoked.status()).toBe(404);
  } finally {
    await alex.close();
    await jordan.close();
  }
});
