import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "./config.js";
import { decrypt, encrypt, keyed, needsRotation } from "./crypto.js";
import { db, one, tx, type Conn } from "./db.js";

// ---- Durable throttles -------------------------------------------------
// Keys are HMAC'd so raw emails and IP addresses are never stored.
const throttleKey = (scope: string, value: string) =>
  `${scope}:${keyed(`throttle:${value.toLowerCase()}`).slice(0, 40)}`;

export async function throttleCount(
  scope: string,
  value: string,
  windowSeconds: number,
) {
  const row = await one(
    db,
    "SELECT hits FROM auth_throttle WHERE key=$1 AND window_start>now()-($2::integer * interval '1 second')",
    [throttleKey(scope, value), windowSeconds],
  );
  return row?.hits ?? 0;
}

export async function throttleHit(
  scope: string,
  value: string,
  windowSeconds: number,
) {
  const row = await one(
    db,
    `INSERT INTO auth_throttle(key,window_start,hits) VALUES($1,now(),1)
     ON CONFLICT(key) DO UPDATE SET
       hits=CASE WHEN auth_throttle.window_start<=now()-($2::integer * interval '1 second') THEN 1 ELSE auth_throttle.hits+1 END,
       window_start=CASE WHEN auth_throttle.window_start<=now()-($2::integer * interval '1 second') THEN now() ELSE auth_throttle.window_start END
     RETURNING hits`,
    [throttleKey(scope, value), windowSeconds],
  );
  return row.hits as number;
}

export async function throttleClear(scope: string, value: string) {
  await db.query("DELETE FROM auth_throttle WHERE key=$1", [
    throttleKey(scope, value),
  ]);
}

// ---- Transactional email ------------------------------------------------
export type EmailTemplate =
  | "challenge_email"
  | "challenge_reset"
  | "update"
  | "reminder";
const SUBJECTS: Record<EmailTemplate, string> = {
  challenge_email: "Your BaePal confirmation code",
  challenge_reset: "Reset your BaePal password",
  update: "You have a new update on BaePal",
  reminder: "Reminder: you have a BaePal plan soon",
};

export function renderEmail(template: EmailTemplate, data: any) {
  const subject = SUBJECTS[template];
  if (template === "challenge_email")
    return {
      subject,
      text: `Your BaePal confirmation code is ${data.code}. It expires in 10 minutes. If you did not sign up, ignore this email.`,
    };
  if (template === "challenge_reset")
    return {
      subject,
      text: `Reset your BaePal password within 10 minutes: ${config.APP_ORIGIN}/auth/reset?challenge=${data.challengeId}&token=${data.code}\nIf you did not ask for this, ignore this email; your password is unchanged.`,
    };
  if (template === "reminder")
    return {
      subject,
      text: `You asked BaePal to remind you about an upcoming plan. Open BaePal for the time and place: ${config.APP_ORIGIN}/dates/${data.planId}`,
    };
  // Updates never include names, messages, budgets or payment details.
  return {
    subject,
    text: `Something new is waiting for you. Open BaePal to see it: ${config.APP_ORIGIN}/notifications\nYou can turn these emails off in your account settings.`,
  };
}

export async function enqueueEmail(
  c: Conn,
  input: {
    userId: string | null;
    to: string;
    template: EmailTemplate;
    data?: unknown;
    dedupeKey?: string;
    delaySeconds?: number;
  },
) {
  await c.query(
    "INSERT INTO email_outbox(id,user_id,template,to_encrypted,data_encrypted,dedupe_key,available_at) VALUES($1,$2,$3,$4,$5,$6,now()+($7::integer * interval '1 second')) ON CONFLICT(dedupe_key) DO NOTHING",
    [
      randomUUID(),
      input.userId,
      input.template,
      encrypt(input.to),
      input.data === undefined ? null : encrypt(JSON.stringify(input.data)),
      input.dedupeKey ?? null,
      input.delaySeconds ?? 0,
    ],
  );
}

// At most one "you have an update" email per member per hour, sent only if
// they still have something unread when the job runs.
export async function enqueueUpdateEmail(c: Conn, userId: string) {
  const u = await one(
    c,
    "SELECT u.email,u.status,COALESCE(s.email_updates,true) AS wanted FROM users u LEFT JOIN member_settings s ON s.user_id=u.id WHERE u.id=$1",
    [userId],
  );
  if (!u || !u.wanted || !["active", "paused"].includes(u.status)) return;
  const hour = Math.floor(Date.now() / 3600000);
  await enqueueEmail(c, {
    userId,
    to: u.email,
    template: "update",
    dedupeKey: `update:${userId}:${hour}`,
    delaySeconds: 120,
  });
}

export type Sender = (message: {
  id: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<void>;

export const localSender: Sender = async (m) => {
  const folder = new URL("../../../.data/mail/", import.meta.url);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(
    new URL(`outbox-${m.id}.json`, folder),
    JSON.stringify({
      subject: m.subject,
      text: m.text,
      note: "Local email capture. Never enabled in production.",
    }),
    { mode: 0o600 },
  );
};

export const resendSender: Sender = async (m) => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.EMAIL_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": m.id,
    },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: [m.to],
      subject: m.subject,
      text: m.text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw Error(`EMAIL_PROVIDER_${res.status}`);
};

export const EMAIL_ATTEMPT_LIMIT = 6;
export async function deliverEmails(
  sender: Sender = config.EMAIL_MODE === "resend" ? resendSender : localSender,
) {
  // Lease rows so overlapping workers never send the same email twice.
  const jobs = (
    await db.query(
      `UPDATE email_outbox SET locked_until=now()+interval '2 minutes'
       WHERE id IN (SELECT id FROM email_outbox WHERE state='pending' AND available_at<=now()
         AND (locked_until IS NULL OR locked_until<now()) ORDER BY available_at LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    )
  ).rows;
  let sent = 0;
  for (const job of jobs) {
    const finish = (state: string, error: string | null = null) =>
      db.query(
        "UPDATE email_outbox SET state=$2,last_error=$3,data_encrypted=NULL,locked_until=NULL,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END WHERE id=$1",
        [job.id, state, error],
      );
    try {
      const to = decrypt(job.to_encrypted);
      if (job.template === "update") {
        const unread = await one(
          db,
          "SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.user_id=$1 AND n.read_at IS NULL AND u.status IN ('active','paused')",
          [job.user_id],
        );
        if (!unread?.n) {
          await finish("cancelled", "NOTHING_UNREAD");
          continue;
        }
      }
      if (to.endsWith(".invalid")) {
        await finish("cancelled", "UNDELIVERABLE_DEMO_ADDRESS");
        continue;
      }
      const data = job.data_encrypted
        ? JSON.parse(decrypt(job.data_encrypted))
        : {};
      await sender({ id: job.id, to, ...renderEmail(job.template, data) });
      await finish("sent");
      sent++;
    } catch (e) {
      const attempts = job.attempts + 1;
      if (attempts >= EMAIL_ATTEMPT_LIMIT)
        await finish("dead", String((e as Error).message).slice(0, 200));
      else
        await db.query(
          "UPDATE email_outbox SET attempts=$2,last_error=$3,locked_until=NULL,available_at=now()+($4::integer * interval '1 second') WHERE id=$1",
          [
            job.id,
            attempts,
            String((e as Error).message).slice(0, 200),
            Math.min(3600, 30 * 2 ** attempts),
          ],
        );
    }
  }
  return { claimed: jobs.length, sent };
}

// ---- Retention ----------------------------------------------------------
// Purges expired operational data. Payments, purchases, refunds, financial
// events and the audit log are never touched here.
export async function purgeExpired() {
  return tx(async (c) => {
    const n = async (sql: string, args: unknown[] = []) =>
      (await c.query(sql, args)).rowCount ?? 0;
    const result = {
      challenges: await n(
        "DELETE FROM challenges WHERE expires_at<now()-interval '1 day'",
      ),
      sessions: await n("DELETE FROM sessions WHERE expires_at<now()"),
      throttles: await n(
        "DELETE FROM auth_throttle WHERE window_start<now()-interval '1 day'",
      ),
      notifications: await n(
        "DELETE FROM notifications WHERE created_at<now()-($1::integer * interval '1 day')",
        [config.RETENTION_NOTIFICATION_DAYS],
      ),
      emails: await n(
        "DELETE FROM email_outbox WHERE state<>'pending' AND created_at<now()-($1::integer * interval '1 day')",
        [config.RETENTION_EMAIL_DAYS],
      ),
      webhooks: await n(
        "DELETE FROM webhook_inbox WHERE state='processed' AND processed_at<now()-($1::integer * interval '1 day')",
        [config.RETENTION_WEBHOOK_DAYS],
      ),
      closedChatMessages: await n(
        "UPDATE messages m SET text='[expired]' FROM matches x WHERE x.id=m.match_id AND x.status='closed' AND m.text NOT IN ('[expired]','[deleted]') AND m.created_at<now()-($1::integer * interval '1 day')",
        [config.RETENTION_CLOSED_CHAT_DAYS],
      ),
      orphanMedia: await n(
        "DELETE FROM media m WHERE m.created_at<now()-interval '1 day' AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id=m.owner_id AND ('/api/v1/media/' || m.id::text)=ANY(p.photos))",
      ),
    };
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total)
      await c.query(
        "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,NULL,'retention.purge',NULL,$2)",
        [randomUUID(), JSON.stringify(result)],
      );
    return result;
  });
}

// ---- Key rotation -------------------------------------------------------
const ENCRYPTED_COLUMNS: { table: string; key: string[]; column: string }[] =
  [
    {
      table: "private_date_preferences",
      key: ["plan_id", "user_id"],
      column: "budget_encrypted",
    },
    { table: "paypal_identities", key: ["user_id"], column: "email_encrypted" },
    { table: "email_outbox", key: ["id"], column: "to_encrypted" },
    { table: "email_outbox", key: ["id"], column: "data_encrypted" },
  ];

export async function rotateFieldKeys() {
  const counts: Record<string, number> = {};
  for (const { table, key, column } of ENCRYPTED_COLUMNS) {
    let rotated = 0;
    await tx(async (c) => {
      const rows = (
        await c.query(
          `SELECT ${key.join(",")},${column} AS value FROM ${table} WHERE ${column} IS NOT NULL FOR UPDATE`,
        )
      ).rows;
      for (const row of rows) {
        if (!needsRotation(row.value)) continue;
        await c.query(
          `UPDATE ${table} SET ${column}=$1 WHERE ${key.map((k, i) => `${k}=$${i + 2}`).join(" AND ")}`,
          [encrypt(decrypt(row.value)), ...key.map((k) => row[k])],
        );
        rotated++;
      }
    });
    counts[`${table}.${column}`] = rotated;
  }
  return counts;
}

// ---- Operational metrics ------------------------------------------------
// Counts and ages only: no member content, emails or provider payloads.
export async function operationalMetrics() {
  const q = async (sql: string) => (await db.query(sql)).rows[0];
  return {
    generatedAt: new Date().toISOString(),
    compensationJobs: await q(
      "SELECT count(*) FILTER (WHERE state='pending')::int AS pending, count(*) FILTER (WHERE state='dead')::int AS dead, COALESCE(EXTRACT(EPOCH FROM now()-min(available_at) FILTER (WHERE state='pending')),0)::int AS oldest_pending_seconds FROM outbox",
    ),
    payments: await q(
      "SELECT count(*) FILTER (WHERE state IN ('unknown','pending','capture_pending'))::int AS unresolved, COALESCE(EXTRACT(EPOCH FROM now()-min(updated_at) FILTER (WHERE state IN ('unknown','pending','capture_pending'))),0)::int AS oldest_unresolved_seconds FROM payments",
    ),
    refunds: await q(
      "SELECT count(*) FILTER (WHERE state IN ('requested','pending'))::int AS pending, count(*) FILTER (WHERE state='failed')::int AS failed FROM refunds",
    ),
    plans: await q(
      "SELECT count(*) FILTER (WHERE financial_state='refund_failed')::int AS refund_failed, count(*) FILTER (WHERE financial_state IN ('refund_pending','reconciliation_pending'))::int AS reconciling FROM date_plans",
    ),
    webhooks: await q(
      "SELECT count(*) FILTER (WHERE state='pending')::int AS pending, count(*) FILTER (WHERE state='quarantined')::int AS quarantined FROM webhook_inbox",
    ),
    email: await q(
      "SELECT count(*) FILTER (WHERE state='pending')::int AS pending, count(*) FILTER (WHERE state='dead')::int AS dead FROM email_outbox",
    ),
    deposits: await q(
      "SELECT count(*) FILTER (WHERE state='authorized')::int AS held, count(*) FILTER (WHERE state='captured')::int AS captured FROM date_deposits",
    ),
  };
}

export function alertsFor(m: Awaited<ReturnType<typeof operationalMetrics>>) {
  const alerts: string[] = [];
  if (m.compensationJobs.dead > 0)
    alerts.push("Compensation jobs need manual review (dead-lettered).");
  if (m.compensationJobs.oldest_pending_seconds > 3600)
    alerts.push("Compensation work has been pending for over an hour.");
  if (m.payments.oldest_unresolved_seconds > 1800)
    alerts.push("A payment has been unresolved for over 30 minutes.");
  if (m.plans.refund_failed > 0) alerts.push("A refund failed and needs review.");
  if (m.webhooks.quarantined > 0)
    alerts.push("Quarantined webhooks need review; do not assume no funds moved.");
  if (m.email.dead > 0) alerts.push("Some emails could not be delivered.");
  return alerts;
}
