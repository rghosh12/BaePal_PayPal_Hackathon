import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const schema = z.object({
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().default(4000),
  SESSION_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  PAYPAL_MODE: z.enum(["mock", "sandbox"]).default("mock"),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_MERCHANT_ID: z.string().default(""),
  PAYPAL_WEBHOOK_ID: z.string().default(""),
  EMAIL_MODE: z.literal("local").default("local"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z.string().default("development"),
});
export const config = schema.parse(process.env);
if (config.NODE_ENV === "production")
  throw new Error(
    "Production release is disabled pending the documented security and operational gates.",
  );
if (
  config.PAYPAL_MODE === "sandbox" &&
  (!config.PAYPAL_CLIENT_ID ||
    !config.PAYPAL_CLIENT_SECRET ||
    !config.PAYPAL_MERCHANT_ID ||
    !config.PAYPAL_WEBHOOK_ID)
)
  throw new Error(
    "Sandbox requires client ID, secret, merchant ID and webhook ID in environment settings.",
  );
