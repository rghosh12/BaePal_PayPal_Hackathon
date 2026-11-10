import newman from "newman";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const server = spawn(
  process.execPath,
  ["apps/hosted/scripts/test-server.mjs"],
  {
    cwd: root,
    env: { ...process.env, BAEPAL_HOSTED_TEST_SERVER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Harness startup timeout")),
      15000,
    );
    server.once("error", reject);
    server.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Harness exited before readiness"));
    });
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("test harness ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const collection = JSON.parse(
    await readFile(
      new URL("postman/taste.postman_collection.json", root),
      "utf8",
    ),
  );
  const environment = JSON.parse(
    await readFile(
      new URL("postman/local.postman_environment.json", root),
      "utf8",
    ),
  );
  const run = randomUUID();
  const values = {
    owner: "newman-" + run,
    other_owner: "other-" + run,
    import_key: randomUUID(),
  };
  for (const entry of environment.values)
    if (entry.key in values) entry.value = values[entry.key];
  await new Promise((resolve, reject) => {
    newman.run(
      { collection, environment, reporters: [], timeoutRequest: 5000 },
      (error, summary) => {
        if (error) return reject(Error("Newman failed to execute"));
        for (const failure of summary.run.failures)
          console.error(
            "FAIL:",
            failure.source?.name,
            failure.error?.test || failure.error?.name,
          );
        console.log(
          `Newman 6.2.3: ${summary.run.stats.requests.total} requests; ${summary.run.stats.assertions.total} assertions; ${summary.run.failures.length} failures. Synthetic Worker fixture only.`,
        );
        if (summary.run.failures.length)
          reject(Error("Postman regression failed"));
        else resolve();
      },
    );
  });
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null)
    await new Promise((resolve) => server.once("exit", resolve));
}
