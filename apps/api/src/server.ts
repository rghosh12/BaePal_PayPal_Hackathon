import { buildApp } from "./app.js";
import { config } from "./config.js";
import { workerTick } from "./payments.js";
import { db } from "./db.js";
import { provider, SandboxPayPal } from "./providers/paypal.js";
import { aiDescriptor } from "./providers/llm.js";
const { app } = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.PORT });
const timer = setInterval(() => {
  void workerTick().catch(() =>
    console.error("Worker tick failed; durable jobs remain queued."),
  );
}, 5000);
timer.unref();
console.log(
  `BaePal API ready on ${config.PORT}; payment mode: ${config.PAYPAL_MODE}; AI: ${JSON.stringify(aiDescriptor())}`,
);
if (provider instanceof SandboxPayPal)
  provider
    .accessToken()
    .then(() => console.log("PayPal Sandbox credentials accepted."))
    .catch(() =>
      console.error(
        "PayPal Sandbox credentials were rejected. Run `pnpm check:keys` for details.",
      ),
    );
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    await db.end();
    process.exit(0);
  });
