// Loopback-only CI harness. Never imported into the deployed Worker.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
if (process.env.BAEPAL_HOSTED_TEST_SERVER !== "1")
  throw Error("Test harness requires an explicit development-only flag.");
const { default: worker } = await import(
  new URL("../dist/server/index.js", import.meta.url).href
);
const db = new DatabaseSync(":memory:");
for (const name of (await readdir(new URL("../drizzle/", import.meta.url)))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  db.exec(
    await readFile(new URL("../drizzle/" + name, import.meta.url), "utf8"),
  );
const env = {
  FIELD_ENCRYPTION_KEY: "ac".repeat(32),
  DB: {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          return db.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...values) };
        },
        async run() {
          return {
            meta: { changes: Number(db.prepare(sql).run(...values).changes) },
          };
        },
      };
      return statement;
    },
  },
};
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 20000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const testOwner = headers.get("x-baepal-test-owner") || "ci-browser";
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(testOwner)) {
      res.writeHead(400);
      res.end();
      return;
    }
    headers.set("oai-authenticated-user-id", testOwner);
    const request = new Request("http://localhost:4173" + req.url, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("CI harness request failed.");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Loopback-only hosted Worker test harness ready."),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
