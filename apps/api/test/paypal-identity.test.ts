import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { hash } from "../src/crypto.js";
import { config } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { publicProfile } from "../src/domain.js";
if (!new URL(config.DATABASE_URL).pathname.endsWith("_test"))
  throw Error("Identity tests require a dedicated _test database.");
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let user: { id: string; token: string; csrf: string };
const req = (method: string, url: string) =>
  app.inject({
    method: method as any,
    url: "/api/v1" + url,
    headers: {
      origin: config.APP_ORIGIN,
      cookie: "baepal=" + user.token,
      "x-csrf-token": user.csrf,
    },
  });
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  user = { id: randomUUID(), token: randomUUID(), csrf: randomUUID() };
  await db.query(
    "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'synthetic-unused','active')",
    [user.id, user.id + "@identity.test.invalid"],
  );
  await db.query(
    "INSERT INTO profile_private(user_id,birth_date,gender,genders) VALUES($1,'1990-01-01','Woman','{Man}')",
    [user.id],
  );
  await db.query(
    "INSERT INTO profiles(user_id,display_name,bio,interests,prompts,photos) VALUES($1,'Synthetic','','{}','[]','{}')",
    [user.id],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(user.token), user.id, user.csrf],
  );
  ({ app } = await buildApp());
});
afterEach(async () => {
  if (app) await app.close();
});
afterAll(async () => {
  await db.query("TRUNCATE users,catalogue CASCADE");
  await db.end();
});
describe("Log in with PayPal badge", () => {
  it("links a labelled mock identity, shows the badge and unlinks", async () => {
    expect((await publicProfile(db, user.id)).paypal_verified).toBe(false);
    const start = await req("GET", "/auth/paypal/start");
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("/profile?paypal=linked");
    expect((await publicProfile(db, user.id)).paypal_verified).toBe(true);
    const status = (await req("GET", "/me/paypal")).json().data;
    expect(status).toMatchObject({ linked: true, verified: true, mode: "mock" });
    await req("DELETE", "/me/paypal");
    expect((await publicProfile(db, user.id)).paypal_verified).toBe(false);
  });
  it("rejects a callback without the matching state cookie", async () => {
    const r = await req("GET", "/auth/paypal/callback?code=abc&state=forged");
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain("paypal=failed");
    expect((await publicProfile(db, user.id)).paypal_verified).toBe(false);
  });
});
