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
import { db, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { config } from "../src/config.js";
import { provider } from "../src/providers/paypal.js";
import { recordOrder, workerTick } from "../src/payments.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error(
    "Worker race tests require a dedicated database ending in _test.",
  );
if (config.PAYPAL_MODE !== "mock")
  throw Error("Worker race tests require the synthetic mock provider.");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture() {
  const users = [randomUUID(), randomUUID()],
    plan = randomUUID(),
    match = randomUUID(),
    job = randomUUID();
  for (const id of users)
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [id, id + "@worker.test.invalid"],
    );
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [match, ...users],
  );
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id,status,financial_state,version) VALUES($1,$2,$3,'cancelled','reconciliation_pending',1)",
    [plan, match, users[0]],
  );
  const pays = [];
  for (const user of users) {
    const purchase = randomUUID(),
      payment = randomUUID(),
      order = "MOCK-" + randomUUID();
    await db.query(
      "INSERT INTO purchases(id,plan_id,version,buyer_id,amount_cents,snapshot) VALUES($1,$2,1,$3,3000,'{}')",
      [purchase, plan, user],
    );
    await db.query(
      "INSERT INTO payments(id,purchase_id,mode,state,order_id) VALUES($1,$2,'mock','approval_pending',$3)",
      [payment, purchase, order],
    );
    pays.push({ payment, order });
  }
  await db.query(
    "INSERT INTO outbox(id,kind,aggregate_id) VALUES($1,'cancel_plan',$2)",
    [job, plan],
  );
  return { plan, job, pays };
}
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue CASCADE");
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("cancellation worker generation fencing", () => {
  it("retains pending compensation when an unrefunded order lookup fails", async () => {
    const f = await fixture();
    vi.spyOn(provider, "getOrder").mockRejectedValue(
      Error("Synthetic provider unavailable"),
    );
    await workerTick();
    expect(
      await one(db, "SELECT state,attempts FROM outbox WHERE id=$1", [f.job]),
    ).toEqual({ state: "pending", attempts: 1 });
    expect(
      (
        await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [
          f.plan,
        ])
      ).financial_state,
    ).toBe("refund_failed");
    expect((await one(db, "SELECT count(*)::int AS n FROM refunds")).n).toBe(0);
  });

  for (const fail of [false, true])
    it(`does not overwrite a late capture rearm with stale ${fail ? "failure" : "success"} bookkeeping`, async () => {
      const f = await fixture(),
        entered = deferred(),
        release = deferred();
      const getOrder = provider.getOrder.bind(provider);
      let calls = 0,
        passedPayment = "";
      const lookup = vi
        .spyOn(provider, "getOrder")
        .mockImplementation(async (order) => {
          calls++;
          if (calls === 1)
            passedPayment = f.pays.find((p) => p.order === order)!.payment;
          if (calls === 2) {
            entered.resolve();
            await release.promise;
            if (fail) throw Error("Synthetic interrupted lookup");
          }
          return getOrder(order);
        });
      const tick = workerTick();
      try {
        await Promise.race([
          entered.promise,
          tick.then(() => {
            throw Error("Worker failed to reach deterministic race gate.");
          }),
        ]);
        const passed = f.pays.find((p) => p.payment === passedPayment)!;
        const capture = await provider.captureOrder(passed.order, randomUUID());
        await recordOrder(passed.payment, capture);
        const rearmed = await one(
          db,
          "SELECT state,attempts,available_at FROM outbox WHERE id=$1",
          [f.job],
        );
        release.resolve();
        await tick;
        expect(
          await one(
            db,
            "SELECT state,attempts,available_at FROM outbox WHERE id=$1",
            [f.job],
          ),
        ).toEqual(rearmed);
        expect(
          (
            await one(
              db,
              "SELECT financial_state FROM date_plans WHERE id=$1",
              [f.plan],
            )
          ).financial_state,
        ).toBe("reconciliation_pending");
        expect(
          (
            await one(db, "SELECT state FROM payments WHERE id=$1", [
              passed.payment,
            ])
          ).state,
        ).toBe("completed");
        lookup.mockRestore();
        await workerTick();
        expect(
          (
            await one(db, "SELECT state FROM payments WHERE id=$1", [
              passed.payment,
            ])
          ).state,
        ).toBe("refunded");
        expect(
          (
            await one(
              db,
              "SELECT financial_state FROM date_plans WHERE id=$1",
              [f.plan],
            )
          ).financial_state,
        ).toBe("refunded");
        expect(
          (await one(db, "SELECT state FROM outbox WHERE id=$1", [f.job]))
            .state,
        ).toBe("processed");
        expect(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM refunds WHERE state='completed'",
            )
          ).n,
        ).toBe(1);
      } finally {
        release.resolve();
        await tick;
      }
    });
});
