"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import IntegrationWorkspace from "./IntegrationWorkspace";
import TasteWorkspace from "./TasteWorkspace";
import MatchWhy from "./MatchWhy";
import { usePathname, useRouter } from "next/navigation";
import {
  Heart,
  Compass,
  MessageCircle,
  CalendarDays,
  UserRound,
  ArrowUpRight,
  ArrowRight,
  SlidersHorizontal,
  MapPin,
  Sparkles,
  X,
  Check,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  Leaf,
  Coffee,
  Palette,
  Send,
  Menu,
  Receipt,
  LoaderCircle,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
type Row = Record<string, any>;
const dollars = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v / 100,
  );
const when = (v: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(new Date(v)) + " · Seattle time";
export default function BaePal() {
  const path = usePathname(),
    router = useRouter();
  const [me, setMe] = useState<Row | null>(null),
    [config, setConfig] = useState<Row>({}),
    [data, setData] = useState<any>(null),
    [matches, setMatches] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const csrf = useRef("");
  const configCache = useRef<Row | null>(null);
  const socket = useRef<Socket | null>(null);
  const retryMessage = useRef<{ text: string; id: string } | null>(null);
  const api = useCallback(
    async (url: string, method = "GET", payload?: unknown) => {
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(csrf.current ? { "x-csrf-token": csrf.current } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: "no-store",
      });
      const result = await r.json();
      if (!r.ok) {
        const e = new Error(
          result.error?.message || "Request failed. Please retry.",
        ) as Error & { status: number };
        e.status = r.status;
        throw e;
      }
      if (result.data?.csrf) csrf.current = result.data.csrf;
      return result.data;
    },
    [],
  );
  const refresh = useCallback(async () => {
    const conf = configCache.current || (await api("/config"));
    configCache.current = conf;
    setConfig(conf);
    let current;
    try {
      current = await api("/me");
      setMe(current);
    } catch (e) {
      if ((e as any).status !== 401) throw e;
      setMe(null);
    }
    if (current && ["active", "paused"].includes(current.status)) {
      const m = await api("/matches");
      setMatches(m);
      if (path === "/discover") setData(await api("/discover"));
      else if (path === "/chats" || path === "/matches") setData(m);
      else if (path.startsWith("/chats/"))
        setData(await api(`/conversations/${path.split("/")[2]}/messages`));
      else if (path === "/dates") setData(await api("/date-plans"));
      else if (path.startsWith("/dates/") && path !== "/dates/new") {
        const fresh = await api(`/date-plans/${path.split("/")[2]}`);
        setData((previous: any) => ({
          ...fresh,
          ...(previous?.id === fresh.id &&
          previous.version === fresh.version &&
          previous.suggestions
            ? { suggestions: previous.suggestions }
            : {}),
        }));
      } else if (path.startsWith("/checkout/"))
        setData(await api(`/purchases/${path.split("/")[2]}`));
      else if (path === "/payments") setData(await api("/payments"));
      else if (path.startsWith("/payments/"))
        setData(await api(`/payments/${path.split("/")[2]}`));
      else if (path === "/admin/reports") setData(await api("/admin/reports"));
    }
    return current;
  }, [api, path]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError("");
    refresh()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!me || !["active", "paused"].includes(me.status)) return;
    const s = config.hosted
      ? null
      : io({ transports: ["polling"], upgrade: false });
    socket.current = s;
    s?.on("connect", () => {
      if (path.startsWith("/chats/"))
        s?.emit("conversation.subscribe", path.split("/")[2]);
    });
    s?.on(
      "message.created",
      () =>
        void refresh().catch(() =>
          setError("Connection interrupted. Retry to refresh."),
        ),
    );
    s?.on("match.created", () => void refresh().catch(() => {}));
    s?.on("access.revoked", () => {
      setData(null);
      setNotice("Access has changed. This conversation may be unavailable.");
      void refresh().catch((e) => setError(e.message));
    });
    const timer = setInterval(() => {
      if (
        path === "/chats" ||
        path === "/dates" ||
        path.startsWith("/chats/") ||
        path.startsWith("/dates/") ||
        path.startsWith("/payments/")
      )
        void refresh().catch(() => {});
    }, 5000);
    return () => {
      s?.disconnect();
      clearInterval(timer);
      socket.current = null;
    };
  }, [me?.id, me?.status, path, refresh, config.hosted]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const submit =
    (fn: (f: FormData) => Promise<void>) => (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const f = new FormData(
        e.currentTarget,
        (e.nativeEvent as SubmitEvent).submitter,
      );
      void act(() => fn(f));
    };
  const go = (url: string) => router.push(url);
  const start = async () => {
    if (me)
      go(
        me.status === "pending_email"
          ? "/auth/verify"
          : me.status === "onboarding"
            ? "/onboarding/profile"
            : "/discover",
      );
    else go("/auth/signup");
  };
  const needsAuth =
    !["/", "/safety", "/terms", "/privacy"].includes(path) &&
    !path.startsWith("/auth/");
  const nav = [
    { href: "/discover", label: "Discover", Icon: Compass },
    ...(config.tasteMatching
      ? [
          {
            href: "/taste/connect",
            label: "Purchase interests",
            Icon: Sparkles,
          },
        ]
      : []),
    { href: "/likes", label: "Likes", Icon: Heart },
    { href: "/chats", label: "Chats", Icon: MessageCircle },
    { href: "/dates", label: "Dates", Icon: CalendarDays },
    { href: "/profile", label: "Profile", Icon: UserRound },
  ];
  const button = (text: string, fn: () => Promise<void>, kind = "primary") => (
    <button className={kind} disabled={busy} onClick={() => void act(fn)}>
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {text}
    </button>
  );
  const heading = (eyebrow: string, title: string, description?: string) => (
    <header className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
  function ProfileCard({ p, compact = false }: { p: Row; compact?: boolean }) {
    return (
      <article className={`person-card ${compact ? "compact" : ""}`}>
        <div className="portrait-wrap">
          <img
            className="portrait"
            src={p.photos[0] || "/portraits/0.svg"}
            alt={`Synthetic illustration for fictional member ${p.display_name}`}
          />
          <span className="photo-label">
            Fictional demo profile · illustrated
          </span>
          <div className="portrait-copy">
            <span className="pill light">
              <MapPin size={12} />
              {p.city}
            </span>
            <h2>
              {p.display_name}, {p.age}
            </h2>
            <p>{p.intention}</p>
          </div>
        </div>
        <div className="person-details">
          {p.taste && (
            <div className="taste-card-note">
              <span className="pill">{p.taste.basis}</span>
              <p>
                Evidence: {p.taste.evidenceGrade}. Pattern overlap is not a
                relationship probability.
              </p>
              {p.taste.commonGround.length > 0 && (
                <p>Shared by both: {p.taste.commonGround.join(", ")}.</p>
              )}
            </div>
          )}
          <div className="tag-list">
            {p.interests.map((i: string) => (
              <span className="tag" key={i}>
                {i}
              </span>
            ))}
          </div>
          <p>{p.bio}</p>
          {!compact &&
            p.prompts.map((prompt: Row, i: number) => (
              <div className="prompt" key={i}>
                <span>{prompt.question}</span>
                <p>{prompt.answer}</p>
              </div>
            ))}
        </div>
      </article>
    );
  }
  function BudgetForm({ plan }: { plan: Row }) {
    const own = plan.ownPreferences;
    const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    return (
      <form
        className="panel form-stack"
        onSubmit={submit(async (f) => {
          await api(`/date-plans/${plan.id}/private-preferences`, "PUT", {
            budgetCents: Math.round(Number(f.get("budget")) * 100),
            activities: f.getAll("activities"),
            timeStart: new Date(String(f.get("start"))).toISOString(),
            timeEnd: new Date(String(f.get("end"))).toISOString(),
          });
          setNotice("Your private preferences are saved.");
          await refresh();
        })}
      >
        <div className="section-label">
          <ShieldCheck size={19} />
          <h2>Your comfort comes first</h2>
        </div>
        <p>
          Only you can see your exact budget. The server uses both budgets to
          find suitable options. Prices can still allow indirect inference.
        </p>
        <label>
          Your maximum per ticket (USD)
          <input
            name="budget"
            type="number"
            min="0"
            max="1000"
            step="0.01"
            required
            defaultValue={own ? own.budgetCents / 100 : 30}
          />
        </label>
        <fieldset>
          <legend>Activities you’d enjoy</legend>
          <div className="check-row">
            {["Coffee", "Art", "Hiking"].map((a) => (
              <label key={a}>
                <input
                  type="checkbox"
                  name="activities"
                  value={a}
                  defaultChecked={!own || own.activities.includes(a)}
                />
                {a}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Available from · your device’s local time
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={day + "T17:00"}
          />
        </label>
        <label>
          Available until · your device’s local time
          <input
            name="end"
            type="datetime-local"
            required
            defaultValue={day + "T21:00"}
          />
        </label>
        <button disabled={busy}>Save my private preferences</button>
      </form>
    );
  }
  let content: React.ReactNode;
  if (path === "/") {
    content = (
      <>
        <div className="landing-nav">
          <Link href="/" className="wordmark">
            <Heart fill="currentColor" />
            bae<span>pal</span>
            <i>✦</i>
          </Link>
          <div>
            <Link href="/safety">Made with care</Link>
            <Link className="button secondary" href="/auth/login">
              Log in <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="tiny-star">✦</span> LESS SWIPING. MORE SOMETHING
              REAL.
            </span>
            <h1>
              A little spark.
              <br />A real <em>connection.</em>
            </h1>
            <p>
              {config.tasteMatching
                ? "Meet someone who spends their weekends like you. You choose which fictional purchase interests count."
                : "Meet someone who gets you. Make a plan you both feel good about."}
              Let the first date be the easy part.
            </p>
            <div className="hero-actions">
              <button onClick={() => void start()}>
                Find your kind of person <ArrowUpRight size={18} />
              </button>
              <Link className="text-link" href="/auth/login">
                Explore the demo <ArrowRight size={16} />
              </Link>
            </div>
            <div className="hero-note">
              <ShieldCheck size={18} />
              <span>
                For adults 18+ · Starting in Seattle · Always your choice
              </span>
            </div>
          </div>
          <div className="hero-art">
            <div className="hero-orbit" />
            <div className="floating-note top">
              <Sparkles size={18} />
              <span>
                A good connection deserves
                <br />
                <strong>a good first date.</strong>
              </span>
            </div>
            <div className="hero-profile">
              <img
                src="/portraits/1.svg"
                alt="Original synthetic illustration of a fictional adult demo member"
              />
              <div>
                <span className="pill light">
                  A LITTLE CURIOUS, A LOT INTENTIONAL
                </span>
                <h2>More than a profile.</h2>
                <p>Your next favorite conversation.</p>
              </div>
            </div>
            <div className="floating-note bottom">
              <Coffee size={24} />
              <span>
                Coffee? Art? The scenic route?
                <br />
                <strong>Find your shared kind of good.</strong>
              </span>
              <Heart size={17} />
            </div>
            <span className="hand-star">✳</span>
          </div>
        </section>
        <section className="how">
          <div>
            <span className="eyebrow">THE GOOD PART STARTS HERE</span>
            <h2>A connection with somewhere to go.</h2>
          </div>
          <div className="how-grid">
            {[
              [
                "01",
                "Be a little more you",
                "Prompts, interests, and the things that make a conversation worth having.",
              ],
              [
                "02",
                "Find a mutual spark",
                "You both choose. Then say hello, at your own pace.",
              ],
              [
                "03",
                "Make room for a real date",
                "Private budgets. Shared plans. A comfortable yes from both of you.",
              ],
            ].map(([n, t, d]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
        </section>
        <footer>
          Fictional hackathon demo · No real reservations or live payments{" "}
          <div>
            <Link href="/safety">Safety</Link>
            <Link href="/privacy">Privacy draft</Link>
            <Link href="/terms">Terms draft</Link>
          </div>
        </footer>
      </>
    );
  } else if (path === "/safety" || path === "/privacy" || path === "/terms") {
    content = (
      <div className="reading">
        <Link className="text-link" href="/">
          <ChevronLeft size={18} />
          Back to BaePal
        </Link>
        {heading(
          "A LITTLE CARE GOES A LONG WAY",
          path === "/safety"
            ? "Connection, on your terms."
            : path === "/privacy"
              ? "Privacy · draft"
              : "Terms · draft",
        )}
        <section className="panel">
          {path === "/safety" ? (
            <>
              <h2>Your pace. Your choice.</h2>
              <p>
                Meet in a public place, tell someone you trust about your plans,
                and arrange your own transport. You can decline, unmatch, or
                block at any time.
              </p>
              <h2>Keep money in perspective.</h2>
              <p>
                Never send money to another member. Demo date tickets use PayPal
                Sandbox or a clearly marked mock provider, and don’t book a real
                venue. Payment and connected accounts never guarantee safety or
                verify identity.
              </p>
              <h2>Need help?</h2>
              <p>
                Use Report from a conversation. This hackathon has no staffed
                24/7 support. Contact local emergency services if you face
                immediate danger.
              </p>
            </>
          ) : (
            <>
              <p>
                This is a draft for a local hackathon demo, not a finalized
                legal policy.
              </p>
              <p>
                Use fictional adult information only. Profiles and matched
                messages are visible to authorized participants; exact budgets
                are encrypted in the database and withheld from your match. The
                application server can access budgets.
              </p>
              <p>
                Photos receive technical validation only; content moderation and
                legal identity verification are unavailable. Delete removes
                dating content and revokes access; local financial records
                remain until the development database is removed. No production
                retention policy has been approved.
              </p>
              <p>
                No real reservations or live purchases are supplied. Sandbox and
                mock receipts are labeled accordingly. Both participants consent
                separately, and payment always requires an additional explicit
                action.
              </p>
            </>
          )}
        </section>
      </div>
    );
  } else if (path.startsWith("/auth/")) {
    const mode = path.split("/")[2];
    content = (
      <div className="auth-layout">
        <Link href="/" className="wordmark">
          <Heart fill="currentColor" />
          bae<span>pal</span>
        </Link>
        <div className="auth-card">
          {heading(
            "YOUR NEXT CHAPTER",
            mode === "signup"
              ? "Start with a hello."
              : mode === "verify"
                ? "Check your inbox."
                : mode === "reset"
                  ? "A fresh start."
                  : "Good to see you.",
          )}
          {config.hosted && (
            <div className="panel form-stack">
              <p>
                This private prototype uses ChatGPT sign-in for access. Demo
                personas are fictional and share only your private workspace. No
                real email/password account or PayPal purchase is created here.
              </p>
              {mode === "signup" ? (
                <form
                  className="form-stack"
                  onSubmit={submit(async (f) => {
                    await api("/auth/signup", "POST", {
                      adult: f.get("adult") === "on",
                      terms: f.get("terms") === "on",
                    });
                    await refresh();
                    go("/onboarding/profile");
                  })}
                >
                  <label className="check">
                    <input name="adult" type="checkbox" required />I am at least
                    18.
                  </label>
                  <label className="check">
                    <input name="terms" type="checkbox" required />I agree to
                    the draft terms and will use fictional information.
                  </label>
                  <button disabled={busy}>Create my prototype profile</button>
                </form>
              ) : (
                <Link href="/auth/login" className="text-link">
                  Choose a demo persona below
                </Link>
              )}
              <a
                href="/signin-with-chatgpt?return_to=%2Fauth%2Flogin"
                target="_top"
                className="text-link"
              >
                Sign in with ChatGPT
              </a>
            </div>
          )}
          {!config.hosted && (
            <>
              <form
                className="form-stack"
                onSubmit={submit(async (f) => {
                  if (mode === "verify") {
                    await api("/auth/email/confirm", "POST", {
                      challengeId: f.get("challenge"),
                      code: f.get("code"),
                    });
                    await refresh();
                    go("/onboarding/profile");
                  } else if (mode === "reset") {
                    if (f.get("token")) {
                      await api("/auth/password/reset", "POST", {
                        challengeId: f.get("challenge"),
                        token: f.get("token"),
                        password: f.get("password"),
                      });
                      setNotice(
                        "Password reset. Log in with your new password.",
                      );
                    } else {
                      await api("/auth/password/request", "POST", {
                        email: f.get("email"),
                      });
                      setNotice(
                        "If eligible, reset instructions are in the local email capture.",
                      );
                    }
                  } else {
                    const result = await api(
                      `/auth/${mode === "signup" ? "signup" : "login"}`,
                      "POST",
                      {
                        email: f.get("email"),
                        password: f.get("password"),
                        ...(mode === "signup"
                          ? {
                              adult: f.get("adult") === "on",
                              terms: f.get("terms") === "on",
                            }
                          : {}),
                      },
                    );
                    const current = await refresh();
                    if (mode === "signup") {
                      go(`/auth/verify?challenge=${result.challengeId}`);
                    } else
                      go(
                        current?.status === "pending_email"
                          ? "/auth/verify"
                          : current?.status === "onboarding"
                            ? "/onboarding/profile"
                            : "/discover",
                      );
                  }
                })}
              >
                {mode === "verify" ? (
                  <>
                    <p>
                      Development email capture is stored on the API server in{" "}
                      <code>.data/mail/</code>. Codes are never shown in public
                      UI.
                    </p>
                    <label>
                      Challenge ID
                      <input
                        name="challenge"
                        required
                        defaultValue={
                          typeof window !== "undefined"
                            ? new URLSearchParams(window.location.search).get(
                                "challenge",
                              ) || ""
                            : ""
                        }
                      />
                    </label>
                    <label>
                      Six-digit confirmation code
                      <input
                        name="code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        autoComplete="one-time-code"
                        required
                      />
                    </label>
                    <button disabled={busy}>Confirm my email</button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const result = await api(
                            "/auth/email/request",
                            "POST",
                            {},
                          );
                          setNotice(
                            `New challenge: ${result.challengeId}. Wait 60 seconds before resending.`,
                          );
                        })
                      }
                    >
                      Resend code
                    </button>
                  </>
                ) : mode === "reset" ? (
                  <>
                    <label>
                      Email
                      <input name="email" type="email" autoComplete="email" />
                    </label>
                    <details>
                      <summary>I have a reset token</summary>
                      <label>
                        Challenge ID
                        <input name="challenge" />
                      </label>
                      <label>
                        Reset token
                        <input name="token" autoComplete="off" />
                      </label>
                      <label>
                        New password
                        <input
                          name="password"
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                        />
                      </label>
                    </details>
                    <button disabled={busy}>Continue</button>
                  </>
                ) : (
                  <>
                    <label>
                      Email address
                      <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="you@example.com"
                      />
                    </label>
                    <label>
                      Password
                      <input
                        name="password"
                        type="password"
                        minLength={mode === "signup" ? 12 : undefined}
                        maxLength={128}
                        autoComplete={
                          mode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        required
                        placeholder={
                          mode === "signup"
                            ? "At least 12 characters"
                            : "Your password"
                        }
                      />
                    </label>
                    {mode === "signup" && (
                      <>
                        <label className="check">
                          <input type="checkbox" name="adult" required />I am at
                          least 18 years old.
                        </label>
                        <label className="check">
                          <input type="checkbox" name="terms" required />I agree
                          to the <Link href="/terms">draft terms</Link> and{" "}
                          <Link href="/privacy">privacy notice</Link>.
                        </label>
                      </>
                    )}
                    <button disabled={busy}>
                      {mode === "signup" ? "Create my account" : "Log in"}
                      <ArrowRight size={17} />
                    </button>
                  </>
                )}
              </form>
            </>
          )}
          {mode === "login" && (
            <>
              {!config.hosted && (
                <Link href="/auth/reset" className="text-link">
                  Forgot password?
                </Link>
              )}
              {config.demo && (
                <div className="demo-login">
                  <span className="eyebrow">
                    PRIVATE DEMO · FICTIONAL ADULTS
                  </span>
                  <p>Try Alex or Jordan in separate browser contexts.</p>
                  {["Alex", "Jordan"].map((n) => (
                    <button
                      key={n}
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api("/auth/login", "POST", {
                            email: `${n.toLowerCase()}@demo.baepal.invalid`,
                            password: "Demo-Only-2026!",
                          });
                          await refresh();
                          go("/discover");
                        })
                      }
                    >
                      Continue as {n}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="muted">
            {mode === "signup" ? (
              <>
                Already here? <Link href="/auth/login">Log in</Link>
              </>
            ) : (
              <>
                New around here?{" "}
                <Link href="/auth/signup">Create an account</Link>
              </>
            )}
          </p>
        </div>
      </div>
    );
  } else if (needsAuth && !me && !loading) {
    content = (
      <div className="auth-card">
        {heading(
          "A PRIVATE SPACE",
          "Come on in.",
          "Log in to see your connections and saved plans.",
        )}
        <Link href="/auth/login" className="button">
          Log in <ArrowRight size={18} />
        </Link>
      </div>
    );
  } else if (
    me &&
    (path === "/profile/edit" || path.startsWith("/onboarding/"))
  ) {
    const p = me.profile,
      q = me.privateProfile;
    content = (
      <>
        {heading(
          "A PROFILE THAT FEELS LIKE YOU",
          me.status === "onboarding"
            ? "Let’s start with your story."
            : "A little more you.",
          "Save a draft at any time. Your date of birth stays private.",
        )}
        <form
          className="panel form-stack profile-form"
          onSubmit={submit(async (f) => {
            const photos = String(f.get("photos") || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            await api("/me/profile", "PATCH", {
              expectedVersion: p.version,
              displayName: f.get("name"),
              birthDate: f.get("dob"),
              gender: f.get("gender"),
              genders: f.getAll("genders"),
              ageMin: Number(f.get("min")),
              ageMax: Number(f.get("max")),
              city: "Seattle",
              intention: f.get("intention"),
              bio: f.get("bio"),
              interests: String(f.get("interests"))
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              prompts: [
                { question: "My perfect first date", answer: f.get("prompt1") },
                { question: "Together we could", answer: f.get("prompt2") },
              ],
              photos,
              publish: f.get("action") === "publish",
            });
            await refresh();
            setNotice("Profile saved.");
            if (f.get("action") === "publish") go("/discover");
          })}
        >
          <div className="two-col">
            <label>
              Display name
              <input
                name="name"
                required
                minLength={2}
                maxLength={50}
                defaultValue={p.display_name}
              />
            </label>
            <label>
              Birth date · private
              <input
                name="dob"
                type="date"
                required
                defaultValue={q.birth_date?.slice(0, 10)}
              />
            </label>
          </div>
          <div className="two-col">
            <label>
              Gender
              <select name="gender" defaultValue={q.gender || "Nonbinary"}>
                <option>Woman</option>
                <option>Man</option>
                <option>Nonbinary</option>
              </select>
            </label>
            <label>
              Looking for
              <select name="intention" defaultValue={p.intention}>
                <option>Long-term relationship</option>
                <option>Marriage-minded</option>
                <option>Exploring intentionally</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>People you’d like to meet</legend>
            <div className="check-row">
              {["Woman", "Man", "Nonbinary"].map((g) => (
                <label key={g}>
                  <input
                    type="checkbox"
                    name="genders"
                    value={g}
                    defaultChecked={q.genders?.includes(g)}
                  />
                  {g}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="two-col">
            <label>
              Minimum age
              <input
                name="min"
                type="number"
                min="18"
                max="99"
                required
                defaultValue={q.age_min}
              />
            </label>
            <label>
              Maximum age
              <input
                name="max"
                type="number"
                min="18"
                max="99"
                required
                defaultValue={q.age_max}
              />
            </label>
          </div>
          <p className="muted">
            Seattle pilot · discovery currently stays within the same city.
            Professional context is optional; account connections are
            unavailable in this build.
          </p>
          <label>
            A little about you
            <textarea
              name="bio"
              maxLength={500}
              required
              defaultValue={p.bio}
            />
          </label>
          <label>
            Your interests · comma separated
            <input name="interests" defaultValue={p.interests.join(", ")} />
          </label>
          <label>
            My perfect first date
            <textarea
              name="prompt1"
              maxLength={250}
              required
              defaultValue={p.prompts[0]?.answer}
            />
          </label>
          <label>
            Together we could
            <textarea
              name="prompt2"
              maxLength={250}
              required
              defaultValue={p.prompts[1]?.answer}
            />
          </label>
          <label>
            Photo URLs · your uploads or demo illustrations
            <input
              id="photo-urls"
              name="photos"
              defaultValue={p.photos.join(", ")}
            />
          </label>
          <label>
            Upload a photo ·{" "}
            {config.hosted
              ? "unavailable in hosted demo; use illustrations below"
              : "technical validation only"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || config.hosted}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void act(async () => {
                    if (file.size > 10 * 1024 * 1024)
                      throw Error("Maximum photo size is 10MB.");
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.onerror = () =>
                          reject(Error("File could not be read."));
                        reader.readAsDataURL(file);
                      },
                    );
                    const result = await api("/me/photos", "POST", { base64 });
                    const input = document.getElementById(
                      "photo-urls",
                    ) as HTMLInputElement;
                    input.value = [input.value, result.url]
                      .filter(Boolean)
                      .join(", ");
                    setNotice(result.moderation);
                  });
              }}
            />
          </label>
          {config.demo && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                (
                  document.getElementById("photo-urls") as HTMLInputElement
                ).value = "/portraits/0.svg, /portraits/1.svg";
              }}
            >
              Use two labeled demo illustrations
            </button>
          )}
          <div className="actions">
            <button name="action" value="publish" disabled={busy}>
              Save &{" "}
              {me.status === "onboarding" ? "activate profile" : "continue"}
            </button>
            <button
              name="action"
              value="draft"
              formNoValidate
              className="secondary"
              disabled={busy}
            >
              Save draft
            </button>
          </div>
        </form>
      </>
    );
  } else if (me?.status === "pending_email") {
    content = (
      <div className="panel">
        {heading("ONE SMALL STEP", "Confirm your email first.")}
        <Link className="button" href="/auth/verify">
          Confirm email
        </Link>
      </div>
    );
  } else if (me?.status === "onboarding") {
    content = (
      <div className="panel">
        {heading("LET’S BEGIN", "Your story is waiting.")}
        <Link className="button" href="/onboarding/profile">
          Continue onboarding
        </Link>
      </div>
    );
  } else if (
    config.tasteMatching &&
    (path.startsWith("/taste/") || path === "/settings/data")
  ) {
    content = <TasteWorkspace path={path} api={api} />;
  } else if (path === "/discover") {
    const cards = Array.isArray(data) ? data : [];
    content = (
      <>
        <div className="heading-row">
          {heading(
            "GOOD PEOPLE. REAL POSSIBILITIES.",
            "A little curiosity goes a long way.",
            "Meet someone who makes you want to know more.",
          )}
          <Link href="/profile/edit" className="button secondary">
            <SlidersHorizontal size={17} />
            Preferences
          </Link>
        </div>
        <div className="discover-tabs">
          <span>
            For you <span className="count">{cards.length}</span>
          </span>
          <span>
            <MapPin size={13} />
            Seattle pilot
          </span>
        </div>
        {cards.length ? (
          <div className="discovery-layout">
            <div className="card-zone">
              <ProfileCard p={cards[0]} />
              <div className="decision-bar">
                <button
                  className="pass"
                  aria-label={`Pass on ${cards[0].display_name}`}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api("/decisions", "POST", {
                        targetId: cards[0].user_id,
                        action: "pass",
                        clientMutationId: crypto.randomUUID(),
                      });
                      await refresh();
                    })
                  }
                >
                  <X size={23} />
                  <span>Not for me</span>
                </button>
                <span>No rush. Trust your feeling.</span>
                <button
                  className="like"
                  aria-label={`Like ${cards[0].display_name}`}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await api("/decisions", "POST", {
                        targetId: cards[0].user_id,
                        action: "like",
                        clientMutationId: crypto.randomUUID(),
                      });
                      setNotice(
                        result.match
                          ? "It’s mutual! Your conversation is ready in Chats."
                          : "Like saved. A conversation opens if they like you too.",
                      );
                      await refresh();
                    })
                  }
                >
                  <Heart size={23} />
                  <span>I’m interested</span>
                </button>
              </div>
            </div>
            <aside className="discovery-aside">
              <div className="note-card lavender">
                <Sparkles size={24} />
                <span className="eyebrow">A BETTER KIND OF HELLO</span>
                <h2>Start with something real.</h2>
                <p>
                  A shared interest. A thoughtful answer. The little things are
                  often the good things.
                </p>
                <span className="small-rule" />
              </div>
              <div className="note-card">
                <ShieldCheck size={23} />
                <h3>Your pace, always.</h3>
                <p>
                  Only mutual likes open a conversation. Your budget and contact
                  details stay off your profile.
                </p>
                <Link href="/safety" className="text-link">
                  A little more on safety <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="next-up">
                <span className="eyebrow">MORE PEOPLE TO GET TO KNOW</span>
                <div>
                  {cards.slice(1, 4).map((p: Row) => (
                    <img
                      key={p.user_id}
                      src={p.photos[0]}
                      alt={`Illustration of ${p.display_name}`}
                    />
                  ))}
                </div>
                <p>Something good could be around the corner.</p>
              </div>
            </aside>
          </div>
        ) : (
          !loading && (
            <div className="empty panel">
              <Compass />
              <h2>You’re all caught up.</h2>
              <p>
                Try adjusting your reciprocal age and gender preferences, or
                come back later.
              </p>
              <Link className="button secondary" href="/profile/edit">
                Edit preferences
              </Link>
            </div>
          )
        )}
      </>
    );
  } else if (path === "/likes") {
    content = (
      <>
        {heading("ROOM FOR A LITTLE MYSTERY", "The feeling has to be mutual.")}
        <div className="empty panel">
          <Heart />
          <h2>Likes inbox is coming later.</h2>
          <p>
            This P1 feature is unavailable. Mutual matches already appear in
            Chats.
          </p>
          <Link className="button" href="/chats">
            See your conversations
          </Link>
        </div>
      </>
    );
  } else if (config.tasteMatching && /^\/matches\/[\w-]+\/why$/.test(path)) {
    content = <MatchWhy matchId={path.split("/")[2]} api={api} />;
  } else if (path === "/chats" || path === "/matches") {
    content = (
      <>
        {heading(
          "A HELLO COULD GO SOMEWHERE",
          "Your conversations.",
          "A little thoughtfulness makes a great first message.",
        )}
        <div className="match-grid">
          {matches.map((m) => (
            <Link className="match-card" key={m.id} href={`/chats/${m.id}`}>
              <img
                src={m.profile.photos[0]}
                alt={`Illustration of ${m.profile.display_name}`}
              />
              <div>
                <h2>{m.profile.display_name}</h2>
                <p>{m.profile.bio}</p>
                <span className="text-link">
                  Say hello <ArrowUpRight size={15} />
                </span>
              </div>
            </Link>
          ))}
        </div>
        {!matches.length && !loading && (
          <div className="empty panel">
            <MessageCircle />
            <h2>Your next hello starts with a mutual like.</h2>
            <Link href="/discover" className="button">
              Discover people
            </Link>
          </div>
        )}
      </>
    );
  } else if (path.startsWith("/chats/")) {
    const mid = path.split("/")[2],
      m = matches.find((m) => m.id === mid);
    content = (
      <>
        {heading(
          "ONE CONVERSATION AT A TIME",
          m ? `You & ${m.profile.display_name}` : "Conversation",
        )}
        {config.tasteMatching && (
          <Link className="text-link" href={`/matches/${mid}/why`}>
            Why this match? <ArrowRight size={15} />
          </Link>
        )}
        <div className="chat-layout">
          <div className="chat-panel panel">
            <div className="chat-header">
              <ShieldCheck size={18} />
              <span>
                Mutual connection · messages are not end-to-end encrypted
              </span>
            </div>
            <div
              className="messages"
              role="log"
              aria-label="Conversation messages"
            >
              {Array.isArray(data) &&
                data.map((msg: Row) => (
                  <div
                    key={msg.id}
                    className={`message ${msg.sender_id === me?.id ? "mine" : ""}`}
                  >
                    <p>{msg.text}</p>
                    <span>
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · saved
                    </span>
                  </div>
                ))}
              {Array.isArray(data) && !data.length && (
                <div className="empty">
                  <Sparkles />
                  <h2>Start with a little curiosity.</h2>
                  <p>What’s something you’re looking forward to this week?</p>
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const text = String(f.get("text")).trim();
                if (!text) return;
                const key =
                  retryMessage.current?.text === text
                    ? retryMessage.current.id
                    : crypto.randomUUID();
                retryMessage.current = { text, id: key };
                void act(async () => {
                  await api(`/conversations/${mid}/messages`, "POST", {
                    text,
                    clientMessageId: key,
                  });
                  retryMessage.current = null;
                  form.reset();
                  await refresh();
                });
              }}
            >
              <label className="sr-only" htmlFor="message-text">
                Your message
              </label>
              <input
                id="message-text"
                name="text"
                maxLength={2000}
                placeholder="A thoughtful hello…"
                required
                autoComplete="off"
              />
              <button aria-label="Send message" disabled={busy}>
                <Send size={18} />
              </button>
            </form>
          </div>
          <aside className="form-stack">
            <div className="note-card lavender">
              <CalendarDays size={24} />
              <h2>Take it off the chat.</h2>
              <p>
                Find a date you can both feel good about. Your budget stays
                yours.
              </p>
              {button("Plan a date", async () => {
                const p = await api("/date-plans", "POST", { matchId: mid });
                go(`/dates/${p.id}`);
              })}
            </div>
            {m && (
              <div className="note-card">
                <h3>Your boundaries matter.</h3>
                {button(
                  "Report",
                  async () => {
                    const notes = window.prompt(
                      "Tell us what happened (up to 2000 characters).",
                    );
                    if (notes === null) return;
                    const result = await api("/reports", "POST", {
                      subjectId: m.profile.user_id,
                      category: "other",
                      notes,
                    });
                    setNotice(result.message);
                  },
                  "secondary",
                )}
                {button(
                  "Block member",
                  async () => {
                    if (
                      !confirm(
                        "Block this member and close chat? Paid tickets will be reconciled separately.",
                      )
                    )
                      return;
                    await api("/blocks", "POST", {
                      targetId: m.profile.user_id,
                    });
                    go("/chats");
                  },
                  "danger",
                )}
                {button(
                  "Unmatch",
                  async () => {
                    if (!confirm("Close this match and cancel open plans?"))
                      return;
                    await api(`/matches/${mid}`, "DELETE");
                    go("/chats");
                  },
                  "secondary",
                )}
              </div>
            )}
          </aside>
        </div>
      </>
    );
  } else if (path === "/dates") {
    content = (
      <>
        {heading(
          "SOMETHING TO LOOK FORWARD TO",
          "Good connections deserve good dates.",
          "A comfortable yes from both of you. Then a plan.",
        )}
        <div className="plans-grid">
          {Array.isArray(data) &&
            data.map((p: Row) => (
              <Link
                href={`/dates/${p.id}`}
                className="plan-card panel"
                key={p.id}
              >
                <span className="pill">{p.status.replaceAll("_", " ")}</span>
                <CalendarDays size={32} />
                <h2>{p.proposal?.snapshot.title || "A date in the making"}</h2>
                <p>
                  {p.proposal
                    ? when(p.proposal.starts_at)
                    : "Start with private preferences."}
                </p>
                <span className="text-link">
                  Make a little plan <ArrowUpRight size={15} />
                </span>
              </Link>
            ))}
        </div>
        {Array.isArray(data) && !data.length && (
          <div className="empty panel">
            <CalendarDays />
            <h2>Your calendar has room for a little possibility.</h2>
            <p>Open a matched chat to start planning a date.</p>
            <Link href="/chats" className="button">
              Your conversations
            </Link>
          </div>
        )}
        <Link href="/payments" className="text-link">
          Your private receipts <ArrowRight size={15} />
        </Link>
      </>
    );
  } else if (path.startsWith("/dates/") && data?.id) {
    const p = data,
      proposal = p.proposal,
      closed = ["cancelled", "expired", "completed"].includes(p.status);
    content = (
      <>
        {heading(
          "A PLAN THAT FEELS GOOD TO BOTH OF YOU",
          proposal?.snapshot.title || "Find your shared kind of good.",
        )}
        <div className="status-strip">
          <span className="pill">{p.status.replaceAll("_", " ")}</span>
          <span>
            Version {p.version} · {p.acceptanceCount}/2 accepted
          </span>
          <span>Financial status: {p.financialState.replaceAll("_", " ")}</span>
        </div>
        <div className="planning-layout">
          <div className="form-stack">
            {!closed &&
              !["confirmed", "payment_pending"].includes(p.status) && (
                <BudgetForm plan={p} />
              )}
            <div className="panel">
              <h2>Your preferences, considered.</h2>
              <p>
                {p.bothPreferences
                  ? "Both sets of preferences are saved."
                  : "Waiting for both members to save their private preferences."}
              </p>
              {!closed &&
                button(
                  "Find shared possibilities",
                  async () => {
                    const result = await api(
                      `/date-plans/${p.id}/suggestions`,
                      "POST",
                      {},
                    );
                    setData({ ...p, suggestions: result.options });
                    setNotice(
                      result.options.length
                        ? result.label
                        : "No shared option fits right now. Consider a free public walk or explicitly edit your preferences.",
                    );
                  },
                  "secondary",
                )}
              {p.suggestions?.length > 0 &&
                button(
                  "Try connected planner",
                  async () => {
                    if (
                      !window.confirm(
                        "Allow the configured planner to receive eligible public catalogue entries and their listed prices? Exact private budgets, messages and identity are excluded. The eligible price range may still imply preferences. No reservation or payment will be made.",
                      )
                    )
                      return;
                    const result = await api(
                      `/date-plans/${p.id}/suggestions`,
                      "POST",
                      {
                        useExternalProvider: true,
                        allowExternalProcessing: true,
                      },
                    );
                    setData({ ...p, suggestions: result.options });
                    setNotice(result.label);
                  },
                  "secondary",
                )}
              {p.suggestions?.map((x: Row) => (
                <article className="suggestion" key={x.id}>
                  <div className="suggestion-icon">
                    {x.activity === "Coffee" ? (
                      <Coffee />
                    ) : x.activity === "Art" ? (
                      <Palette />
                    ) : (
                      <Leaf />
                    )}
                  </div>
                  <div>
                    <h3>{x.title}</h3>
                    <p>{x.description}</p>
                    <p>
                      <strong>{dollars(x.price_cents)} per person</strong> ·{" "}
                      {x.duration_minutes} minutes
                    </p>
                    <small>{x.accessibility}</small>
                    {button(
                      "Propose this date",
                      async () => {
                        await api(`/date-plans/${p.id}/proposals`, "POST", {
                          optionId: x.id,
                          startsAt: x.earliestStart,
                          expectedVersion: p.version,
                        });
                        await refresh();
                      },
                      "secondary",
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <aside className="form-stack">
            {proposal ? (
              <div className="panel proposal">
                <span className="eyebrow">YOUR SHARED PLAN</span>
                <h2>{proposal.snapshot.title}</h2>
                <p>{proposal.snapshot.address}</p>
                <p>{when(proposal.starts_at)}</p>
                <dl>
                  <div>
                    <dt>Two-person total</dt>
                    <dd>{dollars(proposal.snapshot.price_cents * 2)}</dd>
                  </div>
                  <div>
                    <dt>Your independent ticket</dt>
                    <dd>{dollars(proposal.snapshot.price_cents)}</dd>
                  </div>
                  <div>
                    <dt>Fees and taxes</dt>
                    <dd>Included</dd>
                  </div>
                </dl>
                <p className="muted">
                  Fictional demo merchant · no real reservation.
                </p>
                <p>{proposal.snapshot.policy}</p>
                {!closed &&
                  !["confirmed", "payment_pending"].includes(p.status) &&
                  !p.acceptedByYou &&
                  button("This feels good — accept", async () => {
                    await api(`/date-plans/${p.id}/accept`, "POST", {
                      proposalVersion: p.version,
                    });
                    await refresh();
                  })}
                {p.acceptedByYou && (
                  <p className="saved">
                    <Check size={17} />
                    You accepted this version.
                  </p>
                )}
                {p.acceptanceCount === 2 &&
                  proposal.snapshot.price_cents > 0 &&
                  !closed &&
                  button("Open my ticket checkout", async () => {
                    const purchase = await api("/purchases", "POST", {
                      planId: p.id,
                      proposalVersion: p.version,
                    });
                    go(`/checkout/${purchase.purchaseId}`);
                  })}
                <p className="muted">
                  Accepting a plan does not authorize a charge. Each person
                  chooses and pays independently.
                </p>
                <p>
                  Your ticket: {p.yourTicket}. Partner ticket:{" "}
                  {p.partnerPaid ? "paid" : "not yet paid"}.
                </p>
              </div>
            ) : (
              <div className="note-card lavender">
                <Heart size={25} />
                <h2>A shared yes is a good start.</h2>
                <p>
                  Save preferences, explore suggestions, and propose a date.
                  Both people accept the same version before checkout.
                </p>
              </div>
            )}
            {!closed &&
              button(
                "Cancel this plan",
                async () => {
                  if (
                    !confirm(
                      "Cancel this date? Any paid demo tickets will be sent for refund reconciliation.",
                    )
                  )
                    return;
                  await api(`/date-plans/${p.id}/cancel`, "POST", {
                    expectedVersion: p.version,
                  });
                  await refresh();
                },
                "danger",
              )}
            <Link href="/payments" className="text-link">
              View your receipts <ArrowRight size={16} />
            </Link>
          </aside>
        </div>
      </>
    );
  } else if (path.startsWith("/checkout/") && data?.payment) {
    const p = data,
      pay = p.payment;
    content = (
      <>
        {heading("YOUR CHOICE. YOUR TICKET.", "One thoughtful first date.")}
        <div className="checkout panel">
          <span className="pill">
            {config.paymentMode === "mock"
              ? "MOCK · NO PAYPAL CONNECTION"
              : "PAYPAL SANDBOX · NO REAL MONEY"}
          </span>
          <h2>{p.snapshot.title}</h2>
          <p>Fictional BaePal Demo Merchant · No real reservation</p>
          <dl>
            <div>
              <dt>Your ticket · all-in USD</dt>
              <dd>{dollars(p.amount_cents)}</dd>
            </div>
            <div>
              <dt>Payment status</dt>
              <dd>{pay.state}</dd>
            </div>
          </dl>
          <p>{p.snapshot.policy}</p>
          {!["completed", "refunded"].includes(pay.state) && (
            <>
              {button(
                config.paymentMode === "mock"
                  ? "Create mock order"
                  : "Continue to PayPal Sandbox",
                async () => {
                  const result = await api("/payments/orders", "POST", {
                    paymentId: pay.id,
                  });
                  if (result.approvalUrl) {
                    const url = new URL(result.approvalUrl);
                    if (
                      url.protocol !== "https:" ||
                      ![
                        "www.sandbox.paypal.com",
                        "sandbox.paypal.com",
                      ].includes(url.hostname)
                    )
                      throw Error("Unexpected approval destination.");
                    window.location.assign(url.href);
                  } else {
                    setNotice(
                      "Mock order created. The next action simulates provider capture; no PayPal call is made.",
                    );
                    await refresh();
                  }
                },
              )}
              {pay.order_id &&
                button(
                  config.paymentMode === "mock"
                    ? "Simulate mock capture"
                    : "I approved in Sandbox — verify & capture",
                  async () => {
                    await api(`/payments/${pay.id}/capture`, "POST", {});
                    go(`/payments/${pay.id}`);
                  },
                  "secondary",
                )}
            </>
          )}
          <p className="muted">
            A cancelled approval does not pay for a ticket. Capture verification
            is required. Both tickets must be paid before the date is confirmed.
          </p>
          <Link href={`/payments/${pay.id}`} className="text-link">
            View my private receipt <ArrowRight size={15} />
          </Link>
        </div>
      </>
    );
  } else if (path === "/payments") {
    content = (
      <>
        {heading("JUST YOURS", "Your private receipts.")}
        <div className="plans-grid">
          {Array.isArray(data) &&
            data.map((p: Row) => (
              <Link
                href={`/payments/${p.id}`}
                key={p.id}
                className="panel plan-card"
              >
                <Receipt />
                <span className="pill">
                  {p.mode} · {p.state}
                </span>
                <h2>{p.snapshot.title}</h2>
                <p>{dollars(p.amount_cents)}</p>
              </Link>
            ))}
        </div>
        {Array.isArray(data) && !data.length && (
          <p className="panel">No purchases yet.</p>
        )}
      </>
    );
  } else if (path.startsWith("/payments/") && data?.id) {
    const p = data;
    content = (
      <>
        {heading("YOUR PRIVATE RECORD", "A little clarity.")}
        <div className="panel checkout">
          <span className="pill">
            {p.mode.toUpperCase()} · {p.state.toUpperCase()}
          </span>
          <h2>{p.snapshot.title}</h2>
          <p>Fictional BaePal Demo Merchant</p>
          <dl>
            <div>
              <dt>Your amount</dt>
              <dd>{dollars(p.amount_cents)} USD</dd>
            </div>
            <div>
              <dt>Order reference</dt>
              <dd className="reference">{p.order_id || "Not created"}</dd>
            </div>
            <div>
              <dt>Capture reference</dt>
              <dd className="reference">{p.capture_id || "Not captured"}</dd>
            </div>
          </dl>
          <h3>Refund history</h3>
          {p.refunds.length ? (
            p.refunds.map((r: Row, i: number) => (
              <p key={i}>
                {dollars(r.amount_cents)} · {r.state} ·{" "}
                {r.provider_id || "Awaiting provider evidence"}
              </p>
            ))
          ) : (
            <p>
              No refunds recorded. Cancel the plan to request the full demo
              ticket refund.
            </p>
          )}
          <p className="muted">
            Your match cannot see your payer details or this receipt.{" "}
            {p.mode === "mock"
              ? "This record uses deterministic fixtures. It is not PayPal evidence."
              : "Sandbox uses test funds only."}
          </p>
          <Link href="/dates" className="text-link">
            Back to your plans <ArrowRight size={15} />
          </Link>
        </div>
      </>
    );
  } else if (path === "/profile" && me) {
    content = (
      <>
        {heading(
          "THE LITTLE THINGS THAT MAKE YOU, YOU.",
          "Your corner of BaePal.",
        )}
        <div className="profile-layout">
          <ProfileCard p={me.profile} />
          <aside className="form-stack">
            <Link className="button" href="/profile/edit">
              Edit profile & preferences <ArrowUpRight size={17} />
            </Link>
            <Link className="button secondary" href="/settings/account">
              Account & privacy
            </Link>
            <Link className="button secondary" href="/settings/verification">
              Connection center
            </Link>
            <Link className="button secondary" href="/payments">
              My private receipts
            </Link>
            <div className="note-card lavender">
              <ShieldCheck />
              <h2>Simply, honestly you.</h2>
              <p>
                Email confirmation means contact email confirmed. It doesn’t
                verify legal identity or age.
              </p>
              <span className="pill">Status: {me.status}</span>
            </div>
          </aside>
        </div>
      </>
    );
  } else if (path === "/settings/integrations") {
    content = <IntegrationWorkspace api={api} />;
  } else if (path === "/settings/verification") {
    content = (
      <>
        {heading(
          "A LITTLE CONTEXT. ALWAYS OPTIONAL.",
          "Connections, explained.",
        )}
        <div className="panel">
          <h2>Professional connections</h2>
          <p>
            LinkedIn and GitHub account connection adapters are not implemented
            in this milestone. No connected badge is displayed or fabricated.
          </p>
          <p>
            A connection would show account control, not employment validation,
            identity verification, or a safety guarantee. Your experience is
            complete without a professional connection.
          </p>
          <span className="pill">Unavailable · not configured</span>
        </div>
      </>
    );
  } else if (path === "/settings/account" && me) {
    content = (
      <>
        {heading("MAKE YOURSELF COMFORTABLE", "Your account & privacy.")}
        <div className="form-stack settings">
          <Link className="button secondary" href="/settings/integrations">
            Connected services
          </Link>
          <div className="panel">
            <h2>Take your time.</h2>
            <p>
              Pausing hides your profile from discovery. Existing matches remain
              accessible.
            </p>
            {button(
              me.status === "paused" ? "Resume discovery" : "Pause discovery",
              async () => {
                await api(
                  `/me/${me.status === "paused" ? "resume" : "pause"}`,
                  "POST",
                  {},
                );
                await refresh();
              },
              "secondary",
            )}
          </div>
          <form
            className="panel form-stack"
            onSubmit={submit(async (f) => {
              const result = await api("/me/export", "POST", {
                password: f.get("password"),
              });
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(result, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "baepal-my-data.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice("Your private export is ready.");
            })}
          >
            <h2>Your data belongs with you.</h2>
            <label>
              {config.hosted
                ? "ChatGPT access protects this workspace; no demo password is needed"
                : "Confirm password"}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                disabled={config.hosted}
                required={!config.hosted}
              />
            </label>
            <button className="secondary" disabled={busy}>
              Download my data
            </button>
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={(e) => {
                const form = e.currentTarget.form!;
                const password = String(
                  new FormData(form).get("password") || "",
                );
                void act(async () => {
                  if (
                    !confirm(
                      "Permanently delete dating content and revoke access? Local financial records remain for refund reconciliation.",
                    )
                  )
                    return;
                  await api("/me", "DELETE", { password });
                  csrf.current = "";
                  setMe(null);
                  go("/");
                });
              }}
            >
              Delete account
            </button>
          </form>
          <div className="panel">
            <h2>See you when you’re ready.</h2>
            {button(
              "Log out",
              async () => {
                await api("/auth/logout", "POST", {});
                csrf.current = "";
                setMe(null);
                go("/");
              },
              "secondary",
            )}
          </div>
        </div>
      </>
    );
  } else if (path === "/admin/reports") {
    content = (
      <>
        {heading("RESTRICTED WORKSPACE", "Report queue.")}
        <div className="panel">
          {Array.isArray(data) &&
            data.map((r: Row) => (
              <div className="suggestion" key={r.id}>
                <div>
                  <h3>{r.category}</h3>
                  <p>{r.state}</p>
                  {button(
                    "Mark reviewed",
                    async () => {
                      const reason = prompt("Reason for marking reviewed");
                      if (!reason) return;
                      await api(`/admin/reports/${r.id}`, "PATCH", {
                        state: "reviewed",
                        reason,
                      });
                      await refresh();
                    },
                    "secondary",
                  )}
                </div>
              </div>
            ))}
        </div>
      </>
    );
  } else {
    content = loading ? null : (
      <div className="panel">
        {heading("LET’S FIND YOUR WAY", "This page is unavailable.")}
        <Link className="button secondary" href="/discover">
          Back to Discover
        </Link>
      </div>
    );
  }
  const shell =
    path !== "/" &&
    !path.startsWith("/auth/") &&
    !["/safety", "/privacy", "/terms"].includes(path);
  return (
    <>
      <div className="demo-banner">
        <span>✦</span>{" "}
        {config.hosted
          ? "Private prototype workspace. Fictional personas, persistent demo data."
          : "A work in progress, made for connection."}{" "}
        <strong>
          Fictional hackathon demo ·{" "}
          {config.paymentMode === "sandbox"
            ? "PayPal Sandbox"
            : "mock payments"}
        </strong>
      </div>
      {shell ? (
        <div className="app-shell">
          <aside className={`sidebar ${menu ? "open" : ""}`}>
            <Link href="/" className="wordmark">
              <Heart fill="currentColor" />
              bae<span>pal</span>
              <i>✦</i>
            </Link>
            <span className="sidebar-caption">
              MAKE ROOM FOR SOMETHING REAL.
            </span>
            <nav aria-label="Main navigation">
              {nav.map(({ href, label, Icon }) => (
                <Link
                  className={
                    path === href || path.startsWith(href + "/") ? "active" : ""
                  }
                  href={href}
                  key={href}
                  onClick={() => setMenu(false)}
                >
                  <Icon size={20} />
                  {label}
                  {label === "Chats" && matches.length > 0 && (
                    <span className="nav-count">{matches.length}</span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="sidebar-note">
                <Leaf size={22} />
                <p>
                  Good things take
                  <br />a little intention.
                </p>
              </div>
              <Link href="/safety">
                <ShieldCheck size={17} />
                Safety & care <ArrowUpRight size={14} />
              </Link>
              {me && (
                <div className="me-mini">
                  <img
                    src={me.profile.photos[0] || "/portraits/0.svg"}
                    alt="Your illustration"
                  />
                  <div>
                    <strong>{me.profile.display_name || "Your account"}</strong>
                    <small>
                      {me.status === "active"
                        ? "Here with intention"
                        : me.status}
                    </small>
                  </div>
                  <Link href="/settings/account" aria-label="Account settings">
                    <LogOut size={17} />
                  </Link>
                </div>
              )}
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <button
                className="mobile-menu secondary"
                aria-label="Toggle navigation"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Menu size={20} />
              </button>
              <span>YOUR NEXT CHAPTER STARTS WITH A HELLO.</span>
              <div>
                <span className="tiny-star">✦</span>
                <span>A little more intentional.</span>
                {config.hosted && (
                  <label className="persona-picker">
                    <span className="sr-only">Demo persona</span>
                    <select
                      aria-label="Demo persona"
                      value={
                        ["Alex", "Jordan", "Sam", "Parker"].includes(
                          me?.profile.display_name,
                        )
                          ? me?.profile.display_name
                          : ""
                      }
                      disabled={busy}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (name)
                          void act(async () => {
                            await api("/auth/login", "POST", {
                              email:
                                name.toLowerCase() + "@demo.baepal.invalid",
                            });
                            // A fresh document resets drafts and any in-flight polling
                            // from the previous fictional actor before rendering the next.
                            window.location.reload();
                          });
                      }}
                    >
                      <option value="">Switch demo</option>
                      {["Alex", "Jordan", "Sam", "Parker"].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                )}
                <Link href="/profile" aria-label="Your profile">
                  <UserRound size={19} />
                </Link>
              </div>
            </header>
            <main className="main-content" key={me?.id || "anonymous"}>
              {loading && (
                <div className="loading-line" role="status">
                  <LoaderCircle size={18} className="spin" />
                  Bringing things together…
                </div>
              )}
              {error && (
                <div className="alert error" role="alert">
                  {error}
                  <button
                    className="secondary"
                    onClick={() =>
                      void act(async () => {
                        await refresh();
                      })
                    }
                  >
                    Retry
                  </button>
                </div>
              )}
              {notice && (
                <div className="alert" role="status">
                  {notice}
                  <button
                    className="icon"
                    aria-label="Dismiss notification"
                    onClick={() => setNotice("")}
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
              {content}
            </main>
            <div className="workspace-footer">
              A little spark. A real connection.{" "}
              <span>BaePal · Seattle pilot · Adults 18+</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          {(error || notice) && (
            <div
              className={`alert floating-alert ${error ? "error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {error || notice}
              <button
                className="icon"
                aria-label="Dismiss"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {content}
        </>
      )}
    </>
  );
}
