import { test, expect, type Page } from "@playwright/test";
import fixture from "../../apps/hosted/scripts/chat-fixture.json";
const ownerHeaders = { "x-baepal-test-owner": fixture.owner };
const endpoint = `/api/v1/conversations/${fixture.matchId}/messages`;
// Keep authenticated traffic in Chromium. Its localhost Secure-cookie handling
// matches the actual UI; Node APIRequestContext deliberately omits that cookie
// over this loopback HTTP harness. Production cookie settings stay unchanged.
async function browserRequest(
  page: Page,
  url: string,
  method = "GET",
  data?: unknown,
  csrf?: string,
) {
  return page.evaluate(
    async ({ url, method, data, csrf }) => {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { url, method, data, csrf },
  );
}
async function allMessages(page: Page) {
  const messages: Record<string, any>[] = [];
  let after = 0;
  for (let batch = 0; batch < 10; batch++) {
    const response = await browserRequest(page, endpoint + "?after=" + after);
    expect(response.status).toBe(200);
    const rows = response.body.data;
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
    await expect(page).toHaveURL(/\/discover$/);
    await page.goto(`/chats/${fixture.matchId}`);
    const log = page.getByRole("log", { name: "Conversation messages" });
    const rows = log.locator(".message p");
    const expected = Array.from(
      { length: fixture.count },
      (_, index) => fixture.prefix + String(index + 1).padStart(3, "0"),
    );
    await expect(rows).toHaveCount(fixture.count);
    expect(await rows.allTextContents()).toEqual(expected);
    const composer = page.getByRole("textbox", { name: "Your message" });
    const send = page.getByRole("button", { name: "Send message" });
    await page.setViewportSize({ width: 360, height: 800 });
    await composer.scrollIntoViewIfNeeded();
    await expect(composer).toBeVisible();
    await expect(send).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    const navigationDraft =
      "CI fictional draft kept while offline and navigating between chats.";
    await alex.setOffline(true);
    await expect(
      page.getByRole("status").filter({ hasText: /^Offline\./ }),
    ).toBeVisible();
    await composer.fill(navigationDraft);
    await expect(composer).toHaveValue(navigationDraft);
    await expect(send).toBeDisabled();
    await alex.setOffline(false);
    await expect(composer).toHaveValue(navigationDraft);
    await expect(send).toBeEnabled();
    // Use client navigation. A document reload intentionally clears tab-memory
    // drafts; this checks the supported in-memory navigation guarantee instead.
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /^Chats/ })
      .click();
    await expect(page).toHaveURL(/\/chats$/);
    await page.locator(`a[href="/chats/${fixture.matchId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${fixture.matchId}$`));
    await expect(composer).toHaveValue(navigationDraft);
    await expect(rows).toHaveCount(fixture.count);
    expect(await rows.allTextContents()).toEqual(expected);
    await composer.fill("");

    const peerPage = await jordan.newPage();
    await peerPage.goto("/auth/login");
    await peerPage.getByRole("button", { name: "Continue as Jordan" }).click();
    await expect(peerPage).toHaveURL(/\/discover$/);
    const peerResponse = await browserRequest(peerPage, "/api/v1/me");
    expect(peerResponse.status).toBe(200);
    const peer = peerResponse.body.data;
    const pollText = "CI fictional partner update after the initial history.";
    const added = await browserRequest(
      peerPage,
      endpoint,
      "POST",
      { text: pollText, clientMessageId: crypto.randomUUID() },
      peer.csrf,
    );
    expect(added.status).toBe(200);
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
    const stored = await allMessages(page);
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

    const actorResponse = await browserRequest(page, "/api/v1/me");
    expect(actorResponse.status).toBe(200);
    const actor = actorResponse.body.data;
    const blocked = await browserRequest(
      peerPage,
      "/api/v1/blocks",
      "POST",
      { targetId: actor.id },
      peer.csrf,
    );
    expect(blocked.status).toBe(200);
    await expect(rows).toHaveCount(0, { timeout: 15000 });
    await expect(composer).toBeDisabled();
    await expect(send).toBeDisabled();
    const revoked = await browserRequest(page, endpoint);
    expect(revoked.status).toBe(404);
  } finally {
    await alex.close();
    await jordan.close();
  }
});
