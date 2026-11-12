// `pnpm check:keys` — verifies configured PayPal Sandbox and AI credentials
// without moving money: OAuth token, a CREATED (never approved) order bound to
// the merchant ID, and one tiny model completion. Prints no secrets.
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { SandboxPayPal } from "./providers/paypal.js";
import { aiDescriptor, aiEnabled, interpretPreferences } from "./providers/llm.js";

let failed = false;
const ok = (m: string) => console.log(`  ✔ ${m}`);
const bad = (m: string) => {
  failed = true;
  console.log(`  ✘ ${m}`);
};

console.log(`PayPal (PAYPAL_MODE=${config.PAYPAL_MODE})`);
if (config.PAYPAL_MODE !== "sandbox") {
  console.log("  – mock mode: no PayPal calls. Set PAYPAL_MODE=sandbox to use real Sandbox.");
} else {
  const pp = new SandboxPayPal();
  try {
    await pp.accessToken();
    ok("OAuth client ID/secret accepted by api-m.sandbox.paypal.com");
    const order = await pp.createOrder(100, randomUUID(), randomUUID());
    const payee = order.purchase_units?.[0]?.payee?.merchant_id;
    if (order.id && order.status) ok(`Created unapproved test order ${order.id} (${order.status}); it simply expires`);
    if (payee === config.PAYPAL_MERCHANT_ID) ok("PAYPAL_MERCHANT_ID matches the order payee");
    else bad(`PAYPAL_MERCHANT_ID does not match the payee PayPal returned (${payee ?? "none"}). Use the Sandbox business account's Account ID.`);
    if (order.links?.some((l: any) => ["payer-action", "approve"].includes(l.rel))) ok("Approval link returned");
  } catch (e) {
    bad(`${(e as Error).message}. Check the logged PayPal error above (wrong secret, or merchant ID not owned by this app).`);
  }
  if (!config.PAYPAL_WEBHOOK_ID) console.log("  – PAYPAL_WEBHOOK_ID not set: webhooks are rejected (checkout/capture/refund still work).");
}

console.log(`AI (AI_MODE=${config.AI_MODE})`);
if (!aiEnabled()) {
  console.log("  – not configured: features use the labeled deterministic fallback.");
} else {
  const d = aiDescriptor();
  const result = await interpretPreferences("I love slow coffee mornings and small live music shows.");
  if (result.source === "model")
    ok(`${d.model} @ ${d.provider} answered in ${result.run.durationMs} ms → tags: ${result.tags.map((t) => t.tag).join(", ") || "(none)"}`);
  else bad(`Model call failed (${result.run.outcome}). Check AI_BASE_URL, AI_MODEL and AI_API_KEY.`);
}
process.exit(failed ? 1 : 0);
