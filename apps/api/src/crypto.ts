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
// v2 ciphertexts name their key; previous keys stay decrypt-only until
// `pnpm keys:rotate` has re-encrypted every stored value.
export const keyId = (hex: string) => hash(`baepal-field-key:${hex}`).slice(0, 8);
const keyring = () => {
  const keys = [
    config.FIELD_ENCRYPTION_KEY,
    ...config.FIELD_ENCRYPTION_PREVIOUS_KEYS.split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  ];
  return new Map(keys.map((k) => [keyId(k), Buffer.from(k, "hex")]));
};
export const currentKeyId = () => keyId(config.FIELD_ENCRYPTION_KEY);
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.FIELD_ENCRYPTION_KEY, "hex"),
    iv,
  );
  const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
  return [
    "v2",
    currentKeyId(),
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    bytes.toString("hex"),
  ].join(":");
}
function open(key: Buffer, iv: string, tag: string, bytes: string) {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    d.update(Buffer.from(bytes, "hex")),
    d.final(),
  ]).toString();
}
export function decrypt(value: string) {
  const parts = value.split(":");
  const ring = keyring();
  if (parts[0] === "v2") {
    const key = ring.get(parts[1]);
    if (!key) throw Error("Encryption key is not configured");
    return open(key, parts[2], parts[3], parts[4]);
  }
  if (parts[0] !== "v1") throw Error("Unknown encryption version");
  // v1 values carry no key id; try the current key first, then previous keys.
  let last: unknown;
  for (const key of ring.values()) {
    try {
      return open(key, parts[1], parts[2], parts[3]);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
export const needsRotation = (value: string) =>
  !value.startsWith(`v2:${currentKeyId()}:`);
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
