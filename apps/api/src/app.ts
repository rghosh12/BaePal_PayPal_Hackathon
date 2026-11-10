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
import { config } from "./config.js";
import { hash, keyed, token, equal, ageOn } from "./crypto.js";
import {
  AppError,
  fail,
  activeMatch,
  planFor,
  publicProfile,
  eligible,
  decide,
  sendMessage,
  planDTO,
  options,
  savePreferences,
  cancelPlan,
} from "./domain.js";
import { createOrder, captureOrder, ownPayment } from "./payments.js";
import { provider } from "./providers/paypal.js";
import { DeterministicPlanner } from "./providers/ai.js";
import { Contracts, openapi } from "./contracts.js";
const id = z.string().uuid();
const body = (r: FastifyRequest, s: z.ZodType<any>) => s.parse(r.body);
const param = (r: FastifyRequest, key = "id") =>
  id.parse((r.params as any)[key]);
const ok = (data: any) => ({ data });
export async function authenticate(raw: string | undefined) {
  if (!raw) return fail(401, "SESSION_EXPIRED", "Please log in to continue.");
  const s = await one(
    db,
    "SELECT s.*,u.status,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.status NOT IN ('deleted','suspended')",
    [hash(raw)],
  );
  if (!s) return fail(401, "SESSION_EXPIRED", "Please log in to continue.");
  return s;
}
export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 15 * 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
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
    for (const recipient of await io
      .in(`match:${message.match_id}`)
      .fetchSockets()) {
      try {
        const current = await authenticate(recipient.data.sessionToken);
        await activeMatch(db, message.match_id, current.user_id);
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
  async function setSession(reply: any, user: string) {
    const raw = token();
    const csrf = token();
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [hash(raw), user, csrf],
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
        const s = await session(r);
        if (!equal(String(r.headers["x-csrf-token"] || ""), s.csrf))
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
  app.get("/api/v1/openapi.json", async () => openapi);
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
      emailMode: "local",
      aiMode: "deterministic",
      connections: { linkedin: "unavailable", github: "unavailable" },
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
      const csrf = await setSession(reply, uid);
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
      const u = await one(db, "SELECT * FROM users WHERE email=$1", [
        b.email.toLowerCase().trim(),
      ]);
      const valid = await argon2.verify(
        u?.password_hash || (await argon2.hash("invalid-password-placeholder")),
        b.password,
      );
      if (!u || !valid || ["suspended", "deleted"].includes(u.status))
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect, or this account is unavailable.",
        );
      if (r.cookies.baepal)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(r.cookies.baepal),
        ]);
      const csrf = await setSession(reply, u.id);
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
      if (u) {
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
      const item = await one(
        c,
        "SELECT * FROM challenges WHERE id=$1 AND purpose='reset' FOR UPDATE",
        [b.challengeId],
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
      for (const photo of b.photos) {
        const mid = photo.match(/^\/api\/v1\/media\/([a-f0-9-]{36})$/)?.[1];
        if (mid) {
          if (
            !(
              await c.query("SELECT 1 FROM media WHERE id=$1 AND owner_id=$2", [
                mid,
                s.user_id,
              ])
            ).rowCount
          )
            return fail(422, "INVALID_PHOTO", "Photo unavailable.");
        } else if (!(
          config.DEMO_MODE === "true" && /^\/portraits\/[0-5]\.svg$/.test(photo)
        ))
          return fail(
            422,
            "INVALID_PHOTO",
            "Use an uploaded photo or labeled demo illustration.",
          );
      }
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
    const mid = randomUUID();
    await db.query("INSERT INTO media(id,owner_id,bytes) VALUES($1,$2,$3)", [
      mid,
      s.user_id,
      bytes,
    ]);
    return ok({
      url: `/api/v1/media/${mid}`,
      moderation:
        "Development only: technical validation, no content moderation provider.",
    });
  });
  app.get("/api/v1/media/:id", async (r, reply) => {
    const s = await session(r);
    const media = await one(db, "SELECT * FROM media WHERE id=$1", [param(r)]);
    if (!media) return fail(404, "UNAVAILABLE", "Image unavailable.");
    if (media.owner_id !== s.user_id) {
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
  app.get("/api/v1/discover", async (r) => {
    const s = await member(r);
    const ids = (
      await db.query(
        "SELECT user_id FROM profiles WHERE user_id<>$1 ORDER BY user_id",
        [s.user_id],
      )
    ).rows;
    const cards = [];
    for (const x of ids) {
      if (cards.length >= 30) break;
      if (
        (await eligible(db, s.user_id, x.user_id)) &&
        !(
          await db.query(
            "SELECT 1 FROM decisions WHERE actor_id=$1 AND target_id=$2",
            [s.user_id, x.user_id],
          )
        ).rowCount
      )
        cards.push(await publicProfile(db, x.user_id));
    }
    const own = await publicProfile(db, s.user_id);
    cards.sort(
      (a, b) =>
        b.interests.filter((i: string) => own.interests.includes(i)).length -
          a.interests.filter((i: string) => own.interests.includes(i)).length ||
        a.user_id.localeCompare(b.user_id),
    );
    return ok(cards);
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
  app.get("/api/v1/conversations/:id/messages", async (r) => {
    const s = await member(r);
    const mid = param(r);
    await activeMatch(db, mid, s.user_id);
    const after = z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .parse((r.query as any).after);
    return ok(
      (
        await db.query(
          "SELECT * FROM messages WHERE match_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100",
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
    { config: { rateLimit: { max: 6, timeWindow: "1 hour" } } },
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
      const ranked = await new DeterministicPlanner().suggestDates({
        publicInterests: [],
        eligibleOptions: available,
      });
      return ok({
        options: ranked.map((s) => ({
          ...available.find((x) => x.id === s.id),
          reason: s.reason,
        })),
        label:
          "Suggested using your preferences. Fictional demo catalogue; no real reservation.",
        privacy:
          "Exact budgets are private. Suggested prices can still allow indirect inference.",
      });
    },
  );
  app.post("/api/v1/date-plans/:id/proposals", async (r) => {
    const s = await member(r);
    const b = body(r, Contracts.Proposal);
    return tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      if (p.version !== b.expectedVersion)
        return fail(
          409,
          "VERSION_CONFLICT",
          "This plan changed. Refresh and try again.",
        );
      if (["cancelled", "expired", "completed"].includes(p.status))
        return fail(409, "PLAN_CLOSED", "This plan is closed.");
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
      const version = p.version + 1;
      await c.query(
        "INSERT INTO proposals(plan_id,version,catalogue_id,starts_at,snapshot) VALUES($1,$2,$3,$4,$5)",
        [p.id, version, x.id, b.startsAt, JSON.stringify(x)],
      );
      await c.query(
        "UPDATE date_plans SET version=$2,status='proposed' WHERE id=$1",
        [p.id, version],
      );
      return ok({ version });
    });
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
      if (count.n === 2)
        await c.query(
          "UPDATE date_plans SET status=$2,financial_state=$3 WHERE id=$1",
          [
            p.id,
            proposal.snapshot.price_cents === 0 ? "confirmed" : "accepted",
            proposal.snapshot.price_cents === 0 ? "free" : "unpaid",
          ],
        );
      return ok({ accepted: true });
    });
  });
  app.post("/api/v1/date-plans/:id/cancel", async (r) => {
    const s = await member(r);
    return tx(async (c) => {
      const p = await planFor(c, param(r), s.user_id, true);
      const b = body(r, z.object({ expectedVersion: z.number().int() }));
      if (p.version !== b.expectedVersion)
        return fail(409, "VERSION_CONFLICT", "Plan changed. Refresh first.");
      await cancelPlan(c, p);
      return ok({
        cancelled: true,
        message: "Refunds, if applicable, are reconciled separately.",
      });
    });
  });
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
      "SELECT u.*,p.id AS payment_id FROM purchases u JOIN payments p ON p.purchase_id=u.id WHERE u.id=$1 AND u.buyer_id=$2",
      [param(r), s.user_id],
    );
    if (!p) return fail(404, "UNAVAILABLE", "Purchase unavailable.");
    return ok({ ...p, payment: await ownPayment(s.user_id, p.payment_id) });
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
      (
        await db.query(
          "SELECT p.id,p.state,p.mode,u.amount_cents,u.currency,u.snapshot FROM payments p JOIN purchases u ON u.id=p.purchase_id WHERE u.buyer_id=$1 ORDER BY p.created_at DESC",
          [s.user_id],
        )
      ).rows,
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
    return reply.header("Cache-Control", "no-store").send(
      ok({
        profile,
        privateProfile,
        ownMessages,
        payments,
        note: "Synchronous local export, includes only your messages; no partner private inputs.",
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
    return ok(
      (
        await db.query(
          "SELECT id,category,state,created_at FROM reports ORDER BY created_at DESC LIMIT 100",
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
      z.object({
        state: z.enum(["reviewed", "dismissed"]),
        reason: z.string().min(5).max(1000),
      }),
    );
    await tx(async (c) => {
      await c.query("UPDATE reports SET state=$2 WHERE id=$1", [
        param(r),
        b.state,
      ]);
      await c.query(
        "INSERT INTO audit_log(id,actor_id,action,resource_id,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), s.user_id, `report.${b.state}`, param(r), b.reason],
      );
    });
    return ok({ updated: true });
  });
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
  io.on("connection", (socket) => {
    socket.on("conversation.subscribe", async (mid, ack) => {
      try {
        const s = await authenticate(socket.data.sessionToken);
        await activeMatch(db, id.parse(mid), s.user_id);
        await socket.join(`match:${mid}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: "Conversation unavailable" });
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
        );
        await broadcastMessage(m);
        ack?.({ data: m });
      } catch {
        ack?.({ error: "Message could not be sent" });
      }
    });
  });
  app.addHook("preClose", async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return { app, io };
}
