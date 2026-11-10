import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://127.0.0.1:4000/api/v1/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm dev:web",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
