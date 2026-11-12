import { eventForMessage, messageEventEnvelope } from "./chat-events.js";
import {
  catalogueSnapshot,
  paymentSummariesResponse,
  purchaseResponse,
} from "./response-contracts.js";
import {
  createIntegrationHub,
  rankCatalogue,
  integrationStatus,
  validatePreview,
  IntegrationError,
} from "@baepal/integrations";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { Server } from "socket.io";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import argon2 from "argon2";
import sharp from "sharp";
import { z, ZodError } from "zod";
import { db, tx, one } from "./db.js";
import { inbox, matchMembers, notify } from "./notifications.js";
import {
  enqueueEmail,
  throttleClear,
  throttleCount,
  throttleHit,
} from "./ops.js";
import { registerExtraRoutes } from "./routes.js";
import {
  authorizeHold,
  checkIn,
  claimNoShow,
  createHold,
  depositStatus,
  releaseStaleHolds,
} from "./deposits.js";
import { config } from "./config.js";
import { hash, keyed, token, equal, ageOn, decrypt, encrypt } from "./crypto.js";
import { authorizeUrl, identityFromCode } from "./providers/paypal-identity.js";
import {
  AppError,
  fail,
  activeMatch,
  planFor,
  publicProfile,
  sameSnapshot,
  eligible,
  decide,
  sendMessage,
  planDTO,
  options,
  savePreferences,
  assertPlanningOpen,
  cancelPlan,
  firstFittingSlot,
  fitsHours,
} from "./domain.js";
import { createOrder, captureOrder, ownPayment } from "./payments.js";
import { provider } from "./providers/paypal.js";
import {
  aiDescriptor,
  aiEvidence,
  draftIcebreakers,
  interpretPreferences,
  planDates,
  TAG_TAXONOMY,
} from "./providers/llm.js";
import { Contracts, buildOpenApi } from "./contracts.js";
const id = z.string().uuid();
const body = (r: FastifyRequest, s: z.ZodType<any>) => s.parse(r.body);
const param = (r: FastifyRequest, key = "id") =>
  id.parse((r.params as any)[key]);
const ok = (data: any) => ({ data });
// Coarse label only; the raw user agent is not stored.
const deviceLabel = (ua?: string) => {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
};
const MEDIA_QUOTA = 12;
const LOGIN_ACCOUNT_FAILURES = 8;
const LOGIN_NETWORK_FAILURES = 40;
const SIGNUPS_PER_NETWORK = 30;
const RESETS_PER_ACCOUNT = 3;
// Explanations use only interests both members publicly declared.
const withShared = (cards: any[], own: any) =>
  cards.map((c) => ({
    ...c,
    sharedInterests: (c.interests || []).filter((i: string) =>
      (own?.interests || []).includes(i),
    ),
  }));
export async function authenticate(raw: string | undefined) {
  if (!raw) return fail(401, "SESSION_EXPIRED", "Please log in to continue.");
  const s = await one(
    db,
    "SELECT s.*,u.status,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.status NOT IN ('deleted','suspended')",
    [hash(raw)],
  );
  if (!s) return fail(401, "SESSION_EXPIRED", "Please log in to continue.");
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60000)
    await db.query(
      "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1",
      [s.token_hash],
    );
  return s;
}
export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 15 * 1024 * 1024,
    // Narrowed for Fastify's overloads; strings/numbers are valid trustProxy values too.
    trustProxy: config.TRUST_PROXY as boolean,
  });
  const registered: { method: string; url: string }[] = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat())
      registered.push({ method: String(method), url: route.url });
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  // All browser traffic arrives through the web proxy, so limit per session
  // where one exists instead of per proxy IP.
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (r) =>
      r.cookies?.baepal ? `s:${hash(r.cookies.baepal)}` : `ip:${r.ip}`,
  });
  const io = new Server(app.server, {
    cors: { origin: config.APP_ORIGIN, credentials: true },
    maxHttpBufferSize: 8192,
    allowRequest: (req, cb) => {
      let allowed = req.headers.origin === config.APP_ORIGIN;
      // Same-origin polling GETs may omit Origin. Require browser fetch metadata
      // plus a same-origin referrer instead of admitting arbitrary missing origins.
      if (
        !req.headers.origin &&
        req.headers["sec-fetch-site"] === "same-origin"
      ) {
        try {
          allowed =
            new URL(String(req.headers.referer)).origin === config.APP_ORIGIN;
        } catch {
          allowed = false;
        }
      }
      cb(null, allowed);
    },
  });
  async function broadcastMessage(message: any) {
    const event = await eventForMessage(message.id);
    for (const recipient of await io
      .in(`match:${message.match_id}`)
      .fetchSockets()) {
      try {
        const current = await authenticate(recipient.data.sessionToken);
        await activeMatch(db, message.match_id, current.user_id);
        recipient.emit("chat.event", event);
        recipient.emit("message.created", message);
      } catch {
        recipient.leave(`match:${message.match_id}`);
        recipient.emit("access.revoked", { id: message.match_id });
      }
    }
  }
  const session = async (r: FastifyRequest) => authenticate(r.cookies.baepal);
  const member = async (r: FastifyRequest) => {
    const s = await session(r);
    if (!["active", "paused"].includes(s.status))
      return fail(
        403,
        "ONBOARDING_REQUIRED",
        "Complete onboarding to continue.",
      );
    return s;
  };
  async function setSession(reply: any, user: string, r?: FastifyRequest) {
    const raw = token();
    const csrf = token();
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,device) VALUES($1,$2,$3,now()+interval '7 days',$4)",
      [hash(raw), user, csrf, deviceLabel(r?.headers["user-agent"])],
    );
    reply.setCookie("baepal", raw, {
      httpOnly: true,
      secure: config.APP_ORIGIN.startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    return csrf;
  }
  app.addHook("onRequest", async (r) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(r.method) &&
      r.url !== "/api/v1/webhooks/paypal"
    ) {
      if (r.headers.origin !== config.APP_ORIGIN)
        return fail(403, "ORIGIN_DENIED", "Request origin is not allowed.");
      if (r.cookies.baepal) {
        // A stale/revoked cookie must not block login; protected routes still
        // authenticate themselves and reject the request.
        const s = await session(r).catch(() => null);
        if (s && !equal(String(r.headers["x-csrf-token"] || ""), s.csrf))
          return fail(403, "CSRF_REQUIRED", "Refresh the page and try again.");
      }
    }
  });
  app.setErrorHandler((e, _r, reply) => {
    const error = e as any;
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: error.issues
            .map((i: any) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          requestId: _r.id,
        },
      });
    if (error instanceof AppError || error instanceof IntegrationError)
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, requestId: _r.id },
      });
    if (error.statusCode === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMIT",
          message: "Please wait before trying again.",
          requestId: _r.id,
        },
      });
    return reply.code(500).send({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Try again.",
        requestId: _r.id,
      },
    });
  });
  app.addHook("onResponse", async (r, reply) => {
    if (config.NODE_ENV !== "test")
      console.log(
        JSON.stringify({
          requestId: r.id,
          route: r.routeOptions.url,
          method: r.method,
          status: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
        }),
      );
  });
  let openapi: unknown = null;
  app.get("/api/v1/openapi.json", async () =>
    (openapi ??= buildOpenApi(registered)),
  );
  app.get("/api/v1/health", async () => ok({ status: "ok" }));
  app.get("/api/v1/ready", async () => {
    await db.query("SELECT 1");
    return ok({ database: true, paymentMode: config.PAYPAL_MODE });
  });
  app.get("/api/v1/config", async () =>
    ok({
      demo: config.DEMO_MODE === "true",
      paymentMode: config.PAYPAL_MODE,
      paypalClientId:
        config.PAYPAL_MODE === "sandbox" ? config.PAYPAL_CLIENT_ID : null,
      emailMode: config.EMAIL_MODE,
      mediaModeration: config.MEDIA_MODERATION,
      aiMode: aiDescriptor().mode,
      ai: aiDescriptor(),
      connections: {
        linkedin:
          config.LINKEDIN_CLIENT_ID && config.LINKEDIN_CLIENT_SECRET
            ? "available"
            : "unavailable",
        github:
          config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
            ? "available"
            : "unavailable",
      },
      planningPassCents: config.PLANNING_PASS_CENTS,
    }),
  );
  app.get("/api/v1/integrations/status", async (r) => {
    await member(r);
    return ok(integrationStatus(config.BAEPAL_INTEGRATIONS_JSON));
  });
  app.post(
    "/api/v1/integrations/preview",
    { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } },
    async (r) => {
      await member(r);
      const preview = validatePreview(r.body);
      return ok(
        await createIntegrationHub(config.BAEPAL_INTEGRATIONS_JSON).invoke(
          preview.provider,
          preview.operation,
          preview.input,
          { allowExternalProcessing: true },
        ),
      );
    },
  );
  async function challenge(user: string, purpose = "email") {
    return tx(async (c) => {
      // A first request has no challenge row to lock. Serialize issuance and
      // completion on the stable account before touching challenge rows.
      const account = await one(
        c,
        "SELECT id,status,email FROM users WHERE id=$1 FOR UPDATE",
        [user],
      );
      if (
        !account ||
        ["suspended", "deleted"].includes(account.status) ||
        (purpose === "email" && account.status !== "pending_email")
      )
        return fail(
          409,
          "ACCOUNT_UNAVAILABLE",
          "This account is unavailable for this code.",
        );
      const previous = await one(
        c,
        "SELECT * FROM challenges WHERE user_id=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [user, purpose],
      );
      if (
        previous &&
        Date.now() - new Date(previous.created_at).getTime() < 60000
      )
        return fail(
          429,
          "COOLDOWN",
          "Wait 60 seconds before requesting another code.",
        );
      await c.query(
        "UPDATE challenges SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
        [user, purpose],
      );
      const code =
        purpose === "reset" ? token() : String(randomInt(100000, 1000000));
      const cid = randomUUID();
      await c.query(
        "INSERT INTO challenges(id,user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
        [cid, user, purpose, keyed(`${cid}:${code}`)],
      );
      if (config.EMAIL_MODE !== "local") {
        await enqueueEmail(c, {
          userId: user,
          to: account.email,
          template: purpose === "reset" ? "challenge_reset" : "challenge_email",
          data: { code, challengeId: cid },
        });
        return cid;
      }
      const folder = new URL("../../../.data/mail/", import.meta.url);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await writeFile(
        new URL(`${cid}.json`, folder),
        JSON.stringify({
          challengeId: cid,
          purpose,
          code,
          note: "Local email capture. Never enabled in production.",
        }),
        { mode: 0o600 },
      );
      return cid;
    });
  }
  app.post(
    "/api/v1/auth/signup",
    { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } },
    async (r, reply) => {
      const b = body(r, Contracts.Signup);
      const email = b.email.trim().toLowerCase();
      if ((await throttleHit("signup-ip", r.ip, 3600)) > SIGNUPS_PER_NETWORK)
        return fail(
          429,
          "TOO_MANY_ATTEMPTS",
          "Too many sign-ups from this network. Try again later.",
        );
      const uid = randomUUID();
      const password = await argon2.hash(b.password);
      const inserted = await db.query(
        "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id",
        [uid, email, password],
      );
      if (!inserted.rowCount)
        return ok({
          message: "If eligible, you can continue by checking your email.",
          challengeId: randomUUID(),
        });
      await tx(async (c) => {
        await c.query("INSERT INTO profiles(user_id) VALUES($1)", [uid]);
        await c.query("INSERT INTO profile_private(user_id) VALUES($1)", [uid]);
      });
      const cid = await challenge(uid);
      const csrf = await setSession(reply, uid, r);
      return ok({
        message: "Check the local email capture for your confirmation code.",
        challengeId: cid,
        csrf,
      });
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (r, reply) => {
      const b = body(r, Contracts.Login);
      const email = b.email.toLowerCase().trim();
      // Durable failure budgets per account and per network, shared across
      // restarts and processes. Successful logins only clear the account budget.
      if (
        (await throttleCount("login-acct", email, 900)) >= LOGIN_ACCOUNT_FAILURES ||
        (await throttleCount("login-ip", r.ip, 900)) >= LOGIN_NETWORK_FAILURES
      )
        return fail(
          429,
          "TOO_MANY_ATTEMPTS",
          "Too many sign-in attempts. Wait 15 minutes or reset your password.",
        );
      const u = await one(db, "SELECT * FROM users WHERE email=$1", [email]);
      const valid = await argon2.verify(
        u?.password_hash || (await argon2.hash("invalid-password-placeholder")),
        b.password,
      );
      if (!u || !valid || ["suspended", "deleted"].includes(u.status)) {
        await throttleHit("login-acct", email, 900);
        await throttleHit("login-ip", r.ip, 900);
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect, or this account is unavailable.",
        );
      }
      await throttleClear("login-acct", email);
      if (r.cookies.baepal)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(r.cookies.baepal),
        ]);
      const csrf = await setSession(reply, u.id, r);
      return ok({ csrf, status: u.status });
    },
  );
  app.post("/api/v1/auth/email/request", async (r) => {
    const s = await session(r);
    if (s.status !== "pending_email")
      return fail(409, "ALREADY_CONFIRMED", "Email is already confirmed.");
    return ok({ challengeId: await challenge(s.user_id) });
  });
  app.post("/api/v1/auth/email/confirm", async (r) => {
    const s = await session(r);
    const b = body(
      r,
      z.object({ challengeId: id, code: z.string().length(6) }),
    );
    const result = await tx(async (c) => {
      // Keep account -> challenge lock order identical to issuance/reset.
      const account = await one(
        c,
        "SELECT status FROM users WHERE id=$1 FOR UPDATE",
        [s.user_id],
      );
      if (!account || account.status !== "pending_email") return false;
      const item = await one(
        c,
        "SELECT * FROM challenges WHERE id=$1 AND user_id=$2 AND purpose='email' FOR UPDATE",
        [b.challengeId, s.user_id],
      );
      if (
        !item ||
        item.consumed_at ||
        item.attempts >= 5 ||
        new Date(item.expires_at).getTime() < Date.now()
      )
        return false;
      await c.query("UPDATE challenges SET attempts=attempts+1 WHERE id=$1", [
        item.id,
      ]);
      if (!equal(item.code_hash, keyed(`${item.id}:${b.code}`))) return false;
      await c.query("UPDATE challenges SET consumed_at=now() WHERE id=$1", [
        item.id,
      ]);
      await c.query(
        "UPDATE users SET confirmed_at=now(),status='onboarding' WHERE id=$1 AND status='pending_email'",
        [s.user_id],
      );
      return true;
    });
    if (!result)
      return fail(
        422,
        "INVALID_CODE",
        "Code is invalid, expired, used, or attempts are exhausted.",
      );
    return ok({ confirmed: true });
  });
  app.post(
    "/api/v1/auth/password/request",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (r) => {
      const b = body(r, z.object({ email: z.email() }));
      const u = await one(
        db,
        "SELECT id FROM users WHERE email=$1 AND status NOT IN ('deleted','suspended')",
        [b.email.toLowerCase().trim()],
      );
      // Same neutral response whether the account exists, is throttled or
      // is cooling down.
      if (u && (await throttleHit("reset-acct", u.id, 3600)) <= RESETS_PER_ACCOUNT) {
        try {
          await challenge(u.id, "reset");
        } catch {
          /* Generic response including cooldown. */
        }
      }
      return ok({
        message:
          "If this account is eligible, reset instructions have been sent.",
      });
    },
  );
  app.post("/api/v1/auth/password/reset", async (r, reply) => {
    const b = body(
      r,
      z.object({
        challengeId: id,
        token: z.string().length(64),
        password: z.string().min(12).max(128),
      }),
    );
    const password = await argon2.hash(b.password);
    await tx(async (c) => {
      // Read only the owner first; lock/recheck the account before the challenge
      // so a status change cannot be bypassed and issuance cannot invert locks.
      const owner = await one(
        c,
        "SELECT user_id FROM challenges WHERE id=$1 AND purpose='reset'",
        [b.challengeId],
      );
      const account =
        owner &&
        (await one(c, "SELECT status FROM users WHERE id=$1 FOR UPDATE", [
          owner.user_id,
        ]));
      if (!account || ["suspended", "deleted"].includes(account.status))
        return fail(
          422,
          "INVALID_TOKEN",
          "Reset link is expired, invalid or used.",
        );
      const item = await one(
        c,
        "SELECT * FROM challenges WHERE id=$1 AND user_id=$2 AND purpose='reset' FOR UPDATE",
        [b.challengeId, owner.user_id],
      );
      if (
        !item ||
        item.consumed_at ||
        new Date(item.expires_at).getTime() < Date.now() ||
        !equal(item.code_hash, keyed(`${item.id}:${b.token}`))
      )
        return fail(
          422,
          "INVALID_TOKEN",
          "Reset link is expired, invalid or used.",
        );
      await c.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        item.user_id,
        password,
      ]);
      await c.query("UPDATE challenges SET consumed_at=now() WHERE id=$1", [
        item.id,
      ]);
      await c.query("DELETE FROM sessions WHERE user_id=$1", [item.user_id]);
      io.in(`user:${item.user_id}`).disconnectSockets(true);
    });
    reply.clearCookie("baepal", { path: "/" });
    return ok({ reset: true });
  });
  app.post("/api/v1/auth/logout", async (r, reply) => {
    const s = await session(r);
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [s.token_hash]);
    io.in(`session:${s.token_hash}`).disconnectSockets(true);
    reply.clearCookie("baepal", { path: "/" });
    return ok({ loggedOut: true });
  });
  // Log in with PayPal (identity link). Mock mode links a labelled mock
  // identity so the badge can be demonstrated without credentials.
  app.get("/api/v1/auth/paypal/start", async (r, reply) => {
    const s = await member(r);
    if (config.PAYPAL_MODE !== "sandbox") {
      await db.query(
        "INSERT INTO paypal_identities(user_id,payer_id,verified,email_encrypted,mode) VALUES($1,$2,true,NULL,'mock') ON CONFLICT(user_id) DO UPDATE SET verified=true,linked_at=now()",
        [s.user_id, `MOCK-PAYER-${s.user_id.slice(0, 8)}`],
      );
      return reply.redirect(`${config.APP_ORIGIN}/profile?paypal=linked`);
    }
    if (!config.PAYPAL_CLIENT_ID)
      return fail(503, "PAYPAL_NOT_CONFIGURED", "PayPal is not configured.");
    const state = token();
    reply.setCookie("baepal_pp_state", hash(state + s.user_id), {
      httpOnly: true,
      secure: config.APP_ORIGIN.startsWith("https:"),
      sameSite: "lax",
      path: "/api/v1/auth/paypal",
      maxAge: 600,
    });
    return reply.redirect(authorizeUrl(state));
  });
  app.get("/api/v1/auth/paypal/callback", async (r, reply) => {
    const back = (status: string) =>
      reply
        .clearCookie("baepal_pp_state", { path: "/api/v1/auth/paypal" })
        .redirect(`${config.APP_ORIGIN}/profile?paypal=${status}`);
    const s = await member(r).catch(() => null);
    const q = z
      .object({ code: z.string().max(2048).optional(), state: z.string().max(200).optional() })
      .passthrough()
      .parse(r.query);
    const expected = r.cookies.baepal_pp_state;
    if (
      !s ||
      !q.code ||
      !q.state ||
      !expected ||
      !equal(hash(q.state + s.user_id), expected)
    )
      return back("failed");
    try {
      const id = await identityFromCode(q.code);
      const taken = await one(
        db,
        "SELECT user_id FROM paypal_identities WHERE payer_id=$1 AND user_id<>$2",
        [id.payerId, s.user_id],
      );
      if (taken) return back("in-use");
      await db.query(
        "INSERT INTO paypal_identities(user_id,payer_id,verified,email_encrypted,mode) VALUES($1,$2,$3,$4,'sandbox') ON CONFLICT(user_id) DO UPDATE SET payer_id=EXCLUDED.payer_id,verified=EXCLUDED.verified,email_encrypted=EXCLUDED.email_encrypted,mode='sandbox',linked_at=now()",
        [s.user_id, id.payerId, id.verified, id.email ? encrypt(id.email) : null],
      );
      return back(id.verified ? "linked" : "unverified");
    } catch (e) {
      r.log.warn({ err: (e as Error).message }, "paypal identity link failed");
      return back("failed");
    }
  });
  app.get("/api/v1/me/paypal", async (r) => {
    const s = await member(r);
    const row = await one(
      db,
      "SELECT verified,mode,linked_at,email_encrypted IS NOT NULL AS has_email FROM paypal_identities WHERE user_id=$1",
      [s.user_id],
    );
    return ok(
      row
        ? { linked: true, verified: row.verified, mode: row.mode, linkedAt: row.linked_at, payoutEmailOnFile: row.has_email }
        : { linked: false, mode: config.PAYPAL_MODE },
    );
  });
  app.delete("/api/v1/me/paypal", async (r) => {
    const s = await member(r);
    await db.query("DELETE FROM paypal_identities WHERE user_id=$1", [s.user_id]);
    return ok({ linked: false });
  });
  app.get("/api/v1/me", async (r) => {
    const s = await session(r);
    return ok({
      id: s.user_id,
      status: s.status,
      role: s.role,
      csrf: s.csrf,
      profile: await publicProfile(db, s.user_id),
      privateProfile: await one(
        db,
        "SELECT birth_date,gender,genders,age_min,age_max FROM profile_private WHERE user_id=$1",
        [s.user_id],
      ),
    });
  });
  const profileSchema = z
    .object({
      expectedVersion: z.number().int(),
      displayName: z.string().trim().max(50),
      bio: z.string().max(500),
      birthDate: z.union([z.iso.date(), z.literal("")]),
      gender: z.enum(["Woman", "Man", "Nonbinary"]),
      genders: z.array(z.enum(["Woman", "Man", "Nonbinary"])).min(1),
      ageMin: z.number().int().min(18).max(99),
      ageMax: z.number().int().min(18).max(99),
      city: z.literal("Seattle"),
      intention: z.enum([
        "Long-term relationship",
        "Marriage-minded",
        "Exploring intentionally",
      ]),
      interests: z.array(z.string().max(30)).max(10),
      prompts: z
        .array(
          z.object({
            question: z.string().min(1).max(100),
            answer: z.string().max(250),
          }),
        )
        .length(2),
      photos: z.array(z.string().max(200)).max(6),
      publish: z.boolean().default(false),
    })
    .refine((b) => b.ageMax >= b.ageMin, {
      message: "Maximum age must be at least minimum age.",
    });
  app.patch("/api/v1/me/profile", async (r) => {
    const s = await session(r);
    if (!["onboarding", "active", "paused"].includes(s.status))
      return fail(403, "EMAIL_REQUIRED", "Confirm your email first.");
    const b = body(r, profileSchema);
    const age = ageOn(b.birthDate);
    if (b.birthDate && (age < 18 || age > 110)) {
      if (s.status === "onboarding")
        await tx(async (c) => {
          await c.query("DELETE FROM media WHERE owner_id=$1", [s.user_id]);
          await c.query(
            "UPDATE profiles SET display_name='',bio='',photos='{}',prompts='[]' WHERE user_id=$1",
            [s.user_id],
          );
          await c.query(
            "UPDATE profile_private SET birth_date=NULL WHERE user_id=$1",
            [s.user_id],
          );
        });
      return fail(422, "ADULTS_ONLY", "BaePal is for adults aged 18 and over.");
    }
    await tx(async (c) => {
      const p = await one(
        c,
        "SELECT * FROM profiles WHERE user_id=$1 FOR UPDATE",
        [s.user_id],
      );
      if (p.version !== b.expectedVersion)
        return fail(
          409,
          "VERSION_CONFLICT",
          "Your profile changed. Refresh before saving.",
        );
      let approvedPhotos = 0;
      for (const photo of b.photos) {
        const mid = photo.match(/^\/api\/v1\/media\/([a-f0-9-]{36})$/)?.[1];
        if (mid) {
          const m = await one(
            c,
            "SELECT state FROM media WHERE id=$1 AND owner_id=$2",
            [mid, s.user_id],
          );
          if (!m || m.state === "rejected")
            return fail(422, "INVALID_PHOTO", "Photo unavailable.");
          if (m.state === "approved") approvedPhotos++;
        } else if (!(
          config.DEMO_MODE === "true" && /^\/portraits\/[0-5]\.svg$/.test(photo)
        ))
          return fail(
            422,
            "INVALID_PHOTO",
            "Use an uploaded photo or labeled demo illustration.",
          );
        else approvedPhotos++;
      }
      if (
        (b.publish || ["active", "paused"].includes(s.status)) &&
        approvedPhotos < 2 &&
        b.photos.length >= 2
      )
        return fail(
          422,
          "PHOTOS_PENDING_REVIEW",
          "Two approved photos are needed. Some are still waiting for review.",
        );
      if (
        (b.publish || ["active", "paused"].includes(s.status)) &&
        (!b.birthDate ||
          b.displayName.length < 2 ||
          b.photos.length < 2 ||
          b.prompts.some((p: any) => !p.answer.trim()))
      )
        return fail(
          422,
          "INCOMPLETE_PROFILE",
          "Add a display name, adult birth date, two photos, and two answered prompts.",
        );
      await c.query(
        "UPDATE profiles SET display_name=$2,bio=$3,city=$4,intention=$5,interests=$6,prompts=$7,photos=$8,version=version+1 WHERE user_id=$1",
        [
          s.user_id,
          b.displayName,
          b.bio,
          b.city,
          b.intention,
          b.interests,
          JSON.stringify(b.prompts),
          b.photos,
        ],
      );
      await c.query(
        "UPDATE profile_private SET birth_date=$2,gender=$3,genders=$4,age_min=$5,age_max=$6 WHERE user_id=$1",
        [
          s.user_id,
          b.birthDate || null,
          b.gender,
          b.genders,
          b.ageMin,
          b.ageMax,
        ],
      );
      if (b.publish && s.status === "onboarding")
        await c.query("UPDATE users SET status='active' WHERE id=$1", [
          s.user_id,
        ]);
    });
    return ok({ saved: true });
  });
  app.post("/api/v1/me/photos", async (r) => {
    const s = await session(r);
    const b = body(r, z.object({ base64: z.string().max(14000000) }));
    const input = Buffer.from(b.base64, "base64");
    if (input.length > 10 * 1024 * 1024)
      return fail(422, "IMAGE_TOO_LARGE", "Maximum photo size is 10MB.");
    const image = sharp(input, { limitInputPixels: 24000000, failOn: "error" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || ""))
      return fail(422, "IMAGE_FORMAT", "Use JPEG, PNG, or WebP.");
    const bytes = await image
      .rotate()
      .resize(1200, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const held = await one(
      db,
      "SELECT count(*)::int AS n FROM media WHERE owner_id=$1 AND state<>'rejected'",
      [s.user_id],
    );
    if (held.n >= MEDIA_QUOTA)
      return fail(
        422,
        "PHOTO_QUOTA",
        `You can keep up to ${MEDIA_QUOTA} photos. Remove one first.`,
      );
    const mid = randomUUID();
    const state = config.MEDIA_MODERATION === "auto" ? "approved" : "pending";
    await db.query(
      "INSERT INTO media(id,owner_id,bytes,state,reason,reviewed_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        mid,
        s.user_id,
        bytes,
        state,
        state === "approved"
          ? "Development auto-approval: technical checks only, no content moderation provider."
          : null,
        state === "approved" ? new Date() : null,
      ],
    );
    return ok({
      url: `/api/v1/media/${mid}`,
      state,
      moderation:
        state === "approved"
          ? "Development only: technical validation, no content moderation provider."
          : "Waiting for moderator review. It won't be shown to others until approved.",
    });
  });
  app.get("/api/v1/media/:id", async (r, reply) => {
    const s = await session(r);
    const media = await one(db, "SELECT * FROM media WHERE id=$1", [param(r)]);
    if (!media) return fail(404, "UNAVAILABLE", "Image unavailable.");
    if (media.owner_id !== s.user_id) {
      if (media.state !== "approved")
        return fail(404, "UNAVAILABLE", "Image unavailable.");
      const m = await one(
        db,
        "SELECT id FROM matches WHERE low_id=LEAST($1::uuid,$2::uuid) AND high_id=GREATEST($1::uuid,$2::uuid) AND status='active'",
        [s.user_id, media.owner_id],
      );
      if (m) await activeMatch(db, m.id, s.user_id);
      else if (!(await eligible(db, s.user_id, media.owner_id)))
        return fail(404, "UNAVAILABLE", "Image unavailable.");
      const p = await publicProfile(db, media.owner_id);
      if (!p?.photos.includes(`/api/v1/media/${media.id}`))
        return fail(404, "UNAVAILABLE", "Image unavailable.");
    }
    return reply
      .header("Cache-Control", "private, no-store")
      .type("image/jpeg")
      .send(media.bytes);
  });
  // Titles are generic so names, budgets and payer details never leave the
  // owner's authenticated views.
  app.get("/api/v1/notifications", async (r) => {
    const s = await member(r);
    return ok(await tx((c) => inbox(c, s.user_id)));
  });
  app.post("/api/v1/notifications/read", async (r) => {
    const s = await member(r);
    const b = body(
      r,
      z.object({ ids: z.array(z.string().uuid()).max(50).optional() }).strict(),
    );
    const res = b.ids
      ? await db.query(
          "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL",
          [s.user_id, b.ids],
        )
      : await db.query(
          "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
          [s.user_id],
        );
    return ok({ marked: res.rowCount ?? 0 });
  });
  // Members who liked you and are still eligible, where you have not decided yet.
  // Accept/dismiss go through the same POST /decisions path as Discover.
  app.get("/api/v1/likes", async (r) => {
    const s = await member(r);
    const likers = (
      await db.query(
        "SELECT d.actor_id FROM decisions d WHERE d.target_id=$1 AND d.action='like' AND NOT EXISTS (SELECT 1 FROM decisions o WHERE o.actor_id=$1 AND o.target_id=d.actor_id) ORDER BY d.actor_id LIMIT 50",
        [s.user_id],
      )
    ).rows;
    const mine = await publicProfile(db, s.user_id);
    const comments = new Map(
      (
        await db.query(
          "SELECT actor_id,kind,position,snapshot,text,created_at FROM like_comments WHERE target_id=$1",
          [s.user_id],
        )
      ).rows.map((x) => [x.actor_id, x]),
    );
    const cards = [];
    for (const x of likers)
      if (await eligible(db, s.user_id, x.actor_id)) {
        const card: any = await publicProfile(db, x.actor_id);
        const c = comments.get(x.actor_id);
        if (c) {
          const available = sameSnapshot(mine, c.kind, c.position, c.snapshot);
          card.comment = {
            text: c.text,
            kind: c.kind,
            snapshot: available ? c.snapshot : null,
            available,
            createdAt: c.created_at,
          };
        }
        cards.push(card);
      }
    return ok(withShared(cards, mine));
  });
  // Ordered by shared declared interests, then user id. The cursor is an
  // HMAC-signed keyset position bound to the member's current filters, so a
  // filter change invalidates it instead of silently skipping people.
  app.get("/api/v1/discover", async (r) => {
    const s = await member(r);
    const q = z
      .object({
        cursor: z.string().max(400).optional(),
        limit: z.coerce.number().int().min(1).max(30).default(30),
        interest: z.string().trim().min(1).max(40).optional(),
      })
      .parse(r.query);
    const me = await one(
      db,
      "SELECT p.city,p.interests,q.gender,q.genders,q.age_min,q.age_max,date_part('year',age(now(),q.birth_date))::int AS age FROM profiles p JOIN profile_private q ON q.user_id=p.user_id WHERE p.user_id=$1",
      [s.user_id],
    );
    const filters = hash(
      JSON.stringify([
        me.city,
        [...me.interests].sort(),
        me.gender,
        [...me.genders].sort(),
        me.age_min,
        me.age_max,
        q.interest ?? null,
      ]),
    ).slice(0, 16);
    let after: { n: number; id: string } | null = null;
    if (q.cursor) {
      const [payload, sig] = q.cursor.split(".");
      let parsed: any = null;
      try {
        if (equal(sig ?? "", keyed(`discover:${s.user_id}:${payload}`)))
          parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.f !== filters || parsed.e < Date.now())
        return fail(
          409,
          "CURSOR_STALE",
          "Your filters changed or this page expired. Start again from the top.",
        );
      after = { n: parsed.n, id: parsed.u };
    }
    const rows = (
      await db.query(
        `SELECT u.id, cardinality(ARRAY(SELECT unnest(p.interests) INTERSECT SELECT unnest($2::text[])))::int AS shared
         FROM users u JOIN profiles p ON p.user_id=u.id JOIN profile_private q ON q.user_id=u.id
         WHERE u.id<>$1 AND u.status='active' AND u.role='member' AND p.city=$3
           AND q.gender=ANY($4::text[]) AND $5=ANY(q.genders)
           AND date_part('year',age(now(),q.birth_date)) BETWEEN GREATEST($6,18) AND $7
           AND $8 BETWEEN q.age_min AND q.age_max
           AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.actor_id=$1 AND d.target_id=u.id)
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.actor_id=$1 AND b.target_id=u.id) OR (b.actor_id=u.id AND b.target_id=$1))
           AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.low_id=LEAST($1::uuid,u.id) AND m.high_id=GREATEST($1::uuid,u.id))
           AND ($9::int IS NULL OR cardinality(ARRAY(SELECT unnest(p.interests) INTERSECT SELECT unnest($2::text[]))) < $9
                OR (cardinality(ARRAY(SELECT unnest(p.interests) INTERSECT SELECT unnest($2::text[]))) = $9 AND u.id > $10::uuid))
           AND ($12::text IS NULL OR $12 = ANY(p.interests))
         ORDER BY shared DESC, u.id
         LIMIT $11`,
        [
          s.user_id,
          me.interests,
          me.city,
          me.genders,
          me.gender,
          me.age_min,
          me.age_max,
          me.age,
          after?.n ?? null,
          after?.id ?? null,
          q.limit + 1,
          q.interest ?? null,
        ],
      )
    ).rows;
    const page = rows.slice(0, q.limit);
    const cards = [];
    // The shared predicate still has the final say on every card.
    for (const x of page)
      if (await eligible(db, s.user_id, x.id))
        cards.push(await publicProfile(db, x.id));
    const last = page.at(-1);
    let nextCursor: string | null = null;
    if (rows.length > q.limit && last) {
      const payload = Buffer.from(
        JSON.stringify({
          n: last.shared,
          u: last.id,
          f: filters,
          e: Date.now() + 30 * 60000,
        }),
      ).toString("base64url");
      nextCursor = `${payload}.${keyed(`discover:${s.user_id}:${payload}`)}`;
    }
    const own = await publicProfile(db, s.user_id);
    return { data: withShared(cards, own), nextCursor };
  });
  // ---- AI assistance: drafts only, never autonomous actions ----
  app.post(
    "/api/v1/conversations/:id/icebreakers",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (r) => {
      const s = await member(r);
      const m = await activeMatch(db, param(r), s.user_id);
      const partnerId = m.low_id === s.user_id ? m.high_id : m.low_id;
      const [own, partner] = await Promise.all([
        publicProfile(db, s.user_id),
        publicProfile(db, partnerId),
      ]);
      const result = await draftIcebreakers({
        partnerName: partner.display_name,
        partnerInterests: partner.interests || [],
        partnerPrompts: partner.prompts || [],
        sharedInterests: (own.interests || []).filter((i: string) =>
          (partner.interests || []).includes(i),
        ),
      });
      return ok({
        drafts: result.drafts,
        source: result.source,
        label:
          result.source === "model"
            ? `Drafted by ${aiDescriptor().model} from public prompts only. Edit before sending — nothing is sent automatically.`
            : "Template drafts (no AI model ran). Edit before sending.",
      });
    },
  );
  app.post(
    "/api/v1/me/preference-tag-drafts",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (r) => {
      await session(r);
      const b = z
        .object({
          text: z.string().min(3).max(500),
          allowExternalProcessing: z.literal(true),
        })
        .strict()
        .parse(r.body);
      const result = await interpretPreferences(b.text);
      return ok({
        tags: result.tags,
        source: result.source,
        taxonomy: TAG_TAXONOMY,
        label:
          result.source === "model"
            ? `Draft tags proposed by ${aiDescriptor().model}. Nothing changes until you confirm and save.`
            : "Keyword-matched draft tags (no AI model ran). Nothing changes until you confirm and save.",
      });
    },
  );
  app.get("/api/v1/ai/evidence", async (r) => {
    await member(r);
    return ok({ config: aiDescriptor(), runs: aiEvidence() });
  });
  app.get("/api/v1/people/:id", async (r) => {
    const s = await member(r);
    const target = param(r);
    if (!(await eligible(db, s.user_id, target)))
      return fail(404, "UNAVAILABLE", "Profile unavailable.");
    return ok(await publicProfile(db, target));
  });
  app.post("/api/v1/decisions", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Decision);
    const result = await decide(
      s.user_id,
      b.targetId,
      b.action,
      b.clientMutationId,
    );
    if (result.match)
      io.to(`user:${s.user_id}`)
        .to(`user:${b.targetId}`)
        .emit("match.created", { id: result.match.id });
    return ok(result);
  });
  app.get("/api/v1/matches", async (r) => {
    const s = await member(r);
    const matches = (
      await db.query(
        "SELECT * FROM matches WHERE (low_id=$1 OR high_id=$1) AND status='active' ORDER BY created_at DESC",
        [s.user_id],
      )
    ).rows;
    const output = [];
    for (const m of matches) {
      try {
        await activeMatch(db, m.id, s.user_id);
        output.push({
          id: m.id,
          profile: await publicProfile(
            db,
            m.low_id === s.user_id ? m.high_id : m.low_id,
          ),
        });
      } catch {
        /* Unavailable matches are omitted. */
      }
    }
    return ok(output);
  });
  app.get("/api/v1/conversations/:id/events", async (r) => {
    const s = await member(r),
      mid = param(r);
    await activeMatch(db, mid, s.user_id);
    const after = z
      .string()
      .max(16)
      .regex(/^\d+$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
      .parse((r.query as any).after);
    const rows = (
      await db.query(
        "SELECT * FROM chat_message_events WHERE conversation_id=$1 AND sequence>$2::bigint ORDER BY sequence,event_id LIMIT 100",
        [mid, after],
      )
    ).rows;
    return ok(rows.map(messageEventEnvelope));
  });
  app.get("/api/v1/conversations/:id/messages", async (r) => {
    const s = await member(r);
    const mid = param(r);
    await activeMatch(db, mid, s.user_id);
    const after = z
      .string()
      .max(16)
      .regex(/^\d+$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
      .parse((r.query as any).after);
    return ok(
      (
        await db.query(
          "SELECT * FROM messages WHERE match_id=$1 AND sequence>$2::bigint ORDER BY sequence ASC,id ASC LIMIT 100",
          [mid, after],
        )
      ).rows,
    );
  });
  app.post("/api/v1/conversations/:id/messages", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Message);
    const message = await sendMessage(
      s.user_id,
      param(r),
      b.text,
      b.clientMessageId,
      { tokenHash: s.token_hash },
    );
    await broadcastMessage(message);
    return ok(message);
  });
  async function closeMatch(user: string, mid: string) {
    return tx(async (c) => {
      const m = await activeMatch(c, mid, user, true);
      await c.query("UPDATE matches SET status='closed' WHERE id=$1", [mid]);
      const plans = (
        await c.query(
          "SELECT * FROM date_plans WHERE match_id=$1 AND status NOT IN ('cancelled','completed','expired') FOR UPDATE",
          [mid],
        )
      ).rows;
      for (const p of plans) await cancelPlan(c, p);
      io.to(`match:${mid}`).emit("access.revoked", { id: mid });
      io.in(`match:${mid}`).socketsLeave(`match:${mid}`);
      return m;
    });
  }
  app.delete("/api/v1/matches/:id", async (r) => {
    const s = await member(r);
    await closeMatch(s.user_id, param(r));
    return ok({ closed: true });
  });
  app.post("/api/v1/blocks", async (r) => {
    const s = await member(r);
    const b = body(r, z.object({ targetId: id }));
    if (b.targetId === s.user_id)
      return fail(422, "INVALID_TARGET", "Choose another member.");
    await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        [s.user_id, b.targetId].sort().join(":"),
      ]);
      await c.query(
        "INSERT INTO blocks(actor_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [s.user_id, b.targetId],
      );
      const m = await one(
        c,
        "SELECT * FROM matches WHERE low_id=LEAST($1::uuid,$2::uuid) AND high_id=GREATEST($1::uuid,$2::uuid) FOR UPDATE",
        [s.user_id, b.targetId],
      );
      if (m) {
        await c.query("UPDATE matches SET status='closed' WHERE id=$1", [m.id]);
        for (const p of (
          await c.query(
            "SELECT * FROM date_plans WHERE match_id=$1 AND status NOT IN ('completed','cancelled','expired') FOR UPDATE",
            [m.id],
          )
        ).rows)
          await cancelPlan(c, p);
        io.to(`match:${m.id}`).emit("access.revoked", { id: m.id });
        io.in(`match:${m.id}`).socketsLeave(`match:${m.id}`);
      }
      io.to(`user:${s.user_id}`)
        .to(`user:${b.targetId}`)
        .emit("access.revoked", { id: m?.id });
    });
    return ok({ blocked: true });
  });
  app.post("/api/v1/reports", async (r) => {
    const s = await member(r);
    const b = body(
      r,
      z.object({
        subjectId: id,
        category: z.enum([
          "harassment",
          "spam/scam",
          "impersonation",
          "inappropriate content",
          "underage concern",
          "other",
        ]),
        notes: z.string().max(2000),
      }),
    );
    if (s.user_id === b.subjectId)
      return fail(422, "INVALID_TARGET", "Choose another member.");
    const rid = randomUUID();
    await db.query(
      "INSERT INTO reports(id,reporter_id,subject_id,category,notes) VALUES($1,$2,$3,$4,$5)",
      [rid, s.user_id, b.subjectId, b.category, b.notes],
    );
    return ok({
      id: rid,
      message:
        "Report received. Human review is not available around the clock in this demo.",
    });
  });
  app.post("/api/v1/date-plans", async (r) => {
    const s = await member(r);
    const b = body(r, z.object({ matchId: id }));
    return tx(async (c) => {
      await activeMatch(c, b.matchId, s.user_id, true);
      const pid = randomUUID();
      const p = await one(
        c,
        "INSERT INTO date_plans(id,match_id,creator_id) VALUES($1,$2,$3) RETURNING *",
        [pid, b.matchId, s.user_id],
      );
      return ok(await planDTO(c, p, s.user_id));
    });
  });
  app.get("/api/v1/date-plans", async (r) => {
    const s = await member(r);
    const rows = (
      await db.query(
        "SELECT d.* FROM date_plans d JOIN matches m ON m.id=d.match_id WHERE m.low_id=$1 OR m.high_id=$1 ORDER BY d.created_at DESC",
        [s.user_id],
      )
    ).rows;
    const output = [];
    for (const p of rows) {
      try {
        await activeMatch(db, p.match_id, s.user_id);
        output.push(await planDTO(db, p, s.user_id));
      } catch {
        /* Financial receipts remain separately reachable. */
      }
    }
    return ok(output);
  });
  app.get("/api/v1/date-plans/:id", async (r) => {
    const s = await member(r);
    return ok(
      await planDTO(db, await planFor(db, param(r), s.user_id), s.user_id),
    );
  });
  app.put("/api/v1/date-plans/:id/private-preferences", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.PrivatePreferences);
    return tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      await savePreferences(c, p, s.user_id, b);
      return ok({ saved: true });
    });
  });
  app.post(
    "/api/v1/date-plans/:id/suggestions",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (r) => {
      const s = await member(r);
      const p = await planFor(db, param(r), s.user_id);
      const available = await options(db, p.id);
      if ((r.body as any)?.useExternalProvider === true) {
        const permission = z
          .object({
            useExternalProvider: z.literal(true),
            allowExternalProcessing: z.literal(true),
          })
          .strict()
          .parse(r.body);
        const external = await rankCatalogue(
          config.BAEPAL_INTEGRATIONS_JSON,
          available,
          permission,
        );
        return ok({
          ...external,
          label:
            "Provider-ranked fictional catalogue. Review before proposing; no reservation.",
          privacy:
            "Only eligible public catalogue entries were shared; no exact private budgets or messages.",
        });
      }
      // Only public declared interests shared by both members reach the planner.
      const pair = await one(
        db,
        "SELECT a.interests AS a, b.interests AS b FROM matches m JOIN profiles a ON a.user_id=m.low_id JOIN profiles b ON b.user_id=m.high_id WHERE m.id=$1",
        [p.match_id],
      );
      const sharedInterests: string[] = (pair?.a || []).filter((i: string) =>
        (pair?.b || []).includes(i),
      );
      const planned = await planDates({
        sharedInterests,
        eligibleOptions: available,
      });
      const ai = aiDescriptor();
      return ok({
        options: planned.ranked.map((s) => ({
          ...available.find((x) => x.id === s.id),
          reason: s.reason,
        })),
        source: planned.source,
        model: planned.source === "model" ? ai.model : null,
        label:
          planned.source === "model"
            ? `Ranked by ${ai.model} (${ai.provider}) from options that already fit both private budgets and times. Fictional demo catalogue; no real reservation.`
            : "Suggested using your preferences (deterministic fallback — no AI model ran). Fictional demo catalogue; no real reservation.",
        privacy:
          "Exact budgets are private and never sent to the AI. Suggested prices can still allow indirect inference.",
      });
    },
  );
  // AI date agent: picks from options that already fit both private budgets,
  // proposes it at the first valid slot and accepts on behalf of the member who
  // asked. The partner must still accept, and each member approves their own
  // PayPal payment; the agent never spends without that approval.
  app.post(
    "/api/v1/date-plans/:id/agent-book",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (r) => {
      const s = await member(r);
      const p0 = await planFor(db, param(r), s.user_id);
      const available = await options(db, p0.id);
      if (!available.length)
        return fail(
          409,
          "NO_SHARED_OPTION",
          "Nothing fits both private budgets and times right now. Try widening your window.",
        );
      const pair = await one(
        db,
        "SELECT a.interests AS a, b.interests AS b FROM matches m JOIN profiles a ON a.user_id=m.low_id JOIN profiles b ON b.user_id=m.high_id WHERE m.id=$1",
        [p0.match_id],
      );
      const sharedInterests: string[] = (pair?.a || []).filter((i: string) =>
        (pair?.b || []).includes(i),
      );
      const planned = await planDates({ sharedInterests, eligibleOptions: available });
      const pick = planned.ranked
        .map((x) => ({ ...available.find((o) => o.id === x.id)!, reason: x.reason }))
        .find((x) => x.id);
      if (!pick) return fail(409, "NO_SHARED_OPTION", "No option could be chosen.");
      const step = 30 * 60000;
      const startMs = firstFittingSlot(
        pick,
        Math.ceil(
          Math.max(new Date(pick.earliestStart).getTime(), Date.now() + 10 * 60000) / step,
        ) * step,
        new Date(pick.latestEnd).getTime(),
      );
      if (startMs === null)
        return fail(409, "NO_SHARED_OPTION", "No time slot fits both windows and opening hours.");
      const startsAt = new Date(startMs).toISOString();
      const pass = await one(
        db,
        "SELECT 1 FROM entitlements WHERE user_id=$1 AND product='planning_pass' AND state='active'",
        [s.user_id],
      );
      const alternatives = pass
        ? planned.ranked
            .filter((x) => x.id !== pick.id)
            .slice(0, 3)
            .map((x) => {
              const o = available.find((a) => a.id === x.id)!;
              return { id: o.id, title: o.title, price_cents: o.price_cents, reason: x.reason };
            })
        : null;
      const result = await tx(async (c) => {
        const p = await planFor(c, param(r), s.user_id, true);
        if (p.version !== p0.version)
          return fail(409, "VERSION_CONFLICT", "This plan changed. Refresh and try again.");
        assertPlanningOpen(p);
        if (
          (
            await c.query(
              "SELECT 1 FROM payments pay JOIN purchases u ON u.id=pay.purchase_id WHERE u.plan_id=$1",
              [p.id],
            )
          ).rowCount
        )
          return fail(409, "PAYMENT_EXISTS", "Cancel the existing plan before changing a checkout.");
        const version = p.version + 1;
        await c.query(
          "INSERT INTO proposals(plan_id,version,catalogue_id,starts_at,snapshot) VALUES($1,$2,$3,$4,$5)",
          [p.id, version, pick.id, startsAt, JSON.stringify(catalogueSnapshot(pick))],
        );
        await c.query("UPDATE date_plans SET version=$2,status='proposed' WHERE id=$1", [
          p.id,
          version,
        ]);
        await c.query("INSERT INTO acceptances VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
          p.id,
          version,
          s.user_id,
        ]);
        await notify(
          c,
          (await matchMembers(c, p.match_id)).filter((u) => u !== s.user_id),
          `proposal:${p.id}:${version}`,
          "date.proposed",
          p.match_id,
        );
        const ai = aiDescriptor();
        return ok({
          version,
          option: { id: pick.id, title: pick.title, price_cents: pick.price_cents },
          startsAt,
          reason: pick.reason,
          alternatives,
          source: planned.source,
          model: planned.source === "model" ? ai.model : null,
          steps: [
            `Filtered ${available.length} option(s) that fit both private budgets and time windows.`,
            planned.source === "model"
              ? `${ai.model} ranked them using only shared public interests.`
              : "Ranked deterministically (no AI model configured).",
            `Proposed "${pick.title}" and accepted it for you.`,
            "Waiting for your match to accept. Then each of you approves your own PayPal ticket.",
          ],
        });
      });
      await releaseStaleHolds(param(r)).catch((e) => r.log.warn(e, "hold release deferred"));
      return result;
    },
  );
  app.post("/api/v1/date-plans/:id/proposals", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Proposal);
    const result = await tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      if (p.version !== b.expectedVersion)
        return fail(
          409,
          "VERSION_CONFLICT",
          "This plan changed. Refresh and try again.",
        );
      assertPlanningOpen(p);
      if (
        (
          await c.query(
            "SELECT 1 FROM payments pay JOIN purchases u ON u.id=pay.purchase_id WHERE u.plan_id=$1",
            [p.id],
          )
        ).rowCount
      )
        return fail(
          409,
          "PAYMENT_EXISTS",
          "Cancel the existing plan before changing a checkout.",
        );
      const available = await options(c, p.id);
      const x = available.find((o) => o.id === b.optionId);
      const start = new Date(b.startsAt).getTime();
      if (
        !x ||
        start < new Date(x.earliestStart).getTime() ||
        start + x.duration_minutes * 60000 > new Date(x.latestEnd).getTime() ||
        start < Date.now()
      )
        return fail(
          422,
          "OPTION_UNAVAILABLE",
          "Choose an eligible time and experience.",
        );
      if (!fitsHours(x, start))
        return fail(
          422,
          "OUTSIDE_OPENING_HOURS",
          "That time is outside the venue's opening hours (Seattle time).",
        );
      const version = p.version + 1;
      await c.query(
        "INSERT INTO proposals(plan_id,version,catalogue_id,starts_at,snapshot) VALUES($1,$2,$3,$4,$5)",
        [p.id, version, x.id, b.startsAt, JSON.stringify(catalogueSnapshot(x))],
      );
      await c.query(
        "UPDATE date_plans SET version=$2,status='proposed' WHERE id=$1",
        [p.id, version],
      );
      await notify(
        c,
        (await matchMembers(c, p.match_id)).filter((u) => u !== s.user_id),
        `proposal:${p.id}:${version}`,
        "date.proposed",
        p.match_id,
      );
      return ok({ version });
    });
    await releaseStaleHolds(param(r)).catch((e) => r.log.warn(e, "hold release deferred"));
    return result;
  });
  app.post("/api/v1/date-plans/:id/accept", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Acceptance);
    return tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      if (
        p.version !== b.proposalVersion ||
        !["proposed", "accepted"].includes(p.status) ||
        new Date(p.expires_at).getTime() < Date.now()
      )
        return fail(
          409,
          "VERSION_CONFLICT",
          "Accept only the current unexpired proposal.",
        );
      const proposal = await one(
        c,
        "SELECT * FROM proposals WHERE plan_id=$1 AND version=$2",
        [p.id, p.version],
      );
      if (!proposal)
        return fail(409, "NO_PROPOSAL", "Choose a proposal first.");
      await c.query(
        "INSERT INTO acceptances VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [p.id, p.version, s.user_id],
      );
      const count = await one(
        c,
        "SELECT count(*)::int AS n FROM acceptances WHERE plan_id=$1 AND version=$2",
        [p.id, p.version],
      );
      if (count.n === 2) {
        await c.query(
          "UPDATE date_plans SET status=$2,financial_state=$3 WHERE id=$1",
          [
            p.id,
            proposal.snapshot.price_cents === 0 ? "confirmed" : "accepted",
            proposal.snapshot.price_cents === 0 ? "free" : "unpaid",
          ],
        );
        if (proposal.snapshot.price_cents === 0)
          await notify(
            c,
            await matchMembers(c, p.match_id),
            `confirmed:${p.id}:${p.version}`,
            "date.confirmed",
            p.match_id,
          );
      }
      return ok({ accepted: true });
    });
  });
  app.post("/api/v1/date-plans/:id/cancel", async (r) => {
    const s = await member(r);
    const result = await tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      const b = body(r, z.object({ expectedVersion: z.number().int() }));
      if (p.version !== b.expectedVersion)
        return fail(409, "VERSION_CONFLICT", "Plan changed. Refresh first.");
      if (p.status === "completed")
        return fail(
          409,
          "PLAN_CLOSED",
          "A completed plan cannot be cancelled.",
        );
      await cancelPlan(c, p);
      return ok({
        cancelled: true,
        message: "Refunds, if applicable, are reconciled separately.",
      });
    });
    await releaseStaleHolds(param(r)).catch((e) => r.log.warn(e, "hold release deferred"));
    return result;
  });
  app.get("/api/v1/date-plans/:id/deposit", async (r) => {
    const s = await member(r);
    return ok(await depositStatus(param(r), s.user_id));
  });
  app.post(
    "/api/v1/date-plans/:id/deposit",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (r) => {
      const s = await member(r);
      return ok(await createHold(s.user_id, param(r)));
    },
  );
  app.post("/api/v1/date-plans/:id/deposit/authorize", async (r) => {
    const s = await member(r);
    return ok(await authorizeHold(s.user_id, param(r)));
  });
  app.post("/api/v1/date-plans/:id/check-in", async (r) => {
    const s = await member(r);
    return ok(await checkIn(s.user_id, param(r)));
  });
  app.post(
    "/api/v1/date-plans/:id/no-show",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (r) => {
      const s = await member(r);
      const b = body(
        r,
        z.object({ payoutEmail: z.string().email().max(254).optional() }).strict(),
      );
      return ok(await claimNoShow(s.user_id, param(r), b.payoutEmail));
    },
  );
  app.post("/api/v1/purchases", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Purchase);
    return tx(async (c) => {
      const p = await planFor(c, b.planId, s.user_id, true);
      if (
        p.version !== b.proposalVersion ||
        !["accepted", "payment_pending", "confirmed"].includes(p.status) ||
        new Date(p.expires_at).getTime() < Date.now()
      )
        return fail(
          409,
          "CONSENT_REQUIRED",
          "Both members must accept this version first.",
        );
      const count = await one(
        c,
        "SELECT count(*)::int AS n FROM acceptances WHERE plan_id=$1 AND version=$2",
        [p.id, p.version],
      );
      if (count.n !== 2)
        return fail(
          409,
          "CONSENT_REQUIRED",
          "Both members must accept this version first.",
        );
      const proposal = await one(
        c,
        "SELECT * FROM proposals WHERE plan_id=$1 AND version=$2",
        [p.id, p.version],
      );
      if (proposal.snapshot.price_cents <= 0)
        return fail(422, "FREE_PLAN", "Free ideas do not need checkout.");
      const purchase = await one(
        c,
        "INSERT INTO purchases(id,plan_id,version,buyer_id,amount_cents,snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(plan_id,version,buyer_id) DO UPDATE SET buyer_id=EXCLUDED.buyer_id RETURNING *",
        [
          randomUUID(),
          p.id,
          p.version,
          s.user_id,
          proposal.snapshot.price_cents,
          proposal.snapshot,
        ],
      );
      const payment = await one(
        c,
        "INSERT INTO payments(id,purchase_id,mode) VALUES($1,$2,$3) ON CONFLICT(purchase_id) DO UPDATE SET purchase_id=EXCLUDED.purchase_id RETURNING *",
        [randomUUID(), purchase.id, config.PAYPAL_MODE],
      );
      return ok({ purchaseId: purchase.id, paymentId: payment.id });
    });
  });
  app.get("/api/v1/purchases/:id", async (r) => {
    const s = await session(r);
    const p = await one(
      db,
      "SELECT u.id,u.plan_id,u.version,u.amount_cents,u.currency,u.snapshot,u.state,p.id AS payment_id FROM purchases u JOIN payments p ON p.purchase_id=u.id WHERE u.id=$1 AND u.buyer_id=$2",
      [param(r), s.user_id],
    );
    if (!p) return fail(404, "UNAVAILABLE", "Purchase unavailable.");
    return ok(
      purchaseResponse({
        ...p,
        payment: await ownPayment(s.user_id, p.payment_id),
      }),
    );
  });
  app.post("/api/v1/payments/orders", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Order);
    return ok(await createOrder(s.user_id, b.paymentId));
  });
  app.post("/api/v1/payments/:id/capture", async (r) => {
    const s = await member(r);
    return ok(await captureOrder(s.user_id, param(r)));
  });
  app.get("/api/v1/payments", async (r) => {
    const s = await session(r);
    return ok(
      paymentSummariesResponse(
        (
          await db.query(
            "SELECT p.id,p.state,p.mode,u.amount_cents,u.currency,u.snapshot FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE u.buyer_id=$1 ORDER BY p.created_at DESC",
            [s.user_id],
          )
        ).rows,
      ),
    );
  });
  app.get("/api/v1/payments/:id", async (r) => {
    const s = await session(r);
    return ok(await ownPayment(s.user_id, param(r)));
  });
  app.post("/api/v1/webhooks/paypal", async (r, reply) => {
    if (
      config.PAYPAL_MODE !== "sandbox" ||
      !(await provider.verifyWebhook(r.headers, r.body))
    )
      return fail(403, "INVALID_SIGNATURE", "Webhook could not be verified.");
    const b = body(
      r,
      z.object({
        id: z.string().max(200),
        event_type: z.string(),
        resource: z.record(z.string(), z.unknown()),
      }),
    );
    await db.query(
      "INSERT INTO webhook_inbox(event_id,mode,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [b.id, "sandbox", JSON.stringify(b)],
    );
    return reply.code(202).send(ok({ received: true }));
  });
  app.post("/api/v1/me/pause", async (r) => {
    const s = await member(r);
    await db.query(
      "UPDATE users SET status='paused' WHERE id=$1 AND status='active'",
      [s.user_id],
    );
    return ok({ paused: true });
  });
  app.post("/api/v1/me/resume", async (r) => {
    const s = await member(r);
    await db.query(
      "UPDATE users SET status='active' WHERE id=$1 AND status='paused'",
      [s.user_id],
    );
    return ok({ resumed: true });
  });
  async function reauth(r: FastifyRequest) {
    const s = await session(r);
    const b = body(r, z.object({ password: z.string().max(128) }));
    const u = await one(db, "SELECT password_hash FROM users WHERE id=$1", [
      s.user_id,
    ]);
    if (!(await argon2.verify(u.password_hash, b.password)))
      return fail(403, "REAUTH_REQUIRED", "Enter your current password.");
    return s;
  }
  app.post("/api/v1/me/export", async (r, reply) => {
    const s = await reauth(r);
    const profile = await publicProfile(db, s.user_id);
    const privateProfile = await one(
      db,
      "SELECT birth_date,gender,genders,age_min,age_max FROM profile_private WHERE user_id=$1",
      [s.user_id],
    );
    const ownMessages = (
      await db.query(
        "SELECT id,match_id,sequence,text,created_at FROM messages WHERE sender_id=$1",
        [s.user_id],
      )
    ).rows;
    const payments = (
      await db.query(
        "SELECT p.id,p.state,p.mode,p.order_id,p.capture_id,u.amount_cents,u.currency FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE u.buyer_id=$1",
        [s.user_id],
      )
    ).rows;
    const rows = async (sql: string) =>
      (await db.query(sql, [s.user_id])).rows;
    const datePreferences = (
      await rows(
        "SELECT plan_id,budget_encrypted,activities,time_start,time_end FROM private_date_preferences WHERE user_id=$1",
      )
    ).map(({ budget_encrypted, ...p }) => ({
      ...p,
      budgetCents: Number(decrypt(budget_encrypted)),
    }));
    return reply.header("Cache-Control", "no-store").send(
      ok({
        exportedAt: new Date().toISOString(),
        profile,
        privateProfile,
        ownMessages,
        decisions: await rows(
          "SELECT target_id,action FROM decisions WHERE actor_id=$1",
        ),
        blocks: await rows(
          "SELECT target_id,created_at FROM blocks WHERE actor_id=$1",
        ),
        reportsFiled: await rows(
          "SELECT id,category,state,created_at FROM reports WHERE reporter_id=$1",
        ),
        datePlans: await rows(
          "SELECT d.id,d.match_id,d.status,d.financial_state,d.version,d.created_at FROM date_plans d JOIN matches m ON m.id=d.match_id WHERE m.low_id=$1 OR m.high_id=$1",
        ),
        datePreferences,
        purchases: await rows(
          "SELECT id,plan_id,version,amount_cents,currency,state FROM purchases WHERE buyer_id=$1",
        ),
        payments,
        refunds: await rows(
          "SELECT r.id,r.payment_id,r.amount_cents,r.state FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN purchases u ON u.id=p.purchase_id WHERE u.buyer_id=$1",
        ),
        notifications: await rows(
          "SELECT category,read_at,created_at FROM notifications WHERE user_id=$1",
        ),
        settings: await rows(
          "SELECT read_receipts,typing_indicators,email_updates,updated_at FROM member_settings WHERE user_id=$1",
        ),
        sessions: await rows(
          "SELECT id,device,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=$1",
        ),
        paypalIdentity: await rows(
          "SELECT verified,mode,linked_at FROM paypal_identities WHERE user_id=$1",
        ),
        connections: await rows(
          "SELECT provider,label,visible,linked_at FROM connections WHERE user_id=$1",
        ),
        appeals: await rows(
          "SELECT id,state,text,created_at FROM appeals WHERE user_id=$1",
        ),
        sentComments: await rows(
          "SELECT kind,position,snapshot,text,created_at FROM like_comments WHERE actor_id=$1",
        ),
        hiddenContacts: (
          await rows("SELECT count(*)::int AS n FROM contact_hides WHERE user_id=$1")
        )[0]?.n,
        entitlements: await rows(
          "SELECT id,product,amount_cents,state,created_at FROM entitlements WHERE user_id=$1",
        ),
        deposits: await rows(
          "SELECT id,plan_id,amount_cents,state,checked_in_at,created_at FROM date_deposits WHERE user_id=$1",
        ),
        note: "Includes only data you created or that is about your own account. Partner private inputs (budgets, availability), partner messages, session tokens and moderation notes are excluded.",
      }),
    );
  });
  app.delete("/api/v1/me", async (r, reply) => {
    const s = await reauth(r);
    await tx(async (c) => {
      for (const p of (
        await c.query(
          "SELECT d.* FROM date_plans d JOIN matches m ON m.id=d.match_id WHERE (m.low_id=$1 OR m.high_id=$1) AND d.status NOT IN ('completed','cancelled','expired') FOR UPDATE OF d",
          [s.user_id],
        )
      ).rows)
        await cancelPlan(c, p);
      await c.query(
        "UPDATE users SET status='deleted',email=$2,password_hash='' WHERE id=$1",
        [s.user_id, `${s.user_id}@deleted.invalid`],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [s.user_id]);
      await c.query("DELETE FROM media WHERE owner_id=$1", [s.user_id]);
      await c.query(
        "UPDATE profiles SET display_name='Deleted member',bio='',photos='{}',prompts='[]',interests='{}' WHERE user_id=$1",
        [s.user_id],
      );
      await c.query(
        "UPDATE profile_private SET birth_date=NULL,gender=NULL,genders='{}' WHERE user_id=$1",
        [s.user_id],
      );
      await c.query("DELETE FROM private_date_preferences WHERE user_id=$1", [
        s.user_id,
      ]);
      await c.query(
        "DELETE FROM decisions WHERE actor_id=$1 OR target_id=$1",
        [s.user_id],
      );
      await c.query("DELETE FROM notifications WHERE user_id=$1", [
        s.user_id,
      ]);
      for (const table of [
        "paypal_identities",
        "email_outbox",
        "member_settings",
        "read_watermarks",
        "connections",
        "contact_hides",
      ])
        await c.query(`DELETE FROM ${table} WHERE user_id=$1`, [s.user_id]);
      await c.query(
        "DELETE FROM like_comments WHERE actor_id=$1 OR target_id=$1",
        [s.user_id],
      );
      await c.query("UPDATE messages SET text='[deleted]' WHERE sender_id=$1", [
        s.user_id,
      ]);
      await c.query(
        "UPDATE matches SET status='closed' WHERE low_id=$1 OR high_id=$1",
        [s.user_id],
      );
    });
    io.to(`user:${s.user_id}`).emit("access.revoked", {});
    io.in(`user:${s.user_id}`).disconnectSockets(true);
    reply.clearCookie("baepal", { path: "/" });
    return ok({
      deleted: true,
      note: "Financial records retained separately for this local demo until the database volume is removed.",
    });
  });
  app.get("/api/v1/admin/reports", async (r) => {
    const s = await session(r);
    if (!["admin", "moderator"].includes(s.role))
      return fail(403, "ROLE_REQUIRED", "Moderator access required.");
    // Minimal evidence only: the reporter stays anonymous, and budgets,
    // messages and payment details are never joined in.
    return ok(
      (
        await db.query(
          `SELECT r.id,r.category,r.notes,r.state,r.action,r.version,r.created_at,
             r.subject_id,p.display_name AS subject_name,u.status AS subject_status,
             (SELECT count(*)::int FROM reports o WHERE o.subject_id=r.subject_id) AS subject_report_count
           FROM reports r JOIN users u ON u.id=r.subject_id LEFT JOIN profiles p ON p.user_id=r.subject_id
           ORDER BY (r.state='open') DESC, r.created_at DESC LIMIT 100`,
        )
      ).rows,
    );
  });
  app.patch("/api/v1/admin/reports/:id", async (r) => {
    const s = await session(r);
    if (!["admin", "moderator"].includes(s.role))
      return fail(403, "ROLE_REQUIRED", "Moderator access required.");
    const b = body(
      r,
      z
        .object({
          action: z
            .enum(["dismiss", "warn", "suspend", "restore", "escalate"])
            .optional(),
          state: z.enum(["reviewed", "dismissed"]).optional(),
          reason: z.string().min(5).max(1000),
          expectedVersion: z.number().int().min(0).optional(),
          password: z.string().max(128).optional(),
        })
        .refine((x) => x.action || x.state, "Choose a moderation action."),
    );
    const action = b.action ?? (b.state === "dismissed" ? "dismiss" : null);
    // Account-level actions need the moderator's password again (step-up).
    if (["suspend", "restore"].includes(action ?? "")) {
      const staff = await one(db, "SELECT password_hash FROM users WHERE id=$1", [
        s.user_id,
      ]);
      if (!b.password || !(await argon2.verify(staff.password_hash, b.password)))
        return fail(
          403,
          "REAUTH_REQUIRED",
          "Confirm your password to suspend or restore an account.",
        );
    }
    const subject = await tx(async (c) => {
      const report = await one(
        c,
        "SELECT * FROM reports WHERE id=$1 FOR UPDATE",
        [param(r)],
      );
      if (!report) return fail(404, "NOT_FOUND", "Report not found.");
      if (
        b.expectedVersion !== undefined &&
        report.version !== b.expectedVersion
      )
        return fail(
          409,
          "VERSION_CONFLICT",
          "Another moderator updated this report. Refresh first.",
        );
      const target = await one(
        c,
        "SELECT id,role,status FROM users WHERE id=$1 FOR UPDATE",
        [report.subject_id],
      );
      if (
        ["suspend", "restore"].includes(action ?? "") &&
        target.role !== "member"
      )
        return fail(
          403,
          "ROLE_REQUIRED",
          "Staff accounts are managed outside the report queue.",
        );
      if (action === "suspend") {
        await c.query(
          "UPDATE users SET status='suspended' WHERE id=$1 AND status IN ('active','paused','onboarding')",
          [target.id],
        );
        await c.query("DELETE FROM sessions WHERE user_id=$1", [target.id]);
      } else if (action === "restore")
        await c.query(
          "UPDATE users SET status='active' WHERE id=$1 AND status='suspended'",
          [target.id],
        );
      else if (action === "warn")
        await notify(
          c,
          [target.id],
          `warning:${report.id}:${report.version + 1}`,
          "account.warning",
          null,
        );
      const state =
        action === "dismiss"
          ? "dismissed"
          : action === "escalate"
            ? "open"
            : "reviewed";
      await c.query(
        "UPDATE reports SET state=$2,action=$3,version=version+1,updated_at=now() WHERE id=$1",
        [report.id, state, action],
      );
      await c.query(
        "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          s.user_id,
          `report.${action ?? state}`,
          report.id,
          b.reason,
        ],
      );
      return action === "suspend" ? target.id : null;
    });
    if (subject) {
      io.to(`user:${subject}`).emit("access.revoked", {});
      io.in(`user:${subject}`).disconnectSockets(true);
    }
    return ok({ updated: true });
  });
  // Reporters see neutral progress only, never the action taken.
  app.get("/api/v1/reports", async (r) => {
    const s = await member(r);
    return ok(
      (
        await db.query(
          "SELECT id,category,created_at,CASE WHEN state='open' THEN 'received' ELSE 'closed' END AS progress FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT 50",
          [s.user_id],
        )
      ).rows,
    );
  });
  registerExtraRoutes(app, { io, session, member });
  io.use(async (socket, next) => {
    try {
      const raw = app.parseCookie(socket.request.headers.cookie || "").baepal;
      const s = await authenticate(raw);
      if (!["active", "paused"].includes(s.status)) throw Error();
      socket.data.sessionToken = raw;
      socket.data.userId = s.user_id;
      socket.join(`user:${s.user_id}`);
      socket.join(`session:${s.token_hash}`);
      next();
    } catch {
      next(new Error("Session unavailable"));
    }
  });
  // Socket event data can occupy the optional callback position. Only invoke
  // actual acknowledgement functions; transport failures must not reject an
  // async listener after a message has already been persisted.
  const acknowledgeSocket = (callback: unknown, response: unknown) => {
    if (typeof callback !== "function") return;
    try {
      callback(response);
    } catch {
      // Keep persistence independent of acknowledgement delivery. A retry uses
      // the original clientMessageId and returns the existing saved message.
    }
  };
  io.on("connection", (socket) => {
    socket.on("conversation.subscribe", async (mid, ack) => {
      let room: string | undefined;
      try {
        const conversationId = id.parse(mid);
        room = `match:${conversationId}`;
        const s = await authenticate(socket.data.sessionToken);
        await activeMatch(db, conversationId, s.user_id);
        await socket.join(room);
        const fresh = await authenticate(socket.data.sessionToken);
        await activeMatch(db, conversationId, fresh.user_id);
        acknowledgeSocket(ack, { ok: true });
      } catch {
        if (room) {
          try {
            await socket.leave(room);
          } catch {
            /* Delivery still reauthorizes every recipient. */
          }
        }
        acknowledgeSocket(ack, { error: "Conversation unavailable" });
      }
    });
    socket.on("message.send", async (input, ack) => {
      try {
        const s = await authenticate(socket.data.sessionToken);
        const b = z
          .object({
            conversationId: id,
            text: z.string().trim().min(1).max(2000),
            clientMessageId: id,
          })
          .parse(input);
        const m = await sendMessage(
          s.user_id,
          b.conversationId,
          b.text,
          b.clientMessageId,
          { tokenHash: s.token_hash },
        );
        await broadcastMessage(m);
        acknowledgeSocket(ack, { data: m });
      } catch {
        acknowledgeSocket(ack, { error: "Message could not be sent" });
      }
    });
  });
  app.addHook("preClose", async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return { app, io };
}
