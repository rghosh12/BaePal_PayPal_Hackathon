import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config.js";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const keyed = (value: string) =>
  createHmac("sha256", config.SESSION_SECRET).update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.FIELD_ENCRYPTION_KEY, "hex"),
    iv,
  );
  const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    bytes.toString("hex"),
  ].join(":");
}
export function decrypt(value: string) {
  const [version, iv, tag, bytes] = value.split(":");
  if (version !== "v1") throw Error("Unknown encryption version");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config.FIELD_ENCRYPTION_KEY, "hex"),
    Buffer.from(iv, "hex"),
  );
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    d.update(Buffer.from(bytes, "hex")),
    d.final(),
  ]).toString();
}
export function ageOn(birth: string, now = new Date()) {
  const b = new Date(`${birth}T12:00:00Z`);
  if (Number.isNaN(b.getTime()) || b.toISOString().slice(0, 10) !== birth)
    return -1;
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())
  )
    age--;
  return age;
}
