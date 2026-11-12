import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
// Accept the legacy AI_KEY name from earlier .env files.
if (!process.env.AI_API_KEY && process.env.AI_KEY)
  process.env.AI_API_KEY = process.env.AI_KEY;
const schema = z.object({
  BAEPAL_INTEGRATIONS_JSON: z.string().max(65536).optional(),
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
  // Hosted model adapter (OpenAI-compatible Chat Completions API).
  AI_MODE: z.enum(["deterministic", "openai"]).default("deterministic"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  // Explicit opt-in for a public *Sandbox-only* hackathon deployment (e.g. Render).
  HACKATHON_SANDBOX_DEPLOY: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z.string().default("development"),
});
export const config = schema.parse(process.env);
if (
  config.NODE_ENV === "production" &&
  config.HACKATHON_SANDBOX_DEPLOY !== "true"
)
  throw new Error(
    "Production release is disabled pending the documented security and operational gates. Set HACKATHON_SANDBOX_DEPLOY=true only for a Sandbox/mock judge demo.",
  );
if (
  config.PAYPAL_MODE === "sandbox" &&
  (!config.PAYPAL_CLIENT_ID ||
    !config.PAYPAL_CLIENT_SECRET ||
    !config.PAYPAL_MERCHANT_ID)
)
  throw new Error(
    "Sandbox requires PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MERCHANT_ID in environment settings (PAYPAL_WEBHOOK_ID is optional; webhooks are rejected until it is set).",
  );
if (config.AI_MODE === "openai" && !config.AI_API_KEY)
  console.warn(
    "AI_MODE=openai but AI_API_KEY is empty; AI features will use the labeled deterministic fallback.",
  );
