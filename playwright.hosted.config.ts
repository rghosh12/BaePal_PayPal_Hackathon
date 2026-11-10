import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/hosted",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    { name: "hosted-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command:
      "BAEPAL_HOSTED_TEST_SERVER=1 BAEPAL_HOSTED_CHAT_FIXTURE=1 pnpm --filter @baepal/hosted exec tsx scripts/test-server.mjs",
    url: "http://localhost:4173/api/v1/health",
    reuseExistingServer: false,
  },
});
