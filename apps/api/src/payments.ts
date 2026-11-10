import { paymentResponse } from "./response-contracts.js";
import { randomUUID } from "node:crypto";
import { db, one, tx } from "./db.js";
import { config } from "./config.js";
import { provider, verifiedCapture } from "./providers/paypal.js";
import { fail, planFor } from "./domain.js";
export async function ownPayment(user: string, id: string) {
  const p = await one(
    db,
    "SELECT p.id,p.purchase_id,p.mode,p.state,p.order_id,p.capture_id,p.created_at,p.updated_at,u.amount_cents,u.currency,u.plan_id,u.version,u.snapshot FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE p.id=$1 AND u.buyer_id=$2",
    [id, user],
  );
  if (!p) return fail(404, "UNAVAILABLE", "Receipt unavailable.");
  const refunds = (
    await db.query(
      "SELECT amount_cents,state,provider_id FROM refunds WHERE payment_id=$1",
      [id],
    )
  ).rows;
  return paymentResponse({ ...p, refunds });
}
async function operation(user: string, id: string, kind: string) {
  return tx(async (c) => {
    const pay = await one(
      c,
      "SELECT p.*,u.buyer_id,u.amount_cents,u.plan_id,u.version,u.snapshot FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE p.id=$1 AND u.buyer_id=$2 FOR UPDATE OF p",
      [id, user],
    );
    if (!pay) return fail(404, "UNAVAILABLE", "Purchase unavailable.");
    const plan = await planFor(c, pay.plan_id, user, true);
    const accepted = await one(
      c,
      "SELECT count(*)::int AS n FROM acceptances WHERE plan_id=$1 AND version=$2",
      [plan.id, plan.version],
    );
    if (
      !["accepted", "payment_pending", "confirmed"].includes(plan.status) ||
      plan.version !== pay.version ||
      accepted.n !== 2 ||
      new Date(plan.expires_at).getTime() < Date.now()
    )
      return fail(
        409,
        "CONSENT_REQUIRED",
        "Both members must accept the current, unexpired plan.",
      );
    const op = await one(
      c,
      "INSERT INTO payment_operations(id,payment_id,kind) VALUES($1,$2,$3) ON CONFLICT(payment_id,kind) DO UPDATE SET payment_id=EXCLUDED.payment_id RETURNING *",
      [randomUUID(), id, kind],
    );
    return { pay, op };
  });
}
export async function createOrder(user: string, id: string) {
  const { pay, op } = await operation(user, id, "create");
  if (op.state === "completed") return op.result;
  try {
    const order = await provider.createOrder(
      pay.amount_cents,
      pay.purchase_id,
      op.id,
    );
    if (!order.id) throw Error("Missing provider order");
    return await tx(async (c) => {
      await c.query(
        "UPDATE payments SET order_id=$2,state=CASE WHEN state IN ('created','unknown') THEN 'approval_pending' ELSE state END,updated_at=now() WHERE id=$1",
        [id, order.id],
      );
      const result = {
        id,
        orderId: order.id,
        approvalUrl:
          order.links?.find(
            (l) => l.rel === "payer-action" || l.rel === "approve",
          )?.href || null,
        mode: config.PAYPAL_MODE,
      };
      await c.query(
        "UPDATE payment_operations SET state='completed',result=$2 WHERE id=$1",
        [op.id, result],
      );
      return result;
    });
  } catch {
    await db.query(
      "UPDATE payments SET state='unknown',updated_at=now() WHERE id=$1 AND state='created'",
      [id],
    );
    return fail(
      503,
      "PROVIDER_UNAVAILABLE",
      "Order status is uncertain. Retry this purchase; do not start another.",
    );
  }
}
export async function recordOrder(id: string, order: any) {
  return tx(async (c) => {
    const pay = await one(
      c,
      "SELECT p.*,u.id AS purchase_uuid,u.amount_cents,u.plan_id,u.version,u.snapshot FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE p.id=$1 FOR UPDATE OF p",
      [id],
    );
    if (!pay) return;
    const evidence = verifiedCapture(order, { ...pay, id: pay.purchase_uuid });
    if (!evidence) return;
    if (evidence.status !== "COMPLETED") {
      if (["PENDING"].includes(evidence.status))
        await c.query(
          "UPDATE payments SET state='pending',updated_at=now() WHERE id=$1 AND state NOT IN ('completed','refunded')",
          [id],
        );
      return;
    }
    if (["completed", "refunded"].includes(pay.state)) return;
    await c.query(
      "UPDATE payments SET state='completed',capture_id=$2,updated_at=now() WHERE id=$1",
      [id, evidence.id],
    );
    await c.query("UPDATE purchases SET state='paid' WHERE id=$1", [
      pay.purchase_id,
    ]);
    await c.query(
      "INSERT INTO financial_events(id,payment_id,type,source_id) VALUES($1,$2,'capture.completed',$3) ON CONFLICT DO NOTHING",
      [randomUUID(), id, evidence.id],
    );
    const plan = await one(
      c,
      "SELECT * FROM date_plans WHERE id=$1 FOR UPDATE",
      [pay.plan_id],
    );
    // Provider completion can arrive after consent expires, before the expiry
    // worker runs. Check again under the plan lock before confirming either payer.
    const consentExpired =
      !["confirmed", "completed", "cancelled", "expired"].includes(
        plan.status,
      ) && new Date(plan.expires_at).getTime() <= Date.now();
    if (
      ["cancelled", "expired"].includes(plan.status) ||
      plan.version !== pay.version ||
      consentExpired
    ) {
      await c.query(
        "INSERT INTO outbox(id,kind,aggregate_id) VALUES($1,'cancel_plan',$2) ON CONFLICT(kind,aggregate_id) DO UPDATE SET state='pending',available_at=now()",
        [randomUUID(), plan.id],
      );
      await c.query(
        "UPDATE date_plans SET status=CASE WHEN $2 THEN 'expired' ELSE status END,financial_state='reconciliation_pending' WHERE id=$1",
        [plan.id, consentExpired],
      );
    } else {
      const count = await one(
        c,
        "SELECT count(*)::int AS n FROM purchases WHERE plan_id=$1 AND version=$2 AND state='paid'",
        [plan.id, plan.version],
      );
      await c.query(
        "UPDATE date_plans SET status=$2,financial_state=$3 WHERE id=$1",
        [
          plan.id,
          count.n === 2 ? "confirmed" : "payment_pending",
          count.n === 2 ? "paid" : "partially_paid",
        ],
      );
    }
  });
}
export async function captureOrder(user: string, id: string) {
  const { pay, op } = await operation(user, id, "capture");
  if (["completed", "refunded"].includes(pay.state))
    return ownPayment(user, id);
  if (!pay.order_id)
    return fail(409, "ORDER_REQUIRED", "Create the order first.");
  try {
    await db.query(
      "UPDATE payments SET state='capture_pending',updated_at=now() WHERE id=$1 AND state NOT IN ('completed','refunded')",
      [id],
    );
    let order = await provider.getOrder(pay.order_id);
    if (order.status !== "COMPLETED")
      order = await provider.captureOrder(pay.order_id, op.id);
    await recordOrder(id, order);
    await db.query(
      "UPDATE payment_operations SET state='completed' WHERE id=$1",
      [op.id],
    );
    return ownPayment(user, id);
  } catch {
    await db.query(
      "UPDATE payments SET state='unknown',updated_at=now() WHERE id=$1 AND state NOT IN ('completed','refunded')",
      [id],
    );
    return fail(
      503,
      "CAPTURE_RECONCILING",
      "Payment is being reconciled. Retry with the same purchase.",
    );
  }
}
async function refundPayment(pay: any) {
  if (!pay.capture_id) return;
  const refund = await tx(async (c) => {
    await c.query("SELECT id FROM payments WHERE id=$1 FOR UPDATE", [pay.id]);
    return one(
      c,
      "INSERT INTO refunds(id,payment_id,amount_cents) VALUES($1,$2,$3) ON CONFLICT(payment_id) DO UPDATE SET payment_id=EXCLUDED.payment_id RETURNING *",
      [randomUUID(), pay.id, pay.amount_cents],
    );
  });
  if (refund.state === "completed") return;
  await db.query("UPDATE refunds SET state='pending' WHERE id=$1", [refund.id]);
  let result;
  if (refund.provider_id) result = await provider.getRefund(refund.provider_id);
  else
    result = await provider.refundCapture(
      pay.capture_id,
      refund.amount_cents,
      refund.id,
    );
  if (!result.id) throw Error("Refund evidence unavailable");
  if (
    result.status === "COMPLETED" &&
    config.PAYPAL_MODE === "sandbox" &&
    (result.amount?.currency_code !== "USD" ||
      Number(result.amount?.value) * 100 !== refund.amount_cents)
  )
    throw Error("Refund amount mismatch");
  await tx(async (c) => {
    await c.query("SELECT id FROM payments WHERE id=$1 FOR UPDATE", [pay.id]);
    const completed = result.status === "COMPLETED";
    await c.query("UPDATE refunds SET provider_id=$2,state=$3 WHERE id=$1", [
      refund.id,
      result.id,
      completed ? "completed" : "pending",
    ]);
    if (completed) {
      await c.query(
        "UPDATE payments SET state='refunded',updated_at=now() WHERE id=$1",
        [pay.id],
      );
      await c.query("UPDATE purchases SET state='refunded' WHERE id=$1", [
        pay.purchase_id,
      ]);
      await c.query(
        "INSERT INTO financial_events(id,payment_id,type,source_id) VALUES($1,$2,'refund.completed',$3) ON CONFLICT DO NOTHING",
        [randomUUID(), pay.id, result.id],
      );
    }
  });
}
let running = false;
export async function workerTick() {
  if (running) return;
  running = true;
  try {
    await tx(async (c) => {
      const plans = (
        await c.query(
          "SELECT * FROM date_plans WHERE expires_at<now() AND status NOT IN ('confirmed','completed','cancelled','expired') FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const p of plans) {
        await c.query(
          "UPDATE date_plans SET status='expired',financial_state='reconciliation_pending' WHERE id=$1",
          [p.id],
        );
        await c.query(
          "INSERT INTO outbox(id,kind,aggregate_id) VALUES($1,'cancel_plan',$2) ON CONFLICT DO NOTHING",
          [randomUUID(), p.id],
        );
      }
    });
    const inbox = (
      await db.query(
        "SELECT * FROM webhook_inbox WHERE state='pending' ORDER BY created_at LIMIT 20",
      )
    ).rows;
    for (const event of inbox) {
      try {
        const orderId =
          event.payload.resource?.supplementary_data?.related_ids?.order_id;
        const captureId = event.payload.resource?.id;
        const pay = await one(
          db,
          "SELECT * FROM payments WHERE order_id=$1 OR capture_id=$2",
          [orderId || "", captureId || ""],
        );
        if (pay && pay.order_id)
          await recordOrder(pay.id, await provider.getOrder(pay.order_id));
        await db.query(
          "UPDATE webhook_inbox SET state='processed' WHERE event_id=$1",
          [event.event_id],
        );
      } catch {
        /* Retry durable inbox; no payload logging. */
      }
    }
    const pending = (
      await db.query(
        "SELECT p.* FROM payments p WHERE p.state IN ('unknown','pending','capture_pending') AND p.order_id IS NOT NULL LIMIT 20",
      )
    ).rows;
    for (const pay of pending) {
      try {
        await recordOrder(pay.id, await provider.getOrder(pay.order_id));
      } catch {
        /* Retry on next tick. */
      }
    }
    const jobs = (
      await db.query(
        "SELECT * FROM outbox WHERE state='pending' AND available_at<=now() ORDER BY available_at LIMIT 20",
      )
    ).rows;
    for (const job of jobs) {
      try {
        const pays = (
          await db.query(
            "SELECT p.*,u.amount_cents FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE u.plan_id=$1",
            [job.aggregate_id],
          )
        ).rows;
        let all = true;
        for (const pay of pays) {
          if (pay.order_id && !["completed", "refunded"].includes(pay.state)) {
            await recordOrder(pay.id, await provider.getOrder(pay.order_id));
            const fresh = await one(db, "SELECT * FROM payments WHERE id=$1", [
              pay.id,
            ]);
            Object.assign(pay, fresh);
          }
          if (pay.state === "completed") {
            await refundPayment(pay);
            const r = await one(
              db,
              "SELECT state FROM refunds WHERE payment_id=$1",
              [pay.id],
            );
            if (r?.state !== "completed") all = false;
          } else if (
            ["unknown", "capture_pending", "pending"].includes(pay.state)
          )
            all = false;
        }
        await db.query("UPDATE date_plans SET financial_state=$2 WHERE id=$1", [
          job.aggregate_id,
          all
            ? pays.some((p) => p.capture_id)
              ? "refunded"
              : "unpaid"
            : "refund_pending",
        ]);
        if (all)
          await db.query("UPDATE outbox SET state='processed' WHERE id=$1", [
            job.id,
          ]);
        else
          await db.query(
            "UPDATE outbox SET available_at=now()+interval '15 seconds',attempts=attempts+1 WHERE id=$1",
            [job.id],
          );
      } catch {
        await db.query(
          "UPDATE outbox SET attempts=attempts+1,available_at=now()+interval '30 seconds' WHERE id=$1",
          [job.id],
        );
        await db.query(
          "UPDATE date_plans SET financial_state='refund_failed' WHERE id=$1",
          [job.aggregate_id],
        );
      }
    }
  } finally {
    running = false;
  }
}
