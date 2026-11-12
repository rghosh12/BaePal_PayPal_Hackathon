import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { db, tx } from "./db.js";
import { config } from "./config.js";
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
      "INSERT INTO catalogue(id,title,activity,description,address,price_cents,duration_minutes,accessibility,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
      [
        x.id,
        x.title,
        x.activity,
        x.description,
        x.address,
        x.price,
        x.duration,
        "Demo catalogue: step-free route; accessibility must be independently checked for real outings.",
        "Full demo ticket refund on cancellation before the scheduled date.",
      ],
    );
});
console.log(
  "Seeded 16 fictional adults, a demo moderator, two open reports and one block. Local demo password is documented in README.",
);
await db.end();
