import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";

if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Date lifecycle regressions require a dedicated test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let users: { id: string; cookie: string; csrf: string }[];
const start = () => new Date(Date.now() + 86400000).toISOString();
function prefs(budgetCents = 5000) {
  return {
    budgetCents,
    activities: ["Art", "Coffee"],
    timeStart: start(),
    timeEnd: new Date(Date.now() + 93600000).toISOString(),
  };
}
async function req(user: number, method: string, path: string, payload?: any) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:3000",
      cookie: users[user].cookie,
      "x-csrf-token": users[user].csrf,
    },
    payload,
  });
}
async function data(user: number, method: string, path: string, payload?: any) {
  const response = await req(user, method, path, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}
beforeAll(async () => {
  await migrate();
  ({ app } = await buildApp());
  await app.ready();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID(),
      session = randomUUID(),
      csrf = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused-hash','active')",
      [id, id + "@test.invalid"],
    );
    await db.query("INSERT INTO profiles(user_id) VALUES($1)", [id]);
    await db.query(
      "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1995-05-03','Nonbinary',ARRAY['Nonbinary'])",
      [id],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(session), id, csrf],
    );
    users.push({ id, cookie: "baepal=" + session, csrf });
  }
  await db.query(
    "INSERT INTO catalogue VALUES('art','Fictional art','Art','Synthetic art','Fictional Seattle',3000,60,'Demo','Demo policy'),('coffee','Fictional free coffee','Coffee','Synthetic coffee','Fictional Seattle',0,60,'Demo','Demo policy')",
  );
});
afterAll(async () => {
  await app.close();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
async function proposed(option = "art") {
  const mid = randomUUID();
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [mid, users[0].id, users[1].id],
  );
  const plan = await data(0, "POST", "/date-plans", { matchId: mid });
  for (const i of [0, 1])
    await data(i, "PUT", `/date-plans/${plan.id}/private-preferences`, prefs());
  const startsAt = new Date(Date.now() + 86460000).toISOString();
  await data(0, "POST", `/date-plans/${plan.id}/proposals`, {
    optionId: option,
    startsAt,
    expectedVersion: 0,
  });
  return { id: plan.id, startsAt };
}
async function state(id: string) {
  const plan = (
    await db.query(
      "SELECT status,financial_state,version,expires_at FROM date_plans WHERE id=$1",
      [id],
    )
  ).rows;
  const preferences = (
    await db.query(
      "SELECT * FROM private_date_preferences WHERE plan_id=$1 ORDER BY user_id",
      [id],
    )
  ).rows;
  const proposals = (
    await db.query(
      "SELECT * FROM proposals WHERE plan_id=$1 ORDER BY version",
      [id],
    )
  ).rows;
  const accepted = (
    await db.query(
      "SELECT * FROM acceptances WHERE plan_id=$1 ORDER BY user_id",
      [id],
    )
  ).rows;
  return { plan, preferences, proposals, accepted };
}
describe("terminal and elapsed date planning guards", () => {
  it("keeps healthy accepted-plan suggestions available without changing consent", async () => {
    const plan = await proposed();
    for (const i of [0, 1])
      await data(i, "POST", `/date-plans/${plan.id}/accept`, {
        proposalVersion: 1,
      });
    const before = await state(plan.id);
    const suggestions = await data(
      0,
      "POST",
      `/date-plans/${plan.id}/suggestions`,
      {},
    );
    expect(suggestions.options.map((option: any) => option.id)).toContain(
      "art",
    );
    expect(await state(plan.id)).toEqual(before);
  });
  it("does not cancel or enqueue refunds for an already completed paid date", async () => {
    const plan = await proposed();
    for (const i of [0, 1])
      await data(i, "POST", `/date-plans/${plan.id}/accept`, {
        proposalVersion: 1,
      });
    for (const i of [0, 1]) {
      const purchase = await data(i, "POST", "/purchases", {
        planId: plan.id,
        proposalVersion: 1,
      });
      await data(i, "POST", "/payments/orders", {
        paymentId: purchase.paymentId,
      });
      await data(i, "POST", `/payments/${purchase.paymentId}/capture`, {});
    }
    await db.query("UPDATE date_plans SET status='completed' WHERE id=$1", [
      plan.id,
    ]);
    const before = await state(plan.id);
    const response = await req(0, "POST", `/date-plans/${plan.id}/cancel`, {
      expectedVersion: 1,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PLAN_CLOSED");
    expect(await state(plan.id)).toEqual(before);
    expect(
      (await db.query("SELECT 1 FROM outbox WHERE aggregate_id=$1", [plan.id]))
        .rowCount,
    ).toBe(0);
    expect((await db.query("SELECT 1 FROM refunds")).rowCount).toBe(0);
  });

  it.each(["cancelled", "expired", "confirmed", "completed"])(
    "rejects preference edits after %s without changing private data or version",
    async (status) => {
      const plan = await proposed();
      await db.query("UPDATE date_plans SET status=$2 WHERE id=$1", [
        plan.id,
        status,
      ]);
      const before = await state(plan.id);
      const response = await req(
        0,
        "PUT",
        `/date-plans/${plan.id}/private-preferences`,
        prefs(9000),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PLAN_CLOSED");
      expect(await state(plan.id)).toEqual(before);
    },
  );
  it("does not reopen a confirmed free date by proposing a paid alternative", async () => {
    const plan = await proposed("coffee");
    for (const i of [0, 1])
      await data(i, "POST", `/date-plans/${plan.id}/accept`, {
        proposalVersion: 1,
      });
    expect((await data(0, "GET", `/date-plans/${plan.id}`)).status).toBe(
      "confirmed",
    );
    const before = await state(plan.id);
    const response = await req(0, "POST", `/date-plans/${plan.id}/proposals`, {
      optionId: "art",
      startsAt: plan.startsAt,
      expectedVersion: 1,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PLAN_CLOSED");
    expect(await state(plan.id)).toEqual(before);
  });
  it.each(["preferences", "proposal"])(
    "rejects %s changes after wall-clock expiry before the expiry worker runs",
    async (action) => {
      const plan = await proposed();
      await db.query(
        "UPDATE date_plans SET expires_at=now()-interval '1 second' WHERE id=$1",
        [plan.id],
      );
      const before = await state(plan.id);
      const response =
        action === "preferences"
          ? await req(
              0,
              "PUT",
              `/date-plans/${plan.id}/private-preferences`,
              prefs(9000),
            )
          : await req(0, "POST", `/date-plans/${plan.id}/proposals`, {
              optionId: "coffee",
              startsAt: plan.startsAt,
              expectedVersion: 1,
            });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PLAN_CLOSED");
      expect(await state(plan.id)).toEqual(before);
    },
  );
  it.each(["cancelled", "completed", "elapsed"])(
    "does not plan or invoke an external planner for %s invitations",
    async (status) => {
      const plan = await proposed();
      if (status === "elapsed")
        await db.query(
          "UPDATE date_plans SET expires_at=now()-interval '1 second' WHERE id=$1",
          [plan.id],
        );
      else
        await db.query("UPDATE date_plans SET status=$2 WHERE id=$1", [
          plan.id,
          status,
        ]);
      const originalConfig = config.BAEPAL_INTEGRATIONS_JSON;
      config.BAEPAL_INTEGRATIONS_JSON = JSON.stringify({
        version: 1,
        providers: {
          astropods: {
            enabled: true,
            protocol: "baepal-gateway-v1",
            baseUrl: "https://gateway.example.com",
            auth: "bearer",
            token: "fixture-token-only",
            operations: ["plan"],
          },
        },
      });
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () =>
          Response.json({
            version: 1,
            data: {
              suggestions: [{ id: "art", reason: "An eligible art option." }],
            },
          }),
        );
      try {
        const response = await req(
          0,
          "POST",
          `/date-plans/${plan.id}/suggestions`,
          { useExternalProvider: true, allowExternalProcessing: true },
        );
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("PLAN_CLOSED");
        expect(network).not.toHaveBeenCalled();
      } finally {
        config.BAEPAL_INTEGRATIONS_JSON = originalConfig;
      }
    },
  );
});
