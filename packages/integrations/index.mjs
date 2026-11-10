import { z } from "zod";
export const registry = Object.freeze([
  {
    id: "astropods",
    label: "Astropods",
    kind: "gateway",
    operations: ["plan", "explain", "embed"],
  },
  { id: "elastic", label: "Elastic", kind: "gateway", operations: ["search"] },
  {
    id: "channel3",
    label: "Channel3",
    kind: "gateway",
    operations: ["products"],
  },
  { id: "kernel", label: "KERNEL", kind: "gateway", operations: ["venues"] },
  {
    id: "zapier",
    label: "Zapier",
    kind: "gateway",
    operations: ["handoffPreview"],
  },
  { id: "paypal", label: "PayPal", kind: "native", operations: [] },
  { id: "render", label: "Render", kind: "deployment", operations: [] },
  { id: "apimatic", label: "APIMatic", kind: "tooling", operations: [] },
  { id: "postman", label: "Postman / Newman", kind: "tooling", operations: [] },
  {
    id: "agstudio",
    label: "AG Grid / AG Studio",
    kind: "licensed-ui",
    operations: [],
  },
  { id: "bryntum", label: "Bryntum", kind: "licensed-ui", operations: [] },
]);
export class IntegrationError extends Error {
  constructor(code, status = 503) {
    super(
      {
        INTEGRATION_DISABLED: "This integration is not enabled.",
        INTEGRATION_CONFIG:
          "This integration needs valid server configuration.",
        INTEGRATION_INPUT:
          "Choose valid preview inputs and explicitly allow external processing.",
        INTEGRATION_TIMEOUT: "The provider did not respond in time.",
        INTEGRATION_RATE_LIMIT: "The provider is busy. Please try later.",
        INTEGRATION_UPSTREAM: "The provider request could not be completed.",
        INTEGRATION_RESPONSE: "The provider returned an unsupported response.",
      }[code] || "Integration unavailable.",
    );
    this.name = "IntegrationError";
    this.code = code;
    this.status = status;
  }
}
// Only operators supply destinations. Never accept a URL or headers from an API request.
const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value),
        host = u.hostname.toLowerCase();
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (!u.port || u.port === "443") &&
        host.includes(".") &&
        !host.includes(":") &&
        !/^\d+(\.\d+){3}$/.test(host) &&
        !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
      );
    } catch {
      return false;
    }
  });
const entrySchema = z
  .object({
    enabled: z.boolean(),
    protocol: z.literal("baepal-gateway-v1"),
    baseUrl: httpsUrl,
    auth: z.enum(["bearer", "api-key"]),
    token: z
      .string()
      .min(8)
      .max(8192)
      .refine(
        (v) => !/[\r\n]/.test(v) && !/replace|placeholder|your[_-]/i.test(v),
      ),
    operations: z.array(z.string()).min(1).max(8),
    timeoutMs: z.number().int().min(100).max(15000).default(8000),
  })
  .strict();
function readConfiguration(raw) {
  if (!raw) return { providers: {}, invalid: false };
  try {
    if (typeof raw !== "string" || raw.length > 65536) throw Error();
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !value.providers ||
      Array.isArray(value.providers) ||
      typeof value.providers !== "object" ||
      Object.keys(value).some((k) => !["version", "providers"].includes(k))
    )
      throw Error();
    if (
      Object.keys(value.providers).some(
        (id) => !registry.some((p) => p.id === id && p.kind === "gateway"),
      )
    )
      throw Error();
    return { providers: value.providers, invalid: false };
  } catch {
    return { providers: {}, invalid: true };
  }
}
function configured(raw, id) {
  const provider = registry.find((p) => p.id === id && p.kind === "gateway");
  if (!provider) return { state: "setup_required", operations: [] };
  const root = readConfiguration(raw),
    entry = root.providers[id];
  if (root.invalid) return { state: "invalid", operations: [] };
  if (entry === undefined) return { state: "disabled", operations: [] };
  // Disabled templates are intentionally incomplete. No network call is permitted.
  if (entry && entry.enabled === false)
    return { state: "disabled", operations: [] };
  const parsed = entrySchema.safeParse(entry);
  if (
    !parsed.success ||
    parsed.data.operations.some((op) => !provider.operations.includes(op))
  )
    return { state: "invalid", operations: [] };
  return {
    state: "configured_unverified",
    operations: parsed.data.operations,
    config: parsed.data,
  };
}
export function integrationStatus(raw) {
  return {
    contractVersion: "baepal-gateway-v1",
    configurationValid: !readConfiguration(raw).invalid,
    providers: registry.map((p) => {
      const c = configured(raw, p.id);
      return {
        id: p.id,
        label: p.label,
        kind: p.kind,
        state: c.state,
        operations: c.operations,
      };
    }),
  };
}
const interests = z
  .array(z.enum(["books", "coffee", "outdoors", "arts", "music", "games"]))
  .min(1)
  .max(6);
const text = z.string().trim().min(1).max(300);
const externalUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return httpsUrl.safeParse(url.href).success;
    } catch {
      return false;
    }
  });
const inputs = {
  plan: z
    .object({
      interests,
      options: z
        .array(
          z
            .object({
              id: z.string().regex(/^[\w-]{1,80}$/),
              title: text,
              activity: text,
              priceCents: z.number().int().min(0).max(100000),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  explain: z.object({ interests, sharedInterests: interests }).strict(),
  embed: z
    .object({
      features: z
        .record(
          z.enum(["books", "coffee", "outdoors", "arts", "music", "games"]),
          z.number().min(0).max(1),
        )
        .refine((v) => Object.keys(v).length > 0),
    })
    .strict(),
  search: z
    .object({
      vector: z.array(z.number().finite()).min(1).max(3072),
      candidateIds: z.array(z.string().uuid()).max(100),
    })
    .strict(),
  products: z.object({ interests }).strict(),
  venues: z.object({ interests, city: z.literal("Seattle") }).strict(),
  handoffPreview: z
    .object({
      activity: z.enum([
        "Art",
        "Coffee",
        "Outdoors",
        "Music",
        "Games",
        "Books",
      ]),
      city: z.literal("Seattle"),
    })
    .strict(),
};
const outputs = {
  plan: z
    .object({
      suggestions: z
        .array(
          z
            .object({
              id: z.string().max(80),
              reason: z.string().trim().min(1).max(600),
            })
            .strict(),
        )
        .min(1)
        .max(3),
    })
    .strict(),
  explain: z.object({ summary: z.string().trim().min(1).max(600) }).strict(),
  embed: z
    .object({
      vector: z.array(z.number().finite()).min(1).max(3072),
      model: text,
    })
    .strict(),
  search: z
    .object({
      candidates: z
        .array(
          z
            .object({ id: z.string().uuid(), score: z.number().finite() })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  products: z
    .object({
      items: z
        .array(z.object({ id: text, title: text, url: externalUrl }).strict())
        .max(10),
    })
    .strict(),
  venues: z
    .object({
      venues: z
        .array(
          z
            .object({ name: text, description: text, url: externalUrl })
            .strict(),
        )
        .max(10),
    })
    .strict(),
  handoffPreview: z
    .object({ summary: z.string().trim().min(1).max(600), destination: text })
    .strict(),
};
export const previewProviders = Object.freeze({
  plan: "astropods",
  explain: "astropods",
  products: "channel3",
  venues: "kernel",
  handoffPreview: "zapier",
});
export function validatePreview(raw) {
  const parsed = z
    .object({
      operation: z.enum([
        "plan",
        "explain",
        "products",
        "venues",
        "handoffPreview",
      ]),
      allowExternalProcessing: z.literal(true),
      input: z.unknown(),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success) throw new IntegrationError("INTEGRATION_INPUT", 400);
  const value = parsed.data,
    input = inputs[value.operation].safeParse(value.input);
  if (!input.success) throw new IntegrationError("INTEGRATION_INPUT", 400);
  return {
    ...value,
    input: input.data,
    provider: previewProviders[value.operation],
  };
}
async function boundedJSON(response) {
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  )
    throw new IntegrationError("INTEGRATION_RESPONSE", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new IntegrationError("INTEGRATION_RESPONSE", 502);
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new IntegrationError("INTEGRATION_RESPONSE", 502);
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError("INTEGRATION_RESPONSE", 502);
  } finally {
    reader.releaseLock();
  }
}
export function createIntegrationHub(
  raw,
  { fetchImpl = globalThis.fetch } = {},
) {
  return {
    status: () => integrationStatus(raw),
    async invoke(provider, operation, input, permission) {
      if (permission?.allowExternalProcessing !== true)
        throw new IntegrationError("INTEGRATION_INPUT", 400);
      const entry = configured(raw, provider);
      if (entry.state === "disabled")
        throw new IntegrationError("INTEGRATION_DISABLED");
      if (!entry.config) throw new IntegrationError("INTEGRATION_CONFIG");
      if (!entry.operations.includes(operation) || !inputs[operation])
        throw new IntegrationError("INTEGRATION_INPUT", 400);
      const parsed = inputs[operation].safeParse(input);
      if (!parsed.success) throw new IntegrationError("INTEGRATION_INPUT", 400);
      const config = entry.config,
        controller = new AbortController(),
        requestId = crypto.randomUUID(),
        start = Date.now();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const endpoint = new URL(
          config.baseUrl.replace(/\/$/, "") + "/" + operation,
        );
        const response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-BaePal-Contract": "baepal-gateway-v1",
            "X-Request-ID": requestId,
            ...(config.auth === "bearer"
              ? { Authorization: `Bearer ${config.token}` }
              : { "X-API-Key": config.token }),
          },
          body: JSON.stringify({
            version: 1,
            operation,
            requestId,
            input: parsed.data,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new IntegrationError(
            response.status === 429
              ? "INTEGRATION_RATE_LIMIT"
              : "INTEGRATION_UPSTREAM",
            response.status === 429 ? 503 : 502,
          );
        }
        const envelope = z
          .object({ version: z.literal(1), data: outputs[operation] })
          .strict()
          .safeParse(await boundedJSON(response));
        if (!envelope.success)
          throw new IntegrationError("INTEGRATION_RESPONSE", 502);
        const data = envelope.data.data;
        if (JSON.stringify(data).includes(config.token))
          throw new IntegrationError("INTEGRATION_RESPONSE", 502);
        if (
          operation === "plan" &&
          (new Set(data.suggestions.map((x) => x.id)).size !==
            data.suggestions.length ||
            data.suggestions.some(
              (x) => !parsed.data.options.some((o) => o.id === x.id),
            ))
        )
          throw new IntegrationError("INTEGRATION_RESPONSE", 502);
        if (
          operation === "search" &&
          data.candidates.some((x) => !parsed.data.candidateIds.includes(x.id))
        )
          throw new IntegrationError("INTEGRATION_RESPONSE", 502);
        return {
          data,
          evidence: {
            provider,
            operation,
            mode: "gateway",
            requestId,
            durationMs: Date.now() - start,
            verifiedNativeProvider: false,
          },
        };
      } catch (e) {
        if (controller.signal.aborted)
          throw new IntegrationError("INTEGRATION_TIMEOUT", 504);
        if (e instanceof IntegrationError) throw e;
        throw new IntegrationError("INTEGRATION_UPSTREAM", 502);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Called only after each application has authorized the plan and filtered its catalogue.
export async function rankCatalogue(raw, eligibleOptions, permission) {
  if (permission?.allowExternalProcessing !== true)
    throw new IntegrationError("INTEGRATION_INPUT", 400);
  if (!eligibleOptions.length) return { options: [], evidence: null };
  const categories = {
    Art: "arts",
    Coffee: "coffee",
    Outdoors: "outdoors",
    Music: "music",
    Games: "games",
    Books: "books",
  };
  const interests = [
    ...new Set(
      eligibleOptions.map((x) => categories[x.activity]).filter(Boolean),
    ),
  ];
  const result = await createIntegrationHub(raw).invoke(
    "astropods",
    "plan",
    {
      interests: interests.length ? interests : ["arts"],
      options: eligibleOptions.map((x) => ({
        id: x.id,
        title: x.title,
        activity: x.activity,
        priceCents: x.price_cents,
      })),
    },
    permission,
  );
  return {
    options: result.data.suggestions.map((x) => ({
      ...eligibleOptions.find((o) => o.id === x.id),
      reason: x.reason,
    })),
    evidence: result.evidence,
  };
}
