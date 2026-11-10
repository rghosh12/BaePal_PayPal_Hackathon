import { test, expect } from "@playwright/test";
test("reviewed synthetic exclusions change discovery and revocation clears the source", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-baepal-test-owner": "taste-" + crypto.randomUUID() },
  });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue as Alex" }).click();
  await expect(page).toHaveURL("/discover");
  await expect(page.locator(".portrait-copy h2")).toHaveText(/Sam/);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Purchase interests", exact: true })
    .click();
  await page.getByRole("link", { name: "Choose data permissions" }).click();
  const matching = page.getByRole("checkbox", {
    name: "Use reviewed synthetic purchases for matching",
    exact: true,
  });
  await expect(matching).not.toBeChecked();
  await matching.check();
  await page.getByRole("button", { name: "Save separate permissions" }).click();
  await expect(page.getByRole("status")).toContainText(
    "separate data purposes are saved",
  );
  await page
    .getByRole("navigation", { name: "Purchase interest workspace" })
    .getByRole("link", { name: "Sources", exact: true })
    .click();
  await page.getByRole("button", { name: "Import synthetic history" }).click();
  await expect(page).toHaveURL(/\/taste\/imports\//);
  await page.getByRole("link", { name: "Review my fictional records" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Publish reviewed summary" }).click();
  await expect(page.getByRole("status")).toContainText("summary published");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Discover", exact: true })
    .click();
  await expect(page.locator(".portrait-copy h2")).toHaveText(/Sam/);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Purchase interests", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Purchase interest workspace" })
    .getByRole("link", { name: "Private review", exact: true })
    .click();
  await page
    .locator("tbody tr")
    .filter({ hasText: "Demo Harbor Books" })
    .first()
    .getByRole("button", { name: "Exclude this merchant" })
    .click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  await page.getByRole("button", { name: "Publish reviewed summary" }).click();
  await expect(page.getByRole("status")).toContainText("summary published");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Discover", exact: true })
    .click();
  await expect(page.locator(".portrait-copy h2")).toHaveText(/Jordan/);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Purchase interests", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Purchase interest workspace" })
    .getByRole("link", { name: "Stop & delete", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Stop using & delete synthetic data" })
    .click();
  await expect(page.getByRole("status")).toContainText("derived state removed");
  await page
    .getByRole("navigation", { name: "Purchase interest workspace" })
    .getByRole("link", { name: "Private review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No purchase evidence is stored." }),
  ).toBeVisible();
  await context.close();
});
test("private review at 360px scrolls the table without page overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    extraHTTPHeaders: {
      "x-baepal-test-owner": "narrow-" + crypto.randomUUID(),
    },
  });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue as Alex" }).click();
  await page.goto("/taste/consent");
  await page
    .getByRole("checkbox", {
      name: "Use reviewed synthetic purchases for matching",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Save separate permissions" }).click();
  await expect(page.getByRole("status")).toContainText(
    "separate data purposes are saved",
  );
  await page.goto("/taste/connect");
  await page.getByRole("button", { name: "Import synthetic history" }).click();
  await expect(page).toHaveURL(/\/taste\/imports\//);
  await page.goto("/taste/review");
  await expect(page.getByRole("table")).toBeVisible();
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    oversized: [...document.querySelectorAll("body *")]
      .filter(
        (el) =>
          !el.closest(".taste-table-wrap") &&
          el.getBoundingClientRect().width > innerWidth,
      )
      .slice(0, 12)
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        width: el.getBoundingClientRect().width,
      })),
  }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.width,
  );
  await expect(
    page.getByRole("region", { name: "Scrollable private evidence review" }),
  ).toHaveAttribute("tabindex", "0");
  await context.close();
});
