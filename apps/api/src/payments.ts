import { paymentResponse } from "./response-contracts.js";
import { randomUUID } from "node:crypto";
import { db, one, tx } from "./db.js";
import { config } from "./config.js";
import {
  provider,
  verifiedCapture,
  verifiedRefund,
} from "./providers/paypal.js";
import { fail, planFor } from "./domain.js";
import { matchMembers, notify } from "./notifications.js";
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
      "SELECT p.*,u.id AS purchase_uuid,u.amount_cents,u.plan_id,u.version,u.snapshot,u.buyer_id FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE p.id=$1 FOR UPDATE OF p",
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
    await notify(
      c,
      [pay.buyer_id],
      `capture:${evidence.id}`,
      "payment.completed",
      plan.match_id,
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
        "INSERT INTO outbox(id,kind,aggregate_id,generation) VALUES($1,'cancel_plan',$2,1) ON CONFLICT(kind,aggregate_id) DO UPDATE SET state='pending',available_at=now(),generation=outbox.generation+1",
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
      if (count.n === 2)
        await notify(
          c,
          await matchMembers(c, plan.match_id),
          `confirmed:${plan.id}:${plan.version}`,
          "date.confirmed",
          plan.match_id,
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
  verifiedRefund(result, refund.amount_cents);
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
      const owner = await one(
        c,
        "SELECT u.buyer_id,d.match_id FROM purchases u JOIN date_plans d ON d.id=u.plan_id WHERE u.id=$1",
        [pay.purchase_id],
      );
      if (owner)
        await notify(
          c,
          [owner.buyer_id],
          `refund:${result.id}`,
          "refund.completed",
          owner.match_id,
        );
    }
  });
}
// No provider calls run under these locks. recordOrder takes the plan lock before
// rearming the outbox; this matching order makes the generation fence atomic with
// financial-state bookkeeping. Payment rows are read without locks because
// recordOrder locks a payment before its plan.
async function finishCancellation(job: any, failed = false) {
  await tx(async (c) => {
    const plan = await one(
      c,
      "SELECT id FROM date_plans WHERE id=$1 FOR UPDATE",
      [job.aggregate_id],
    );
    if (!plan) return;
    const current = await one(
      c,
      "SELECT state,generation FROM outbox WHERE id=$1 FOR UPDATE",
      [job.id],
    );
    if (
      !current ||
      current.state !== "pending" ||
      String(current.generation) !== String(job.generation)
    )
      return;
    const payments = (
      await c.query(
        "SELECT p.state,p.order_id,p.capture_id,u.amount_cents,r.state AS refund_state,r.amount_cents AS refunded_cents FROM payments p JOIN purchases u ON u.id=p.purchase_id LEFT JOIN refunds r ON r.payment_id=p.id WHERE u.plan_id=$1",
        [job.aggregate_id],
      )
    ).rows;
    const settled = payments.every((pay) => {
      const refundComplete =
        pay.state === "refunded" &&
        pay.refund_state === "completed" &&
        pay.refunded_cents === pay.amount_cents;
      return (
        !["completed", "unknown", "capture_pending", "pending"].includes(
          pay.state,
        ) &&
        (!pay.capture_id || refundComplete) &&
        (pay.state !== "refunded" || refundComplete) &&
        // Failed lookup cannot establish that an existing order was never paid.
        (!failed || !pay.order_id || refundComplete)
      );
    });
    await c.query("UPDATE date_plans SET financial_state=$2 WHERE id=$1", [
      job.aggregate_id,
      settled
        ? payments.some((pay) => pay.capture_id)
          ? "refunded"
          : "unpaid"
        : failed
          ? "refund_failed"
          : "refund_pending",
    ]);
    if (settled)
      await c.query("UPDATE outbox SET state='processed' WHERE id=$1", [
        job.id,
      ]);
    else
      await c.query(
        "UPDATE outbox SET attempts=attempts+1,available_at=now()+($2::integer * interval '1 second') WHERE id=$1",
        [job.id, failed ? 30 : 15],
      );
  });
}
const WEBHOOK_ATTEMPT_LIMIT = 8;
async function deferWebhook(event: any, reason: string, quarantine = false) {
  const attempts = event.attempts + 1;
  const exhausted = attempts >= WEBHOOK_ATTEMPT_LIMIT;
  const delay = Math.min(300, 5 * 2 ** Math.min(event.attempts, 6));
  await db.query(
    "UPDATE webhook_inbox SET attempts=attempts+1,state=$3,last_error=$4,available_at=now()+($5::integer * interval '1 second') WHERE event_id=$1 AND state='pending' AND attempts=$2",
    [
      event.event_id,
      event.attempts,
      quarantine || exhausted ? "quarantined" : "pending",
      reason,
      delay,
    ],
  );
}
async function reconcileWebhook(event: any) {
  // Inbox rows are accepted only after signature verification at the HTTP boundary.
  // Unsupported events remain inspectable; they never trigger speculative mutations.
  if (event.mode !== config.PAYPAL_MODE)
    return deferWebhook(event, "MODE_MISMATCH", true);
  const type = event.payload?.event_type;
  if (!["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING"].includes(type))
    return deferWebhook(event, "UNSUPPORTED_EVENT", true);
  const reference = (value: unknown) =>
    typeof value === "string" && value.length > 0 && value.length <= 200
      ? value
      : null;
  const orderId = reference(
    event.payload?.resource?.supplementary_data?.related_ids?.order_id,
  );
  const captureId = reference(event.payload?.resource?.id);
  if (!orderId && !captureId)
    return deferWebhook(event, "MALFORMED_REFERENCE", true);
  const pay = await one(
    db,
    "SELECT * FROM payments WHERE mode=$3 AND (($1::text IS NOT NULL AND order_id=$1) OR ($2::text IS NOT NULL AND capture_id=$2))",
    [orderId, captureId, event.mode],
  );
  if (!pay?.order_id) return deferWebhook(event, "CORRELATION_MISSING");
  // Both provided references must belong to this order/capture, even when the OR
  // correlation found one of them. Financial status still comes from getOrder.
  if (
    (orderId && pay.order_id !== orderId) ||
    (captureId && pay.capture_id && pay.capture_id !== captureId)
  )
    return deferWebhook(event, "CAPTURE_REFERENCE_MISMATCH", true);
  let order;
  try {
    order = await provider.getOrder(pay.order_id);
  } catch {
    return deferWebhook(event, "PROVIDER_UNAVAILABLE");
  }
  if (!order || typeof order !== "object" || order.id !== pay.order_id)
    return deferWebhook(event, "PROVIDER_EVIDENCE_INVALID");
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (
    capture &&
    (!reference(capture.id) || (captureId && capture.id !== captureId))
  )
    return deferWebhook(event, "CAPTURE_REFERENCE_MISMATCH", true);
  try {
    await recordOrder(pay.id, order);
  } catch {
    return deferWebhook(event, "PROVIDER_EVIDENCE_INVALID");
  }
  const actual = await one(db, "SELECT state FROM payments WHERE id=$1", [
    pay.id,
  ]);
  const accepted =
    type === "PAYMENT.CAPTURE.COMPLETED"
      ? ["completed", "refunded"].includes(actual?.state)
      : ["pending", "completed", "refunded"].includes(actual?.state);
  if (!accepted) return deferWebhook(event, "PROVIDER_EVIDENCE_PENDING");
  await db.query(
    "UPDATE webhook_inbox SET state='processed',attempts=attempts+1,last_error=NULL,processed_at=now() WHERE event_id=$1 AND state='pending' AND attempts=$2",
    [event.event_id, event.attempts],
  );
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
        "SELECT * FROM webhook_inbox WHERE state='pending' AND available_at<=now() ORDER BY available_at,created_at,event_id LIMIT 20",
      )
    ).rows;
    for (const event of inbox) {
      try {
        await reconcileWebhook(event);
      } catch {
        await deferWebhook(event, "RECONCILIATION_UNAVAILABLE");
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
        for (const pay of pays) {
          if (pay.order_id && !["completed", "refunded"].includes(pay.state)) {
            await recordOrder(pay.id, await provider.getOrder(pay.order_id));
            const fresh = await one(db, "SELECT * FROM payments WHERE id=$1", [
              pay.id,
            ]);
            Object.assign(pay, fresh);
          }
          if (pay.state === "completed") await refundPayment(pay);
        }
        await finishCancellation(job);
      } catch {
        await finishCancellation(job, true);
      }
    }
  } finally {
    running = false;
  }
}
