import { persistMessageEvent } from "./chat-events.js";
import { notify } from "./notifications.js";
import { catalogueSnapshot } from "./response-contracts.js";
import { randomUUID } from "node:crypto";
import { db, one, tx, type Conn } from "./db.js";
import { ageOn, decrypt, encrypt } from "./crypto.js";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new AppError(status, code, message);
};
export async function activeMatch(
  c: Conn | typeof db,
  id: string,
  userId: string,
  lock = false,
) {
  const m = await one(
    c,
    `SELECT * FROM matches WHERE id=$1 AND ($2=low_id OR $2=high_id) ${lock ? "FOR UPDATE" : ""}`,
    [id, userId],
  );
  if (!m || m.status !== "active")
    return fail(404, "UNAVAILABLE", "This conversation is unavailable.");
  if (
    (
      await c.query(
        "SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1)",
        [m.low_id, m.high_id],
      )
    ).rowCount
  )
    return fail(404, "UNAVAILABLE", "This conversation is unavailable.");
  const people = await c.query(
    "SELECT status FROM users WHERE id=ANY($1::uuid[])",
    [[m.low_id, m.high_id]],
  );
  if (people.rows.some((p) => !["active", "paused"].includes(p.status)))
    return fail(404, "UNAVAILABLE", "This conversation is unavailable.");
  return m;
}
export async function planFor(
  c: Conn | typeof db,
  id: string,
  userId: string,
  lock = false,
) {
  let p = await one(c, "SELECT * FROM date_plans WHERE id=$1", [id]);
  if (!p) return fail(404, "UNAVAILABLE", "Plan unavailable.");
  const m = await activeMatch(c, p.match_id, userId, lock);
  if (lock)
    p = await one(c, "SELECT * FROM date_plans WHERE id=$1 FOR UPDATE", [id]);
  return { ...p, low_id: m.low_id, high_id: m.high_id };
}
export async function publicProfile(c: Conn | typeof db, id: string) {
  return one(
    c,
    `SELECT p.*,date_part('year',age(now(),q.birth_date))::int AS age FROM profiles p JOIN profile_private q ON q.user_id=p.user_id WHERE p.user_id=$1`,
    [id],
  );
}
export async function eligible(
  c: Conn | typeof db,
  a: string,
  b: string,
  allowActiveMatch = false,
) {
  if (a === b) return false;
  const rows = await c.query(
    `SELECT u.id,u.status,p.city,q.gender,q.genders,q.age_min,q.age_max,q.birth_date FROM users u JOIN profiles p ON p.user_id=u.id JOIN profile_private q ON q.user_id=u.id WHERE u.id=ANY($1::uuid[])`,
    [[a, b]],
  );
  if (rows.rowCount !== 2 || rows.rows.some((r) => r.status !== "active"))
    return false;
  const [x, y] = rows.rows;
  if (x.city !== y.city) return false;
  for (const [s, t] of [
    [x, y],
    [y, x],
  ]) {
    const age = ageOn(t.birth_date.toISOString().slice(0, 10));
    if (
      age < 18 ||
      age < s.age_min ||
      age > s.age_max ||
      !s.genders.includes(t.gender)
    )
      return false;
  }
  return !(
    await c.query(
      "SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1) UNION ALL SELECT 1 FROM matches WHERE low_id=LEAST($1::uuid,$2::uuid) AND high_id=GREATEST($1::uuid,$2::uuid) AND (status<>'active' OR NOT $3::boolean)",
      [a, b, allowActiveMatch],
    )
  ).rowCount;
}
export async function decide(
  user: string,
  target: string,
  action: string,
  mutation: string,
) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      [user, target].sort().join(":"),
    ]);
    const existing = await one(
      c,
      "SELECT * FROM decisions WHERE actor_id=$1 AND (target_id=$2 OR mutation_id=$3)",
      [user, target, mutation],
    );
    if (existing) {
      if (
        existing.target_id !== target ||
        existing.action !== action ||
        existing.mutation_id !== mutation
      )
        return fail(409, "IDEMPOTENCY_CONFLICT", "Decision already recorded.");
      // Exact idempotency replay may refer to the newly formed active match,
      // but must not resurrect a closed/blocked/paused or now-ineligible card.
      if (!(await eligible(c, user, target, true)))
        return fail(404, "UNAVAILABLE", "This profile is unavailable.");
      return {
        match: await one(
          c,
          "SELECT id FROM matches WHERE low_id=LEAST($1::uuid,$2::uuid) AND high_id=GREATEST($1::uuid,$2::uuid) AND status='active'",
          [user, target],
        ),
      };
    }
    if (!(await eligible(c, user, target)))
      return fail(404, "UNAVAILABLE", "This profile is unavailable.");
    await c.query("INSERT INTO decisions VALUES($1,$2,$3,$4)", [
      user,
      target,
      action,
      mutation,
    ]);
    let match = null;
    if (
      action === "like" &&
      (
        await c.query(
          "SELECT 1 FROM decisions WHERE actor_id=$1 AND target_id=$2 AND action='like'",
          [target, user],
        )
      ).rowCount
    ) {
      match = await one(
        c,
        "INSERT INTO matches(id,low_id,high_id) VALUES($1,LEAST($2::uuid,$3::uuid),GREATEST($2::uuid,$3::uuid)) ON CONFLICT(low_id,high_id) DO UPDATE SET low_id=EXCLUDED.low_id RETURNING id",
        [randomUUID(), user, target],
      );
      await notify(
        c,
        [user, target],
        `match:${match.id}`,
        "match.created",
        match.id,
      );
    }
    return { match };
  });
}
export async function sendMessage(
  user: string,
  id: string,
  text: string,
  client: string,
  session?: { tokenHash: string },
) {
  return tx(async (c) => {
    // Count and retry IDs are sender-wide, so serialize before any match lock.
    // Recheck match/member authorization after waiting for admission.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `message-sender:${user}`,
    ]);
    const m = await activeMatch(c, id, user, true);
    if (
      session &&
      !(await one(
        c,
        "SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()",
        [session.tokenHash, user],
      ))
    )
      return fail(401, "SESSION_EXPIRED", "Please log in to continue.");
    const existing = await one(
      c,
      "SELECT * FROM messages WHERE sender_id=$1 AND client_id=$2",
      [user, client],
    );
    if (existing) {
      if (existing.match_id !== id || existing.text !== text)
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Message key was already used.",
        );
      await persistMessageEvent(c, existing);
      return existing;
    }
    const recent = await one(
      c,
      "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1 AND created_at>statement_timestamp()-interval '1 minute'",
      [user],
    );
    if (recent.n >= 30)
      return fail(
        429,
        "MESSAGE_RATE_LIMIT",
        "Please wait a moment before sending another message.",
      );
    const sequence = m.last_sequence + 1;
    await c.query("UPDATE matches SET last_sequence=$2 WHERE id=$1", [
      id,
      sequence,
    ]);
    const message = await one(
      c,
      "INSERT INTO messages(id,match_id,sequence,sender_id,client_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING *",
      [randomUUID(), id, sequence, user, client, text],
    );
    await persistMessageEvent(c, message);
    await notify(
      c,
      [m.low_id === user ? m.high_id : m.low_id],
      `message:${message.id}`,
      "message.received",
      id,
    );
    return message;
  });
}
export async function planDTO(c: Conn | typeof db, p: any, user: string) {
  const own = await one(
    c,
    "SELECT * FROM private_date_preferences WHERE plan_id=$1 AND user_id=$2",
    [p.id, user],
  );
  const count = await one(
    c,
    "SELECT count(*)::int AS n FROM private_date_preferences WHERE plan_id=$1",
    [p.id],
  );
  const proposal = await one(
    c,
    "SELECT * FROM proposals WHERE plan_id=$1 AND version=$2",
    [p.id, p.version],
  );
  const accepted = (
    await c.query(
      "SELECT user_id FROM acceptances WHERE plan_id=$1 AND version=$2",
      [p.id, p.version],
    )
  ).rows.map((r) => r.user_id);
  const paid = (
    await c.query(
      "SELECT buyer_id,state FROM purchases WHERE plan_id=$1 AND version=$2",
      [p.id, p.version],
    )
  ).rows;
  return {
    id: p.id,
    matchId: p.match_id,
    status: p.status,
    financialState: p.financial_state,
    version: p.version,
    expiresAt: p.expires_at,
    bothPreferences: count.n === 2,
    ownPreferences: own
      ? {
          budgetCents: Number(decrypt(own.budget_encrypted)),
          activities: own.activities,
          timeStart: own.time_start,
          timeEnd: own.time_end,
        }
      : null,
    proposal: proposal
      ? { ...proposal, snapshot: catalogueSnapshot(proposal.snapshot) }
      : null,
    acceptedByYou: accepted.includes(user),
    acceptanceCount: accepted.length,
    yourTicket: paid.find((r) => r.buyer_id === user)?.state || "not purchased",
    partnerPaid: paid.some((r) => r.buyer_id !== user && r.state === "paid"),
  };
}
export function assertPlanningOpen(p: any) {
  if (!p) return fail(404, "UNAVAILABLE", "Plan unavailable.");
  if (
    ["cancelled", "expired", "confirmed", "completed"].includes(p.status) ||
    new Date(p.expires_at).getTime() <= Date.now()
  )
    return fail(409, "PLAN_CLOSED", "This plan cannot be edited or replanned.");
}
export async function options(c: Conn | typeof db, plan: string) {
  assertPlanningOpen(
    await one(c, "SELECT status,expires_at FROM date_plans WHERE id=$1", [
      plan,
    ]),
  );
  const prefs = (
    await c.query("SELECT * FROM private_date_preferences WHERE plan_id=$1", [
      plan,
    ])
  ).rows;
  if (prefs.length !== 2) return [];
  // Use one clock sample for every option; elapsed availability is not reusable.
  const now = Date.now();
  const start = Math.max(
    now,
    ...prefs.map((p) => new Date(p.time_start).getTime()),
  );
  const end = Math.min(...prefs.map((p) => new Date(p.time_end).getTime()));
  if (start >= end) return [];
  const items = (
    await c.query("SELECT * FROM catalogue ORDER BY price_cents,id")
  ).rows;
  return items
    .filter(
      (x) =>
        prefs.every(
          (p) =>
            x.price_cents <= Number(decrypt(p.budget_encrypted)) &&
            (p.activities.length === 0 || p.activities.includes(x.activity)),
        ) && start + x.duration_minutes * 60000 <= end,
    )
    .map((x) => ({
      ...x,
      earliestStart: new Date(start).toISOString(),
      latestEnd: new Date(end).toISOString(),
    }));
}
export async function savePreferences(
  c: Conn,
  p: any,
  user: string,
  body: any,
) {
  assertPlanningOpen(p);
  await c.query(
    "INSERT INTO private_date_preferences(plan_id,user_id,budget_encrypted,activities,time_start,time_end) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(plan_id,user_id) DO UPDATE SET budget_encrypted=EXCLUDED.budget_encrypted,activities=EXCLUDED.activities,time_start=EXCLUDED.time_start,time_end=EXCLUDED.time_end",
    [
      p.id,
      user,
      encrypt(String(body.budgetCents)),
      body.activities,
      body.timeStart,
      body.timeEnd,
    ],
  );
  if (p.version) {
    const payments = await c.query(
      "SELECT 1 FROM payments pay JOIN purchases pu ON pu.id=pay.purchase_id WHERE pu.plan_id=$1",
      [p.id],
    );
    if (payments.rowCount)
      return fail(
        409,
        "PAYMENT_EXISTS",
        "Cancel the plan before changing preferences after checkout begins.",
      );
    await c.query("DELETE FROM acceptances WHERE plan_id=$1", [p.id]);
    await c.query(
      "UPDATE date_plans SET status='collecting_preferences',version=version+1 WHERE id=$1",
      [p.id],
    );
  }
}
export async function cancelPlan(c: Conn, p: any) {
  // Transition only once against current database state. Retried cancellation must
  // preserve terminal/pending refund evidence and the worker's existing schedule.
  // recordOrder independently rearms compensation for a genuinely new late capture.
  const changed = await c.query(
    "UPDATE date_plans SET status='cancelled',financial_state=CASE WHEN EXISTS(SELECT 1 FROM purchases WHERE plan_id=$1) THEN 'reconciliation_pending' ELSE 'unpaid' END WHERE id=$1 AND status NOT IN ('cancelled','expired','completed') RETURNING id",
    [p.id],
  );
  if (!changed.rowCount) return;
  await c.query(
    "INSERT INTO outbox(id,kind,aggregate_id) VALUES($1,'cancel_plan',$2) ON CONFLICT DO NOTHING",
    [randomUUID(), p.id],
  );
}
