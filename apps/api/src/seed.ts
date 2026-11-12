import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { db, tx } from "./db.js";
import { config } from "./config.js";
import { encrypt } from "./crypto.js";
if (config.DEMO_MODE !== "true")
  throw Error("Seed requires DEMO_MODE=true on local/staging.");
const names = [
  "Alex",
  "Jordan",
  "Sam",
  "Riley",
  "Taylor",
  "Morgan",
  "Casey",
  "Avery",
  "Quinn",
  "Jamie",
  "Sage",
  "Rowan",
  "Emerson",
  "Finley",
  "Reese",
  "Parker",
];
const bios = [
  "A slow Sunday, a strong coffee, and a conversation that goes somewhere.",
  "Collecting little adventures and very good book recommendations.",
  "Happiest near the water. Looking for someone to share the scenic route.",
  "Equal parts curious and considerate. Let’s make a new favorite memory.",
];
const password = await argon2.hash("Demo-Only-2026!");
// Seattle local opening hours [open, close] in whole hours, 24 = midnight.
const VENUE_FACTS: Record<
  string,
  { neighborhood: string; stepFree: boolean; hours: [number, number] }
> = {
  coffee: { neighborhood: "Waterfront", stepFree: true, hours: [7, 22] },
  art: { neighborhood: "Capitol Hill", stepFree: true, hours: [10, 22] },
  walk: { neighborhood: "Waterfront", stepFree: true, hours: [0, 24] },
  bookshop: { neighborhood: "Fremont", stepFree: false, hours: [9, 22] },
  pottery: { neighborhood: "Ballard", stepFree: false, hours: [12, 22] },
  acoustic: { neighborhood: "Capitol Hill", stepFree: true, hours: [17, 24] },
  picnic: { neighborhood: "Wallingford", stepFree: true, hours: [6, 22] },
  foodtrucks: {
    neighborhood: "South Lake Union",
    stepFree: true,
    hours: [11, 22],
  },
};
await tx(async (c) => {
  for (let i = 0; i < names.length; i++) {
    const email = `${names[i].toLowerCase()}@demo.baepal.invalid`;
    if ((await c.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount)
      continue;
    const id = randomUUID();
    await c.query(
      "INSERT INTO users(id,email,password_hash,status,confirmed_at) VALUES($1,$2,$3,'active',now())",
      [id, email, password],
    );
    await c.query(
      "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,$2,$3,$4)",
      [
        id,
        `${1990 + (i % 8)}-06-15`,
        i % 3 === 0 ? "Nonbinary" : i % 3 === 1 ? "Woman" : "Man",
        ["Woman", "Man", "Nonbinary"],
      ],
    );
    await c.query(
      "INSERT INTO profiles(user_id,display_name,bio,interests,prompts,photos) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        names[i],
        bios[i % 4],
        [
          ["Coffee", "Art", "Books", "Museums"],
          ["Coffee", "Art", "Hiking", "Live music"],
          ["Hiking", "Kayaking", "Picnics", "Photography"],
          ["Books", "Board games", "Coffee", "Film"],
          ["Live music", "Food trucks", "Dancing", "Comedy"],
          ["Pottery", "Art", "Farmers markets", "Cooking"],
        ][i % 6],
        JSON.stringify(
          [
            [
              {
                question: "My perfect first date",
                answer: "A little art, a long walk, and no rush.",
              },
              {
                question: "Together we could",
                answer: "Find the best hidden bookstore in Seattle.",
              },
            ],
            [
              {
                question: "My perfect first date",
                answer:
                  "Coffee somewhere with big windows, then a gallery we've never been to.",
              },
              {
                question: "Together we could",
                answer: "Catch a tiny acoustic show and argue about the setlist.",
              },
            ],
            [
              {
                question: "My perfect first date",
                answer: "A sunrise trail, a thermos, and good snacks.",
              },
              {
                question: "Together we could",
                answer: "Kayak Lake Union and photograph the houseboats.",
              },
            ],
            [
              {
                question: "My perfect first date",
                answer: "A board game café where I will absolutely lose at Catan.",
              },
              {
                question: "Together we could",
                answer: "Start a two-person book club with very strong opinions.",
              },
            ],
            [
              {
                question: "My perfect first date",
                answer: "Food trucks, a comedy set, and dancing badly after.",
              },
              {
                question: "Together we could",
                answer: "Try every taco truck in Fremont.",
              },
            ],
            [
              {
                question: "My perfect first date",
                answer: "Getting our hands messy at a pottery wheel.",
              },
              {
                question: "Together we could",
                answer: "Cook dinner from whatever the farmers market has.",
              },
            ],
          ][i % 6],
        ),
        [`/portraits/${i % 6}.svg`, `/portraits/${(i + 1) % 6}.svg`],
      ],
    );
  }
  const modEmail = "moderator@demo.baepal.invalid";
  if (
    !(await c.query("SELECT 1 FROM users WHERE email=$1", [modEmail])).rowCount
  ) {
    const id = randomUUID();
    await c.query(
      "INSERT INTO users(id,email,password_hash,status,role,confirmed_at) VALUES($1,$2,$3,'active','moderator',now())",
      [id, modEmail, password],
    );
    await c.query(
      "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1985-03-01','Nonbinary',$2)",
      [id, ["Woman", "Man", "Nonbinary"]],
    );
    await c.query(
      "INSERT INTO profiles(user_id,display_name,bio,interests,prompts,photos) VALUES($1,'Robin (BaePal safety)','Fictional demo moderator. Staff accounts never appear in Discover.','{}','[]','{}')",
      [id],
    );
  }
  const userId = async (name: string) =>
    (
      await c.query("SELECT id FROM users WHERE email=$1", [
        `${name}@demo.baepal.invalid`,
      ])
    ).rows[0].id as string;
  // Fixtures for the moderation queue and safety flows.
  if (!(await c.query("SELECT 1 FROM reports")).rowCount)
    for (const [reporter, subject, category, notes] of [
      [
        "sam",
        "parker",
        "spam/scam",
        "Asked me to move to another app and buy a gift card before we met.",
      ],
      [
        "reese",
        "finley",
        "harassment",
        "Kept messaging after I said I wasn't interested.",
      ],
    ])
      await c.query(
        "INSERT INTO reports(id,reporter_id,subject_id,category,notes) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          await userId(reporter),
          await userId(subject),
          category,
          notes,
        ],
      );
  await c.query(
    "INSERT INTO blocks(actor_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [await userId("avery"), await userId("emerson")],
  );
  // A few incoming likes so the Likes inbox has content in the demo.
  for (const [actor, target] of [
    ["riley", "alex"],
    ["taylor", "alex"],
    ["morgan", "jordan"],
    ["casey", "jordan"],
  ])
    await c.query(
      "INSERT INTO decisions(actor_id,target_id,action,mutation_id) SELECT a.id,b.id,'like',$3 FROM users a, users b WHERE a.email=$1 AND b.email=$2 ON CONFLICT DO NOTHING",
      [
        `${actor}@demo.baepal.invalid`,
        `${target}@demo.baepal.invalid`,
        randomUUID(),
      ],
    );
  for (const x of [
    {
      id: "coffee",
      title: "A little coffee & a lot of conversation",
      activity: "Coffee",
      description:
        "A fictional coffee tasting for two at the demo BaePal café.",
      address: "Demo venue · Seattle waterfront",
      price: 1200,
      duration: 60,
    },
    {
      id: "art",
      title: "An evening of art & possibility",
      activity: "Art",
      description: "A fictional gallery visit with a guided sketching session.",
      address: "Demo venue · Capitol Hill, Seattle",
      price: 3000,
      duration: 90,
    },
    {
      id: "walk",
      title: "Take the scenic route",
      activity: "Hiking",
      description:
        "A free public walking idea. No booking, guide, or ticket is supplied.",
      address: "Public waterfront · Seattle",
      price: 0,
      duration: 60,
    },
    {
      id: "bookshop",
      title: "Bookshop & coffee session",
      activity: "Books",
      description:
        "A fictional hour browsing a demo bookshop, each picking a book for the other, plus a drink.",
      address: "Demo venue · Fremont, Seattle",
      price: 2000,
      duration: 75,
    },
    {
      id: "pottery",
      title: "Beginner pottery evening",
      activity: "Art",
      description:
        "A fictional hands-on wheel session for two beginners. Pieces are not fired or shipped.",
      address: "Demo studio · Ballard, Seattle",
      price: 3500,
      duration: 120,
    },
    {
      id: "acoustic",
      title: "Small-room acoustic set",
      activity: "Music",
      description:
        "A fictional intimate acoustic performance with reserved seats for two.",
      address: "Demo venue · Capitol Hill, Seattle",
      price: 2500,
      duration: 90,
    },
    {
      id: "picnic",
      title: "Community picnic in the park",
      activity: "Food",
      description:
        "A free public picnic idea. Bring your own snacks; no booking or ticket is supplied.",
      address: "Public park · Gas Works, Seattle",
      price: 0,
      duration: 90,
    },
    {
      id: "foodtrucks",
      title: "Food truck tasting crawl",
      activity: "Food",
      description:
        "A fictional tasting pass for four demo food trucks, shared between two people.",
      address: "Demo market · South Lake Union, Seattle",
      price: 1800,
      duration: 90,
    },
  ])
    await c.query(
      `INSERT INTO catalogue(id,title,activity,description,address,price_cents,duration_minutes,accessibility,policy,neighborhood,step_free,opens_minute,closes_minute,source)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Fictional demo catalogue (BaePal seed). Hours and access are invented for the demo.')
       ON CONFLICT(id) DO UPDATE SET neighborhood=EXCLUDED.neighborhood,step_free=EXCLUDED.step_free,opens_minute=EXCLUDED.opens_minute,closes_minute=EXCLUDED.closes_minute,accessibility=EXCLUDED.accessibility,source=EXCLUDED.source`,
      [
        x.id,
        x.title,
        x.activity,
        x.description,
        x.address,
        x.price,
        x.duration,
        VENUE_FACTS[x.id].stepFree
          ? "Demo listing says step-free entry. Check independently for real outings."
          : "Demo listing has steps at the entrance. Check independently for real outings.",
        "Full demo ticket refund on cancellation before the scheduled date.",
        VENUE_FACTS[x.id].neighborhood,
        VENUE_FACTS[x.id].stepFree,
        VENUE_FACTS[x.id].hours[0] * 60,
        VENUE_FACTS[x.id].hours[1] * 60,
      ],
    );
  // ---- Scenario fixtures (synthetic, labelled mock payments) ----------
  const ensureMatch = async (a: string, b: string) => {
    const [x, y] = [await userId(a), await userId(b)].sort();
    for (const [actor, target] of [
      [x, y],
      [y, x],
    ])
      await c.query(
        "INSERT INTO decisions(actor_id,target_id,action,mutation_id) VALUES($1,$2,'like',$3) ON CONFLICT DO NOTHING",
        [actor, target, randomUUID()],
      );
    return (
      await c.query(
        "INSERT INTO matches(id,low_id,high_id) VALUES($1,$2,$3) ON CONFLICT(low_id,high_id) DO UPDATE SET low_id=EXCLUDED.low_id RETURNING id",
        [randomUUID(), x, y],
      )
    ).rows[0].id as string;
  };
  const fixturePlan = async (
    matchId: string,
    creator: string,
    status: string,
    financial: string,
  ) => {
    const existing = await c.query(
      "SELECT id FROM date_plans WHERE match_id=$1",
      [matchId],
    );
    if (existing.rowCount) return null;
    return (
      await c.query(
        "INSERT INTO date_plans(id,match_id,creator_id,status,financial_state,version,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '3 days') RETURNING id",
        [randomUUID(), matchId, await userId(creator), status, financial, status === "collecting_preferences" ? 0 : 1],
      )
    ).rows[0].id as string;
  };
  const prefs = async (plan: string, who: string, budget: number, activities: string[]) =>
    c.query(
      "INSERT INTO private_date_preferences(plan_id,user_id,budget_encrypted,activities,time_start,time_end) VALUES($1,$2,$3,$4,now()+interval '1 day',now()+interval '1 day 6 hours') ON CONFLICT DO NOTHING",
      [plan, await userId(who), encrypt(String(budget)), activities],
    );
  const art = { id: "art", title: "An evening of art & possibility", activity: "Art", price_cents: 3000, duration_minutes: 90, address: "Demo venue · Capitol Hill, Seattle" };
  const proposeArt = async (plan: string, accepters: string[]) => {
    await c.query(
      "INSERT INTO proposals(plan_id,version,catalogue_id,starts_at,snapshot) VALUES($1,1,'art',date_trunc('hour',now())+interval '1 day 2 hours',$2) ON CONFLICT DO NOTHING",
      [plan, JSON.stringify(art)],
    );
    for (const who of accepters)
      await c.query("INSERT INTO acceptances VALUES($1,1,$2) ON CONFLICT DO NOTHING", [plan, await userId(who)]);
  };
  const ticket = async (plan: string, who: string, paymentState: string, purchaseState: string, refunded = false) => {
    const purchase = randomUUID(), payment = randomUUID();
    await c.query(
      "INSERT INTO purchases(id,plan_id,version,buyer_id,amount_cents,snapshot,state) VALUES($1,$2,1,$3,3000,$4,$5)",
      [purchase, plan, await userId(who), JSON.stringify(art), purchaseState],
    );
    await c.query(
      "INSERT INTO payments(id,purchase_id,mode,state,order_id,capture_id) VALUES($1,$2,'mock',$3,$4,$5)",
      [payment, purchase, paymentState, `MOCK-FIXTURE-${payment.slice(0, 8)}`, paymentState === "pending" ? null : `CAP-FIXTURE-${payment.slice(0, 8)}`],
    );
    if (refunded)
      await c.query(
        "INSERT INTO refunds(id,payment_id,amount_cents,provider_id,state,kind) VALUES($1,$2,3000,$3,'completed','cancellation')",
        [randomUUID(), payment, `REF-FIXTURE-${payment.slice(0, 8)}`],
      );
  };
  // No-results discovery preferences.
  await c.query(
    "UPDATE profile_private SET age_min=70,age_max=80 WHERE user_id=$1",
    [await userId("rowan")],
  );
  // No budget overlap: Sam's $0 budget and Riley's Art-only list share nothing.
  const noOverlap = await fixturePlan(await ensureMatch("sam", "riley"), "sam", "collecting_preferences", "unpaid");
  if (noOverlap) {
    await prefs(noOverlap, "sam", 0, ["Coffee"]);
    await prefs(noOverlap, "riley", 5000, ["Art"]);
  }
  // Pending capture: Taylor paid, Morgan's capture is still PENDING at PayPal.
  const pending = await fixturePlan(await ensureMatch("taylor", "morgan"), "taylor", "payment_pending", "partially_paid");
  if (pending) {
    await prefs(pending, "taylor", 4000, ["Art"]);
    await prefs(pending, "morgan", 4000, ["Art"]);
    await proposeArt(pending, ["taylor", "morgan"]);
    await ticket(pending, "taylor", "completed", "paid");
    await ticket(pending, "morgan", "pending", "created");
  }
  // Cancelled after both paid; both tickets fully refunded.
  const cancelled = await fixturePlan(await ensureMatch("casey", "quinn"), "casey", "cancelled", "refunded");
  if (cancelled) {
    await prefs(cancelled, "casey", 4000, ["Art"]);
    await prefs(cancelled, "quinn", 4000, ["Art"]);
    await proposeArt(cancelled, ["casey", "quinn"]);
    await ticket(cancelled, "casey", "refunded", "refunded", true);
    await ticket(cancelled, "quinn", "refunded", "refunded", true);
  }
  // A declined proposal waiting for a new idea.
  const declined = await fixturePlan(await ensureMatch("jamie", "sage"), "jamie", "collecting_preferences", "unpaid");
  if (declined) {
    await prefs(declined, "jamie", 4000, ["Art", "Coffee"]);
    await prefs(declined, "sage", 4000, ["Art", "Coffee"]);
    await proposeArt(declined, ["jamie"]);
    await c.query("DELETE FROM acceptances WHERE plan_id=$1", [declined]);
    await c.query("INSERT INTO proposal_declines(plan_id,version,user_id) VALUES($1,1,$2)", [declined, await userId("sage")]);
  }
});
console.log(
  "Seeded 16 fictional adults, a demo moderator, two open reports, one block and scenario fixtures (no-results filters, no budget overlap, pending capture, cancelled + refunded, declined proposal). Payments in fixtures are labelled mock. Local demo password is documented in README.",
);
await db.end();
