import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { config } from "./config.js";
import { contactHash, equal, hash, token } from "./crypto.js";
import { db, one, tx } from "./db.js";
import {
  activeMatch,
  decide,
  eligible,
  fail,
  planFor,
  publicProfile,
  resolveLocalTime,
  snapshotOf,
  VENUE_TZ,
} from "./domain.js";
import { matchMembers, notify } from "./notifications.js";
import {
  alertsFor,
  enqueueEmail,
  operationalMetrics,
} from "./ops.js";
import { partialRefund } from "./payments.js";
import { provider, verifiedCapture, verifiedRefund } from "./providers/paypal.js";

type Session = { user_id: string; token_hash: string; role: string; status: string };
export type RouteContext = {
  io: Server;
  session: (r: FastifyRequest) => Promise<Session>;
  member: (r: FastifyRequest) => Promise<Session>;
};
const ok = (data: unknown) => ({ data });
const uuid = z.string().uuid();
const param = (r: FastifyRequest, key = "id") =>
  uuid.parse((r.params as any)[key]);
const UNDO_WINDOW_MS = 10 * 60000;

async function stepUp(userId: string, password: string | undefined) {
  const u = await one(db, "SELECT password_hash FROM users WHERE id=$1", [
    userId,
  ]);
  if (!password || !u || !(await argon2.verify(u.password_hash, password)))
    return fail(403, "REAUTH_REQUIRED", "Enter your current password.");
}
const requireStaff = (s: Session, roles = ["admin", "moderator"]) => {
  if (!roles.includes(s.role))
    return fail(403, "ROLE_REQUIRED", "Staff access required.");
};

export function registerExtraRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { io, session, member } = ctx;

  // ---- Sessions (#1, #19) ----------------------------------------------
  app.get("/api/v1/me/sessions", async (r) => {
    const s = await session(r);
    const rows = (
      await db.query(
        "SELECT id,token_hash,device,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY last_seen_at DESC",
        [s.user_id],
      )
    ).rows;
    return ok(
      rows.map(({ token_hash, ...x }) => ({
        ...x,
        current: token_hash === s.token_hash,
      })),
    );
  });
  app.delete("/api/v1/me/sessions/:id", async (r, reply) => {
    const s = await session(r);
    const row = await one(
      db,
      "DELETE FROM sessions WHERE id=$1 AND user_id=$2 RETURNING token_hash",
      [param(r), s.user_id],
    );
    if (!row) return fail(404, "UNAVAILABLE", "Session unavailable.");
    io.in(`session:${row.token_hash}`).disconnectSockets(true);
    if (row.token_hash === s.token_hash) reply.clearCookie("baepal", { path: "/" });
    return ok({ revoked: true });
  });
  app.post("/api/v1/me/sessions/revoke-others", async (r) => {
    const s = await session(r);
    const b = z.object({ password: z.string().max(128) }).parse(r.body);
    await stepUp(s.user_id, b.password);
    const gone = (
      await db.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash",
        [s.user_id, s.token_hash],
      )
    ).rows;
    for (const g of gone) io.in(`session:${g.token_hash}`).disconnectSockets(true);
    return ok({ revoked: gone.length });
  });

  // ---- Member settings (#18) -------------------------------------------
  const settingsOf = async (user: string) =>
    (await one(
      db,
      "SELECT read_receipts AS \"readReceipts\",typing_indicators AS \"typingIndicators\",email_updates AS \"emailUpdates\" FROM member_settings WHERE user_id=$1",
      [user],
    )) ?? { readReceipts: false, typingIndicators: true, emailUpdates: true };
  app.get("/api/v1/me/settings", async (r) => {
    const s = await member(r);
    return ok(await settingsOf(s.user_id));
  });
  app.put("/api/v1/me/settings", async (r) => {
    const s = await member(r);
    const b = z
      .object({
        readReceipts: z.boolean(),
        typingIndicators: z.boolean(),
        emailUpdates: z.boolean(),
      })
      .strict()
      .parse(r.body);
    await tx(async (c) => {
      const before = await one(
        c,
        "SELECT read_receipts FROM member_settings WHERE user_id=$1 FOR UPDATE",
        [s.user_id],
      );
      await c.query(
        "INSERT INTO member_settings(user_id,read_receipts,typing_indicators,email_updates) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET read_receipts=$2,typing_indicators=$3,email_updates=$4,updated_at=now()",
        [s.user_id, b.readReceipts, b.typingIndicators, b.emailUpdates],
      );
      // Turning receipts off forgets stored read positions; turning them on
      // never reveals reads that happened while they were off.
      if (before?.read_receipts && !b.readReceipts)
        await c.query("DELETE FROM read_watermarks WHERE user_id=$1", [
          s.user_id,
        ]);
      if (!b.emailUpdates)
        await c.query(
          "UPDATE email_outbox SET state='cancelled' WHERE user_id=$1 AND template='update' AND state='pending'",
          [s.user_id],
        );
    });
    return ok(await settingsOf(s.user_id));
  });

  // ---- Read receipts and typing (#18) ----------------------------------
  app.post("/api/v1/conversations/:id/read", async (r) => {
    const s = await member(r);
    const mid = param(r);
    const b = z.object({ sequence: z.number().int().min(0) }).strict().parse(r.body);
    const m = await activeMatch(db, mid, s.user_id);
    if (b.sequence > m.last_sequence)
      return fail(422, "INVALID_SEQUENCE", "That message does not exist yet.");
    const mine = await settingsOf(s.user_id);
    if (!mine.readReceipts) return ok({ stored: false });
    const row = await one(
      db,
      "INSERT INTO read_watermarks(match_id,user_id,sequence) VALUES($1,$2,$3) ON CONFLICT(match_id,user_id) DO UPDATE SET sequence=GREATEST(read_watermarks.sequence,EXCLUDED.sequence),updated_at=now() RETURNING sequence",
      [mid, s.user_id, b.sequence],
    );
    const partner = m.low_id === s.user_id ? m.high_id : m.low_id;
    if ((await settingsOf(partner)).readReceipts)
      io.to(`user:${partner}`).emit("chat.read", {
        conversationId: mid,
        sequence: row.sequence,
      });
    return ok({ stored: true, sequence: row.sequence });
  });
  app.get("/api/v1/conversations/:id/read", async (r) => {
    const s = await member(r);
    const mid = param(r);
    const m = await activeMatch(db, mid, s.user_id);
    const partner = m.low_id === s.user_id ? m.high_id : m.low_id;
    // Receipts are reciprocal: you see theirs only while both have them on.
    const [mine, theirs] = await Promise.all([
      settingsOf(s.user_id),
      settingsOf(partner),
    ]);
    if (!mine.readReceipts || !theirs.readReceipts)
      return ok({ partnerReadSequence: null, enabled: false });
    const row = await one(
      db,
      "SELECT sequence FROM read_watermarks WHERE match_id=$1 AND user_id=$2",
      [mid, partner],
    );
    return ok({ partnerReadSequence: row?.sequence ?? 0, enabled: true });
  });
  const lastTyping = new WeakMap<object, number>();
  io.on("connection", (socket) => {
    socket.on("typing", async (input: unknown) => {
      try {
        const now = Date.now();
        if (now - (lastTyping.get(socket) ?? 0) < 2000) return;
        lastTyping.set(socket, now);
        const conversationId = uuid.parse((input as any)?.conversationId);
        const userId = socket.data.userId as string;
        await activeMatch(db, conversationId, userId);
        if (!(await settingsOf(userId)).typingIndicators) return;
        socket.to(`match:${conversationId}`).emit("chat.typing", {
          conversationId,
          expiresAt: new Date(now + 5000).toISOString(),
        });
      } catch {
        /* Typing is best-effort and never errors to the client. */
      }
    });
  });

  // ---- Undo latest pass (#17) ------------------------------------------
  app.post("/api/v1/decisions/undo", async (r) => {
    const s = await member(r);
    return tx(async (c) => {
      const last = await one(
        c,
        "SELECT * FROM decisions WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [s.user_id],
      );
      if (
        !last ||
        last.action !== "pass" ||
        Date.now() - new Date(last.created_at).getTime() > UNDO_WINDOW_MS
      )
        return fail(
          409,
          "UNDO_UNAVAILABLE",
          "Only your most recent pass from the last 10 minutes can be undone.",
        );
      await c.query(
        "DELETE FROM decisions WHERE actor_id=$1 AND target_id=$2 AND action='pass'",
        [s.user_id, last.target_id],
      );
      return ok({ undone: true, targetId: last.target_id });
    });
  });

  // ---- Like with a comment on a prompt or photo (#17) -------------------
  app.post("/api/v1/likes/comments", async (r) => {
    const s = await member(r);
    const b = z
      .object({
        targetId: uuid,
        kind: z.enum(["prompt", "photo"]),
        position: z.number().int().min(0).max(11),
        text: z.string().trim().min(1).max(300),
        clientMutationId: uuid,
      })
      .strict()
      .parse(r.body);
    if (!(await eligible(db, s.user_id, b.targetId)))
      return fail(404, "PROFILE_UNAVAILABLE", "This profile is no longer available.");
    const snapshot = snapshotOf(
      await publicProfile(db, b.targetId),
      b.kind,
      b.position,
    );
    if (!snapshot)
      return fail(422, "TARGET_UNAVAILABLE", "That part of the profile has changed.");
    const result = await decide(s.user_id, b.targetId, "like", b.clientMutationId);
    await db.query(
      "INSERT INTO like_comments(actor_id,target_id,kind,position,snapshot,text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (actor_id,target_id) DO NOTHING",
      [s.user_id, b.targetId, b.kind, b.position, JSON.stringify(snapshot), b.text],
    );
    if (result.match)
      io.to(`user:${s.user_id}`)
        .to(`user:${b.targetId}`)
        .emit("match.created", { id: result.match.id });
    return ok(result);
  });

  // ---- Consensual contact hiding (#19) ---------------------------------
  // Members type specific email addresses; only keyed hashes are stored and
  // nothing is uploaded from an address book.
  app.get("/api/v1/me/hidden-contacts", async (r) => {
    const s = await member(r);
    const rows = (
      await db.query(
        "SELECT contact_hash,created_at FROM contact_hides WHERE user_id=$1 ORDER BY created_at",
        [s.user_id],
      )
    ).rows;
    return ok({
      count: rows.length,
      entries: rows.map((x) => ({ id: x.contact_hash.slice(0, 16), createdAt: x.created_at })),
    });
  });
  app.post("/api/v1/me/hidden-contacts", async (r) => {
    const s = await member(r);
    const b = z
      .object({ emails: z.array(z.string().trim().email().max(254)).min(1).max(50) })
      .strict()
      .parse(r.body);
    const existing = await one(
      db,
      "SELECT count(*)::int AS n FROM contact_hides WHERE user_id=$1",
      [s.user_id],
    );
    if (existing.n + b.emails.length > 500)
      return fail(422, "HIDE_LIMIT", "You can hide up to 500 contacts.");
    for (const email of b.emails)
      await db.query(
        "INSERT INTO contact_hides(user_id,contact_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [s.user_id, contactHash(email)],
      );
    return ok({ hidden: b.emails.length });
  });
  app.delete("/api/v1/me/hidden-contacts/:entry", async (r) => {
    const s = await member(r);
    const entry = z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .parse((r.params as any).entry);
    const res = await db.query(
      "DELETE FROM contact_hides WHERE user_id=$1 AND left(contact_hash,16)=$2",
      [s.user_id, entry],
    );
    return ok({ removed: res.rowCount ?? 0 });
  });

  // ---- Decline a proposal (#5) -----------------------------------------
  app.post("/api/v1/date-plans/:id/decline", async (r) => {
    const s = await member(r);
    const b = z
      .object({ proposalVersion: z.number().int() })
      .strict()
      .parse(r.body);
    return tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      if (p.version !== b.proposalVersion || p.status !== "proposed")
        return fail(
          409,
          "VERSION_CONFLICT",
          "Only an open, unaccepted proposal can be declined.",
        );
      await c.query(
        "INSERT INTO proposal_declines(plan_id,version,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [p.id, p.version, s.user_id],
      );
      await c.query("DELETE FROM acceptances WHERE plan_id=$1 AND version=$2", [
        p.id,
        p.version,
      ]);
      await c.query(
        "UPDATE date_plans SET status='collecting_preferences' WHERE id=$1",
        [p.id],
      );
      await notify(
        c,
        (await matchMembers(c, p.match_id)).filter((u) => u !== s.user_id),
        `decline:${p.id}:${p.version}`,
        "date.declined",
        p.match_id,
      );
      return ok({ declined: true });
    });
  });

  // ---- Time zone resolution (#5) ---------------------------------------
  app.get("/api/v1/time/resolve", async (r) => {
    const q = z
      .object({
        local: z.string().max(16),
        tz: z.string().max(64).default(VENUE_TZ),
      })
      .parse(r.query);
    return ok({ ...resolveLocalTime(q.local, q.tz), timezone: q.tz });
  });

  // ---- Calendar export and reminders (#18) -----------------------------
  const confirmedPlan = async (r: FastifyRequest, user: string) => {
    const p = await planFor(db, param(r), user);
    const proposal = await one(
      db,
      "SELECT * FROM proposals WHERE plan_id=$1 AND version=$2",
      [p.id, p.version],
    );
    if (!proposal || !["confirmed", "completed"].includes(p.status))
      return fail(409, "NOT_CONFIRMED", "Only a confirmed plan can be exported.");
    return { p, proposal };
  };
  app.get("/api/v1/date-plans/:id/calendar.ics", async (r, reply) => {
    const s = await member(r);
    const { p, proposal } = await confirmedPlan(r, s.user_id);
    const start = new Date(proposal.starts_at);
    const end = new Date(
      start.getTime() + (proposal.snapshot.duration_minutes ?? 60) * 60000,
    );
    const ics = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const esc = (v: string) => String(v ?? "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    // No partner name or contact details; just the plan you both accepted.
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BaePal//Demo//EN",
      "BEGIN:VEVENT",
      `UID:${p.id}-${p.version}@baepal.invalid`,
      `DTSTAMP:${ics(new Date())}`,
      `DTSTART:${ics(start)}`,
      `DTEND:${ics(end)}`,
      `SUMMARY:${esc(`BaePal plan: ${proposal.snapshot.title}`)}`,
      `LOCATION:${esc(proposal.snapshot.address)}`,
      `DESCRIPTION:${esc(`Times are UTC; venue time zone is ${proposal.timezone}. Fictional demo venue.`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    return reply
      .header("Cache-Control", "private, no-store")
      .header("Content-Disposition", 'attachment; filename="baepal-plan.ics"')
      .type("text/calendar; charset=utf-8")
      .send(body);
  });
  app.post("/api/v1/date-plans/:id/reminder", async (r) => {
    const s = await member(r);
    const { p, proposal } = await confirmedPlan(r, s.user_id);
    const sendAt = new Date(proposal.starts_at).getTime() - 2 * 3600000;
    const u = await one(db, "SELECT email FROM users WHERE id=$1", [s.user_id]);
    await tx((c) =>
      enqueueEmail(c, {
        userId: s.user_id,
        to: u.email,
        template: "reminder",
        data: { planId: p.id },
        dedupeKey: `reminder:${p.id}:${p.version}:${s.user_id}`,
        delaySeconds: Math.max(0, Math.round((sendAt - Date.now()) / 1000)),
      }),
    );
    return ok({ scheduledFor: new Date(Math.max(sendAt, Date.now())).toISOString() });
  });

  // ---- Media moderation (#2) -------------------------------------------
  app.delete("/api/v1/me/photos/:id", async (r) => {
    const s = await session(r);
    const mid = param(r);
    const url = `/api/v1/media/${mid}`;
    return tx(async (c) => {
      const p = await one(
        c,
        "SELECT photos FROM profiles WHERE user_id=$1 FOR UPDATE",
        [s.user_id],
      );
      if (
        p.photos.includes(url) &&
        ["active", "paused"].includes(s.status) &&
        p.photos.length <= 2
      )
        return fail(
          409,
          "PHOTOS_REQUIRED",
          "Add another photo before removing this one; active profiles need two.",
        );
      const gone = await c.query(
        "DELETE FROM media WHERE id=$1 AND owner_id=$2",
        [mid, s.user_id],
      );
      if (!gone.rowCount) return fail(404, "UNAVAILABLE", "Photo unavailable.");
      await c.query(
        "UPDATE profiles SET photos=array_remove(photos,$2),version=version+1 WHERE user_id=$1",
        [s.user_id, url],
      );
      return ok({ removed: true });
    });
  });
  app.get("/api/v1/me/photos", async (r) => {
    const s = await session(r);
    return ok(
      (
        await db.query(
          "SELECT id,state,reason,created_at FROM media WHERE owner_id=$1 ORDER BY created_at DESC",
          [s.user_id],
        )
      ).rows.map((m) => ({ ...m, url: `/api/v1/media/${m.id}` })),
    );
  });
  app.get("/api/v1/admin/media", async (r) => {
    const s = await session(r);
    requireStaff(s);
    return ok(
      (
        await db.query(
          "SELECT m.id,m.state,m.reason,m.created_at,m.owner_id FROM media m WHERE m.state='pending' ORDER BY m.created_at LIMIT 50",
        )
      ).rows,
    );
  });
  app.get("/api/v1/admin/media/:id/image", async (r, reply) => {
    const s = await session(r);
    requireStaff(s);
    const m = await one(db, "SELECT bytes FROM media WHERE id=$1", [param(r)]);
    if (!m) return fail(404, "UNAVAILABLE", "Image unavailable.");
    await db.query(
      "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,'media.view',$3,'moderation review')",
      [randomUUID(), s.user_id, param(r)],
    );
    return reply
      .header("Cache-Control", "private, no-store")
      .type("image/jpeg")
      .send(m.bytes);
  });
  app.patch("/api/v1/admin/media/:id", async (r) => {
    const s = await session(r);
    requireStaff(s);
    const b = z
      .object({
        state: z.enum(["approved", "rejected"]),
        reason: z.string().min(3).max(300),
      })
      .strict()
      .parse(r.body);
    const mid = param(r);
    await tx(async (c) => {
      const m = await one(c, "SELECT * FROM media WHERE id=$1 FOR UPDATE", [mid]);
      if (!m) return fail(404, "UNAVAILABLE", "Image unavailable.");
      await c.query(
        "UPDATE media SET state=$2,reason=$3,reviewed_at=now() WHERE id=$1",
        [mid, b.state, b.reason],
      );
      if (b.state === "rejected")
        await c.query(
          "UPDATE profiles SET photos=array_remove(photos,$2),version=version+1 WHERE user_id=$1",
          [m.owner_id, `/api/v1/media/${mid}`],
        );
      await c.query(
        "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), s.user_id, `media.${b.state}`, mid, b.reason],
      );
    });
    return ok({ updated: true });
  });

  // ---- Appeals (#19) ---------------------------------------------------
  app.post(
    "/api/v1/appeals",
    { config: { rateLimit: { max: 3, timeWindow: "1 day" } } },
    async (r) => {
      const s = await member(r);
      const b = z.object({ text: z.string().trim().min(10).max(2000) }).strict().parse(r.body);
      const warned = await one(
        db,
        "SELECT 1 FROM notifications WHERE user_id=$1 AND category='account.warning'",
        [s.user_id],
      );
      if (!warned)
        return fail(409, "NOTHING_TO_APPEAL", "There is no moderation action on your account.");
      const id = randomUUID();
      await db.query("INSERT INTO appeals(id,user_id,text) VALUES($1,$2,$3)", [
        id,
        s.user_id,
        b.text,
      ]);
      return ok({ id, state: "open" });
    },
  );
  app.get("/api/v1/appeals", async (r) => {
    const s = await member(r);
    return ok(
      (
        await db.query(
          "SELECT id,state,created_at FROM appeals WHERE user_id=$1 ORDER BY created_at DESC",
          [s.user_id],
        )
      ).rows,
    );
  });
  app.get("/api/v1/admin/appeals", async (r) => {
    const s = await session(r);
    requireStaff(s);
    return ok(
      (
        await db.query(
          "SELECT a.id,a.text,a.state,a.created_at,a.user_id,u.status FROM appeals a JOIN users u ON u.id=a.user_id ORDER BY (a.state='open') DESC,a.created_at DESC LIMIT 50",
        )
      ).rows,
    );
  });
  app.patch("/api/v1/admin/appeals/:id", async (r) => {
    const s = await session(r);
    requireStaff(s);
    const b = z
      .object({ state: z.enum(["upheld", "overturned"]), reason: z.string().min(5).max(1000) })
      .strict()
      .parse(r.body);
    await tx(async (c) => {
      const a = await one(c, "SELECT * FROM appeals WHERE id=$1 FOR UPDATE", [param(r)]);
      if (!a || a.state !== "open")
        return fail(409, "NOT_OPEN", "This appeal is already decided.");
      await c.query("UPDATE appeals SET state=$2 WHERE id=$1", [a.id, b.state]);
      await c.query(
        "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), s.user_id, `appeal.${b.state}`, a.id, b.reason],
      );
    });
    return ok({ updated: true });
  });

  // ---- Operations (#8, #15) --------------------------------------------
  app.get("/api/v1/admin/ops", async (r) => {
    const s = await session(r);
    requireStaff(s);
    const metrics = await operationalMetrics();
    return ok({ ...metrics, alerts: alertsFor(metrics) });
  });
  app.post("/api/v1/admin/jobs/:id/retry", async (r) => {
    const s = await session(r);
    requireStaff(s, ["admin"]);
    const b = z.object({ password: z.string().max(128), reason: z.string().min(5).max(500) }).strict().parse(r.body);
    await stepUp(s.user_id, b.password);
    const job = await one(
      db,
      "UPDATE outbox SET state='pending',attempts=0,dead_at=NULL,available_at=now(),locked_until=NULL WHERE id=$1 AND state='dead' RETURNING id",
      [param(r)],
    );
    if (!job) return fail(409, "NOT_DEAD", "Only dead-lettered jobs can be retried.");
    await db.query(
      "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,'job.retry',$3,$4)",
      [randomUUID(), s.user_id, job.id, b.reason],
    );
    return ok({ requeued: true });
  });
  app.post("/api/v1/admin/payments/:id/refunds", async (r) => {
    const s = await session(r);
    requireStaff(s, ["admin"]);
    const b = z
      .object({
        amountCents: z.number().int().min(1).max(100000),
        reason: z.string().min(5).max(500),
        password: z.string().max(128),
      })
      .strict()
      .parse(r.body);
    await stepUp(s.user_id, b.password);
    const refund = await partialRefund(param(r), b.amountCents, b.reason);
    await db.query(
      "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,'payment.partial_refund',$3,$4)",
      [randomUUID(), s.user_id, param(r), b.reason],
    );
    return ok(refund);
  });

  // ---- One-time planning pass (#36) ------------------------------------
  // A separate $5 Sandbox product. Safety, exports, deletion and core dating
  // stay free; the pass only adds alternative itineraries to the AI agent.
  const passFor = (user: string) =>
    one(
      db,
      "SELECT id,amount_cents,mode,state,order_id,created_at FROM entitlements WHERE user_id=$1 AND product='planning_pass' ORDER BY created_at DESC LIMIT 1",
      [user],
    );
  app.get("/api/v1/planning-pass", async (r) => {
    const s = await member(r);
    return ok({
      priceCents: config.PLANNING_PASS_CENTS,
      terms:
        "One-time Sandbox purchase, not a subscription. Adds up to three alternative itineraries when the AI agent books. Refundable within 24 hours. Fictional demo product; no real money.",
      current: (await passFor(s.user_id)) ?? null,
    });
  });
  app.post(
    "/api/v1/planning-pass/order",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (r) => {
      const s = await member(r);
      const row = await tx(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `pass:${s.user_id}`,
        ]);
        const existing = await one(
          c,
          "SELECT * FROM entitlements WHERE user_id=$1 AND product='planning_pass' AND state IN ('created','approval_pending','active')",
          [s.user_id],
        );
        if (existing?.state === "active")
          return fail(409, "ALREADY_ACTIVE", "Your planning pass is already active.");
        return (
          existing ??
          (await one(
            c,
            "INSERT INTO entitlements(id,user_id,product,amount_cents,mode) VALUES($1,$2,'planning_pass',$3,$4) RETURNING *",
            [randomUUID(), s.user_id, config.PLANNING_PASS_CENTS, config.PAYPAL_MODE],
          ))
        );
      });
      if (row.order_id) return ok({ id: row.id, orderId: row.order_id, mode: row.mode });
      const order = await provider.createOrder(row.amount_cents, row.id, `pass-${row.id}`);
      await db.query(
        "UPDATE entitlements SET order_id=$2,state='approval_pending',updated_at=now() WHERE id=$1 AND order_id IS NULL",
        [row.id, order.id],
      );
      return ok({ id: row.id, orderId: order.id, mode: row.mode });
    },
  );
  app.post("/api/v1/planning-pass/:id/capture", async (r) => {
    const s = await member(r);
    const row = await one(
      db,
      "SELECT * FROM entitlements WHERE id=$1 AND user_id=$2",
      [param(r), s.user_id],
    );
    if (!row?.order_id) return fail(404, "UNAVAILABLE", "Order unavailable.");
    if (row.state === "active") return ok({ state: "active" });
    let order = await provider.getOrder(row.order_id);
    if (order.status !== "COMPLETED")
      order = await provider.captureOrder(row.order_id, `pass-cap-${row.id}`);
    const capture = verifiedCapture(order, {
      id: row.id,
      order_id: row.order_id,
      amount_cents: row.amount_cents,
    });
    if (!capture || capture.status !== "COMPLETED")
      return fail(409, "CAPTURE_PENDING", "PayPal has not completed this payment yet.");
    // Granted only from verified completed capture evidence; replays are no-ops.
    await db.query(
      "UPDATE entitlements SET state='active',capture_id=$2,updated_at=now() WHERE id=$1 AND state<>'active' AND state<>'refunded'",
      [row.id, capture.id],
    );
    return ok({ state: "active" });
  });
  app.post("/api/v1/planning-pass/:id/refund", async (r) => {
    const s = await member(r);
    const row = await one(
      db,
      "SELECT * FROM entitlements WHERE id=$1 AND user_id=$2",
      [param(r), s.user_id],
    );
    if (!row || row.state !== "active" || !row.capture_id)
      return fail(409, "NOT_REFUNDABLE", "Only an active pass can be refunded.");
    if (Date.now() - new Date(row.created_at).getTime() > 24 * 3600000)
      return fail(409, "REFUND_WINDOW_CLOSED", "The 24-hour refund window has passed.");
    const result = verifiedRefund(
      await provider.refundCapture(row.capture_id, row.amount_cents, `pass-ref-${row.id}`),
      row.amount_cents,
    );
    if (result.status !== "COMPLETED")
      return fail(409, "REFUND_PENDING", "PayPal is still processing this refund.");
    await db.query(
      "UPDATE entitlements SET state='refunded',refund_id=$2,updated_at=now() WHERE id=$1 AND state='active'",
      [row.id, result.id],
    );
    return ok({ state: "refunded" });
  });

  // ---- Professional connections (#9) -----------------------------------
  // Proves account control only. Hidden unless the member chooses to show it.
  type Adapter = {
    configured: boolean;
    authorize: (state: string) => string;
    identify: (code: string, state: string) => Promise<{ subject: string; label: string }>;
  };
  const redirect = (p: string) => `${config.APP_ORIGIN}/api/v1/auth/${p}/callback`;
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const adapters: Record<"github" | "linkedin", Adapter> = {
    github: {
      configured: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
      authorize: (state) =>
        `https://github.com/login/oauth/authorize?${form({ client_id: config.GITHUB_CLIENT_ID, redirect_uri: redirect("github"), state, scope: "read:user", allow_signup: "false" })}`,
      identify: async (code) => {
        const t = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: form({ client_id: config.GITHUB_CLIENT_ID, client_secret: config.GITHUB_CLIENT_SECRET, code, redirect_uri: redirect("github") }),
          signal: AbortSignal.timeout(10000),
        }).then((x) => x.json() as Promise<any>);
        if (!t.access_token) throw Error("GITHUB_TOKEN");
        const u = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(10000),
        }).then((x) => x.json() as Promise<any>);
        if (!u.id) throw Error("GITHUB_USER");
        return { subject: String(u.id), label: String(u.login ?? "") };
      },
    },
    linkedin: {
      configured: !!(config.LINKEDIN_CLIENT_ID && config.LINKEDIN_CLIENT_SECRET),
      authorize: (state) =>
        `https://www.linkedin.com/oauth/v2/authorization?${form({ response_type: "code", client_id: config.LINKEDIN_CLIENT_ID, redirect_uri: redirect("linkedin"), state, nonce: hash(`nonce:${state}`), scope: "openid profile" })}`,
      identify: async (code, state) => {
        const t = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form({ grant_type: "authorization_code", code, client_id: config.LINKEDIN_CLIENT_ID, client_secret: config.LINKEDIN_CLIENT_SECRET, redirect_uri: redirect("linkedin") }),
          signal: AbortSignal.timeout(10000),
        }).then((x) => x.json() as Promise<any>);
        if (!t.id_token) throw Error("LINKEDIN_TOKEN");
        // Received directly from the token endpoint over TLS, so the claims
        // are validated here without a JWKS signature check (OIDC Core 3.1.3.7).
        const claims = JSON.parse(Buffer.from(String(t.id_token).split(".")[1], "base64url").toString());
        if (
          claims.iss !== "https://www.linkedin.com" ||
          (Array.isArray(claims.aud) ? !claims.aud.includes(config.LINKEDIN_CLIENT_ID) : claims.aud !== config.LINKEDIN_CLIENT_ID) ||
          claims.exp * 1000 < Date.now() ||
          claims.nonce !== hash(`nonce:${state}`) ||
          !claims.sub
        )
          throw Error("LINKEDIN_CLAIMS");
        // Employment data is never requested; only that the account is controlled.
        return { subject: String(claims.sub), label: "LinkedIn account" };
      },
    },
  };
  const providerParam = (r: FastifyRequest) =>
    z.enum(["github", "linkedin"]).parse((r.params as any).provider);
  app.get("/api/v1/me/connections", async (r) => {
    const s = await member(r);
    const rows = (
      await db.query(
        "SELECT provider,label,visible,linked_at FROM connections WHERE user_id=$1",
        [s.user_id],
      )
    ).rows;
    return ok(
      (["github", "linkedin"] as const).map((p) => ({
        provider: p,
        available: adapters[p].configured,
        ...(rows.find((x) => x.provider === p) ?? { linked: false }),
        linked: rows.some((x) => x.provider === p),
      })),
    );
  });
  app.get("/api/v1/auth/:provider/start", async (r, reply) => {
    const p = providerParam(r);
    const s = await member(r);
    if (!adapters[p].configured)
      return fail(503, "CONNECTION_UNAVAILABLE", "This connection is not configured.");
    const state = token();
    reply.setCookie(`baepal_${p}_state`, hash(state + s.user_id), {
      httpOnly: true,
      secure: config.APP_ORIGIN.startsWith("https:"),
      sameSite: "lax",
      path: `/api/v1/auth/${p}`,
      maxAge: 600,
    });
    return reply.redirect(adapters[p].authorize(state));
  });
  app.get("/api/v1/auth/:provider/callback", async (r, reply) => {
    const p = providerParam(r);
    const back = (status: string) =>
      reply
        .clearCookie(`baepal_${p}_state`, { path: `/api/v1/auth/${p}` })
        .redirect(`${config.APP_ORIGIN}/profile?${p}=${status}`);
    const s = await member(r).catch(() => null);
    const q = z
      .object({ code: z.string().max(2048).optional(), state: z.string().max(200).optional() })
      .passthrough()
      .parse(r.query);
    const expected = (r.cookies as any)[`baepal_${p}_state`];
    if (!s || !q.code || !q.state || !expected || !equal(hash(q.state + s.user_id), expected))
      return back("failed");
    try {
      const id = await adapters[p].identify(q.code, q.state);
      const taken = await one(
        db,
        "SELECT user_id FROM connections WHERE provider=$1 AND subject=$2 AND user_id<>$3",
        [p, id.subject, s.user_id],
      );
      // Duplicate identities are refused; accounts are never merged.
      if (taken) return back("in-use");
      await db.query(
        "INSERT INTO connections(user_id,provider,subject,label) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,provider) DO UPDATE SET subject=EXCLUDED.subject,label=EXCLUDED.label,linked_at=now()",
        [s.user_id, p, id.subject, id.label],
      );
      return back("linked");
    } catch {
      return back("failed");
    }
  });
  app.patch("/api/v1/me/connections/:provider", async (r) => {
    const s = await member(r);
    const b = z.object({ visible: z.boolean() }).strict().parse(r.body);
    const res = await db.query(
      "UPDATE connections SET visible=$3 WHERE user_id=$1 AND provider=$2",
      [s.user_id, providerParam(r), b.visible],
    );
    if (!res.rowCount) return fail(404, "UNAVAILABLE", "Connection unavailable.");
    return ok({ visible: b.visible });
  });
  app.delete("/api/v1/me/connections/:provider", async (r) => {
    const s = await member(r);
    await db.query("DELETE FROM connections WHERE user_id=$1 AND provider=$2", [
      s.user_id,
      providerParam(r),
    ]);
    return ok({ linked: false });
  });
}
