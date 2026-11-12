import { beforeAll } from "vitest";

// Durable throttles are not tied to users, so TRUNCATE users CASCADE does not
// reset them. Clear them per file so suites don't share failure budgets.
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("test")) return;
  const { db } = await import("../src/db.js");
  await db.query("DELETE FROM auth_throttle").catch(() => undefined);
});
