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
import { encrypt, hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { options } from "../src/domain.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Window regressions require a dedicated test database.");
const minute = 60000;
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let plan: string, users: string[], cookie: string, csrf: string;
beforeAll(async () => {
  await migrate();
  ({ app } = await buildApp());
  await app.ready();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue CASCADE");
  users = [randomUUID(), randomUUID()];
  plan = randomUUID();
  const match = randomUUID(),
    session = randomUUID();
  csrf = randomUUID();
  cookie = "baepal=" + session;
  for (const id of users)
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [id, id + "@window.test.invalid"],
    );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(session), users[0], csrf],
  );
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [match, ...users],
  );
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id) VALUES($1,$2,$3)",
    [plan, match, users[0]],
  );
  for (const [index, user] of users.entries())
    await db.query(
      "INSERT INTO private_date_preferences(plan_id,user_id,budget_encrypted,activities,time_start,time_end) VALUES($1,$2,$3,ARRAY['Art','Coffee'],now()+interval '1 hour',now()+interval '3 hours')",
      [plan, user, encrypt(String(index ? 3891 : 5297))],
    );
  await db.query(
    "INSERT INTO catalogue VALUES('art','Fictional art','Art','Synthetic art','Fictional Seattle',3000,60,'Demo','Demo policy'),('coffee','Fictional coffee','Coffee','Synthetic coffee','Fictional Seattle',1200,30,'Demo','Demo policy'),('premium','Fictional premium','Art','Synthetic premium','Fictional Seattle',9000,10,'Demo','Demo policy'),('hiking','Fictional hiking','Hiking','Synthetic hiking','Fictional Seattle',1000,10,'Demo','Demo policy')",
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
async function windows(
  start: number,
  end: number,
  peerStart = start,
  peerEnd = end,
) {
  for (const [index, user] of users.entries())
    await db.query(
      "UPDATE private_date_preferences SET time_start=$3,time_end=$4 WHERE plan_id=$1 AND user_id=$2",
      [
        plan,
        user,
        new Date(index ? peerStart : start).toISOString(),
        new Date(index ? peerEnd : end).toISOString(),
      ],
    );
}
function pin(now: number) {
  vi.spyOn(Date, "now").mockReturnValue(now);
}
describe("remaining availability overlap", () => {
  it.each([-minute, 0])(
    "returns a neutral empty result when overlap ends %d milliseconds from now",
    async (offset) => {
      const now = Date.now();
      await windows(now - 120 * minute, now + offset);
      pin(now);
      expect(await options(db, plan)).toEqual([]);
    },
  );
  it("clamps a partially elapsed overlap to now and excludes experiences too long for its remainder", async () => {
    const now = Date.now();
    await windows(now - 120 * minute, now + 45 * minute);
    pin(now);
    const result = await options(db, plan);
    expect(result.map((option) => option.id)).toEqual(["coffee"]);
    expect(result[0].earliestStart).toBe(new Date(now).toISOString());
    expect(result[0].latestEnd).toBe(new Date(now + 45 * minute).toISOString());
  });
  it("includes an exact-duration remaining fit without broadening the end boundary", async () => {
    const now = Date.now();
    await windows(now - 120 * minute, now + 30 * minute);
    pin(now);
    const result = await options(db, plan);
    expect(result.map((option) => option.id)).toEqual(["coffee"]);
    expect(
      Date.parse(result[0].earliestStart) + result[0].duration_minutes * minute,
    ).toBe(Date.parse(result[0].latestEnd));
  });
  it("returns no experiences when the remaining overlap is shorter than every eligible duration", async () => {
    const now = Date.now();
    await windows(now - 120 * minute, now + 30 * minute - 1);
    pin(now);
    expect(await options(db, plan)).toEqual([]);
  });
  it("preserves future overlap bounds, reciprocal activity/budget filters and private budget redaction", async () => {
    const now = Date.now();
    await windows(
      now + 60 * minute,
      now + 240 * minute,
      now + 120 * minute,
      now + 180 * minute,
    );
    pin(now);
    const result = await options(db, plan);
    expect(result.map((option) => option.id)).toEqual(["coffee", "art"]);
    for (const option of result) {
      expect(option.earliestStart).toBe(
        new Date(now + 120 * minute).toISOString(),
      );
      expect(option.latestEnd).toBe(new Date(now + 180 * minute).toISOString());
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain("5297");
    expect(text).not.toContain("3891");
  });
  it("keeps disjoint future windows neutral", async () => {
    const now = Date.now();
    await windows(
      now + 60 * minute,
      now + 120 * minute,
      now + 180 * minute,
      now + 240 * minute,
    );
    pin(now);
    expect(await options(db, plan)).toEqual([]);
  });
  it("does not call a configured planner when an unexpired plan has no remaining eligible window", async () => {
    const now = Date.now();
    await windows(now - 120 * minute, now + 29 * minute);
    pin(now);
    const previous = config.BAEPAL_INTEGRATIONS_JSON;
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
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        version: 1,
        data: { suggestions: [{ id: "art", reason: "An art option." }] },
      }),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/date-plans/${plan}/suggestions`,
        headers: {
          origin: "http://localhost:3000",
          cookie,
          "x-csrf-token": csrf,
        },
        payload: { useExternalProvider: true, allowExternalProcessing: true },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.options).toEqual([]);
      expect(response.json().data.evidence).toBeNull();
      expect(network).not.toHaveBeenCalled();
      expect(
        (await db.query("SELECT status FROM date_plans WHERE id=$1", [plan]))
          .rows[0].status,
      ).toBe("collecting_preferences");
    } finally {
      config.BAEPAL_INTEGRATIONS_JSON = previous;
    }
  });
});
