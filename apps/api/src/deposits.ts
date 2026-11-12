import { randomUUID } from "node:crypto";
import { db, one, tx, type Conn } from "./db.js";
import { config } from "./config.js";
import { fail, planFor } from "./domain.js";
import { provider } from "./providers/paypal.js";
import { matchMembers, notify } from "./notifications.js";

export const DEPOSIT_CENTS = 1000;
const HOLD_STATUSES = ["accepted", "payment_pending", "confirmed"];
const CHECK_IN_EARLY_MS = 60 * 60000;
const NO_SHOW_GRACE_MS = 30 * 60000;
const usd = (cents: number) => (cents / 100).toFixed(2);
// Local/staging demos may check in or claim before the scheduled time so the
// whole flow fits in a short walkthrough. Production enforces the window.
const demoClock = () => config.DEMO_MODE === "true";

async function lockedPlan(c: Conn, planId: string, user: string) {
  const p = await planFor(c, planId, user, true);
  if (!HOLD_STATUSES.includes(p.status))
    return fail(
      409,
      "PLAN_NOT_ACCEPTED",
      "Both people accept the same plan before placing a no-show hold.",
    );
  const proposal = await one(
    c,
    "SELECT starts_at FROM proposals WHERE plan_id=$1 AND version=$2",
    [p.id, p.version],
  );
  return { ...p, starts_at: proposal?.starts_at as Date };
}
async function deposits(c: Conn | typeof db, planId: string, version: number) {
  return (
    await c.query(
      "SELECT * FROM date_deposits WHERE plan_id=$1 AND version=$2",
      [planId, version],
    )
  ).rows;
}

export async function depositStatus(planId: string, user: string) {
  return tx(async (c) => {
    const p = await planFor(c, planId, user);
    const rows = await deposits(c, p.id, p.version);
    const own = rows.find((d) => d.user_id === user);
    const partner = rows.find((d) => d.user_id !== user);
    const payout = await one(
      c,
      "SELECT x.recipient_id,x.amount_cents,x.batch_id,x.state FROM deposit_payouts x JOIN date_deposits d ON d.id=x.deposit_id WHERE d.plan_id=$1 AND d.version=$2",
      [p.id, p.version],
    );
    return {
      amountCents: DEPOSIT_CENTS,
      mode: config.PAYPAL_MODE,
      eligible: HOLD_STATUSES.includes(p.status),
      demoClock: demoClock(),
      you: own
        ? {
            state: own.state,
            orderId: own.order_id,
            authorizationId: own.authorization_id,
            captureId: own.capture_id,
            checkedIn: !!own.checked_in_at,
          }
        : { state: "none", checkedIn: false },
      // The partner's PayPal identifiers stay private; only the state is shared.
      partner: partner
        ? { state: partner.state, checkedIn: !!partner.checked_in_at }
        : { state: "none", checkedIn: false },
      payout: payout
        ? {
            toYou: payout.recipient_id === user,
            amountCents: payout.amount_cents,
            batchId: payout.recipient_id === user ? payout.batch_id : null,
            state: payout.state,
          }
        : null,
    };
  });
}

export async function createHold(user: string, planId: string) {
  const dep = await tx(async (c) => {
    const p = await lockedPlan(c, planId, user);
    const existing = await one(
      c,
      "SELECT * FROM date_deposits WHERE plan_id=$1 AND version=$2 AND user_id=$3",
      [p.id, p.version, user],
    );
    if (existing) return existing;
    return one(
      c,
      "INSERT INTO date_deposits(id,plan_id,version,user_id,amount_cents,mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [randomUUID(), p.id, p.version, user, DEPOSIT_CENTS, config.PAYPAL_MODE],
    );
  });
  if (dep.state !== "created")
    return { depositId: dep.id, orderId: dep.order_id, state: dep.state };
  if (dep.order_id)
    return { depositId: dep.id, orderId: dep.order_id, state: dep.state };
  const order = await provider.createHoldOrder(
    dep.amount_cents,
    dep.id,
    dep.plan_id,
    `hold-${dep.id}`,
  );
  await db.query(
    "UPDATE date_deposits SET order_id=$2,updated_at=now() WHERE id=$1 AND order_id IS NULL",
    [dep.id, order.id],
  );
  return {
    depositId: dep.id,
    orderId: order.id,
    state: "created",
    approveUrl:
      order.links?.find((l) => ["payer-action", "approve"].includes(l.rel))
        ?.href ?? null,
  };
}

export async function authorizeHold(user: string, planId: string) {
  const dep = await tx(async (c) => {
    const p = await lockedPlan(c, planId, user);
    return one(
      c,
      "SELECT * FROM date_deposits WHERE plan_id=$1 AND version=$2 AND user_id=$3 FOR UPDATE",
      [p.id, p.version, user],
    );
  });
  if (!dep?.order_id)
    return fail(409, "HOLD_REQUIRED", "Start the PayPal hold first.");
  if (dep.state === "authorized") return depositStatus(planId, user);
  if (dep.state !== "created")
    return fail(409, "HOLD_CLOSED", "This hold is already settled.");
  const order = await provider.authorizeOrder(dep.order_id, `auth-${dep.id}`);
  const unit = order.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  if (!auth?.id || !["CREATED", "PENDING"].includes(auth.status))
    return fail(502, "HOLD_NOT_AUTHORIZED", "PayPal did not authorize the hold.");
  if (
    config.PAYPAL_MODE === "sandbox" &&
    (unit.reference_id !== dep.id ||
      auth.amount?.currency_code !== "USD" ||
      auth.amount?.value !== usd(dep.amount_cents))
  )
    return fail(502, "HOLD_MISMATCH", "PayPal hold details did not match.");
  await tx(async (c) => {
    await c.query(
      "UPDATE date_deposits SET state='authorized',authorization_id=$2,updated_at=now() WHERE id=$1 AND state='created'",
      [dep.id, auth.id],
    );
    const plan = await one(c, "SELECT match_id FROM date_plans WHERE id=$1", [
      dep.plan_id,
    ]);
    await notify(
      c,
      (await matchMembers(c, plan.match_id)).filter((u) => u !== user),
      `hold:${dep.id}`,
      "deposit.held",
      plan.match_id,
    );
  });
  return depositStatus(planId, user);
}

async function voidHold(dep: any) {
  if (dep.state !== "authorized") return;
  await provider.voidAuthorization(dep.authorization_id, `void-${dep.id}`);
  await db.query(
    "UPDATE date_deposits SET state='voided',updated_at=now() WHERE id=$1 AND state='authorized'",
    [dep.id],
  );
}

// Holds belong to one accepted version. Cancellation or a new proposal
// releases them; provider calls run after the plan transaction commits.
export async function releaseStaleHolds(planId: string) {
  const stale = (
    await db.query(
      "SELECT d.* FROM date_deposits d JOIN date_plans p ON p.id=d.plan_id WHERE d.plan_id=$1 AND d.state='authorized' AND (d.version<>p.version OR p.status IN ('cancelled','expired'))",
      [planId],
    )
  ).rows;
  for (const d of stale) await voidHold(d);
}

export async function checkIn(user: string, planId: string) {
  const { rows, matchId } = await tx(async (c) => {
    const p = await lockedPlan(c, planId, user);
    if (
      !demoClock() &&
      Date.now() < new Date(p.starts_at).getTime() - CHECK_IN_EARLY_MS
    )
      return fail(
        409,
        "TOO_EARLY",
        "Check-in opens an hour before the date starts.",
      );
    const res = await c.query(
      "UPDATE date_deposits SET checked_in_at=coalesce(checked_in_at,now()),updated_at=now() WHERE plan_id=$1 AND version=$2 AND user_id=$3 AND state='authorized'",
      [p.id, p.version, user],
    );
    if (!res.rowCount)
      return fail(409, "HOLD_REQUIRED", "Place your no-show hold first.");
    return { rows: await deposits(c, p.id, p.version), matchId: p.match_id };
  });
  if (rows.length === 2 && rows.every((d) => d.checked_in_at)) {
    for (const d of rows) await voidHold(d);
    await tx((c) =>
      matchMembers(c, matchId).then((members) =>
        notify(c, members, `released:${planId}:${rows[0].version}`, "deposit.released", matchId),
      ),
    );
  }
  return depositStatus(planId, user);
}

export async function claimNoShow(
  user: string,
  planId: string,
  payoutEmail?: string,
) {
  if (config.PAYPAL_MODE === "sandbox" && !payoutEmail)
    return fail(
      422,
      "PAYOUT_EMAIL_REQUIRED",
      "Enter the PayPal email that should receive the payout.",
    );
  const { own, absent, payout, matchId } = await tx(async (c) => {
    const p = await lockedPlan(c, planId, user);
    if (
      !demoClock() &&
      Date.now() < new Date(p.starts_at).getTime() + NO_SHOW_GRACE_MS
    )
      return fail(
        409,
        "TOO_EARLY",
        "You can report a no-show 30 minutes after the start time.",
      );
    const rows = await deposits(c, p.id, p.version);
    const own = rows.find((d) => d.user_id === user);
    const absent = rows.find((d) => d.user_id !== user);
    if (!own?.checked_in_at)
      return fail(409, "CHECK_IN_REQUIRED", "Check in before reporting a no-show.");
    if (!absent || absent.state !== "authorized" || absent.checked_in_at)
      return fail(
        409,
        "NO_HOLD_TO_CLAIM",
        "There is no active hold from your match to claim.",
      );
    const payout = await one(
      c,
      "INSERT INTO deposit_payouts(id,deposit_id,recipient_id,amount_cents) VALUES($1,$2,$3,$4) ON CONFLICT(deposit_id) DO UPDATE SET deposit_id=EXCLUDED.deposit_id RETURNING *",
      [randomUUID(), absent.id, user, absent.amount_cents],
    );
    return { own, absent, payout, matchId: p.match_id };
  });
  const capture = await provider.captureAuthorization(
    absent.authorization_id,
    absent.amount_cents,
    `cap-${absent.id}`,
  );
  if (!capture?.id || !["COMPLETED", "PENDING"].includes(capture.status))
    return fail(502, "CAPTURE_FAILED", "PayPal could not capture the hold.");
  await db.query(
    "UPDATE date_deposits SET state='captured',capture_id=$2,updated_at=now() WHERE id=$1",
    [absent.id, capture.id],
  );
  await voidHold(own);
  const result = await provider.createPayout(
    payoutEmail || "mock-recipient@demo.baepal.invalid",
    payout.amount_cents,
    "Your BaePal date didn't show up. Their no-show hold is yours.",
    `payout-${payout.id}`,
  );
  await db.query(
    "UPDATE deposit_payouts SET batch_id=$2,state=$3 WHERE id=$1",
    [
      payout.id,
      result?.batch_header?.payout_batch_id ?? null,
      (result?.batch_header?.batch_status ?? "PENDING").toLowerCase(),
    ],
  );
  await tx(async (c) => {
    await notify(c, [user], `compensated:${payout.id}`, "deposit.compensated", matchId);
    await notify(c, [absent.user_id], `captured:${absent.id}`, "deposit.captured", matchId);
  });
  return depositStatus(planId, user);
}
