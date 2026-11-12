// Re-encrypts every stored field with FIELD_ENCRYPTION_KEY. Put the old key
// in FIELD_ENCRYPTION_PREVIOUS_KEYS first, run this, then remove it.
import { db } from "./db.js";
import { currentKeyId } from "./crypto.js";
import { rotateFieldKeys } from "./ops.js";

const counts = await rotateFieldKeys();
console.log(
  JSON.stringify({ currentKeyId: currentKeyId(), rotated: counts }, null, 2),
);
await db.end();
