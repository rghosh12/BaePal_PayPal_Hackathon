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
      return;
    }
    await page.getByRole("button", { name: /^Pass on / }).click();
  }
  throw Error(`No candidate ${name}`);
}
test("two people match, exchange a persisted message, agree on a date and independently mock-purchase tickets", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const alex = await a.newPage(),
    jordan = await b.newPage();
  await signIn(alex, "Alex");
  await signIn(jordan, "Jordan");
  await likeUntil(alex, "Jordan");
  await likeUntil(jordan, "Alex");
  for (const p of [alex, jordan]) {
    await p
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /Chats/ })
      .click();
    await p.getByRole("link", { name: /Say hello/ }).click();
  }
  await alex
    .getByRole("textbox", { name: "Your message" })
    .fill("Coffee and a little art?");
  await alex.getByRole("button", { name: "Send message" }).click();
  await expect(jordan.getByRole("log")).toContainText(
    "Coffee and a little art?",
  );
  await jordan.reload();
  await expect(jordan.getByRole("log")).toContainText(
    "Coffee and a little art?",
  );
  await alex.getByRole("button", { name: "Plan a date", exact: true }).click();
  await expect(alex).toHaveURL(/\/dates\//);
  await jordan.goto(alex.url());
  for (const p of [alex, jordan]) {
    await p
      .getByRole("spinbutton", { name: "Your maximum per ticket (USD)" })
      .fill("40");
    await p
      .getByRole("button", { name: "Save my private preferences" })
      .click();
    await expect(p.getByRole("status")).toContainText(
      "Your private preferences are saved.",
    );
  }
  await alex.getByRole("button", { name: "Find shared possibilities" }).click();
  await alex.getByRole("button", { name: "Propose this date" }).first().click();
  for (const p of [alex, jordan]) {
    await p.reload();
    await p.getByRole("button", { name: "This feels good — accept" }).click();
  }
  for (const p of [alex, jordan]) {
    await p.reload();
    await p.getByRole("button", { name: "Open my ticket checkout" }).click();
    await p.getByRole("button", { name: "Create mock order" }).click();
    await p.getByRole("button", { name: "Simulate mock capture" }).click();
    await expect(p).toHaveURL(/\/payments\//);
    await expect(
      p.getByText("MOCK · COMPLETED", { exact: true }),
    ).toBeVisible();
  }
  await alex.goto("/dates");
  await alex
    .getByRole("link", { name: /Make a little plan/ })
    .first()
    .click();
  await expect(alex.getByText("confirmed", { exact: true })).toBeVisible();
  await a.close();
  await b.close();
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
