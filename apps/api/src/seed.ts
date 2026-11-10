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
        ["Coffee", "Art", i % 2 ? "Hiking" : "Books"],
        JSON.stringify([
          {
            question: "My perfect first date",
            answer: "A little art, a long walk, and no rush.",
          },
          {
            question: "Together we could",
            answer: "Find the best hidden bookstore in Seattle.",
          },
        ]),
        [`/portraits/${i % 6}.svg`, `/portraits/${(i + 1) % 6}.svg`],
      ],
    );
  }
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
  "Seeded 16 fictional adults. Local demo password is documented in README.",
);
await db.end();
