// Invoked through tsx to load the actual TypeScript API, never a route mock.
import newman from "newman";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const requireAPI = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { default: pg } = await import(requireAPI.resolve("pg"));
const { default: argon2 } = await import(requireAPI.resolve("argon2"));
let database;
try {
  database = new URL(
    process.env.DATABASE_URL ||
      "postgres://baepal:local_only@127.0.0.1:5432/baepal_test",
  );
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw Error();
} catch {
  throw Error(
    "Postman core regression requires a valid PostgreSQL test database URL.",
  );
}
if (!database.pathname.endsWith("_test"))
  throw Error(
    "Postman core regression requires a dedicated database ending in _test.",
  );
if (process.env.PAYPAL_MODE && process.env.PAYPAL_MODE !== "mock")
  throw Error(
    "Postman core regression requires PAYPAL_MODE=mock; Sandbox is a separate manual workflow.",
  );
const schema = "newman_" + randomUUID().replaceAll("-", "");
const basePool = new pg.Pool({ connectionString: database.href, max: 1 });
let app,
  db,
  timer,
  tick = Promise.resolve(),
  workerFailure = false;
try {
  await basePool.query(`CREATE SCHEMA ${schema}`);
  database.searchParams.set("options", "-c search_path=" + schema);
  Object.assign(process.env, {
    DATABASE_URL: database.href,
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PAYPAL_MODE: "mock",
    EMAIL_MODE: "local",
    DEMO_MODE: "true",
    BAEPAL_INTEGRATIONS_JSON: "",
  });
  ({ db } = await import("../apps/api/src/db.ts"));
  // Execute schema migrations within this random schema, without printing provider/config data.
  await db.query(
    "CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const { readdir } = await import("node:fs/promises");
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  )
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await db.query(
      await readFile(
        new URL("../db/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
    await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
  }
  ({ app } = await (await import("../apps/api/src/app.ts")).buildApp());
  await app.ready();
  const password = "Synthetic-only-" + randomUUID(),
    users = [];
  for (const name of ["actor", "peer", "outsider"]) {
    const id = randomUUID(),
      email = name + "@newman.baepal.invalid";
    await db.query(
      "INSERT INTO users(id,email,password_hash,status,confirmed_at) VALUES($1,$2,$3,'active',now())",
      [id, email, await argon2.hash(password)],
    );
    await db.query(
      'INSERT INTO profiles(user_id,display_name,bio,photos,prompts) VALUES($1,$2,\'Fictional regression persona\',ARRAY[\'/portraits/0.svg\',\'/portraits/1.svg\'],\'[{"question":"Date","answer":"Art"},{"question":"Fun","answer":"Coffee"}]\')',
      [id, name],
    );
    await db.query(
      "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1995-05-03','Nonbinary',ARRAY['Nonbinary'])",
      [id],
    );
    users.push({ id, email });
  }
  const sessions = {};
  async function call(user, method, path, payload) {
    const result = await app.inject({
      method,
      url: "/api/v1" + path,
      headers: { origin: process.env.APP_ORIGIN, ...(sessions[user] || {}) },
      payload,
    });
    if (result.statusCode !== 200)
      throw Error(
        "Synthetic fixture setup failed at " +
          method +
          " " +
          path +
          " (" +
          result.statusCode +
          ")",
      );
    if (path === "/auth/login")
      sessions[user] = {
        cookie: String(result.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": result.json().data.csrf,
      };
    return result.json().data;
  }
  for (const user of users.slice(0, 2))
    await call(user.id, "POST", "/auth/login", { email: user.email, password });
  const [actor, peer, outsider] = users;
  await call(actor.id, "POST", "/decisions", {
    targetId: peer.id,
    action: "like",
    clientMutationId: randomUUID(),
  });
  const match = (
    await call(peer.id, "POST", "/decisions", {
      targetId: actor.id,
      action: "like",
      clientMutationId: randomUUID(),
    })
  ).match;
  const plan = await call(actor.id, "POST", "/date-plans", {
    matchId: match.id,
  });
  await db.query(
    "INSERT INTO catalogue VALUES('art','Fictional art night','Art','Synthetic catalogue','Fictional Seattle',3000,60,'Demo step-free','Synthetic full refund before date')",
  );
  const starts = new Date(Date.now() + 86400000).toISOString(),
    ends = new Date(Date.now() + 90000000).toISOString();
  for (const [user, budget] of [
    [actor, 5297],
    [peer, 4891],
  ])
    await call(user.id, "PUT", `/date-plans/${plan.id}/private-preferences`, {
      budgetCents: budget,
      activities: ["Art"],
      timeStart: starts,
      timeEnd: ends,
    });
  await call(actor.id, "POST", `/date-plans/${plan.id}/proposals`, {
    optionId: "art",
    startsAt: starts,
    expectedVersion: 0,
  });
  for (const user of [actor, peer])
    await call(user.id, "POST", `/date-plans/${plan.id}/accept`, {
      proposalVersion: 1,
    });
  const foreign = await call(peer.id, "POST", "/purchases", {
    planId: plan.id,
    proposalVersion: 1,
  });
  const foreignMatch = randomUUID();
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [foreignMatch, peer.id, outsider.id],
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw Error("Loopback fixture did not bind.");
  const { workerTick } = await import("../apps/api/src/payments.ts");
  timer = setInterval(() => {
    tick = tick
      .then(() => workerTick())
      .catch(() => {
        workerFailure = true;
      });
  }, 50);
  const collection = JSON.parse(
    await readFile(
      new URL("../postman/core.postman_collection.json", import.meta.url),
      "utf8",
    ),
  );
  const environment = JSON.parse(
    await readFile(
      new URL(
        "../postman/core-local.postman_environment.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const runtime = {
    base_url: `http://127.0.0.1:${address.port}`,
    app_origin: process.env.APP_ORIGIN,
    actor_email: actor.email,
    actor_id: actor.id,
    peer_email: peer.email,
    password,
    plan_id: plan.id,
    match_id: match.id,
    peer_id: peer.id,
    foreign_payment_id: foreign.paymentId,
    foreign_purchase_id: foreign.purchaseId,
    foreign_match_id: foreignMatch,
  };
  for (const entry of environment.values)
    if (entry.key in runtime) entry.value = runtime[entry.key];
  await new Promise((resolve, reject) =>
    newman.run(
      {
        collection,
        environment,
        reporters: [],
        timeoutRequest: 5000,
        timeout: 30000,
      },
      (error, summary) => {
        if (error) return reject(Error("Core Newman execution failed."));
        for (const failure of summary.run.failures)
          console.error(
            "FAIL:",
            failure.source?.name,
            failure.error?.test || failure.error?.name,
          );
        console.log(
          `Newman 6.2.3 core: ${summary.run.stats.requests.total} requests; ${summary.run.stats.assertions.total} assertions; ${summary.run.failures.length} failures. Isolated PostgreSQL schema; synthetic mock payments only.`,
        );
        if (summary.run.failures.length)
          reject(Error("Core Postman regression failed."));
        else resolve();
      },
    ),
  );
  if (workerFailure) throw Error("Synthetic reconciliation worker failed.");
} finally {
  if (timer) clearInterval(timer);
  try {
    await tick;
  } finally {
    try {
      if (app) await app.close();
    } finally {
      try {
        if (db) await db.end();
      } finally {
        try {
          await basePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } finally {
          await basePool.end();
        }
      }
    }
  }
}
