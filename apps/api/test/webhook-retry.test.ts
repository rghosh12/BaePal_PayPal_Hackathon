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
import { workerTick } from "../src/payments.js";
if (
  !new URL(config.DATABASE_URL).pathname.endsWith("_test") ||
  config.PAYPAL_MODE !== "mock"
)
  throw Error(
    "Webhook retry tests require a dedicated _test database and synthetic mock provider.",
  );
async function fixture() {
  const users = [randomUUID(), randomUUID()],
    match = randomUUID(),
    plan = randomUUID(),
    purchase = randomUUID(),
    payment = randomUUID(),
    order = "MOCK-" + randomUUID(),
    event = "WH-" + randomUUID();
  for (const id of users)
    await db.query(
      "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
      [id, id + "@webhook.test.invalid"],
    );
  await db.query(
    "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid))",
    [match, ...users],
  );
  await db.query(
    "INSERT INTO date_plans(id,match_id,creator_id,status,version) VALUES($1,$2,$3,'accepted',1)",
    [plan, match, users[0]],
  );
  await db.query(
    "INSERT INTO purchases(id,plan_id,version,buyer_id,amount_cents,snapshot) VALUES($1,$2,1,$3,3000,'{}')",
    [purchase, plan, users[0]],
  );
  await db.query(
    "INSERT INTO payments(id,purchase_id,mode) VALUES($1,$2,'mock')",
    [payment, purchase],
  );
  await db.query(
    "INSERT INTO webhook_inbox(event_id,mode,payload) VALUES($1,'mock',$2)",
    [
      event,
      {
        id: event,
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-" + order,
          supplementary_data: { related_ids: { order_id: order } },
        },
      },
    ],
  );
  return { payment, order, event };
}
function capturedOrder(id: string, status = "COMPLETED") {
  return {
    id,
    status: "COMPLETED",
    purchase_units: [{ payments: { captures: [{ id: "CAP-" + id, status }] } }],
  };
}
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue,webhook_inbox CASCADE");
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.query("TRUNCATE users,catalogue,webhook_inbox CASCADE");
  await db.end();
});
describe("durable webhook correlation retries", () => {
  it("retains a webhook arriving before its payment order is persisted", async () => {
    const f = await fixture();
    const lookup = vi.spyOn(provider, "getOrder");
    await workerTick();
    expect(
      (
        await one(db, "SELECT state FROM webhook_inbox WHERE event_id=$1", [
          f.event,
        ])
      ).state,
    ).toBe("pending");
    expect(lookup).not.toHaveBeenCalled();
    const queued = await one(
      db,
      "SELECT attempts,available_at,last_error FROM webhook_inbox WHERE event_id=$1",
      [f.event],
    );
    expect(queued.attempts).toBe(1);
    expect(queued.last_error).toBe("CORRELATION_MISSING");
    expect(new Date(queued.available_at).getTime()).toBeGreaterThan(Date.now());
    await workerTick();
    expect(
      (
        await one(db, "SELECT attempts FROM webhook_inbox WHERE event_id=$1", [
          f.event,
        ])
      ).attempts,
    ).toBe(1);
    await db.query(
      "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
      [f.payment, f.order],
    );
    await db.query(
      "UPDATE webhook_inbox SET available_at=now() WHERE event_id=$1",
      [f.event],
    );
    lookup.mockResolvedValue(capturedOrder(f.order));
    await workerTick();
    expect(
      (await one(db, "SELECT state FROM payments WHERE id=$1", [f.payment]))
        .state,
    ).toBe("completed");
    const processed = await one(
      db,
      "SELECT state,attempts,last_error,processed_at FROM webhook_inbox WHERE event_id=$1",
      [f.event],
    );
    expect(processed.state).toBe("processed");
    expect(processed.attempts).toBe(2);
    expect(processed.last_error).toBeNull();
    expect(processed.processed_at).not.toBeNull();
  });
  it("does not treat a completed notification as financial evidence when the provider still reports approval only", async () => {
    const f = await fixture();
    await db.query(
      "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
      [f.payment, f.order],
    );
    vi.spyOn(provider, "getOrder").mockResolvedValue({
      id: f.order,
      status: "APPROVED",
    });
    await workerTick();
    expect(
      (await one(db, "SELECT state FROM payments WHERE id=$1", [f.payment]))
        .state,
    ).toBe("approval_pending");
    expect(
      await one(
        db,
        "SELECT state,last_error FROM webhook_inbox WHERE event_id=$1",
        [f.event],
      ),
    ).toEqual({ state: "pending", last_error: "PROVIDER_EVIDENCE_PENDING" });
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM financial_events")).n,
    ).toBe(0);
  });
  it.each(["PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.COMPLETED"])(
    "retains authoritative pending capture without inventing completion for %s",
    async (type) => {
      const f = await fixture();
      await db.query(
        "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
        [f.payment, f.order],
      );
      await db.query(
        "UPDATE webhook_inbox SET payload=jsonb_set(payload,'{event_type}',to_jsonb($2::text)) WHERE event_id=$1",
        [f.event, type],
      );
      vi.spyOn(provider, "getOrder").mockResolvedValue(
        capturedOrder(f.order, "PENDING"),
      );
      await workerTick();
      expect(
        (await one(db, "SELECT state FROM payments WHERE id=$1", [f.payment]))
          .state,
      ).toBe("pending");
      expect(
        (
          await one(db, "SELECT state FROM webhook_inbox WHERE event_id=$1", [
            f.event,
          ])
        ).state,
      ).toBe(type === "PAYMENT.CAPTURE.PENDING" ? "processed" : "pending");
      expect(
        (await one(db, "SELECT count(*)::int AS n FROM financial_events")).n,
      ).toBe(0);
    },
  );
  it("does not let twenty old missing correlations starve a newer valid event", async () => {
    const old = [];
    for (let n = 0; n < 20; n++) {
      const event = "OLD-" + randomUUID();
      old.push(event);
      await db.query(
        "INSERT INTO webhook_inbox(event_id,mode,payload,created_at,available_at) VALUES($1,'mock',$2,now()-interval '2 minutes',now()-interval '2 minutes')",
        [
          event,
          {
            event_type: "PAYMENT.CAPTURE.COMPLETED",
            resource: {
              id: "CAP-absent-" + n,
              supplementary_data: { related_ids: { order_id: "absent-" + n } },
            },
          },
        ],
      );
    }
    const f = await fixture();
    await db.query(
      "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
      [f.payment, f.order],
    );
    const lookup = vi
      .spyOn(provider, "getOrder")
      .mockResolvedValue(capturedOrder(f.order));
    await workerTick();
    expect(lookup).not.toHaveBeenCalled();
    expect(
      (
        await one(db, "SELECT attempts FROM webhook_inbox WHERE event_id=$1", [
          f.event,
        ])
      ).attempts,
    ).toBe(0);
    await workerTick();
    expect(
      (
        await one(db, "SELECT state FROM webhook_inbox WHERE event_id=$1", [
          f.event,
        ])
      ).state,
    ).toBe("processed");
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM webhook_inbox WHERE event_id=ANY($1::text[]) AND state='pending' AND attempts=1",
          [old],
        )
      ).n,
    ).toBe(20);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "quarantines exhausted retries with a fixed reason (provider failure: %s)",
    async (providerFailure) => {
      const f = await fixture();
      const lookup = vi.spyOn(provider, "getOrder");
      if (providerFailure) {
        await db.query(
          "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
          [f.payment, f.order],
        );
        lookup.mockRejectedValue(
          Error(
            "Synthetic provider payload and credential must never be logged",
          ),
        );
      }
      for (let attempt = 1; attempt <= 8; attempt++) {
        await db.query(
          "UPDATE webhook_inbox SET available_at=now() WHERE event_id=$1",
          [f.event],
        );
        await workerTick();
        const row = await one(
          db,
          "SELECT state,attempts,available_at,last_error FROM webhook_inbox WHERE event_id=$1",
          [f.event],
        );
        expect(row.attempts).toBe(attempt);
        expect(row.state).toBe(attempt === 8 ? "quarantined" : "pending");
        expect(row.last_error).toBe(
          providerFailure ? "PROVIDER_UNAVAILABLE" : "CORRELATION_MISSING",
        );
        expect(
          new Date(row.available_at).getTime() - Date.now(),
        ).toBeLessThanOrEqual(300000);
      }
      await workerTick();
      expect(
        (
          await one(
            db,
            "SELECT attempts FROM webhook_inbox WHERE event_id=$1",
            [f.event],
          )
        ).attempts,
      ).toBe(8);
      expect(lookup).toHaveBeenCalledTimes(providerFailure ? 8 : 0);
    },
  );
  it.each([
    [
      "UNSUPPORTED_EVENT",
      { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "refund-id" } },
      "mock",
    ],
    [
      "MALFORMED_REFERENCE",
      { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
      "mock",
    ],
    [
      "MODE_MISMATCH",
      {
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "capture-id" },
      },
      "sandbox",
    ],
  ])(
    "retains unsupported or malformed events as %s",
    async (reason, payload, mode) => {
      const f = await fixture();
      await db.query(
        "UPDATE webhook_inbox SET payload=$2,mode=$3 WHERE event_id=$1",
        [f.event, payload, mode],
      );
      const lookup = vi.spyOn(provider, "getOrder");
      await workerTick();
      expect(
        await one(
          db,
          "SELECT state,last_error,attempts FROM webhook_inbox WHERE event_id=$1",
          [f.event],
        ),
      ).toEqual({ state: "quarantined", last_error: reason, attempts: 1 });
      expect(lookup).not.toHaveBeenCalled();
    },
  );
  it("quarantines a capture reference that differs from authoritative provider evidence", async () => {
    const f = await fixture();
    await db.query(
      "UPDATE payments SET order_id=$2,state='approval_pending' WHERE id=$1",
      [f.payment, f.order],
    );
    vi.spyOn(provider, "getOrder").mockResolvedValue({
      ...capturedOrder(f.order),
      purchase_units: [
        {
          payments: {
            captures: [{ id: "CAP-unrelated", status: "COMPLETED" }],
          },
        },
      ],
    });
    await workerTick();
    expect(
      await one(
        db,
        "SELECT state,last_error FROM webhook_inbox WHERE event_id=$1",
        [f.event],
      ),
    ).toEqual({
      state: "quarantined",
      last_error: "CAPTURE_REFERENCE_MISMATCH",
    });
    expect(
      (await one(db, "SELECT state FROM payments WHERE id=$1", [f.payment]))
        .state,
    ).toBe("approval_pending");
    expect(
      (await one(db, "SELECT count(*)::int AS n FROM financial_events")).n,
    ).toBe(0);
  });
});
