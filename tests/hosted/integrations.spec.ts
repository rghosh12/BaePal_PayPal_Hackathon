import { test, expect } from "@playwright/test";
test("connection setup is accessible at 360px and never asks for credentials in the browser", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    extraHTTPHeaders: {
      "x-baepal-test-owner": "integrations-" + crypto.randomUUID(),
    },
  });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue as Alex" }).click();
  await page.goto("/settings/account");
  await page
    .getByRole("link", { name: "Connected services", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connected services", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Astropods", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run preview" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I allow this selected data/ })
    .check();
  await expect(
    page.getByRole("button", { name: "Run preview" }),
  ).toBeDisabled();
  await expect(
    page.locator('input[type="password"], input[type="text"], textarea'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
