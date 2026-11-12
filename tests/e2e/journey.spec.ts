import { test, expect, type Page } from "@playwright/test";
async function signIn(page: Page, name: string) {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: `Continue as ${name}` }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(
    page.getByRole("heading", { name: "A little curiosity goes a long way." }),
  ).toBeVisible();
}
async function likeUntil(page: Page, name: string) {
  for (let n = 0; n < 16; n++) {
    const like = page.getByRole("button", {
      name: `Like ${name}`,
      exact: true,
    });
    if (await like.isVisible()) {
      await like.click();
      await expect(like).not.toBeVisible();
      return;
    }
    const pass = page.getByRole("button", { name: /^Pass on / });
    const before = await pass.getAttribute("aria-label");
    await pass.click();
    await expect(pass).not.toHaveAttribute("aria-label", before!);
  }
  throw Error(`No candidate ${name}`);
}
// Authenticated API assertions stay in Chromium and use its actual session cookie.
// The CSRF token is read and consumed inside the browser, never exported as an artifact.
async function browserRequest(
  page: Page,
  url: string,
  method = "GET",
  payload?: unknown,
) {
  return page.evaluate(
    async ({ url, method, payload }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (method !== "GET") {
        const identity = await fetch("/api/v1/me", {
          credentials: "include",
          cache: "no-store",
        });
        const body = await identity.json();
        if (!identity.ok) return { status: identity.status, body };
        headers["x-csrf-token"] = body.data.csrf;
      }
      const response = await fetch(url, {
        method,
        credentials: "include",
        cache: "no-store",
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, payload },
  );
}
function primitiveValues(value: unknown): unknown[] {
  return value && typeof value === "object"
    ? Object.values(value).flatMap(primitiveValues)
    : [value];
}
test("two people recover chat, revise consent, independently mock-pay, refund and retain receipts after blocking", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const alex = await a.newPage(),
      jordan = await b.newPage();
    await signIn(alex, "Alex");
    await signIn(jordan, "Jordan");
    await likeUntil(alex, "Jordan");
    await likeUntil(jordan, "Alex");
    for (const page of [alex, jordan]) {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: /Chats/ })
        .click();
      await page.getByRole("link", { name: /Say hello/ }).click();
    }
    const chatURL = alex.url(),
      matchId = new URL(chatURL).pathname.split("/")[2];
    const firstMessage = "Coffee and a little art?",
      offlineMessage = "Saved while the other browser reconnects.";
    await alex
      .getByRole("textbox", { name: "Your message" })
      .fill(firstMessage);
    await alex.getByRole("button", { name: "Send message" }).click();
    await expect(
      alex.getByRole("log").getByText(firstMessage, { exact: true }),
    ).toBeVisible();
    await expect(
      jordan.getByRole("log").getByText(firstMessage, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await b.setOffline(true);
    await expect(
      jordan.locator(".chat-panel").getByRole("status"),
    ).toContainText("Offline.");
    await alex
      .getByRole("textbox", { name: "Your message" })
      .fill(offlineMessage);
    await alex.getByRole("button", { name: "Send message" }).click();
    await expect(
      alex.getByRole("log").getByText(offlineMessage, { exact: true }),
    ).toBeVisible();
    await b.setOffline(false);
    await expect(
      jordan.getByRole("log").getByText(offlineMessage, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await jordan.reload();
    for (const text of [firstMessage, offlineMessage])
      await expect(
        jordan.getByRole("log").getByText(text, { exact: true }),
      ).toBeVisible({ timeout: 15000 });
    await expect(jordan.getByRole("log").locator(".message p")).toHaveCount(2);

    await alex
      .getByRole("button", { name: "Plan a date", exact: true })
      .click();
    await expect(alex).toHaveURL(/\/dates\//);
    const dateURL = alex.url(),
      planId = new URL(dateURL).pathname.split("/")[2],
      planPath = `/api/v1/date-plans/${planId}`;
    await jordan.goto(dateURL);
    const members = [
      { page: alex, budget: "47.13", cents: 4713, peerCents: 3827 },
      { page: jordan, budget: "38.27", cents: 3827, peerCents: 4713 },
    ];
    for (const member of members) {
      const page = member.page;
      await page
        .getByRole("spinbutton", { name: "Your maximum per ticket (USD)" })
        .fill(member.budget);
      await page.getByRole("checkbox", { name: "Coffee", exact: true }).check();
      await page
        .getByRole("checkbox", { name: "Hiking", exact: true })
        .uncheck();
      await page.getByRole("checkbox", { name: "Art", exact: true }).check();
      await page
        .getByRole("button", { name: "Save my private preferences" })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Your private preferences are saved.",
      );
    }
    for (const member of members) {
      const response = await browserRequest(member.page, planPath);
      expect(response.status).toBe(200);
      expect(response.body.data.ownPreferences.budgetCents).toBe(member.cents);
      const values = primitiveValues(response.body.data);
      expect(values).not.toContain(member.peerCents);
      expect(values).not.toContain(String(member.peerCents));
      expect(response.body.data).not.toHaveProperty("partnerPreferences");
    }
    const propose = async (title: string) => {
      await alex
        .getByRole("button", { name: "Find shared possibilities" })
        .click();
      await alex
        .locator("article.suggestion")
        .filter({
          has: alex.getByRole("heading", { name: title, exact: true }),
        })
        .getByRole("button", { name: "Propose this date" })
        .click();
    };
    const acceptBoth = async () => {
      for (const page of [alex, jordan]) {
        await page.reload();
        await page
          .getByRole("button", { name: "This feels good — accept" })
          .click();
        await expect(
          page.getByText("You accepted this version.", { exact: true }),
        ).toBeVisible();
      }
    };
    await propose("A little coffee & a lot of conversation");
    await expect(alex.locator(".status-strip")).toContainText("Version 1");
    await acceptBoth();
    await alex.reload();
    await expect(alex.locator(".status-strip")).toContainText("2/2 accepted");
    await propose("An evening of art & possibility");
    await expect(alex.locator(".status-strip")).toContainText(
      "Version 2 · 0/2 accepted",
    );
    await expect(
      alex.getByRole("button", { name: "Open my ticket checkout" }),
    ).toHaveCount(0);
    await jordan.reload();
    await expect(jordan.locator(".status-strip")).toContainText(
      "Version 2 · 0/2 accepted",
    );
    await expect(
      jordan.getByText("You accepted this version.", { exact: true }),
    ).toHaveCount(0);
    const staleAcceptance = await browserRequest(
      jordan,
      planPath + "/accept",
      "POST",
      { proposalVersion: 1 },
    );
    expect(staleAcceptance.status).toBe(409);
    const stalePurchase = await browserRequest(
      jordan,
      "/api/v1/purchases",
      "POST",
      { planId, proposalVersion: 1 },
    );
    expect(stalePurchase.status).toBe(409);
    await acceptBoth();

    const receipts: { page: Page; path: string; paymentId: string }[] = [];
    for (const [index, page] of [alex, jordan].entries()) {
      await page.reload();
      await page
        .getByRole("button", { name: "Open my ticket checkout" })
        .click();
      await page.getByRole("button", { name: "Create mock order" }).click();
      await page.getByRole("button", { name: "Simulate mock capture" }).click();
      await expect(page).toHaveURL(/\/payments\//);
      await expect(
        page.getByText("MOCK · COMPLETED", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("$30.00 USD", { exact: true })).toBeVisible();
      const path = new URL(page.url()).pathname;
      receipts.push({ page, path, paymentId: path.split("/")[2] });
      const view = await browserRequest(page, planPath);
      expect(view.status).toBe(200);
      expect(view.body.data.status).toBe(
        index === 0 ? "payment_pending" : "confirmed",
      );
    }
    expect(receipts[0].paymentId).not.toBe(receipts[1].paymentId);
    expect(
      (await browserRequest(alex, "/api/v1/payments/" + receipts[1].paymentId))
        .status,
    ).toBe(404);
    await alex.goto(dateURL);
    await expect(alex.locator(".status-strip")).toContainText("confirmed");
    alex.once("dialog", (dialog) => dialog.accept());
    await alex
      .getByRole("button", { name: "Cancel this plan", exact: true })
      .click();
    await expect(alex.locator(".status-strip")).toContainText("cancelled");
    await expect
      .poll(
        async () => {
          const result = await browserRequest(alex, planPath);
          expect(result.status).toBe(200);
          return result.body.data.financialState;
        },
        { timeout: 20000 },
      )
      .toBe("refunded");
    for (const receipt of receipts) {
      await receipt.page.goto(receipt.path);
      await expect(
        receipt.page.getByText("MOCK · REFUNDED", { exact: true }),
      ).toBeVisible();
      const result = await browserRequest(
        receipt.page,
        "/api/v1/payments/" + receipt.paymentId,
      );
      expect(result.status).toBe(200);
      expect(result.body.data.refunds).toHaveLength(1);
      expect(result.body.data.refunds[0]).toMatchObject({
        amount_cents: 3000,
        state: "completed",
      });
      expect(result.body.data.refunds[0].provider_id).toEqual(
        expect.any(String),
      );
      await expect(
        receipt.page.getByRole("heading", { name: "Refund history" }),
      ).toBeVisible();
    }

    await alex.goto(chatURL);
    await jordan.goto(chatURL);
    await expect(
      alex.getByRole("log").getByText(firstMessage, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      jordan.getByRole("log").getByText(firstMessage, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    alex.once("dialog", (dialog) => dialog.accept());
    await alex
      .getByRole("button", { name: "Block member", exact: true })
      .click();
    await expect(alex).toHaveURL(/\/chats$/);
    await expect(jordan.getByRole("log").locator(".message p")).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(
      jordan.getByRole("textbox", { name: "Your message" }),
    ).toBeDisabled();
    await expect(
      jordan.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    for (const receipt of receipts) {
      expect(
        (
          await browserRequest(
            receipt.page,
            `/api/v1/conversations/${matchId}/messages?after=0`,
          )
        ).status,
      ).toBe(404);
      const blockedSend = await browserRequest(
        receipt.page,
        `/api/v1/conversations/${matchId}/messages`,
        "POST",
        {
          text: "Synthetic denied after block",
          clientMessageId: crypto.randomUUID(),
        },
      );
      expect(blockedSend.status).toBe(404);
      await receipt.page.goto(receipt.path);
      await expect(
        receipt.page.getByText("MOCK · REFUNDED", { exact: true }),
      ).toBeVisible();
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test("360px landing and login remain within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ["/", "/auth/login", "/safety"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
