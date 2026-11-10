import {
  afterAll,
  afterEach,
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
import { workerTick } from "../src/payments.js";
import { config } from "../src/config.js";
import { provider } from "../src/providers/paypal.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error(
    "Refund evidence regressions require a dedicated database ending in _test.",
  );
const originalMode = config.PAYPAL_MODE;
let paymentId: string, planId: string;
async function fixture(amount: number) {
  const [low, high] = [randomUUID(), randomUUID()].sort();
  const match = randomUUID(),
    purchase = randomUUID();
  planId = randomUUID();
  paymentId = randomUUID();
  for (const uid of [low, high])
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'unused-synthetic-password','active')",
      [uid, uid + "@refund.test.invalid"],
    );
  await db.query("INSERT INTO matches(id,low_id,high_id) VALUES($1,$2,$3)", [
    match,
    low,
    high,
  ]);
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id,status,financial_state,version) VALUES($1,$2,$3,'cancelled','reconciliation_pending',1)",
    [planId, match, low],
  );
  await db.query(
    "INSERT INTO purchases(id,plan_id,version,buyer_id,amount_cents,snapshot,state) VALUES($1,$2,1,$3,$4,'{}','paid')",
    [purchase, planId, low, amount],
  );
  await db.query(
    "INSERT INTO payments(id,purchase_id,mode,state,capture_id) VALUES($1,$2,'sandbox','completed','synthetic-capture')",
    [paymentId, purchase],
  );
  await db.query(
    "INSERT INTO outbox(id,kind,aggregate_id) VALUES($1,'cancel_plan',$2)",
    [randomUUID(), planId],
  );
}
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,outbox,webhook_inbox CASCADE");
  // Use only stubbed synthetic responses while exercising the Sandbox branch.
  // No native Sandbox network call or transaction is performed.
  config.PAYPAL_MODE = "sandbox";
});
afterEach(() => {
  config.PAYPAL_MODE = originalMode;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.query("TRUNCATE users,outbox,webhook_inbox CASCADE");
  await db.end();
});
describe("strict completed refund amount evidence", () => {
  for (const [cents, value] of [
    [29, "0.29"],
    [251, "2.51"],
  ] as const)
    it(`completes a valid canonical ${value} USD refund without float rounding`, async () => {
      await fixture(cents);
      vi.spyOn(provider, "refundCapture").mockResolvedValue({
        id: "synthetic-refund",
        status: "COMPLETED",
        amount: { currency_code: "USD", value },
      });
      await workerTick();
      expect(
        (await one(db, "SELECT state FROM payments WHERE id=$1", [paymentId]))
          .state,
      ).toBe("refunded");
      expect(
        (
          await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [
            planId,
          ])
        ).financial_state,
      ).toBe("refunded");
      expect(
        await one(
          db,
          "SELECT amount_cents,state FROM refunds WHERE payment_id=$1",
          [paymentId],
        ),
      ).toEqual({ amount_cents: cents, state: "completed" });
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int AS n FROM financial_events WHERE type='refund.completed'",
          )
        ).n,
      ).toBe(1);
    });
  for (const value of [30, "3e1", "30.000", " 30.00 ", "+30.00", "0x1e", "30"])
    it(`rejects noncanonical refund wire value ${JSON.stringify(value)} even when coercion equals the amount`, async () => {
      await fixture(3000);
      vi.spyOn(provider, "refundCapture").mockResolvedValue({
        id: "synthetic-refund",
        status: "COMPLETED",
        amount: { currency_code: "USD", value },
      });
      await workerTick();
      expect(
        (await one(db, "SELECT state FROM payments WHERE id=$1", [paymentId]))
          .state,
      ).toBe("completed");
      expect(
        (
          await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [
            planId,
          ])
        ).financial_state,
      ).toBe("refund_failed");
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int AS n FROM financial_events WHERE type='refund.completed'",
          )
        ).n,
      ).toBe(0);
      expect(
        (
          await one(db, "SELECT state FROM outbox WHERE aggregate_id=$1", [
            planId,
          ])
        ).state,
      ).toBe("pending");
    });
  for (const amount of [
    { currency_code: "EUR", value: "30.00" },
    { currency_code: "USD", value: "29.99" },
  ])
    it(`does not complete a mismatched ${amount.currency_code} ${amount.value} refund`, async () => {
      await fixture(3000);
      vi.spyOn(provider, "refundCapture").mockResolvedValue({
        id: "synthetic-refund",
        status: "COMPLETED",
        amount,
      });
      await workerTick();
      expect(
        (await one(db, "SELECT state FROM payments WHERE id=$1", [paymentId]))
          .state,
      ).toBe("completed");
      expect(
        (
          await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [
            planId,
          ])
        ).financial_state,
      ).toBe("refund_failed");
    });
  it("retains a pending provider refund without claiming completion or requiring completed-only amount evidence", async () => {
    await fixture(29);
    vi.spyOn(provider, "refundCapture").mockResolvedValue({
      id: "synthetic-refund",
      status: "PENDING",
    });
    await workerTick();
    expect(
      (await one(db, "SELECT state FROM payments WHERE id=$1", [paymentId]))
        .state,
    ).toBe("completed");
    expect(
      (
        await one(db, "SELECT financial_state FROM date_plans WHERE id=$1", [
          planId,
        ])
      ).financial_state,
    ).toBe("refund_pending");
    expect(
      (
        await one(db, "SELECT state FROM refunds WHERE payment_id=$1", [
          paymentId,
        ])
      ).state,
    ).toBe("pending");
  });
});
