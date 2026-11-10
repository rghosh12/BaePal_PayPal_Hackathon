import { z } from "zod";
import type { Env, State, Row } from "./types";
import {
  load,
  mutate,
  uuid,
  now,
  profile,
  age,
  catalogue,
  digest,
} from "./store";
import {
  tasteFor,
  tasteCapabilities,
  saveConsent,
  revokeTaste,
  importDemo,
  evidenceDTO,
  correctEvidence,
  rebuildTaste,
  ownTasteProfile,
  setSharing,
  compareTaste,
  AuthorizedPayPalHistoryProvider,
} from "./taste";
const id = z.string().uuid();
const fail = (status: number, code: string, message: string): never => {
  throw Object.assign(Error(message), { status, code });
};
const json = (
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(
    { data },
    { status, headers: { "Cache-Control": "no-store", ...extra } },
  );
const schemaProfile = z
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
          question: z.string().max(100),
          answer: z.string().max(250),
        }),
      )
      .length(2),
    photos: z.array(z.string().regex(/^\/portraits\/[0-5]\.svg$/)).max(6),
    publish: z.boolean(),
  })
  .refine((x) => x.ageMax >= x.ageMin, {
    message: "Choose a valid age range.",
  });
function userFor(s: State, uid: string | null) {
  const u = s.users.find(
    (x) => x.id === uid && !["deleted", "suspended"].includes(x.status),
  );
  if (!u)
    return fail(
      401,
      "SESSION_EXPIRED",
      "Choose a demo persona or create your prototype profile.",
    );
  return u;
}
function member(s: State, uid: string | null) {
  const u = userFor(s, uid);
  if (!["active", "paused"].includes(u.status))
    return fail(403, "ONBOARDING_REQUIRED", "Complete your profile first.");
  return u;
}
function blocked(s: State, a: string, b: string) {
  return s.decisions.some(
    (d) =>
      d.action === "block" &&
      ((d.actor === a && d.target === b) || (d.actor === b && d.target === a)),
  );
}
function matchFor(s: State, mid: string, u: Row) {
  const m = s.matches.find(
    (m) =>
      m.id === mid && [m.low, m.high].includes(u.id) && m.status === "active",
  );
  if (
    !m ||
    blocked(s, m.low, m.high) ||
    [m.low, m.high].some(
      (uid) =>
        !["active", "paused"].includes(
          s.users.find((u) => u.id === uid)?.status,
        ),
    )
  )
    return fail(404, "UNAVAILABLE", "Conversation unavailable.");
  return m;
}
function eligible(s: State, a: Row, b: Row) {
  if (
    a.id === b.id ||
    a.status !== "active" ||
    b.status !== "active" ||
    a.city !== b.city ||
    blocked(s, a.id, b.id) ||
    s.matches.some(
      (m) => [m.low, m.high].includes(a.id) && [m.low, m.high].includes(b.id),
    )
  )
    return false;
  return [
    [a, b],
    [b, a],
  ].every(([x, y]) => {
    const n = age(y.privateProfile.birth_date);
    return (
      n >= 18 &&
      n >= x.privateProfile.age_min &&
      n <= x.privateProfile.age_max &&
      x.privateProfile.genders.includes(y.privateProfile.gender)
    );
  });
}
function planFor(s: State, pid: string, u: Row) {
  const p = s.plans.find((p) => p.id === pid);
  if (!p) return fail(404, "UNAVAILABLE", "Plan unavailable.");
  matchFor(s, p.matchId, u);
  return p;
}
function options(p: Row) {
  const values = Object.values(p.preferences) as Row[];
  if (values.length !== 2) return [];
  const start = Math.max(...values.map((v) => Date.parse(v.timeStart))),
    end = Math.min(...values.map((v) => Date.parse(v.timeEnd)));
  return catalogue
    .filter(
      (x) =>
        values.every(
          (v) =>
            x.price_cents <= v.budgetCents && v.activities.includes(x.activity),
        ) &&
        start + x.duration_minutes * 60000 <= end &&
        end > Date.now(),
    )
    .map((x) => ({
      ...x,
      earliestStart: new Date(
        Math.max(start, Date.now() + 60000),
      ).toISOString(),
      latestEnd: new Date(end).toISOString(),
    }));
}
function planDTO(s: State, p: Row, u: Row) {
  const buys = s.purchases.filter(
    (b) => b.plan_id === p.id && b.version === p.version,
  );
  return {
    id: p.id,
    matchId: p.matchId,
    status: p.status,
    financialState: p.financialState,
    version: p.version,
    expiresAt: p.expiresAt,
    bothPreferences: Object.keys(p.preferences).length === 2,
    ownPreferences: p.preferences[u.id] || null,
    proposal: p.proposal,
    acceptedByYou: p.accepted.includes(u.id),
    acceptanceCount: p.accepted.length,
    yourTicket: buys.find((b) => b.buyer_id === u.id)?.state || "not purchased",
    partnerPaid: buys.some((b) => b.buyer_id !== u.id && b.state === "paid"),
  };
}
function ownPayment(s: State, pid: string, u: Row): Row {
  const pay = s.payments.find((p) => p.id === pid);
  const purchase = s.purchases.find(
    (p) => p.id === pay?.purchase_id && p.buyer_id === u.id,
  );
  if (!pay || !purchase)
    return fail(404, "UNAVAILABLE", "Receipt unavailable.");
  return {
    ...pay,
    amount_cents: purchase.amount_cents,
    currency: "USD",
    plan_id: purchase.plan_id,
    version: purchase.version,
    snapshot: purchase.snapshot,
  };
}
function cancel(s: State, p: Row) {
  p.status = "cancelled";
  const purchases = s.purchases.filter((x) => x.plan_id === p.id);
  for (const purchase of purchases) {
    const pay = s.payments.find((x) => x.purchase_id === purchase.id);
    if (pay?.state === "completed") {
      pay.refunds = [
        {
          amount_cents: purchase.amount_cents,
          state: "completed",
          provider_id: `MOCK-REF-${pay.id}`,
        },
      ];
      pay.state = "refunded";
      purchase.state = "refunded";
    }
  }
  p.financialState = purchases.some((x) => x.state === "refunded")
    ? "refunded"
    : "unpaid";
}
function payable(s: State, purchase: Row, u: Row) {
  const p = planFor(s, purchase.plan_id, u);
  if (
    p.version !== purchase.version ||
    p.accepted.length !== 2 ||
    !["accepted", "payment_pending", "confirmed"].includes(p.status) ||
    Date.parse(p.expiresAt) < Date.now()
  )
    return fail(
      409,
      "CONSENT_REQUIRED",
      "Both members must accept the current unexpired plan.",
    );
  return p;
}
function limit(s: State, key: string, max: number, window: number) {
  const n = Date.now(),
    v = s.rates[key];
  if (!v || v.until < n) s.rates[key] = { count: 1, until: n + window };
  else if (v.count >= max)
    return fail(429, "RATE_LIMIT", "Please wait before trying again.");
  else v.count++;
}
export async function handleAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname.replace("/api/v1", ""),
    method = request.method;
  try {
    if (path === "/health")
      return json({ status: "ok", deployment: "private-prototype" });
    if (path === "/config")
      return json({
        hosted: true,
        tasteMatching: true,
        demo: true,
        paymentMode: "mock",
        emailMode: "platform",
        aiMode: "deterministic",
        connections: { linkedin: "unavailable", github: "unavailable" },
        chatTransport: "authorized polling",
      });
    if (path === "/ready") {
      await env.DB.prepare("SELECT 1").first();
      return json({ database: true, paymentMode: "mock" });
    }
    const owner = request.headers.get("oai-authenticated-user-id");
    if (!owner)
      return fail(
        401,
        "PLATFORM_SIGN_IN",
        "Sign in with ChatGPT to open this private workspace.",
      );
    const cookies = Object.fromEntries(
      (request.headers.get("cookie") || "")
        .split(";")
        .map((v) => v.trim().split("=")),
    );
    const uid = cookies.baepal_persona || null;
    const csrf = await digest(
      `${env.FIELD_ENCRYPTION_KEY}:${owner}:${uid || "none"}`,
    );
    if (method !== "GET") {
      if (request.headers.get("origin") !== url.origin)
        return fail(403, "ORIGIN_DENIED", "Request origin is not allowed.");
      if (uid && request.headers.get("x-csrf-token") !== csrf)
        return fail(
          403,
          "CSRF_REQUIRED",
          "Refresh this page before trying again.",
        );
      if (Number(request.headers.get("content-length") || "0") > 20000)
        return fail(413, "BODY_TOO_LARGE", "Request too large.");
    }
    const raw = method === "GET" ? {} : await request.text();
    if (typeof raw === "string" && raw.length > 20000)
      return fail(413, "BODY_TOO_LARGE", "Request too large.");
    const body = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    const cookie = (id: string) =>
      `baepal_persona=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
    if (method === "POST" && path === "/auth/login") {
      const b = z.object({ email: z.email() }).parse(body);
      const s = (await load(owner, env)).state;
      const u = s.users.find(
        (u) =>
          u.kind === "demo" &&
          u.email === b.email &&
          ["active", "paused"].includes(u.status),
      );
      if (!u)
        return fail(
          401,
          "DEMO_ONLY",
          "Choose an available fictional demo persona.",
        );
      return json(
        {
          status: u.status,
          csrf: await digest(`${env.FIELD_ENCRYPTION_KEY}:${owner}:${u.id}`),
        },
        200,
        { "Set-Cookie": cookie(u.id) },
      );
    }
    if (method === "POST" && path === "/auth/signup") {
      z.object({ adult: z.literal(true), terms: z.literal(true) }).parse(body);
      const personal = await mutate(owner, env, (s) => {
        let u = s.users.find(
          (u) => u.kind === "custom" && u.status !== "deleted",
        );
        if (!u) {
          u = {
            ...s.users[0],
            id: uuid(),
            email: "private-profile@prototype.invalid",
            kind: "custom",
            display_name: "",
            bio: "",
            photos: [],
            interests: [],
            prompts: [
              { question: "My perfect first date", answer: "" },
              { question: "Together we could", answer: "" },
            ],
            status: "onboarding",
            role: "member",
            version: 1,
            privateProfile: {
              birth_date: null,
              gender: "Nonbinary",
              genders: ["Woman", "Man", "Nonbinary"],
              age_min: 18,
              age_max: 99,
            },
          };
          s.users.push(u);
        }
        return u;
      });
      return json(
        {
          status: personal.status,
          csrf: await digest(
            `${env.FIELD_ENCRYPTION_KEY}:${owner}:${personal.id}`,
          ),
        },
        200,
        { "Set-Cookie": cookie(personal.id) },
      );
    }
    if (method === "POST" && path === "/auth/logout")
      return json({ loggedOut: true }, 200, {
        "Set-Cookie":
          "baepal_persona=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
    const read = (s: State) => {
      const u = userFor(s, uid);
      if (path === "/me")
        return {
          id: u.id,
          status: u.status,
          role: u.role,
          csrf,
          profile: profile(u),
          privateProfile: u.privateProfile,
        };
      if (path === "/payments")
        return s.payments
          .filter((p) =>
            s.purchases.some(
              (b) => b.id === p.purchase_id && b.buyer_id === u.id,
            ),
          )
          .map((p) => ownPayment(s, p.id, u));
      if (/^\/payments\/[\w-]+$/.test(path))
        return ownPayment(s, id.parse(path.split("/")[2]), u);
      if (/^\/purchases\/[\w-]+$/.test(path)) {
        const purchase = s.purchases.find(
          (x) => x.id === path.split("/")[2] && x.buyer_id === u.id,
        );
        if (!purchase) return fail(404, "UNAVAILABLE", "Purchase unavailable.");
        return { ...purchase, payment: ownPayment(s, purchase.payment_id, u) };
      }
      member(s, uid);
      if (path === "/taste/capabilities") return tasteCapabilities();
      if (path === "/taste/profile") return ownTasteProfile(tasteFor(s, u.id));
      if (path === "/taste/evidence") {
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(100)
          .parse(url.searchParams.get("limit") || 100);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000)
          .default(0)
          .parse(url.searchParams.get("offset") || 0);
        return evidenceDTO(tasteFor(s, u.id), limit, offset);
      }
      if (/^\/taste\/imports\/[\w-]+$/.test(path)) {
        const item = tasteFor(s, u.id).imports.find(
          (x) => x.id === id.parse(path.split("/")[3]),
        );
        if (!item) return fail(404, "UNAVAILABLE", "Import unavailable.");
        return item;
      }
      if (/^\/matches\/[\w-]+\/explanation$/.test(path)) {
        const match = matchFor(s, id.parse(path.split("/")[2]), u);
        const peer = s.users.find(
          (p) => p.id === (match.low === u.id ? match.high : match.low),
        )!;
        return {
          matchId: match.id,
          ...compareTaste(u, peer, s.taste?.[u.id], s.taste?.[peer.id]).public,
          notice:
            "Only mutually approved broad tags are included. No raw purchases, amounts or peer merchant list are shared.",
        };
      }
      if (path === "/discover")
        return s.users
          .filter(
            (candidate) =>
              eligible(s, u, candidate) &&
              !s.decisions.some(
                (d) => d.actor === u.id && d.target === candidate.id,
              ),
          )
          .map((candidate) => ({
            candidate,
            comparison: compareTaste(
              u,
              candidate,
              s.taste?.[u.id],
              s.taste?.[candidate.id],
            ),
          }))
          .sort(
            (a, b) =>
              b.comparison.score - a.comparison.score ||
              a.candidate.id.localeCompare(b.candidate.id),
          )
          .map(({ candidate, comparison }) => ({
            ...profile(candidate),
            taste: comparison.public,
          }));
      if (path === "/matches")
        return s.matches
          .filter(
            (m) =>
              m.status === "active" &&
              [m.low, m.high].includes(u.id) &&
              !blocked(s, m.low, m.high),
          )
          .map((m) => ({
            id: m.id,
            profile: profile(
              s.users.find((x) => x.id === (m.low === u.id ? m.high : m.low))!,
            ),
          }));
      if (/^\/people\/[\w-]+$/.test(path)) {
        const p = s.users.find((x) => x.id === path.split("/")[2]);
        if (!p || !eligible(s, u, p))
          return fail(404, "UNAVAILABLE", "Profile unavailable.");
        return profile(p);
      }
      if (/^\/conversations\/[\w-]+\/messages$/.test(path)) {
        const mid = id.parse(path.split("/")[2]);
        matchFor(s, mid, u);
        const after = z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .parse(url.searchParams.get("after") || 0);
        return s.messages
          .filter((m) => m.match_id === mid && m.sequence > after)
          .slice(-200);
      }
      if (path === "/date-plans")
        return s.plans
          .filter((p) => {
            try {
              planFor(s, p.id, u);
              return true;
            } catch {
              return false;
            }
          })
          .map((p) => planDTO(s, p, u))
          .reverse();
      if (/^\/date-plans\/[\w-]+$/.test(path))
        return planDTO(s, planFor(s, id.parse(path.split("/")[2]), u), u);
      if (path === "/admin/reports") {
        if (!["moderator", "admin"].includes(u.role))
          return fail(403, "ROLE_REQUIRED", "Moderator access required.");
        return s.reports.map((r) => ({
          id: r.id,
          category: r.category,
          state: r.state,
          created_at: r.created_at,
        }));
      }
      return fail(
        404,
        "NOT_FOUND",
        "This feature is unavailable in the hosted prototype.",
      );
    };
    if (method === "GET") return json(read((await load(owner, env)).state));
    const result = await mutate(owner, env, async (s) => {
      const u = userFor(s, uid);
      limit(s, `request:${u.id}`, 120, 60000);
      if (method === "PATCH" && path === "/me/profile") {
        const b = schemaProfile.parse(body);
        if (b.expectedVersion !== u.version)
          return fail(
            409,
            "VERSION_CONFLICT",
            "Profile changed. Refresh before saving.",
          );
        if (b.birthDate && (age(b.birthDate) < 18 || age(b.birthDate) > 110))
          return fail(
            422,
            "ADULTS_ONLY",
            "This prototype is for adults aged 18 and over.",
          );
        if (
          (b.publish || u.status !== "onboarding") &&
          (!b.birthDate ||
            b.displayName.length < 2 ||
            b.photos.length < 2 ||
            b.prompts.some((p) => !p.answer.trim()))
        )
          return fail(
            422,
            "INCOMPLETE_PROFILE",
            "Add an adult birth date, display name, two illustrations and two answered prompts.",
          );
        Object.assign(u, {
          display_name: b.displayName,
          bio: b.bio,
          city: b.city,
          intention: b.intention,
          interests: b.interests,
          prompts: b.prompts,
          photos: b.photos,
          version: u.version + 1,
          privateProfile: {
            birth_date: b.birthDate || null,
            gender: b.gender,
            genders: b.genders,
            age_min: b.ageMin,
            age_max: b.ageMax,
          },
        });
        if (b.publish && u.status === "onboarding") u.status = "active";
        return { saved: true };
      }
      if (method === "POST" && path === "/me/export")
        return {
          profile: profile(u),
          privateProfile: u.privateProfile,
          ownMessages: s.messages.filter((m) => m.sender_id === u.id),
          payments: s.payments
            .filter((p) =>
              s.purchases.some(
                (b) => b.id === p.purchase_id && b.buyer_id === u.id,
              ),
            )
            .map((p) => ownPayment(s, p.id, u)),
          taste: s.taste?.[u.id] || null,
          note: "Only this selected persona’s data; no other persona’s private budget or message text.",
        };
      if (method === "DELETE" && path === "/me") {
        if (s.taste) delete s.taste[u.id];
        for (const p of s.plans.filter((p) =>
          s.matches.some(
            (m) => m.id === p.matchId && [m.low, m.high].includes(u.id),
          ),
        ))
          cancel(s, p);
        for (const m of s.matches.filter((m) => [m.low, m.high].includes(u.id)))
          m.status = "closed";
        for (const p of s.plans) delete p.preferences[u.id];
        for (const m of s.messages.filter((m) => m.sender_id === u.id))
          m.text = "[deleted]";
        Object.assign(u, {
          status: "deleted",
          display_name: "Deleted persona",
          bio: "",
          photos: [],
          interests: [],
          prompts: [],
          privateProfile: {
            birth_date: null,
            gender: null,
            genders: [],
            age_min: 18,
            age_max: 99,
          },
        });
        return { deleted: true };
      }
      member(s, uid);
      if (path.startsWith("/taste/")) {
        const taste = tasteFor(s, u.id);
        if (method === "POST" && path === "/taste/consents")
          return saveConsent(taste, body);
        if (method === "POST" && path === "/taste/demo-imports")
          return importDemo(taste, body);
        if (method === "POST" && path === "/taste/rebuild")
          return rebuildTaste(taste, body);
        if (method === "PATCH" && /^\/taste\/evidence\/[\w-]+$/.test(path))
          return correctEvidence(taste, id.parse(path.split("/")[3]), body);
        if (method === "PATCH" && path === "/taste/profile/sharing")
          return setSharing(taste, body);
        if (method === "DELETE" && /^\/taste\/consents\/[\w-]+$/.test(path))
          return revokeTaste(taste, id.parse(path.split("/")[3]));
        if (
          method === "POST" &&
          (path === "/taste/paypal-sync" || path === "/taste/exports")
        )
          return new AuthorizedPayPalHistoryProvider().load(
            "",
            u.id,
            "",
            taste.consent.version,
          );
      }
      if (method === "POST" && ["/me/pause", "/me/resume"].includes(path)) {
        u.status = path.endsWith("pause") ? "paused" : "active";
        return { saved: true };
      }
      if (method === "POST" && path === "/decisions") {
        const b = z
          .object({
            targetId: id,
            action: z.enum(["like", "pass"]),
            clientMutationId: id,
          })
          .parse(body);
        const previous = s.decisions.find(
          (d) =>
            d.actor === u.id &&
            (d.target === b.targetId || d.mutation === b.clientMutationId),
        );
        if (previous) {
          if (
            previous.action !== b.action ||
            previous.target !== b.targetId ||
            previous.mutation !== b.clientMutationId
          )
            return fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Decision key already used.",
            );
          return {
            match:
              s.matches.find(
                (m) =>
                  [m.low, m.high].includes(u.id) &&
                  [m.low, m.high].includes(b.targetId),
              ) || null,
          };
        }
        const target = s.users.find((x) => x.id === b.targetId);
        if (!target || !eligible(s, u, target))
          return fail(404, "UNAVAILABLE", "Profile unavailable.");
        s.decisions.push({
          actor: u.id,
          target: b.targetId,
          action: b.action,
          mutation: b.clientMutationId,
        });
        let match = null;
        if (
          b.action === "like" &&
          s.decisions.some(
            (d) =>
              d.actor === b.targetId &&
              d.target === u.id &&
              d.action === "like",
          )
        ) {
          const [low, high] = [u.id, b.targetId].sort();
          match = {
            id: uuid(),
            low,
            high,
            status: "active",
            lastSequence: 0,
            created_at: now(),
          };
          s.matches.push(match);
        }
        return { match };
      }
      if (
        method === "POST" &&
        /^\/conversations\/[\w-]+\/messages$/.test(path)
      ) {
        const mid = id.parse(path.split("/")[2]),
          m = matchFor(s, mid, u);
        const b = z
          .object({
            text: z.string().trim().min(1).max(2000),
            clientMessageId: id,
          })
          .parse(body);
        const existing = s.messages.find(
          (x) => x.sender_id === u.id && x.client_id === b.clientMessageId,
        );
        if (existing) {
          if (existing.text !== b.text || existing.match_id !== mid)
            return fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Message key already used.",
            );
          return existing;
        }
        limit(s, `messages:${u.id}`, 30, 60000);
        if (s.messages.length >= 2000)
          return fail(
            422,
            "STORAGE_LIMIT",
            "Prototype message limit reached. Export your data.",
          );
        const message = {
          id: uuid(),
          match_id: mid,
          sequence: ++m.lastSequence,
          sender_id: u.id,
          client_id: b.clientMessageId,
          text: b.text,
          created_at: now(),
        };
        s.messages.push(message);
        return message;
      }
      if (
        (method === "DELETE" && path.startsWith("/matches/")) ||
        (method === "POST" && path === "/blocks")
      ) {
        let matches;
        if (path === "/blocks") {
          const b = z.object({ targetId: id }).parse(body);
          if (b.targetId === u.id || !s.users.some((x) => x.id === b.targetId))
            return fail(422, "INVALID_TARGET", "Choose another persona.");
          if (
            !s.decisions.some(
              (d) =>
                d.actor === u.id &&
                d.target === b.targetId &&
                d.action === "block",
            )
          )
            s.decisions.push({
              actor: u.id,
              target: b.targetId,
              action: "block",
              mutation: uuid(),
            });
          matches = s.matches.filter(
            (m) =>
              [m.low, m.high].includes(u.id) &&
              [m.low, m.high].includes(b.targetId),
          );
        } else matches = [matchFor(s, id.parse(path.split("/")[2]), u)];
        for (const m of matches) {
          m.status = "closed";
          for (const p of s.plans.filter((p) => p.matchId === m.id))
            cancel(s, p);
        }
        return { closed: true };
      }
      if (method === "POST" && path === "/reports") {
        const b = z
          .object({
            subjectId: id,
            category: z.enum([
              "other",
              "harassment",
              "spam/scam",
              "impersonation",
              "inappropriate content",
              "underage concern",
            ]),
            notes: z.string().max(2000),
          })
          .parse(body);
        if (b.subjectId === u.id || !s.users.some((x) => x.id === b.subjectId))
          return fail(422, "INVALID_TARGET", "Choose another persona.");
        const report = {
          id: uuid(),
          reporter: u.id,
          subject: b.subjectId,
          category: b.category,
          notes: b.notes,
          state: "open",
          created_at: now(),
        };
        s.reports.push(report);
        return {
          id: report.id,
          message:
            "Report saved in your private prototype. No staffed moderation or external notification is implied.",
        };
      }
      if (method === "POST" && path === "/date-plans") {
        const b = z.object({ matchId: id }).parse(body);
        matchFor(s, b.matchId, u);
        const p = {
          id: uuid(),
          matchId: b.matchId,
          status: "collecting_preferences",
          financialState: "unpaid",
          version: 0,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          preferences: {},
          proposal: null,
          accepted: [],
        };
        s.plans.push(p);
        return planDTO(s, p, u);
      }
      if (path.startsWith("/date-plans/")) {
        const pid = id.parse(path.split("/")[2]),
          p = planFor(s, pid, u),
          action = path.split("/")[3];
        if (["cancelled", "expired"].includes(p.status) && action !== "cancel")
          return fail(409, "PLAN_CLOSED", "This plan is closed.");
        if (method === "PUT" && action === "private-preferences") {
          const b = z
            .object({
              budgetCents: z.number().int().min(0).max(100000),
              activities: z.array(z.enum(["Coffee", "Art", "Hiking"])).min(1),
              timeStart: z.iso.datetime(),
              timeEnd: z.iso.datetime(),
            })
            .parse(body);
          if (
            Date.parse(b.timeStart) <= Date.now() ||
            Date.parse(b.timeEnd) <= Date.parse(b.timeStart)
          )
            return fail(
              422,
              "INVALID_TIME",
              "Choose a future start and later end.",
            );
          if (s.purchases.some((x) => x.plan_id === p.id))
            return fail(
              409,
              "PAYMENT_EXISTS",
              "Cancel this plan before editing a checkout.",
            );
          p.preferences[u.id] = b;
          if (p.version) {
            p.version++;
            p.accepted = [];
            p.proposal = null;
            p.status = "collecting_preferences";
          }
          return { saved: true };
        }
        if (method === "POST" && action === "suggestions") {
          limit(s, `suggest:${u.id}:${p.id}`, 8, 3600000);
          return {
            options: options(p),
            label:
              "Suggested using your preferences. Fictional catalogue only.",
            privacy:
              "Exact budgets are private in partner views; suggestion prices can allow indirect inference.",
          };
        }
        if (method === "POST" && action === "proposals") {
          const b = z
            .object({
              optionId: z.string(),
              startsAt: z.iso.datetime(),
              expectedVersion: z.number().int(),
            })
            .parse(body);
          if (p.version !== b.expectedVersion)
            return fail(
              409,
              "VERSION_CONFLICT",
              "Plan changed. Refresh first.",
            );
          if (s.purchases.some((x) => x.plan_id === p.id))
            return fail(
              409,
              "PAYMENT_EXISTS",
              "Cancel before changing a checkout.",
            );
          const option = options(p).find((x) => x.id === b.optionId),
            start = Date.parse(b.startsAt);
          if (
            !option ||
            start < Date.parse(option.earliestStart) - 60000 ||
            start + option.duration_minutes * 60000 >
              Date.parse(option.latestEnd) ||
            start < Date.now()
          )
            return fail(
              422,
              "OPTION_UNAVAILABLE",
              "Choose an eligible experience and time.",
            );
          p.version++;
          p.proposal = {
            plan_id: p.id,
            version: p.version,
            catalogue_id: option.id,
            starts_at: b.startsAt,
            timezone: "America/Los_Angeles",
            snapshot: option,
          };
          p.status = "proposed";
          p.accepted = [];
          return { version: p.version };
        }
        if (method === "POST" && action === "accept") {
          const b = z.object({ proposalVersion: z.number().int() }).parse(body);
          if (
            !p.proposal ||
            p.version !== b.proposalVersion ||
            !["proposed", "accepted"].includes(p.status) ||
            Date.parse(p.expiresAt) < Date.now()
          )
            return fail(
              409,
              "VERSION_CONFLICT",
              "Accept only the current unexpired proposal.",
            );
          if (!p.accepted.includes(u.id)) p.accepted.push(u.id);
          if (p.accepted.length === 2) {
            p.status =
              p.proposal.snapshot.price_cents === 0 ? "confirmed" : "accepted";
            p.financialState =
              p.proposal.snapshot.price_cents === 0 ? "free" : "unpaid";
          }
          return { accepted: true };
        }
        if (method === "POST" && action === "cancel") {
          const b = z.object({ expectedVersion: z.number().int() }).parse(body);
          if (b.expectedVersion !== p.version)
            return fail(
              409,
              "VERSION_CONFLICT",
              "Plan changed. Refresh first.",
            );
          cancel(s, p);
          return {
            cancelled: true,
            message:
              "Mock refunds are simulated. No PayPal operation occurred.",
          };
        }
      }
      if (method === "POST" && path === "/purchases") {
        const b = z
            .object({ planId: id, proposalVersion: z.number().int() })
            .parse(body),
          p = planFor(s, b.planId, u);
        if (
          p.version !== b.proposalVersion ||
          p.accepted.length !== 2 ||
          !["accepted", "payment_pending", "confirmed"].includes(p.status) ||
          Date.parse(p.expiresAt) < Date.now()
        )
          return fail(
            409,
            "CONSENT_REQUIRED",
            "Both personas must accept this version first.",
          );
        if (p.proposal.snapshot.price_cents <= 0)
          return fail(422, "FREE_PLAN", "Free ideas need no checkout.");
        let purchase = s.purchases.find(
          (x) =>
            x.plan_id === p.id &&
            x.version === p.version &&
            x.buyer_id === u.id,
        );
        if (!purchase) {
          const pid = uuid(),
            payid = uuid();
          purchase = {
            id: pid,
            plan_id: p.id,
            version: p.version,
            buyer_id: u.id,
            amount_cents: p.proposal.snapshot.price_cents,
            currency: "USD",
            snapshot: p.proposal.snapshot,
            state: "created",
            payment_id: payid,
          };
          s.purchases.push(purchase);
          s.payments.push({
            id: payid,
            purchase_id: pid,
            mode: "mock",
            state: "created",
            order_id: null,
            capture_id: null,
            refunds: [],
          });
        }
        return { purchaseId: purchase.id, paymentId: purchase.payment_id };
      }
      if (method === "POST" && path === "/payments/orders") {
        const b = z.object({ paymentId: id }).parse(body);
        const pay = ownPayment(s, b.paymentId, u),
          purchase = s.purchases.find((x) => x.id === pay.purchase_id)!;
        payable(s, purchase, u);
        const stored = s.payments.find((x) => x.id === pay.id)!;
        stored.order_id ||= `MOCK-ORDER-${pay.id}`;
        if (stored.state === "created") stored.state = "approval_pending";
        return {
          id: stored.id,
          orderId: stored.order_id,
          mode: "mock",
          approvalUrl: null,
        };
      }
      if (method === "POST" && /^\/payments\/[\w-]+\/capture$/.test(path)) {
        const pay = ownPayment(s, id.parse(path.split("/")[2]), u),
          purchase = s.purchases.find((x) => x.id === pay.purchase_id)!;
        const p = payable(s, purchase, u),
          stored = s.payments.find((x) => x.id === pay.id)!;
        if (!stored.order_id)
          return fail(409, "ORDER_REQUIRED", "Create the mock order first.");
        if (stored.state !== "completed") {
          stored.state = "completed";
          stored.capture_id = `MOCK-CAP-${stored.id}`;
          purchase.state = "paid";
        }
        const paid = s.purchases.filter(
          (x) =>
            x.plan_id === p.id && x.version === p.version && x.state === "paid",
        );
        p.status = paid.length === 2 ? "confirmed" : "payment_pending";
        p.financialState = paid.length === 2 ? "paid" : "partially_paid";
        return ownPayment(s, stored.id, u);
      }
      if (method === "PATCH" && path.startsWith("/admin/reports/")) {
        if (!["moderator", "admin"].includes(u.role))
          return fail(403, "ROLE_REQUIRED", "Moderator access required.");
        const b = z
          .object({
            state: z.enum(["reviewed", "dismissed"]),
            reason: z.string().min(5).max(1000),
          })
          .parse(body);
        const report = s.reports.find((x) => x.id === path.split("/")[3]);
        if (!report) return fail(404, "UNAVAILABLE", "Report unavailable.");
        report.state = b.state;
        report.audit = { actor: u.id, reason: b.reason, at: now() };
        return { updated: true };
      }
      return fail(
        404,
        "UNAVAILABLE",
        "This feature is unavailable in the hosted prototype.",
      );
    });
    return json(
      result,
      200,
      method === "DELETE" && path === "/me"
        ? {
            "Set-Cookie":
              "baepal_persona=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
          }
        : {},
    );
  } catch (error) {
    const e = error as any;
    const status =
      e instanceof z.ZodError || e instanceof SyntaxError
        ? 400
        : e.status || 500;
    return Response.json(
      {
        error: {
          code:
            e instanceof z.ZodError ? "VALIDATION" : e.code || "UNAVAILABLE",
          message:
            status === 500
              ? "This action could not be completed. Please retry."
              : e.message,
          requestId: uuid(),
        },
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
