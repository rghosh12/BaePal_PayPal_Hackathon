import type { Env, State, Row } from "./types";
const enc = new TextEncoder();
const toHex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(
    new Uint8Array(
      value instanceof Uint8Array
        ? value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          )
        : value,
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
export async function digest(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
async function key(env: Env) {
  if (!/^[a-f0-9]{64}$/i.test(env.FIELD_ENCRYPTION_KEY || ""))
    throw Error("Prototype encryption key is not configured.");
  return crypto.subtle.importKey(
    "raw",
    fromHex(env.FIELD_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(value: State, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(env),
    enc.encode(JSON.stringify(value)),
  );
  return `v1:${toHex(iv)}:${toHex(data)}`;
}
async function open(value: string, env: Env): Promise<State> {
  const [version, iv, data] = value.split(":");
  if (version !== "v1") throw Error("Unknown state version");
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromHex(iv) },
        await key(env),
        fromHex(data),
      ),
    ),
  );
}
export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export function seed(): State {
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
  return {
    users: names.map((name, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      email: `${name.toLowerCase()}@demo.baepal.invalid`,
      kind: "demo",
      status: "active",
      role: i === 15 ? "moderator" : "member",
      display_name: name,
      bio: [
        "A slow Sunday, a strong coffee, and a conversation that goes somewhere.",
        "Collecting little adventures and good book recommendations.",
        "Happiest by the water. Let’s take the scenic route.",
        "Curious, considerate, and here with intention.",
      ][i % 4],
      city: "Seattle",
      intention: [
        "Long-term relationship",
        "Marriage-minded",
        "Exploring intentionally",
      ][i % 3],
      interests: ["Coffee", "Art", i % 2 ? "Hiking" : "Books"],
      prompts: [
        {
          question: "My perfect first date",
          answer: "A little art, a long walk, and no rush.",
        },
        {
          question: "Together we could",
          answer: "Find a new favorite bookstore in Seattle.",
        },
      ],
      photos: [`/portraits/${i % 6}.svg`, `/portraits/${(i + 1) % 6}.svg`],
      version: 1,
      privateProfile: {
        birth_date: `${1990 + (i % 8)}-06-15`,
        gender: ["Nonbinary", "Woman", "Man"][i % 3],
        genders: ["Nonbinary", "Woman", "Man"],
        age_min: 18,
        age_max: 99,
      },
    })),
    decisions: [],
    matches: [],
    messages: [],
    plans: [],
    purchases: [],
    payments: [],
    reports: [],
    rates: {},
  };
}
export async function load(owner: string, env: Env) {
  const id = await digest(`baepal:${owner}`);
  let row = await env.DB.prepare(
    "SELECT version,state FROM prototype_workspaces WHERE id=?",
  )
    .bind(id)
    .first<{ version: number; state: string }>();
  if (!row) {
    await env.DB.prepare(
      "INSERT INTO prototype_workspaces(id,version,state,updated_at) VALUES(?,0,?,?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(id, await seal(seed(), env), now())
      .run();
    row = await env.DB.prepare(
      "SELECT version,state FROM prototype_workspaces WHERE id=?",
    )
      .bind(id)
      .first<{ version: number; state: string }>();
  }
  if (!row) throw Error("Workspace unavailable");
  return { id, version: row.version, state: await open(row.state, env) };
}
export async function mutate<T>(
  owner: string,
  env: Env,
  fn: (state: State) => Promise<T> | T,
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await load(owner, env);
    const result = await fn(loaded.state);
    const json = JSON.stringify(loaded.state);
    if (new TextEncoder().encode(json).byteLength > 750000)
      throw Object.assign(
        Error(
          "Prototype storage limit reached. Export your data before starting a fresh workspace.",
        ),
        { status: 422, code: "STORAGE_LIMIT" },
      );
    const changed = await env.DB.prepare(
      "UPDATE prototype_workspaces SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?",
    )
      .bind(await seal(loaded.state, env), now(), loaded.id, loaded.version)
      .run();
    if (changed.meta.changes === 1) return result;
  }
  throw Object.assign(Error("Another action changed this workspace. Retry."), {
    status: 409,
    code: "VERSION_CONFLICT",
  });
}
export function age(date: string) {
  const d = new Date(date + "T12:00:00Z"),
    n = new Date();
  if (
    !date ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== date
  )
    return -1;
  return (
    n.getUTCFullYear() -
    d.getUTCFullYear() -
    Number(
      n.getUTCMonth() < d.getUTCMonth() ||
        (n.getUTCMonth() === d.getUTCMonth() &&
          n.getUTCDate() < d.getUTCDate()),
    )
  );
}
export function profile(u: Row) {
  return {
    user_id: u.id,
    display_name: u.display_name,
    bio: u.bio,
    city: u.city,
    intention: u.intention,
    interests: u.interests,
    prompts: u.prompts,
    photos: u.photos,
    version: u.version,
    age: age(u.privateProfile.birth_date),
  };
}
export const catalogue = [
  {
    id: "coffee",
    title: "A little coffee & a lot of conversation",
    activity: "Coffee",
    description: "A fictional tasting for two at the BaePal demo café.",
    address: "Demo venue · Seattle waterfront",
    price_cents: 1200,
    duration_minutes: 60,
  },
  {
    id: "art",
    title: "An evening of art & possibility",
    activity: "Art",
    description: "A fictional gallery visit with guided sketching.",
    address: "Demo venue · Capitol Hill, Seattle",
    price_cents: 3000,
    duration_minutes: 90,
  },
  {
    id: "walk",
    title: "Take the scenic route",
    activity: "Hiking",
    description:
      "A free public walking idea. No booking, guide or ticket is supplied.",
    address: "Public waterfront · Seattle",
    price_cents: 0,
    duration_minutes: 60,
  },
].map((x) => ({
  ...x,
  accessibility:
    "Demo catalogue: step-free concept. Independently check accessibility for real outings.",
  policy:
    "Fictional mock tickets: full simulated refund on cancellation. No real money or reservation.",
}));
