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
  // Comma-separated retired keys, decrypt-only during rotation.
  FIELD_ENCRYPTION_PREVIOUS_KEYS: z
    .string()
    .regex(/^([a-f0-9]{64})?(,[a-f0-9]{64})*$/i)
    .default(""),
  PAYPAL_MODE: z.enum(["mock", "sandbox"]).default("mock"),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_MERCHANT_ID: z.string().default(""),
  PAYPAL_WEBHOOK_ID: z.string().default(""),
  // local: write to .data/mail (development only). resend: Resend HTTP API.
  EMAIL_MODE: z.enum(["local", "resend"]).default("local"),
  EMAIL_FROM: z.string().default("BaePal <demo@baepal.invalid>"),
  EMAIL_API_KEY: z.string().default(""),
  // auto: development adapter approves after technical checks (labelled).
  // manual: uploads stay pending until a moderator approves them.
  MEDIA_MODERATION: z.enum(["auto", "manual"]).default("auto"),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  LINKEDIN_CLIENT_ID: z.string().default(""),
  LINKEDIN_CLIENT_SECRET: z.string().default(""),
  PLANNING_PASS_CENTS: z.coerce.number().int().min(100).max(5000).default(500),
  // Configurable retention windows (days). Not legal advice; financial
  // records and audit logs are never purged by these jobs.
  RETENTION_CLOSED_CHAT_DAYS: z.coerce.number().int().min(1).default(365),
  RETENTION_NOTIFICATION_DAYS: z.coerce.number().int().min(1).default(180),
  RETENTION_EMAIL_DAYS: z.coerce.number().int().min(1).default(30),
  RETENTION_WEBHOOK_DAYS: z.coerce.number().int().min(1).default(90),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  // Hosted model adapter (OpenAI-compatible Chat Completions API).
  AI_MODE: z.enum(["deterministic", "openai"]).default("deterministic"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  // Explicit opt-in for a public *Sandbox-only* hackathon deployment (e.g. Render).
  HACKATHON_SANDBOX_DEPLOY: z.enum(["true", "false"]).default("false"),
  // Fastify trustProxy: "true"/"false", a hop count, or proxy-addr names/CIDRs.
  TRUST_PROXY: z
    .string()
    .default("loopback")
    .transform((v) =>
      v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v,
    ),
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
if (config.EMAIL_MODE === "resend" && !config.EMAIL_API_KEY)
  throw new Error("EMAIL_MODE=resend requires EMAIL_API_KEY.");
if (config.AI_MODE === "openai" && !config.AI_API_KEY)
  console.warn(
    "AI_MODE=openai but AI_API_KEY is empty; AI features will use the labeled deterministic fallback.",
  );
