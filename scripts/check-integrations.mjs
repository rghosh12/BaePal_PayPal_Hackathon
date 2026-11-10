// Server-side operator check. Never prints raw config, endpoints, tokens, or exceptions.
import { readFile } from "node:fs/promises";
import { integrationStatus } from "../packages/integrations/index.mjs";
let raw = process.env.BAEPAL_INTEGRATIONS_JSON;
// The API's ignored local .env is an optional fallback, without exposing dotenv output.
if (raw === undefined) {
  const { default: dotenv } =
    await import("../apps/api/node_modules/dotenv/lib/main.js");
  try {
    raw = dotenv.parse(
      await readFile(new URL("../.env", import.meta.url)),
    ).BAEPAL_INTEGRATIONS_JSON;
  } catch (error) {
    if (error.code !== "ENOENT")
      throw Error("Could not read local configuration.");
  }
}
const status = integrationStatus(raw);
console.log(JSON.stringify(status, null, 2));
if (
  !status.configurationValid ||
  status.providers.some((p) => p.state === "invalid")
)
  process.exitCode = 1;
